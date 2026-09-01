import { createHash, randomUUID } from 'node:crypto'
import { appendFile, link, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import {
  EvaluationBudgetController,
  EvaluationBudgetJournalError,
  type EvaluationBudgetJournalEntry,
  type EvaluationBudgetLimits,
} from '@/v5/evaluation-budget'

export const V5_EVALUATION_RUNNER_PROTOCOL_VERSION = 'reffo-v5-nonprod-blind-eval-runner-v2' as const
export const V5_EVALUATION_CHECKPOINT_VERSION = 'reffo-v5-evaluation-checkpoint-v1' as const
export const V5_EVALUATION_USAGE_VERSION = 'reffo-v5-evaluation-usage-v2' as const
export const EXPECTED_NONPROD_HISTORY_SHA256 = '070466694c2761a9af674ff31cb6bef00b38c995836885e44d0b5e7078e4646a'
export const V5_NON_EXTRACTION_CALL_UPPER_BOUND = 19
export const V5_GENERATION_NON_EXTRACTION_CALL_UPPER_BOUND = 17
export const V5_JUDGE_CALL_UPPER_BOUND = 2

export type EvaluationRunStage = 'extract-only' | 'generation-only' | 'judge-only' | 'full'

export const CASE_2_CANARY_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 28,
  maxInputTokens: 350_000,
  maxOutputTokens: 100_000,
  maxWallTimeMs: 10 * 60_000,
}

export const EXTRACT_ONLY_CANARY_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 6,
  maxInputTokens: 120_000,
  maxOutputTokens: 50_000,
  maxWallTimeMs: 5 * 60_000,
}

export const JUDGE_ONLY_CANARY_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 2,
  maxInputTokens: 150_000,
  maxOutputTokens: 20_000,
  maxWallTimeMs: 5 * 60_000,
}

export const FULL_RUN_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 220,
  maxInputTokens: 2_500_000,
  maxOutputTokens: 500_000,
  maxWallTimeMs: 60 * 60_000,
}

export const FULL_CASE_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 36,
  maxInputTokens: 450_000,
  maxOutputTokens: 100_000,
  maxWallTimeMs: 10 * 60_000,
}

export interface EvaluationRunnerCliOptions {
  historyPath: string
  outputRoot: string
  selectedCases: number[]
  dryRun: boolean
  live: boolean
  resume: boolean
  failFast: true
  outputWasExplicit: boolean
  help: boolean
  stage: EvaluationRunStage
  sourceRun: string | null
}

export interface EvaluationCheckpointFingerprints {
  inputDigest: string
  implementationDigest: string
  configDigest: string
}

export type EvaluationCheckpointKind =
  | 'run_manifest'
  | 'resume_extraction'
  | 'v5_result'
  | 'blind_eval_input'
  | 'generation_summary'
  | 'blind_ab'
  | 'case_summary'

export interface EvaluationCheckpointEnvelope<T> {
  checkpointVersion: typeof V5_EVALUATION_CHECKPOINT_VERSION
  kind: EvaluationCheckpointKind
  caseId: string
  createdAt: string
  fingerprints: EvaluationCheckpointFingerprints
  payloadSha256: string
  payload: T
}

export interface EvaluationUsageEntry {
  usageVersion: typeof V5_EVALUATION_USAGE_VERSION
  at: string
  reservationId: string
  caseId: string
  outcome: 'success' | 'failure'
  promptVersion: string
  model: string
  inputTokens: number | null
  outputTokens: number | null
  finishReason: string | null
  requestedMaxOutputTokens: number
  providerRequestId: string | null
  latencyMs: number | null
  error?: { name: string; message: string; code?: string }
}

export class EvaluationRunnerSafetyError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EvaluationRunnerSafetyError'
  }
}

export function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  return value
}

export function digestJson(value: unknown) {
  return sha256(JSON.stringify(canonicalize(value)))
}

function parseCaseSelector(value: string) {
  if (!value.trim()) throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', '--cases 不能为空')
  const selected = new Set<number>()
  for (const part of value.split(',')) {
    const token = part.trim()
    const range = token.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start > end) throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', `案例范围无效：${token}`)
      for (let current = start; current <= end; current += 1) selected.add(current)
      continue
    }
    if (!/^\d+$/.test(token)) {
      throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', `无法识别案例编号：${token}`)
    }
    selected.add(Number(token))
  }
  const result = [...selected].sort((left, right) => left - right)
  if (result.some(value => value < 1 || value > 9)) {
    throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', '案例编号必须位于 1–9')
  }
  return result
}

function requireFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new EvaluationRunnerSafetyError('MISSING_FLAG_VALUE', `${flag} 需要一个值`)
  }
  return value
}

export function parseEvaluationRunnerArgs(
  argv: string[],
  input: { backendRoot: string; now?: Date } 
): EvaluationRunnerCliOptions {
  const now = input.now ?? new Date()
  let historyPath = resolve(
    input.backendRoot,
    '../.artifacts/supabase/nonprod-20260829-162532/database/resume_histories.json'
  )
  let outputRoot = resolve(
    input.backendRoot,
    `../.artifacts/v5-nonprod-nine-safe-${now.toISOString().replace(/[:.]/g, '-')}`
  )
  let selectedCases = [2]
  let dryRun = true
  let live = false
  let dryRunWasExplicit = false
  let resume = false
  let outputWasExplicit = false
  let help = false
  let stage: EvaluationRunStage = 'full'
  let sourceRun: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--history') {
      historyPath = resolve(process.cwd(), requireFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--output') {
      outputRoot = resolve(process.cwd(), requireFlagValue(argv, index, arg))
      outputWasExplicit = true
      index += 1
    } else if (arg === '--cases') {
      selectedCases = parseCaseSelector(requireFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--stage') {
      const value = requireFlagValue(argv, index, arg)
      if (!['extract-only', 'generation-only', 'judge-only', 'full'].includes(value)) {
        throw new EvaluationRunnerSafetyError('INVALID_STAGE', `无法识别运行阶段：${value}`)
      }
      stage = value as EvaluationRunStage
      index += 1
    } else if (arg === '--source-run') {
      sourceRun = resolve(process.cwd(), requireFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--dry-run') {
      dryRun = true
      dryRunWasExplicit = true
    } else if (arg === '--live') {
      live = true
      dryRun = false
    } else if (arg === '--resume') {
      resume = true
    } else if (arg === '--fail-fast') {
      // Fail-fast is mandatory for this production-data evaluator. The flag is
      // accepted so invocations can state that safety decision explicitly.
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else {
      throw new EvaluationRunnerSafetyError('UNKNOWN_ARGUMENT', `未知参数：${arg}`)
    }
  }

  if (resume && !outputWasExplicit) {
    throw new EvaluationRunnerSafetyError('RESUME_REQUIRES_OUTPUT', '--resume 必须同时提供明确的 --output 目录')
  }
  if (live && dryRunWasExplicit) {
    throw new EvaluationRunnerSafetyError('CONFLICTING_RUN_MODE', '--live 与 --dry-run 不能同时使用')
  }
  if (live && !outputWasExplicit) {
    throw new EvaluationRunnerSafetyError('LIVE_REQUIRES_OUTPUT', '--live 必须提供明确的全新或恢复 --output 目录')
  }
  if (stage === 'judge-only' && !sourceRun) {
    throw new EvaluationRunnerSafetyError('JUDGE_SOURCE_RUN_REQUIRED', 'judge-only 必须提供冻结的 --source-run 目录')
  }
  if (stage !== 'judge-only' && sourceRun) {
    throw new EvaluationRunnerSafetyError('SOURCE_RUN_STAGE_MISMATCH', '--source-run 只允许用于 judge-only')
  }

  return {
    historyPath,
    outputRoot,
    selectedCases,
    dryRun,
    live,
    resume,
    failFast: true,
    outputWasExplicit,
    help,
    stage,
    sourceRun,
  }
}

export function budgetProfileForCases(
  selectedCases: readonly number[],
  stage: EvaluationRunStage = 'full'
) {
  const isCase2Canary = selectedCases.length === 1 && selectedCases[0] === 2
  if (isCase2Canary && stage === 'extract-only') {
    return {
      name: 'case_2_extract_canary' as const,
      runLimits: { ...EXTRACT_ONLY_CANARY_LIMITS },
      caseLimits: { ...EXTRACT_ONLY_CANARY_LIMITS },
    }
  }
  if (isCase2Canary && stage === 'judge-only') {
    return {
      name: 'case_2_judge_canary' as const,
      runLimits: { ...JUDGE_ONLY_CANARY_LIMITS },
      caseLimits: { ...JUDGE_ONLY_CANARY_LIMITS },
    }
  }
  return {
    name: isCase2Canary ? 'case_2_canary' as const : 'bounded_batch' as const,
    runLimits: { ...(isCase2Canary ? CASE_2_CANARY_LIMITS : FULL_RUN_LIMITS) },
    caseLimits: { ...(isCase2Canary ? CASE_2_CANARY_LIMITS : FULL_CASE_LIMITS) },
  }
}

export function v5CasePhysicalCallUpperBound(
  resumeChunks: number,
  stage: EvaluationRunStage = 'full'
) {
  if (!Number.isSafeInteger(resumeChunks) || resumeChunks < 1) {
    throw new EvaluationRunnerSafetyError('INVALID_RESUME_CHUNK_COUNT', 'resumeChunks 必须是正安全整数')
  }
  if (stage === 'extract-only') return resumeChunks * 2
  if (stage === 'judge-only') return V5_JUDGE_CALL_UPPER_BOUND
  return resumeChunks * 2 + (stage === 'generation-only'
    ? V5_GENERATION_NON_EXTRACTION_CALL_UPPER_BOUND
    : V5_NON_EXTRACTION_CALL_UPPER_BOUND)
}

export function assertResumeExtractionReplaySafe(input: {
  resume: boolean
  hasV5Checkpoint: boolean
  resumeDigest: string
  completedResumeDigests: ReadonlySet<string>
}) {
  if (
    input.resume
    && !input.hasV5Checkpoint
    && input.completedResumeDigests.has(input.resumeDigest)
  ) {
    throw new EvaluationRunnerSafetyError(
      'CROSS_PROCESS_EXTRACTION_CACHE_REPLAY_BLOCKED',
      '恢复运行需要重新提取已在此前进程处理过的同源简历；进程内可信缓存不可跨进程恢复，已拒绝重复外呼。'
    )
  }
}

export function assertStrictDeepSeekEndpoint(value: string | undefined) {
  const configured = value?.trim() || 'https://api.deepseek.com'
  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch (cause) {
    throw new EvaluationRunnerSafetyError('INVALID_PROVIDER_ENDPOINT', 'OPENAI_BASE_URL 不是合法 URL', {
      cause: cause instanceof Error ? cause : undefined,
    })
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'api.deepseek.com'
    || parsed.port !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new EvaluationRunnerSafetyError(
      'UNSAFE_PROVIDER_ENDPOINT',
      `评测只允许 https://api.deepseek.com 根地址，当前为 ${parsed.toString()}`
    )
  }
  return 'https://api.deepseek.com'
}

export async function assertOutputDirectoryPolicy(path: string, resume: boolean) {
  let entries: string[]
  try {
    entries = await readdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (resume) {
        throw new EvaluationRunnerSafetyError('RESUME_OUTPUT_MISSING', `恢复目录不存在：${path}`)
      }
      return
    }
    throw error
  }
  if (resume) {
    if (entries.length === 0) {
      throw new EvaluationRunnerSafetyError('RESUME_OUTPUT_EMPTY', `恢复目录为空：${path}`)
    }
    return
  }
  if (entries.length > 0) {
    throw new EvaluationRunnerSafetyError(
      'OUTPUT_DIRECTORY_NOT_EMPTY',
      `输出目录非空，拒绝混用历史结果：${path}`
    )
  }
}

export interface EvaluationRunLock {
  path: string
  release(): Promise<void>
}

export async function acquireEvaluationRunLock(input: {
  outputRoot: string
  resume: boolean
}): Promise<EvaluationRunLock> {
  await mkdir(input.outputRoot, { recursive: true, mode: 0o700 })
  const lockPath = resolve(input.outputRoot, '.reffo-v5-evaluation.lock')
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(lockPath, 'wx', 0o600)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new EvaluationRunnerSafetyError(
        'RUN_LOCK_HELD',
        `输出目录已有运行锁：${lockPath}。请先人工核验原进程已停止，再处理残留锁。`
      )
    }
    throw cause
  }

  let released = false
  const release = async () => {
    if (released) return
    released = true
    try {
      await unlink(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      protocolVersion: V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString(),
      resume: input.resume,
    })}\n`)
    await handle.sync()
  } catch (cause) {
    await handle.close().catch(() => undefined)
    await release()
    throw cause
  }
  await handle.close()

  if (!input.resume) {
    const unexpected = (await readdir(input.outputRoot)).filter(name => name !== basename(lockPath))
    if (unexpected.length > 0) {
      await release()
      throw new EvaluationRunnerSafetyError(
        'OUTPUT_DIRECTORY_RACE_DETECTED',
        `获取运行锁时输出目录出现其他内容，拒绝继续：${unexpected.join(', ')}`
      )
    }
  }

  return { path: lockPath, release }
}

async function implementationFiles(root: string) {
  const files: string[] = []
  const visit = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(child)
    }
  }
  await visit(resolve(root, 'src'))
  files.push(resolve(root, 'scripts/run-v5-nonprod-nine-case-blind-eval.ts'))
  files.push(resolve(root, 'package.json'))
  files.push(resolve(root, 'bun.lock'))
  files.push(resolve(root, 'tsconfig.json'))
  return files.sort()
}

export async function createImplementationDigest(backendRoot: string) {
  const rows = []
  for (const path of await implementationFiles(backendRoot)) {
    rows.push({ path: relative(backendRoot, path), sha256: sha256(await readFile(path)) })
  }
  return digestJson(rows)
}

export async function atomicWriteText(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

export async function atomicWriteJson(path: string, value: unknown) {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function atomicWriteJsonExclusive(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  try {
    await link(temporary, path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new EvaluationRunnerSafetyError(
        'CHECKPOINT_ALREADY_EXISTS',
        `拒绝覆盖已有检查点：${path}`
      )
    }
    throw cause
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

export async function writeCheckpoint<T>(input: {
  path: string
  kind: EvaluationCheckpointKind
  caseId: string
  fingerprints: EvaluationCheckpointFingerprints
  payload: T
}) {
  const envelope: EvaluationCheckpointEnvelope<T> = {
    checkpointVersion: V5_EVALUATION_CHECKPOINT_VERSION,
    kind: input.kind,
    caseId: input.caseId,
    createdAt: new Date().toISOString(),
    fingerprints: { ...input.fingerprints },
    payloadSha256: digestJson(input.payload),
    payload: input.payload,
  }
  await atomicWriteJsonExclusive(input.path, envelope)
  return envelope
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readCheckpointUnbound<T>(input: {
  path: string
  kind: EvaluationCheckpointKind
  caseId: string
}): Promise<EvaluationCheckpointEnvelope<T> | null> {
  let raw: string
  try {
    raw = await readFile(input.path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new EvaluationRunnerSafetyError('CHECKPOINT_CORRUPT', `检查点 JSON 损坏：${input.path}`, {
      cause: cause instanceof Error ? cause : undefined,
    })
  }
  if (!isRecord(parsed) || parsed.checkpointVersion !== V5_EVALUATION_CHECKPOINT_VERSION) {
    throw new EvaluationRunnerSafetyError(
      'CHECKPOINT_LEGACY_OR_INVALID',
      `拒绝复用旧版裸 JSON 或未知检查点：${input.path}`
    )
  }
  const envelope = parsed as unknown as EvaluationCheckpointEnvelope<T>
  if (envelope.kind !== input.kind || envelope.caseId !== input.caseId) {
    throw new EvaluationRunnerSafetyError('CHECKPOINT_IDENTITY_MISMATCH', `检查点身份不匹配：${input.path}`)
  }
  if (envelope.payloadSha256 !== digestJson(envelope.payload)) {
    throw new EvaluationRunnerSafetyError('CHECKPOINT_PAYLOAD_DIGEST_MISMATCH', `检查点内容摘要不匹配：${input.path}`)
  }
  return envelope
}

export async function readCheckpoint<T>(input: {
  path: string
  kind: EvaluationCheckpointKind
  caseId: string
  fingerprints: EvaluationCheckpointFingerprints
}): Promise<EvaluationCheckpointEnvelope<T> | null> {
  const envelope = await readCheckpointUnbound<T>(input)
  if (!envelope) return null
  for (const key of ['inputDigest', 'implementationDigest', 'configDigest'] as const) {
    if (envelope.fingerprints?.[key] !== input.fingerprints[key]) {
      throw new EvaluationRunnerSafetyError(
        'CHECKPOINT_FINGERPRINT_MISMATCH',
        `检查点 ${key} 不匹配，拒绝跨输入、实现或配置复用：${input.path}`
      )
    }
  }
  return envelope
}

export function createAppendOnlyJsonlSink<T>(path: string) {
  let tail = Promise.resolve()
  return async (entry: T) => {
    const line = `${JSON.stringify(entry)}\n`
    tail = tail.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await appendFile(path, line, { encoding: 'utf8', mode: 0o600 })
    })
    await tail
  }
}

export async function readJsonlStrict<T>(path: string): Promise<T[] | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const lines = raw.split('\n').filter(line => line.length > 0)
  if (lines.length === 0) throw new EvaluationBudgetJournalError(`JSONL journal is empty: ${path}`)
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as T
    } catch (cause) {
      throw new EvaluationBudgetJournalError(`JSONL journal is corrupt at line ${index + 1}: ${path}`, {
        cause: cause instanceof Error ? cause : undefined,
      })
    }
  })
}

export function estimateProviderInputTokens(input: ChatCompletionInput) {
  // One UTF-8 byte per token is deliberately conservative for both Chinese and
  // Latin prompts. Pending reservations are replaced with actual provider usage.
  const messageBytes = Buffer.byteLength(JSON.stringify(input.messages), 'utf8')
  const transportAllowance = input.structuredOutput ? 8_000 : 1_000
  return messageBytes + transportAllowance
}

function serializedError(error: unknown) {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return {
      name: error.name || 'Error',
      message: error.message.slice(0, 500),
      ...(code ? { code } : {}),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 500) }
}

function combineSignals(signals: Array<AbortSignal | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  return AbortSignal.any(active)
}

/**
 * The wrapped provider must be the direct DeepSeek provider. Reservation happens
 * immediately before every SDK invocation; no fallback/retry provider belongs
 * outside or inside this wrapper.
 */
export class BudgetedEvaluationProvider implements LlmProvider {
  private readonly activeCalls = new Set<Promise<ChatCompletionResult>>()

  constructor(private readonly input: {
    directProvider: LlmProvider
    budget: EvaluationBudgetController
    caseId: string
    model: string
    usageSink: (entry: EvaluationUsageEntry) => Promise<void>
  }) {}

  complete(request: ChatCompletionInput): Promise<ChatCompletionResult> {
    const operation = this.performComplete(request)
    this.activeCalls.add(operation)
    void operation.then(
      () => this.activeCalls.delete(operation),
      () => this.activeCalls.delete(operation)
    )
    return operation
  }

  async drain() {
    while (this.activeCalls.size > 0) {
      await Promise.allSettled([...this.activeCalls])
    }
  }

  private async performComplete(request: ChatCompletionInput): Promise<ChatCompletionResult> {
    if (request.model && request.model !== this.input.model) {
      throw new EvaluationRunnerSafetyError(
        'MODEL_OVERRIDE_BLOCKED',
        `评测期间禁止切换模型：${request.model}`
      )
    }
    const reservation = await this.input.budget.reservePhysicalCall({
      caseId: this.input.caseId,
      label: request.promptVersion ?? 'unknown',
      estimatedInputTokens: estimateProviderInputTokens(request),
      maxOutputTokens: request.maxOutputTokens ?? 8_192,
    })
    const startedAt = Date.now()
    try {
      const result = await this.input.directProvider.complete({
        ...request,
        model: this.input.model,
        maxProviderAttempts: 1,
        signal: combineSignals([reservation.signal, request.signal, request.stepContext?.signal]),
      })
      if (result.provider !== 'deepseek') {
        throw new EvaluationRunnerSafetyError(
          'NON_DEEPSEEK_PROVIDER_BLOCKED',
          `评测只接受 DeepSeek provider 响应，实际为 ${result.provider || 'unknown'}`
        )
      }
      await this.input.budget.settleSuccess(reservation, {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      })
      await this.input.usageSink({
        usageVersion: V5_EVALUATION_USAGE_VERSION,
        at: new Date().toISOString(),
        reservationId: reservation.reservationId,
        caseId: this.input.caseId,
        outcome: 'success',
        promptVersion: request.promptVersion ?? 'unknown',
        model: result.model,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        finishReason: result.finishReason ?? null,
        requestedMaxOutputTokens: request.maxOutputTokens ?? 8_192,
        providerRequestId: result.providerRequestId ?? null,
        latencyMs: result.latencyMs,
      })
      return result
    } catch (error) {
      const alreadySettled = this.input.budget.journal().some(entry => (
        entry.type === 'call_settled' && entry.reservationId === reservation.reservationId
      ))
      if (!alreadySettled) {
        try {
          await this.input.budget.settleFailure(reservation, error)
        } catch (accountedFailure) {
          error = accountedFailure
        }
      }
      try {
        await this.input.usageSink({
          usageVersion: V5_EVALUATION_USAGE_VERSION,
          at: new Date().toISOString(),
          reservationId: reservation.reservationId,
          caseId: this.input.caseId,
          outcome: 'failure',
          promptVersion: request.promptVersion ?? 'unknown',
          model: request.model ?? this.input.model,
          inputTokens: null,
          outputTokens: null,
          finishReason: null,
          requestedMaxOutputTokens: request.maxOutputTokens ?? 8_192,
          providerRequestId: null,
          latencyMs: Date.now() - startedAt,
          error: serializedError(error),
        })
      } catch (journalError) {
        throw new EvaluationRunnerSafetyError('USAGE_JOURNAL_WRITE_FAILED', 'usage journal 写入失败', {
          cause: journalError instanceof Error ? journalError : undefined,
        })
      }
      throw error
    }
  }
}

export async function restoreEvaluationBudget(input: {
  journalPath: string
  journalSink: (entry: EvaluationBudgetJournalEntry) => Promise<void>
}) {
  const entries = await readJsonlStrict<EvaluationBudgetJournalEntry>(input.journalPath)
  if (!entries) return null
  const budget = await EvaluationBudgetController.restore(entries, { journalSink: input.journalSink })
  const snapshot = budget.snapshot()
  if (snapshot.aborted || snapshot.terminal) {
    budget.dispose()
    throw new EvaluationRunnerSafetyError('TERMINAL_RUN_CANNOT_RESUME', '已有运行已进入终止状态，禁止自动恢复或重试')
  }
  if (snapshot.pendingReservations.length > 0) {
    budget.dispose()
    throw new EvaluationRunnerSafetyError(
      'PENDING_CALL_CANNOT_RESUME',
      'usage journal 存在结果未知的在途调用，禁止将其自动重试'
    )
  }
  return budget
}

export async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
