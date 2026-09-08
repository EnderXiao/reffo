import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { evaluationDeepSeekPolicy, parseDeepSeekThinking, parseDeepSeekExtractionThinking, resolveDeepSeekStageThinking, isResumeExtractionRequest } from '@/config/deepseek-thinking'
import type { DoubleOrderAbResult } from '@/v5/ab-evaluator'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import {
  DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
  DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
  DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
  splitResumeDocument,
} from '@/v5/chunked-resume-extraction'
import { EvaluationBudgetController, type EvaluationBudgetJournalEntry } from '@/v5/evaluation-budget'
import {
  buildP01ValidationTrace,
  bucketP01ValidationIssues,
  sanitizeP01ValidationObservation,
  type P01ValidationObservationV1,
  type P01ValidationIssueBucket,
} from '@/v5/p01-validation-diagnostics'
import {
  loadValidatedJudgeSourceRun,
  type JudgeSourceProvenance,
} from '@/v5/evaluation-judge-source'
import {
  BudgetedEvaluationProvider,
  EvaluationRunnerSafetyError,
  EXPECTED_NONPROD_HISTORY_SHA256,
  V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
  V5_EVALUATION_CHECKPOINT_VERSION,
  V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION,
  V5_GENERATION_NON_EXTRACTION_CALL_UPPER_BOUND,
  V5_JUDGE_CALL_UPPER_BOUND,
  V5_NON_EXTRACTION_CALL_UPPER_BOUND,
  acquireEvaluationRunLock,
  assertOutputDirectoryPolicy,
  assertResumeExtractionReplaySafe,
  assertStrictDeepSeekEndpoint,
  atomicWriteJson,
  atomicWriteText,
  budgetProfileForCases,
  createAppendOnlyJsonlSink,
  createExtractionImplementationDigest,
  createImplementationDigest,
  digestJson,
  isV5CodeGateDeliverable,
  parseEvaluationRunnerArgs,
  readCheckpoint,
  readJsonlStrict,
  restoreEvaluationBudget,
  sanitizeV5DeliveryDiagnostics,
  sha256,
  v5CasePhysicalCallUpperBound,
  v5CaseOutputTokenEnvelope,
  v5EvaluationComponentQuotas,
  writeCheckpoint,
  type EvaluationCheckpointFingerprints,
  type EvaluationRunStage,
  type EvaluationUsageEntry,
} from '@/v5/evaluation-runner-support'
import type {
  CanonicalSourceDocument,
  GeneratedResumeArtifact,
  V5DeliveryDiagnostics,
  V5WorkflowResult,
} from '@/v5/types'
import { V5_SCHEMA_VERSION, V5_WORKFLOW_VERSION } from '@/v5/types'
import { measureArtifactMarkdown } from '@/v5/validators'
import {
  V5_RESUME_EXTRACTION_CACHE_VERSION,
  createTrustedResumeExtractionCache,
  type ResumeExtractionCacheStats,
  type TrustedResumeExtractionCache,
  type TrustedResumeExtractionCacheOptions,
  type TrustedResumeExtractionCacheSnapshot,
  type TrustedResumeExtractionPartialSnapshot,
} from '@/v5/resume-extraction-cache'
import { resumeExtractionOutputTokenCapForBlocks } from '@/v5/prompt-compiler'

interface HistoryRecord {
  company: string
  position: string
  resume_content: string
  jd_content: string
  optimized_content: string
}

interface CaseSummary {
  caseNumber: number
  target: string
  runId: string
  state: string
  usedSafeFallback: boolean
  matchScore: number
  baselineGate: 'pass' | 'fail' | 'inconsistent'
  candidateGate: 'pass' | 'fail' | 'inconsistent'
  baselineScore: number
  candidateScore: number
  winner: 'baseline' | 'v5' | 'tie' | 'order_inconsistent'
  orderConsistent: boolean
  scoreDriftMax: number
  baselineChars: number
  candidateChars: number
  baselineBullets: number
  candidateBullets: number
  deliveryDiagnostics: V5DeliveryDiagnostics
}

interface GenerationCaseSummary {
  caseNumber: number
  target: string
  runId: string
  state: string
  usedSafeFallback: boolean
  usedAnyFallback: boolean
  deliveryDecision: V5WorkflowResult['deliveryDecision']
  qualityGates: V5WorkflowResult['qualityGates']
  matchScore: number
  candidateChars: number
  candidateBullets: number
  deliveryDiagnostics: V5DeliveryDiagnostics
}

interface BlindEvaluationInput {
  schemaVersion: typeof V5_SCHEMA_VERSION
  caseNumber: number
  target: string
  resumeEvidenceBundle: V5WorkflowResult['resumeEvidenceBundle']
  jobRequirementBundle: V5WorkflowResult['jobRequirementBundle']
  baselineArtifact: GeneratedResumeArtifact
  candidateArtifact: GeneratedResumeArtifact
}

interface CaseStatus {
  caseId: string
  caseNumber: number
  target: string
  stage: 'running' | 'extracted' | 'generated' | 'evaluated' | 'completed' | 'failed'
  updatedAt: string
  fingerprints: EvaluationCheckpointFingerprints
  error?: {
    name: string
    message: string
    code?: string
    issues?: P01ValidationIssueBucket[]
    validationIssues?: P01ValidationIssueBucket[]
    outputAudit?: {
      rawOutputDigest: string
      validatedOutputDigest: string
      normalizationApplied: boolean
      normalizationChangeCount: number
    }
  }
  budget: ReturnType<EvaluationBudgetController['snapshot']>
}

interface RunManifest {
  runId: string
  runnerProtocolVersion: typeof V5_EVALUATION_RUNNER_PROTOCOL_VERSION
  createdAt: string
  historyPath: string
  selectedCases: number[]
  stage: EvaluationRunStage
  sourceRun: string | null
  judgeSource: JudgeSourceProvenance | null
  budgetProfile: ReturnType<typeof budgetProfileForCases>
  provider: {
    endpoint: string
    model: string
    maxProviderAttempts: 1
    fallbackEnabled: false
    generationPolicy?: ReturnType<typeof evaluationDeepSeekPolicy>
    extractionPolicy?: ReturnType<typeof evaluationDeepSeekPolicy>
  }
  executionPolicy: {
    releaseGateMode: 'deterministic_product_delivery_v2'
    agentFactJudgeEnabled: false
    agentQualityJudgeEnabled: false
    artifactGenerationMode: 'dsl_v1' | 'writer_v1'
    jobTargetingPolicy?: 'job-targeted-v1'
    entryWritingPolicy?: 'entry-writing-v1'
    artifactRepairMax: 0
    interviewMode: 'deferred'
    componentQuotaPolicy: typeof V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION
  }
  extractionCache: {
    protocolVersion: typeof V5_RESUME_EXTRACTION_CACHE_VERSION
    implementationDigest: string
    configDigest: string
    persistence: 'validated_local_checkpoint_v1'
  }
}

const backendRoot = resolve(import.meta.dir, '..')

export function providerComponentQuotasForRun(input: {
  resume: boolean
  resumeChunks: number
  stage: EvaluationRunStage
  validatedShardIndexes: readonly number[]
  artifactGenerationMode?: 'dsl_v1' | 'writer_v1'
}) {
  // Historical usage is cumulative. Only new runs can shrink extraction
  // quotas to the missing shards without invalidating an existing journal.
  return v5EvaluationComponentQuotas(input.resumeChunks, input.stage, {
    ...(input.resume ? {} : { validatedShardIndexes: input.validatedShardIndexes }),
    artifactGenerationMode: input.artifactGenerationMode,
  })
}

export async function persistGenerationDiagnosticsBeforeResumeCache<T>(input: {
  persistGenerationDiagnostics: () => Promise<T>
  persistResumeExtraction: () => Promise<void>
}) {
  const diagnostics = await input.persistGenerationDiagnostics()
  await input.persistResumeExtraction()
  return diagnostics
}

export type EvaluationFailureCleanupStage =
  | 'generation_diagnostics'
  | 'fail_fast'
  | 'provider_drain'
  | 'resume_extraction_cache'
  | 'failed_status'

export type EvaluationFailureCleanupErrors = Partial<Record<EvaluationFailureCleanupStage, unknown>>

export const DEFAULT_EVALUATION_CLEANUP_TIMEOUT_MS = 5_000

export class EvaluationCleanupTimeoutError extends Error {
  readonly code = 'EVALUATION_CLEANUP_TIMEOUT' as const

  constructor(readonly stage: string, readonly timeoutMs: number) {
    super(`Evaluation cleanup stage ${stage} exceeded ${timeoutMs}ms`)
    this.name = 'EvaluationCleanupTimeoutError'
  }
}

async function runBoundedCleanup<T>(
  stage: string,
  action: () => T | Promise<T>,
  timeoutMs: number
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new EvaluationCleanupTimeoutError(stage, timeoutMs)),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface EvaluationFailureCleanupInput {
  persistFailureDiagnostics: () => Promise<void>
  triggerFailFast: () => Promise<void>
  drainProvider: () => Promise<void>
  persistResumeExtraction: () => Promise<void>
  writeFailedStatus: () => Promise<void>
  onStageError?: (
    stage: EvaluationFailureCleanupStage,
    error: unknown
  ) => void | Promise<void>
  cleanupTimeoutMs?: number
}

/**
 * Failure cleanup is intentionally best-effort per stage. In particular, a
 * non-critical P01 cache snapshot/write failure must never skip cancellation,
 * physical-call settlement, or the final failed status.
 */
export async function finalizeFailedEvaluationCase(input: EvaluationFailureCleanupInput) {
  const errors: EvaluationFailureCleanupErrors = {}
  const cleanupTimeoutMs = input.cleanupTimeoutMs ?? DEFAULT_EVALUATION_CLEANUP_TIMEOUT_MS
  const attempt = async (
    stage: EvaluationFailureCleanupStage,
    action: () => Promise<void>
  ) => {
    try {
      // Provider drain owns its request-settlement deadline. Local persistence,
      // cancellation bookkeeping and telemetry get an additional short bound
      // so one stuck cleanup cannot prevent the remaining stages or rethrow.
      if (stage === 'provider_drain') await action()
      else await runBoundedCleanup(stage, action, cleanupTimeoutMs)
    } catch (error) {
      errors[stage] = error
      try {
        await runBoundedCleanup(
          `${stage}_telemetry`,
          () => input.onStageError?.(stage, error),
          cleanupTimeoutMs
        )
      } catch {
        // Cleanup telemetry is secondary and must never interrupt the remaining
        // cleanup stages or replace the primary workflow failure.
      }
    }
  }

  await attempt('generation_diagnostics', input.persistFailureDiagnostics)
  await attempt('fail_fast', input.triggerFailFast)
  await attempt('provider_drain', input.drainProvider)
  await attempt('resume_extraction_cache', input.persistResumeExtraction)
  await attempt('failed_status', input.writeFailedStatus)
  return errors
}

export async function finalizeFailedEvaluationCaseAndRethrow(
  input: EvaluationFailureCleanupInput & { primaryError: unknown }
): Promise<never> {
  const { primaryError, ...cleanupInput } = input
  try {
    await finalizeFailedEvaluationCase(cleanupInput)
  } finally {
    // The first workflow/provider error is the only terminal cause. Every
    // cleanup failure has already been emitted as privacy-safe secondary
    // telemetry and is never allowed to mask it.
    throw primaryError
  }
}

export type EvaluationResourceCleanupStage =
  | 'resume_extraction_cache_clear'
  | 'budget_dispose'
  | 'run_lock_release'

export async function finalizeEvaluationResources(input: {
  hadPrimaryFailure: boolean
  stages: Array<{ stage: EvaluationResourceCleanupStage; action: () => void | Promise<void> }>
  onStageError?: (
    stage: EvaluationResourceCleanupStage,
    error: unknown
  ) => void | Promise<void>
  cleanupTimeoutMs?: number
}) {
  let firstCleanupError: unknown
  let hasCleanupError = false
  const cleanupTimeoutMs = input.cleanupTimeoutMs ?? DEFAULT_EVALUATION_CLEANUP_TIMEOUT_MS
  for (const item of input.stages) {
    try {
      await runBoundedCleanup(item.stage, item.action, cleanupTimeoutMs)
    } catch (error) {
      if (!hasCleanupError) {
        firstCleanupError = error
        hasCleanupError = true
      }
      try {
        await runBoundedCleanup(
          `${item.stage}_telemetry`,
          () => input.onStageError?.(item.stage, error),
          cleanupTimeoutMs
        )
      } catch {
        // Cleanup telemetry is always secondary.
      }
    }
  }
  if (!input.hadPrimaryFailure && hasCleanupError) throw firstCleanupError
}

function usage() {
  return `Reffo v5 nonprod 安全评测运行器

用法：
  bun run scripts/run-v5-nonprod-nine-case-blind-eval.ts --stage extract-only --dry-run --cases 2
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --stage generation-only --live --output <新目录> --cases 2 --fail-fast
  bun run scripts/run-v5-nonprod-nine-case-blind-eval.ts --stage judge-only --source-run <生成目录> --dry-run --cases 2
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --stage judge-only --source-run <生成目录> --live --output <新评审目录> --cases 2 --fail-fast
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --live --output <新目录> --cases 1-9 --fail-fast
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --live --resume --output <原目录> --cases <原选择>

参数：
  --history <path>  指定固定的 9 条 nonprod 数据文件
  --output <path>   指定全新输出目录；非 --resume 时目录必须为空
  --cases <list>    例如 2、1,3,5 或 1-9；默认仅案例 2 canary
  --stage <stage>   generation-only、judge-only 或 full 可实跑；extract-only 当前仅允许 dry-run
  --artifact-mode <mode>  dsl_v1（默认）或 writer_v1（非生产受控写作）
  --job-targeted          启用 r2 岗位画像与胜任映射（须同时选择 writer_v1）
  --entry-writer          经历级单次 Writer + 正文流接收（须同时启用 --job-targeted）
  --source-run      judge-only 使用的冻结 generation-only/full 输出目录；必须与新输出目录隔离
  --dry-run         只做输入、预算、指纹与调用上界预检；这是默认模式
  --live            显式启用真实调用，且必须同时提供 --output
  --resume          只复用指纹一致且完整的版本化检查点；不重试未知状态的调用
  --fail-fast       显式声明失败即停（本运行器始终强制开启）
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHistories(value: unknown): HistoryRecord[] {
  if (!Array.isArray(value) || value.length !== 9) {
    throw new Error(`预期 9 条 nonprod 历史，实际 ${Array.isArray(value) ? value.length : '非数组'} 条`)
  }
  const fields = ['company', 'position', 'resume_content', 'jd_content', 'optimized_content'] as const
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`案例 ${index + 1} 不是对象`)
    for (const field of fields) {
      if (typeof item[field] !== 'string' || !(item[field] as string).trim()) {
        throw new Error(`案例 ${index + 1} 缺少非空字符串字段 ${field}`)
      }
    }
    return item as unknown as HistoryRecord
  })
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 80)
}

function caseId(caseNumber: number) {
  return `case-${String(caseNumber).padStart(2, '0')}`
}

function casePrefix(caseNumber: number, target: string) {
  return `${caseId(caseNumber)}-${safeFilename(target)}`
}

function frozenCaseInputDigest(historyDigest: string, caseNumber: number, history: HistoryRecord) {
  return digestJson({
    historyDigest,
    caseNumber,
    company: history.company,
    position: history.position,
    resume: history.resume_content,
    jd: history.jd_content,
    baseline: history.optimized_content,
  })
}

export function serializedError(error: unknown): NonNullable<CaseStatus['error']> {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    const issues = 'issues' in error && Array.isArray(error.issues)
      ? bucketP01ValidationIssues(error.issues, 'domain')
      : []
    const validationIssues = 'validationIssues' in error && Array.isArray(error.validationIssues)
      ? bucketP01ValidationIssues(error.validationIssues, 'schema')
      : []
    const outputAudit = 'outputAudit' in error && isRecord(error.outputAudit)
      && typeof error.outputAudit.rawOutputDigest === 'string'
      && typeof error.outputAudit.validatedOutputDigest === 'string'
      && typeof error.outputAudit.normalizationApplied === 'boolean'
      && Array.isArray(error.outputAudit.normalizationChanges)
      ? {
          rawOutputDigest: error.outputAudit.rawOutputDigest.slice(0, 128),
          validatedOutputDigest: error.outputAudit.validatedOutputDigest.slice(0, 128),
          normalizationApplied: error.outputAudit.normalizationApplied,
          normalizationChangeCount: error.outputAudit.normalizationChanges
            .filter(change => typeof change === 'string').length,
        }
      : undefined
    return {
      name: /^[A-Za-z][A-Za-z0-9_]*$/.test(error.name) ? error.name : 'Error',
      message: code ? `V5 evaluation failed (${code})` : 'V5 evaluation failed',
      ...(code ? { code } : {}),
      ...(issues.length > 0 ? { issues } : {}),
      ...(validationIssues.length > 0 ? { validationIssues } : {}),
      ...(outputAudit ? { outputAudit } : {}),
    }
  }
  return { name: 'Error', message: 'V5 evaluation failed' }
}

function deliveryDiagnosticsFromError(error: unknown) {
  if (!isRecord(error) || error.deliveryDiagnostics === undefined) return null
  return sanitizeV5DeliveryDiagnostics(error.deliveryDiagnostics)
}

function strictCheckpointDiagnostics(value: unknown, caseNumber: number) {
  const sanitized = sanitizeV5DeliveryDiagnostics(value)
  if (digestJson(sanitized) !== digestJson(value)) {
    throw new EvaluationRunnerSafetyError(
      'GENERATION_DIAGNOSTICS_UNSAFE_PAYLOAD',
      `案例 ${caseNumber} 的生成诊断检查点包含版本化安全结构之外的字段`
    )
  }
  return sanitized
}

function assertMatchingDiagnostics(input: {
  expected: unknown
  actual: unknown
  caseNumber: number
  label: string
}) {
  const expected = sanitizeV5DeliveryDiagnostics(input.expected)
  const actual = sanitizeV5DeliveryDiagnostics(input.actual)
  if (digestJson(expected) !== digestJson(actual)) {
    throw new EvaluationRunnerSafetyError(
      'GENERATION_DIAGNOSTICS_MISMATCH',
      `案例 ${input.caseNumber} 的生成诊断与${input.label}不一致`
    )
  }
  return actual
}

function diagnosticRatio(value: { numerator: number; denominator: number }) {
  const ratio = `${value.numerator}/${value.denominator}`
  return value.denominator === 0 ? `${ratio}（N/A）` : ratio
}

function diagnosticReportCells(diagnostics: V5DeliveryDiagnostics) {
  const metrics = diagnostics.metrics
  if (!metrics) {
    return {
      plannedCoverage: 'N/A',
      stableCoreCoverage: 'N/A',
      primaryRequirementCoverage: 'N/A',
      businessBullets: 'N/A',
      outputLength: 'N/A',
    }
  }
  const unit = metrics.outputLengthUnit === 'cjk_characters' ? '字符' : '词'
  const softFloor = metrics.outputLengthSoftMin === null ? '—' : metrics.outputLengthSoftMin
  const hardFloor = metrics.outputLengthHardMin === null ? '—' : metrics.outputLengthHardMin
  return {
    plannedCoverage: diagnosticRatio(metrics.plannedEvidenceCoverage),
    stableCoreCoverage: diagnosticRatio(metrics.stableCoreCoverage),
    primaryRequirementCoverage: diagnosticRatio(metrics.primaryRequirementCoverage),
    businessBullets: `${metrics.renderedBusinessBulletCount}/${metrics.targetBusinessBulletTarget}（${metrics.targetBusinessBulletMin}–${metrics.targetBusinessBulletMax}）`,
    outputLength: `${metrics.outputLengthValue} ${unit}（soft ${softFloor}–${metrics.outputLengthSoftMax}；hard ${hardFloor}–${metrics.outputLengthHardMax}）`,
  }
}

function baselineArtifact(markdown: string): GeneratedResumeArtifact {
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    markdown,
    claims: [],
    usedEvidenceIds: [],
    omittedPlannedEvidenceIds: [],
    renderStats: measureArtifactMarkdown(markdown),
  }
}

function evaluationScore(result: DoubleOrderAbResult, side: 'baseline' | 'candidate') {
  const forwardId = side === 'baseline' ? 'A' : 'B'
  const reverseId = side === 'baseline' ? 'B' : 'A'
  const total = (evaluation: DoubleOrderAbResult['forward'], candidate: 'A' | 'B') => {
    const row = evaluation.evaluations.find(item => item.candidateId === candidate)
    return row ? Object.values(row.dimensions).reduce((sum, value) => sum + value, 0) : 0
  }
  return Number(((total(result.forward, forwardId) + total(result.reverse, reverseId)) / 2).toFixed(1))
}

function evaluationGate(result: DoubleOrderAbResult, side: 'baseline' | 'candidate') {
  const forwardId = side === 'baseline' ? 'A' : 'B'
  const reverseId = side === 'baseline' ? 'B' : 'A'
  const forward = result.forward.evaluations.find(item => item.candidateId === forwardId)?.absoluteGate
  const reverse = result.reverse.evaluations.find(item => item.candidateId === reverseId)?.absoluteGate
  return forward === reverse ? forward ?? 'inconsistent' : 'inconsistent'
}

function winner(result: DoubleOrderAbResult): CaseSummary['winner'] {
  if (!result.orderConsistent) return 'order_inconsistent'
  if (result.normalizedForwardWinner === 'left') return 'baseline'
  if (result.normalizedForwardWinner === 'right') return 'v5'
  return 'tie'
}

function assertV5EvaluationCandidateDeliverable(
  result: V5WorkflowResult,
  caseNumber: number
) {
  if (isV5CodeGateDeliverable(result)) return
  throw Object.assign(
    new Error(`案例 ${caseNumber} 的 v5 未通过当前本地产品交付门禁；候选不能恢复或进入盲评`),
    { code: 'V5_DELIVERY_GATE_FAIL_FAST' }
  )
}

function normalizedNgrams(value: string, size = 4) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
  const counts = new Map<string, number>()
  for (let index = 0; index <= normalized.length - size; index += 1) {
    const gram = normalized.slice(index, index + size)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function similarity(left: string, right: string) {
  const a = normalizedNgrams(left)
  const b = normalizedNgrams(right)
  let dot = 0
  let aNorm = 0
  let bNorm = 0
  for (const value of a.values()) aNorm += value * value
  for (const value of b.values()) bNorm += value * value
  for (const [key, value] of a) dot += value * (b.get(key) ?? 0)
  return Number((dot / Math.sqrt(aNorm * bNorm || 1)).toFixed(3))
}

function sameSourceDifferentiation(results: Map<number, V5WorkflowResult>) {
  const selected = [3, 4, 5, 6, 7, 8]
    .map(number => results.get(number)?.artifact.markdown)
    .filter((value): value is string => Boolean(value))
  const values: number[] = []
  for (let left = 0; left < selected.length; left += 1) {
    for (let right = left + 1; right < selected.length; right += 1) {
      values.push(similarity(selected[left], selected[right]))
    }
  }
  const sorted = [...values].sort((left, right) => left - right)
  return {
    pairCount: values.length,
    medianSimilarity: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    minSimilarity: values.length ? Math.min(...values) : null,
    maxSimilarity: values.length ? Math.max(...values) : null,
  }
}

function report(input: {
  summaries: CaseSummary[]
  results: Map<number, V5WorkflowResult>
  usage: EvaluationUsageEntry[]
  historyDigest: string
  selectedCases: number[]
  stage: EvaluationRunStage
  judgeSource: JudgeSourceProvenance | null
  budget: ReturnType<EvaluationBudgetController['snapshot']>
  extractionCache: Readonly<ResumeExtractionCacheStats>
}) {
  const average = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
  const rows = input.summaries.map(item => {
    const prefix = casePrefix(item.caseNumber, item.target)
    const diagnostics = diagnosticReportCells(item.deliveryDiagnostics)
    return `| ${item.caseNumber} | ${item.target} | ${item.baselineGate} / ${item.candidateGate} | ${item.baselineScore} → ${item.candidateScore} | ${item.winner} | ${item.baselineChars} → ${item.candidateChars} | ${item.baselineBullets} → ${item.candidateBullets} | ${diagnostics.plannedCoverage} | ${diagnostics.stableCoreCoverage} | ${diagnostics.primaryRequirementCoverage} | ${diagnostics.businessBullets} | ${diagnostics.outputLength} | [v5 简历](cases/${prefix}-v5.md) | [生成诊断](cases/${prefix}-generation-diagnostics.json) | [盲评检查点](cases/${prefix}-ab.json) |`
  }).join('\n')
  const differentiation = sameSourceDifferentiation(input.results)
  const successfulUsage = input.usage.filter(item => item.outcome === 'success')
  const totalInput = successfulUsage.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0)
  const totalOutput = successfulUsage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0)
  const totalLatency = input.usage.reduce((sum, item) => sum + (item.latencyMs ?? 0), 0)
  const differentiationText = differentiation.pairCount > 0
    ? `中位数 ${differentiation.medianSimilarity}，范围 ${differentiation.minSimilarity}–${differentiation.maxSimilarity}`
    : '当前选择不足以计算（需要案例 3–8 中至少两例）'
  const title = input.stage === 'judge-only'
    ? 'Reffo v5 nonprod 冻结产物双顺序盲评'
    : 'Reffo v5 nonprod 简历生成与双顺序盲评'
  const lineageNote = input.stage === 'judge-only' && input.judgeSource
    ? `- 本次仅执行 P12；baseline 与 v5 产物按内容摘要从 source-run ${input.judgeSource.sourceRunId} 复验后载入，没有重跑 P01–P06D 生成链路。`
    : '- baseline 使用历史 nonprod 已保存的优化简历；v5 使用本次冻结实现和配置处理原始简历与 JD。'
  return `# ${title}

运行时间：${new Date().toISOString()}

数据摘要 SHA-256：${input.historyDigest}

## 总体结果

- 选择案例：${input.selectedCases.join(', ')}
- 完成案例：${input.summaries.length}/${input.selectedCases.length}
- v5 胜 / 旧版胜 / 平局 / 顺序不一致：${input.summaries.filter(item => item.winner === 'v5').length} / ${input.summaries.filter(item => item.winner === 'baseline').length} / ${input.summaries.filter(item => item.winner === 'tie').length} / ${input.summaries.filter(item => item.winner === 'order_inconsistent').length}
- 旧版平均分：${average(input.summaries.map(item => item.baselineScore)).toFixed(1)}
- v5 平均分：${average(input.summaries.map(item => item.candidateScore)).toFixed(1)}
- 进入盲评的 v5 安全回退：${input.summaries.filter(item => item.usedSafeFallback).length}（当前代码门禁必须为 0；安全回退只供内部诊断）
- 同源岗位 v5 正文四元组相似度：${differentiationText}
- 物理模型尝试：${input.budget.run.usage.physicalAttempts} 次；已结算输入 ${input.budget.run.usage.settledInputTokens} tokens；已结算输出 ${input.budget.run.usage.settledOutputTokens} tokens
- Provider 成功响应：${successfulUsage.length}；响应所报输入 ${totalInput} tokens；输出 ${totalOutput} tokens；累计 Provider 延迟 ${totalLatency} ms
- 受信 P01 提取缓存：命中 ${input.extractionCache.hits}，未命中 ${input.extractionCache.misses}，并发合并 ${input.extractionCache.coalesced}，完整性失败 ${input.extractionCache.integrityFailures}

## 逐案结果

| # | 目标岗位 | 离线评测（旧/v5） | 双顺序均分 | 胜者 | 字符数 | bullets | 计划覆盖 n/d | 稳定核心 n/d | JD 主要求 n/d | 业务 bullet/target | 输出长度/边界 | 简历 | 生成诊断 | 盲评 |
|---:|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|---|
${rows}

## 说明

${lineageNote}
- 只使用直接 DeepSeek provider；禁用 fallback、SDK 自动重试和整案自动重跑。
- 每次真实物理请求前先预留调用、输入、输出与墙钟预算；失败请求同样计数并触发共享取消。
- 每案先通过 v5 本地代码硬门禁，再进行 P12 A/B 与 B/A 双顺序匿名评测；生产生成链路不调用 P09/P11 Agent Judge。
- P12 只记录离线质量结果，不反向阻断已经通过代码门禁的候选；安全回退、review_required 和其他非可交付产物在 P12 前失败即停。
- 已验证的 P01 结果会以 0600 权限写入本地 .artifacts 缓存，并按简历、实现、Prompt、Schema 与 Provider 指纹跨运行复验后复用；指纹或完整性不匹配时拒绝读取。
`
}

function partialCaseReport(status: CaseStatus) {
  const error = status.error
  return `# 案例 ${status.caseNumber} 运行状态

- 目标岗位：${status.target}
- 状态：${status.stage}
- 更新时间：${status.updatedAt}
- 物理模型尝试：${status.budget.run.usage.physicalAttempts}
- 已结算输入 Token：${status.budget.run.usage.settledInputTokens}
- 已结算输出 Token：${status.budget.run.usage.settledOutputTokens}
${error ? `- 错误：${error.code ? `${error.code}: ` : ''}${error.message}` : ''}

该文件是当前案例的部分报告；失败案例不会被自动重试。
`
}

function generationReport(input: {
  summaries: GenerationCaseSummary[]
  historyDigest: string
  selectedCases: number[]
  budget: ReturnType<EvaluationBudgetController['snapshot']>
  extractionCache: Readonly<ResumeExtractionCacheStats>
}) {
  const rows = input.summaries.map(item => {
    const prefix = casePrefix(item.caseNumber, item.target)
    const diagnostics = diagnosticReportCells(item.deliveryDiagnostics)
    return `| ${item.caseNumber} | ${item.target} | ${item.state} | ${item.matchScore} | ${item.candidateChars} | ${item.candidateBullets} | ${diagnostics.plannedCoverage} | ${diagnostics.stableCoreCoverage} | ${diagnostics.primaryRequirementCoverage} | ${diagnostics.businessBullets} | ${diagnostics.outputLength} | [v5 简历](cases/${prefix}-v5.md) | [生成诊断](cases/${prefix}-generation-diagnostics.json) | [冻结盲评输入](cases/${prefix}-blind-input.json) |`
  }).join('\n')
  return `# Reffo v5 nonprod 分阶段生成报告

运行时间：${new Date().toISOString()}

- 阶段：generation-only
- 数据摘要 SHA-256：${input.historyDigest}
- 选择案例：${input.selectedCases.join(', ')}
- 完成案例：${input.summaries.length}/${input.selectedCases.length}
- 物理模型尝试：${input.budget.run.usage.physicalAttempts}
- 已结算输入 / 输出：${input.budget.run.usage.settledInputTokens} / ${input.budget.run.usage.settledOutputTokens} tokens
- P01 缓存命中 / 未命中：${input.extractionCache.hits} / ${input.extractionCache.misses}

| # | 目标岗位 | 状态 | 匹配分 | 字符数 | 业务 bullets | 计划覆盖 n/d | 稳定核心 n/d | JD 主要求 n/d | 业务 bullet/target | 输出长度/边界 | 简历 | 生成诊断 | 盲评输入 |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
${rows}

本阶段没有执行 P12；盲评必须在独立 judge-only 运行中读取冻结输入。
`
}

async function readStatusStrict(path: string): Promise<CaseStatus | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`案例状态文件损坏：${path}`, { cause: cause instanceof Error ? cause : undefined })
  }
  if (!isRecord(value) || typeof value.caseId !== 'string' || typeof value.stage !== 'string') {
    throw new Error(`案例状态文件结构无效：${path}`)
  }
  return value as unknown as CaseStatus
}

interface ResumeExtractionCachePreflight {
  status: 'hit' | 'partial' | 'miss'
  checkpointPath: string
}

async function preflightResumeExtractionCache(input: {
  root: string
  document: CanonicalSourceDocument
  cache: TrustedResumeExtractionCache
  fingerprints: EvaluationCheckpointFingerprints
  caseId: string
}): Promise<ResumeExtractionCachePreflight> {
  const checkpointPath = resolve(input.root, `${input.cache.keyFor(input.document)}.json`)
  const current = await readCheckpoint<TrustedResumeExtractionCacheSnapshot>({
    path: checkpointPath,
    kind: 'resume_extraction',
    caseId: input.caseId,
    fingerprints: input.fingerprints,
  })
  if (current) {
    input.cache.hydrate(input.document, current.payload)
    return { status: 'hit', checkpointPath }
  }
  const partialPath = resolve(input.root, `${input.cache.keyFor(input.document)}.partial.json`)
  const partial = await readCheckpoint<TrustedResumeExtractionPartialSnapshot>({
    path: partialPath,
    kind: 'resume_extraction_partial',
    caseId: input.caseId,
    fingerprints: input.fingerprints,
  })
  if (partial) {
    input.cache.hydratePartial(input.document, partial.payload)
    return { status: 'partial', checkpointPath: partialPath }
  }
  // Runner v9 never scans or promotes v1 cache files. Those snapshots were
  // produced under older extraction semantics and a malformed legacy file
  // must not block a fresh, content-addressed v2 lookup.
  return { status: 'miss', checkpointPath }
}

/** Local checkpoints are mutable progress, serialized per descriptor by the caller. */
export async function persistPartialExtractionCheckpoint(input: {
  root: string
  snapshot: TrustedResumeExtractionPartialSnapshot
  document: CanonicalSourceDocument
  cacheOptions: TrustedResumeExtractionCacheOptions
  fingerprints: EvaluationCheckpointFingerprints
}) {
  const key = input.snapshot.cacheKey
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid partial cache key')
  const lock = await acquireEvaluationRunLock({
    outputRoot: resolve(input.root, 'partial-locks', key), resume: true,
  })
  try {
    const path = resolve(input.root, `${key}.partial.json`)
    const caseId = `resume-${input.document.sha256}`
    const current = await readCheckpoint<TrustedResumeExtractionPartialSnapshot>({
      path, kind: 'resume_extraction_partial', caseId, fingerprints: input.fingerprints,
    })
    const verifier = createTrustedResumeExtractionCache({ ...input.cacheOptions, onValidatedShard: undefined })
    if (current) verifier.hydratePartial(input.document, current.payload)
    verifier.hydratePartial(input.document, input.snapshot)
    const payload = verifier.partialSnapshot(input.document)
    if (!payload) throw new Error('Validated partial snapshot missing')
    await atomicWriteJson(path, {
      checkpointVersion: V5_EVALUATION_CHECKPOINT_VERSION,
      kind: 'resume_extraction_partial', caseId,
      createdAt: new Date().toISOString(),
      fingerprints: input.fingerprints,
      payloadSha256: digestJson(payload), payload,
    })
  } finally {
    await lock.release()
  }
}

async function main() {
  const args = parseEvaluationRunnerArgs(process.argv.slice(2), { backendRoot })
  if (args.help) {
    console.log(usage())
    return
  }

  const historyText = await readFile(args.historyPath, 'utf8')
  const historyDigest = sha256(historyText)
  if (historyDigest !== EXPECTED_NONPROD_HISTORY_SHA256) {
    throw new Error(
      `nonprod 输入 SHA-256 不匹配；预期 ${EXPECTED_NONPROD_HISTORY_SHA256}，实际 ${historyDigest}`
    )
  }
  const histories = parseHistories(JSON.parse(historyText))
  const selected = args.selectedCases.map(number => ({ number, history: histories[number - 1] }))
  const providerEndpoint = assertStrictDeepSeekEndpoint(process.env.OPENAI_BASE_URL)
  const structuredOutputMode = (process.env.V5_STRUCTURED_OUTPUT_MODE || 'auto').trim().toLowerCase()
  if (!['auto', 'json_object'].includes(structuredOutputMode)) {
    throw new Error('DeepSeek 评测只允许 V5_STRUCTURED_OUTPUT_MODE=auto 或 json_object')
  }
  await assertOutputDirectoryPolicy(args.outputRoot, args.resume)

  const judgeSourceRun = args.stage === 'judge-only'
    ? await loadValidatedJudgeSourceRun({
        sourceRun: args.sourceRun!,
        outputRoot: args.outputRoot,
        historyDigest,
        selectedCases: args.selectedCases,
        cases: selected.map(({ number, history }) => {
          const target = `${history.company} / ${history.position}`
          return {
            caseNumber: number,
            caseId: caseId(number),
            prefix: casePrefix(number, target),
            inputDigest: frozenCaseInputDigest(historyDigest, number, history),
            resumeDigest: canonicalizeSourceDocument(history.resume_content).canonicalDocument.sha256,
          }
        }),
      })
    : null

  const caseBudgetRequirements = selected.map(({ history }) => {
    const chunks = splitResumeDocument(
      canonicalizeSourceDocument(history.resume_content).canonicalDocument
    )
    const resumeChunks = chunks.length
    return {
      resumeChunks,
      requiredPhysicalCalls: v5CasePhysicalCallUpperBound(resumeChunks, args.stage),
      outputTokenEnvelope: v5CaseOutputTokenEnvelope(resumeChunks, args.stage, {
        shardOutputTokenCaps: chunks.map(chunk => resumeExtractionOutputTokenCapForBlocks(chunk.blocks)),
        artifactGenerationMode: args.artifactGenerationMode,
      }),
    }
  })
  const requiredPhysicalCalls = Math.max(...caseBudgetRequirements.map(item => item.requiredPhysicalCalls))
  const requiredOutputTokens = Math.max(...caseBudgetRequirements.map(item => item.outputTokenEnvelope.totalTokens))
  const requiredResumeChunks = Math.max(...caseBudgetRequirements.map(item => item.resumeChunks))
  const budgetProfile = budgetProfileForCases(args.selectedCases, args.stage, {
    requiredPhysicalCalls,
    resumeChunks: requiredResumeChunks,
    estimatedOutputTokens: requiredOutputTokens,
  })
  const implementationDigest = await createImplementationDigest(backendRoot)
  const model = process.env.AI_MODEL?.trim() || 'deepseek-chat'
  const generationPolicy = evaluationDeepSeekPolicy(model, process.env.DEEPSEEK_THINKING_MODE, process.env.DEEPSEEK_REASONING_EFFORT)
  const extractionThinkingMode = parseDeepSeekExtractionThinking(process.env.DEEPSEEK_P01_THINKING_MODE)
  const extractionThinking = resolveDeepSeekStageThinking(
    parseDeepSeekThinking(process.env.DEEPSEEK_THINKING_MODE, process.env.DEEPSEEK_REASONING_EFFORT),
    extractionThinkingMode, true
  )
  const extractionPolicy = evaluationDeepSeekPolicy(model, extractionThinking.mode, extractionThinking.effort)
  const contextWindowTokens = Number.parseInt(process.env.V5_CONTEXT_WINDOW_TOKENS || '64000', 10)
  if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens <= 0) {
    throw new Error('V5_CONTEXT_WINDOW_TOKENS 必须是正安全整数')
  }
  const extractionImplementationDigest = await createExtractionImplementationDigest(backendRoot)
  const extractionRuntimeConfig = {
    runtime: { bunVersion: Bun.version },
    providerEndpoint,
    model,
    // Only the effective extraction policy belongs in this cache key.
    // Changing Writer effort must not invalidate a disabled-thinking P01 cache.
    ...(extractionPolicy ? { generationPolicy: extractionPolicy } : {}),
    maxProviderAttempts: 1,
    fallbackEnabled: false,
    structuredOutputMode,
    contextWindowTokens,
    chunkPlanVersion: RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
    chunkConfig: {
      maxBlocks: DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
      maxCharacters: DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
      maxEstimatedOutputTokens: DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
      concurrency: DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
    },
  }
  const extractionConfigDigest = digestJson(extractionRuntimeConfig)
  const executionPolicy = {
    releaseGateMode: 'deterministic_product_delivery_v2',
    agentFactJudgeEnabled: false,
    agentQualityJudgeEnabled: false,
    artifactGenerationMode: args.artifactGenerationMode,
    ...(args.jobTargetingPolicy ? { jobTargetingPolicy: args.jobTargetingPolicy } : {}),
    ...(args.entryWritingPolicy ? { entryWritingPolicy: args.entryWritingPolicy } : {}),
    artifactRepairMax: 0,
    interviewMode: 'deferred',
    componentQuotaPolicy: V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION,
  } as const
  const configDigest = digestJson({
    runnerProtocolVersion: V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
    workflowVersion: V5_WORKFLOW_VERSION,
    runtime: { bunVersion: Bun.version },
    selectedCases: args.selectedCases,
    stage: args.stage,
    sourceRun: args.sourceRun,
    judgeSource: judgeSourceRun?.provenance ?? null,
    providerEndpoint,
    model,
    ...(generationPolicy ? { generationPolicy } : {}),
    extractionPolicy,
    maxProviderAttempts: 1,
    fallbackEnabled: false,
    ...executionPolicy,
    doubleOrderBlindEvaluation: true,
    structuredOutputMode,
    contextWindowTokens,
    budgetProfile,
    extractionImplementationDigest,
    extractionConfigDigest,
    extractionCache: {
      protocolVersion: V5_RESUME_EXTRACTION_CACHE_VERSION,
      chunkPlanVersion: RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
      maxBlocks: DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
      maxCharacters: DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
      maxEstimatedOutputTokens: DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
      concurrency: DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
      persistence: 'validated_local_checkpoint_v1',
    },
  })
  // P01 identity deliberately excludes JD, downstream planning/rendering,
  // selected cases and run budgets. Its exact source/prompt dependency digest
  // and provider/chunk configuration remain separate and both must match.
  const resumeExtractionCacheOptions: TrustedResumeExtractionCacheOptions = {
    implementationFingerprint: extractionImplementationDigest,
    providerConfigFingerprint: extractionConfigDigest,
    chunkMaxBlocks: DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
    chunkMaxCharacters: DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
    chunkMaxEstimatedOutputTokens: DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
    chunkConcurrency: DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  }
  const persistentExtractionCacheRoot = resolve(backendRoot, '..', '.artifacts', 'v5-resume-extraction-cache')
  const partialWrites = new Map<string, Promise<void>>()
  const persistPartial = (
    snapshot: TrustedResumeExtractionPartialSnapshot,
    document: CanonicalSourceDocument
  ) => {
    const previous = partialWrites.get(snapshot.cacheKey) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => persistPartialExtractionCheckpoint({
      root: persistentExtractionCacheRoot, snapshot, document,
      cacheOptions: resumeExtractionCacheOptions,
      fingerprints: {
        inputDigest: document.sha256,
        implementationDigest: extractionImplementationDigest,
        configDigest: extractionConfigDigest,
      },
    }))
    partialWrites.set(snapshot.cacheKey, next)
    return next
  }
  const resumeExtractionCache = createTrustedResumeExtractionCache({
    ...resumeExtractionCacheOptions,
    onValidatedShard: async (snapshot, document) => {
      try { await persistPartial(snapshot, document) } catch {
        console.warn(JSON.stringify({ event: 'p01_partial_checkpoint_write_failed' }))
      }
    },
  })
  const preflightCases = await Promise.all(selected.map(async ({ number, history }) => {
    const resume = canonicalizeSourceDocument(history.resume_content)
    const job = canonicalizeSourceDocument(history.jd_content)
    const chunks = splitResumeDocument(resume.canonicalDocument)
    const resumeChunks = chunks.length
    const sourceShape = {
      shardOutputTokenCaps: chunks.map(chunk => resumeExtractionOutputTokenCapForBlocks(chunk.blocks)),
      artifactGenerationMode: args.artifactGenerationMode,
    }
    const outputTokenEnvelopeWithoutCache = v5CaseOutputTokenEnvelope(resumeChunks, args.stage, sourceShape)
    const extractionFingerprints: EvaluationCheckpointFingerprints = {
      inputDigest: resume.canonicalDocument.sha256,
      implementationDigest: extractionImplementationDigest,
      configDigest: extractionConfigDigest,
    }
    const extractionCache = await preflightResumeExtractionCache({
      root: persistentExtractionCacheRoot,
      document: resume.canonicalDocument,
      cache: resumeExtractionCache,
      fingerprints: extractionFingerprints,
      caseId: `resume-${resume.canonicalDocument.sha256}`,
    })
    const extractionProgress = resumeExtractionCache.progress(resume.canonicalDocument)
    const budgetShape = { ...sourceShape, validatedShardIndexes: extractionProgress.validatedShardIndices }
    const physicalCallUpperBoundWithoutCache = v5CasePhysicalCallUpperBound(resumeChunks, args.stage)
    const physicalCallUpperBound = v5CasePhysicalCallUpperBound(resumeChunks, args.stage, budgetShape)
    const outputTokenEnvelope = v5CaseOutputTokenEnvelope(resumeChunks, args.stage, budgetShape)
    return {
      caseNumber: number,
      resumeDigest: resume.canonicalDocument.sha256,
      resumeBlocks: resume.canonicalDocument.blocks.length,
      resumeChunks,
      jobBlocks: job.canonicalDocument.blocks.length,
      cacheStatus: extractionCache.status,
      cacheCheckpointPath: extractionCache.checkpointPath,
      validatedShardCount: extractionProgress.validatedShardIndices.length,
      extractionCallUpperBound: v5CasePhysicalCallUpperBound(resumeChunks, 'extract-only', budgetShape),
      physicalCallUpperBoundWithoutCache,
      physicalCallUpperBound,
      withinCaseCallBudget: physicalCallUpperBound <= budgetProfile.caseLimits.maxPhysicalCalls,
      outputTokenEnvelopeWithoutCache,
      outputTokenEnvelope,
      componentQuotas: v5EvaluationComponentQuotas(resumeChunks, args.stage, budgetShape),
      withinCaseOutputBudget: outputTokenEnvelope.totalTokens <= budgetProfile.caseLimits.maxOutputTokens,
    }
  }))
  const noCacheCallUpperBound = preflightCases.reduce(
    (sum, item) => sum + item.physicalCallUpperBoundWithoutCache,
    0
  )
  const uniqueResumeUpperBound = args.stage === 'judge-only'
    ? selected.length * V5_JUDGE_CALL_UPPER_BOUND
    : [...new Map(preflightCases.map(item => [item.resumeDigest, item])).values()]
      .reduce(
        (sum, item) => sum + item.extractionCallUpperBound,
        0
      )
      + selected.length * (args.stage === 'extract-only'
        ? 0
        : args.stage === 'generation-only'
          ? V5_GENERATION_NON_EXTRACTION_CALL_UPPER_BOUND
          : V5_NON_EXTRACTION_CALL_UPPER_BOUND)
  const noCacheOutputTokenEnvelope = preflightCases.reduce(
    (sum, item) => sum + item.outputTokenEnvelopeWithoutCache.totalTokens,
    0
  )
  const uniqueResumeOutputTokenEnvelope = args.stage === 'judge-only'
    ? noCacheOutputTokenEnvelope
    : [...new Map(preflightCases.map(item => [item.resumeDigest, item])).values()]
      .reduce(
        (sum, item) => sum + item.outputTokenEnvelope.primaryExtractionTokens
          + item.outputTokenEnvelope.repairExtractionTokens,
        0
      )
      + preflightCases.reduce((sum, item) => sum + item.outputTokenEnvelope.nonExtractionTokens, 0)
  const overCaseCallBudget = preflightCases.filter(item => !item.withinCaseCallBudget)
  const overCaseOutputBudget = preflightCases.filter(item => !item.withinCaseOutputBudget)
  const blockingReasons = [
    ...(args.stage === 'extract-only'
      ? [`${args.stage} 尚未实现独立检查点路由，禁止 live；避免误跑完整链路并消耗 API`]
      : []),
    ...(overCaseCallBudget.length > 0
      ? [`案例 ${overCaseCallBudget.map(item => item.caseNumber).join(', ')} 的调用上界超过单案 ${budgetProfile.caseLimits.maxPhysicalCalls} 次`]
      : []),
    ...(overCaseOutputBudget.length > 0
      ? [`案例 ${overCaseOutputBudget.map(item => item.caseNumber).join(', ')} 的预计输出 envelope 超过单案 ${budgetProfile.caseLimits.maxOutputTokens} Token`]
      : []),
    ...(uniqueResumeUpperBound > budgetProfile.runLimits.maxPhysicalCalls
      ? [`启用受信共享提取缓存后批次调用上界 ${uniqueResumeUpperBound} 仍超过全局 ${budgetProfile.runLimits.maxPhysicalCalls} 次`]
      : []),
    ...(uniqueResumeOutputTokenEnvelope > budgetProfile.runLimits.maxOutputTokens
      ? [`启用受信共享提取缓存后批次预计输出 envelope ${uniqueResumeOutputTokenEnvelope} 仍超过全局 ${budgetProfile.runLimits.maxOutputTokens} Token`]
      : []),
  ]
  const preflight = {
    event: 'dry_run_preflight',
    dryRun: args.dryRun,
    providerInitialized: false,
    externalCallsMade: 0,
    historyPath: args.historyPath,
    historyDigest,
    expectedHistoryDigest: EXPECTED_NONPROD_HISTORY_SHA256,
    outputRoot: args.outputRoot,
    outputMode: args.resume ? 'resume' : 'new_empty_directory',
    selectedCases: args.selectedCases,
    stage: args.stage,
    sourceRun: args.sourceRun,
    judgeSource: judgeSourceRun
      ? {
          sourceRunId: judgeSourceRun.provenance.sourceRunId,
          sourceStage: judgeSourceRun.provenance.sourceStage,
          contentDigest: judgeSourceRun.provenance.contentDigest,
          cases: judgeSourceRun.provenance.cases.map(item => ({
            caseNumber: item.caseNumber,
            sourceV5PayloadSha256: item.sourceV5PayloadSha256,
          })),
        }
      : null,
    failFast: args.failFast,
    provider: { endpoint: providerEndpoint, model, ...(generationPolicy ? { generationPolicy } : {}), extractionPolicy, fallbackEnabled: false, maxProviderAttempts: 1 },
    executionPolicy,
    budgetProfile,
    implementationDigest,
    configDigest,
    extractionImplementationDigest,
    extractionConfigDigest,
    cases: preflightCases,
    physicalCallUpperBoundWithoutCache: noCacheCallUpperBound,
    physicalCallUpperBoundWithTrustedResumeExtractionCache: uniqueResumeUpperBound,
    physicalCallUpperBoundAfterCachePreflight: uniqueResumeUpperBound,
    outputTokenEnvelopeWithoutCache: noCacheOutputTokenEnvelope,
    outputTokenEnvelopeWithTrustedResumeExtractionCache: uniqueResumeOutputTokenEnvelope,
    outputTokenEnvelopeAfterCachePreflight: uniqueResumeOutputTokenEnvelope,
    extractionCacheReady: args.stage === 'judge-only'
      || preflightCases.every(item => item.cacheStatus !== 'miss'),
    liveRunAllowed: blockingReasons.length === 0,
    blockingReasons,
  }
  console.log(JSON.stringify(preflight, null, 2))
  if (args.dryRun) return

  if (blockingReasons.length > 0) {
    throw new Error(
      `离线预检阻断：${blockingReasons.join('；')}。当前硬预算无法覆盖最坏路径，不能直接实跑。`
    )
  }
  if (process.env.SUPABASE_PROJECT_ENV !== 'nonprod') {
    throw new Error(`仅允许 nonprod 数据运行，当前 SUPABASE_PROJECT_ENV=${process.env.SUPABASE_PROJECT_ENV || 'unset'}`)
  }
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY 未配置')

  const runLock = await acquireEvaluationRunLock({ outputRoot: args.outputRoot, resume: args.resume })
  let runFailed = false
  try {
  await mkdir(resolve(args.outputRoot, 'cases'), { recursive: true, mode: 0o700 })
  // Defense in depth: this runner supplies an event bus with no persistence
  // subscriber. If a future workflow accidentally enables one, it may write
  // only inside this run's private artifact directory, never backend/data.
  process.env.HARNESS_DATABASE_PATH = resolve(args.outputRoot, 'harness.sqlite')
  process.env.OPENAI_BASE_URL = providerEndpoint
  process.env.AI_MODEL = model
  process.env.AI_FALLBACK_MODELS = ''
  process.env.V5_STRUCTURED_OUTPUT_MODE = structuredOutputMode
  const journalPath = resolve(args.outputRoot, 'budget-journal.jsonl')
  const usagePath = resolve(args.outputRoot, 'usage.jsonl')
  const budgetJournalSink = createAppendOnlyJsonlSink<EvaluationBudgetJournalEntry>(journalPath)
  const usageSink = createAppendOnlyJsonlSink<EvaluationUsageEntry>(usagePath)
  const manifestFingerprints: EvaluationCheckpointFingerprints = {
    inputDigest: historyDigest,
    implementationDigest,
    configDigest,
  }
  const manifestPath = resolve(args.outputRoot, 'run-manifest.json')
  let manifest: RunManifest
  let budget: EvaluationBudgetController

  if (args.resume) {
    const checkpoint = await readCheckpoint<RunManifest>({
      path: manifestPath,
      kind: 'run_manifest',
      caseId: 'run',
      fingerprints: manifestFingerprints,
    })
    if (!checkpoint) throw new Error('恢复目录缺少版本化 run manifest')
    manifest = checkpoint.payload
    if (
      manifest.runnerProtocolVersion !== V5_EVALUATION_RUNNER_PROTOCOL_VERSION
      || manifest.selectedCases.join(',') !== args.selectedCases.join(',')
      || manifest.stage !== args.stage
      || manifest.sourceRun !== args.sourceRun
      || digestJson(manifest.judgeSource ?? null) !== digestJson(judgeSourceRun?.provenance ?? null)
      || manifest.extractionCache?.protocolVersion !== V5_RESUME_EXTRACTION_CACHE_VERSION
      || manifest.extractionCache?.implementationDigest !== extractionImplementationDigest
      || manifest.extractionCache?.configDigest !== extractionConfigDigest
      || manifest.extractionCache?.persistence !== 'validated_local_checkpoint_v1'
      || digestJson(manifest.executionPolicy) !== digestJson(executionPolicy)
    ) {
      throw new Error('run manifest 与当前运行选择不一致')
    }
    const restored = await restoreEvaluationBudget({ journalPath, journalSink: budgetJournalSink })
    if (!restored) throw new Error('恢复目录缺少 budget journal')
    const budgetInitialization = restored.journal().find(entry => entry.type === 'budget_initialized')
    if (
      restored.snapshot().runId !== manifest.runId
      || !budgetInitialization
      || digestJson(budgetInitialization.config.runLimits) !== digestJson(manifest.budgetProfile.runLimits)
      || digestJson(budgetInitialization.config.caseLimits) !== digestJson(manifest.budgetProfile.caseLimits)
    ) {
      restored.dispose()
      throw new Error('budget journal 的 runId 或预算上限与 manifest 不一致')
    }
    const restoredUsage = await readJsonlStrict<EvaluationUsageEntry>(usagePath)
    const reservationIds = restored.journal()
      .filter((entry): entry is Extract<EvaluationBudgetJournalEntry, { type: 'call_reserved' }> => entry.type === 'call_reserved')
      .map(entry => entry.reservationId)
      .sort()
    const usageReservationIds = (restoredUsage ?? []).map(entry => entry.reservationId).sort()
    if (
      reservationIds.length !== usageReservationIds.length
      || reservationIds.some((id, index) => id !== usageReservationIds[index])
    ) {
      restored.dispose()
      throw new Error('budget journal 与 usage journal 的物理调用集合不一致，禁止恢复')
    }
    budget = restored
  } else {
    manifest = {
      runId: `v5-eval-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
      runnerProtocolVersion: V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      historyPath: args.historyPath,
      selectedCases: [...args.selectedCases],
      stage: args.stage,
      sourceRun: args.sourceRun,
      judgeSource: judgeSourceRun?.provenance ?? null,
      budgetProfile,
      provider: {
        endpoint: providerEndpoint,
        model,
        ...(generationPolicy ? { generationPolicy } : {}),
        extractionPolicy,
        maxProviderAttempts: 1,
        fallbackEnabled: false,
      },
      executionPolicy,
      extractionCache: {
        protocolVersion: V5_RESUME_EXTRACTION_CACHE_VERSION,
        implementationDigest: extractionImplementationDigest,
        configDigest: extractionConfigDigest,
        persistence: 'validated_local_checkpoint_v1',
      },
    }
    await writeCheckpoint({
      path: manifestPath,
      kind: 'run_manifest',
      caseId: 'run',
      fingerprints: manifestFingerprints,
      payload: manifest,
    })
    budget = await EvaluationBudgetController.create({
      runId: manifest.runId,
      runLimits: budgetProfile.runLimits,
      caseLimits: budgetProfile.caseLimits,
    }, { journalSink: budgetJournalSink })
  }

  const summaries: CaseSummary[] = []
  const generationSummaries: GenerationCaseSummary[] = []
  const completedResults = new Map<number, V5WorkflowResult>()
  const completedResumeDigests = new Set<string>()

  let executionFailed = false
  try {
    // Provider-bearing modules are intentionally loaded only after dry-run has
    // returned and all input/output/environment safety checks have passed.
    const [
      { deepSeekProvider },
      { createHarnessEventBus },
      { V5ResumeOptimizationWorkflow },
      { runDoubleOrderBlindAb },
    ] = await Promise.all([
      import('@/providers/deepseek-provider'),
      import('@/harness/event-bus'),
      import('@/v5/main/workflow'),
      import('@/v5/ab-evaluator'),
    ])

    for (const { number: caseNumber, history } of selected) {
      const id = caseId(caseNumber)
      const target = `${history.company} / ${history.position}`
      const canonicalResumeDocument = canonicalizeSourceDocument(history.resume_content).canonicalDocument
      const resumeChunks = splitResumeDocument(canonicalResumeDocument).length
      const resumeDigest = canonicalResumeDocument.sha256
      const prefix = casePrefix(caseNumber, target)
      const inputDigest = frozenCaseInputDigest(historyDigest, caseNumber, history)
      const fingerprints: EvaluationCheckpointFingerprints = { inputDigest, implementationDigest, configDigest }
      const judgeSourceCase = judgeSourceRun?.cases.find(item => item.caseNumber === caseNumber) ?? null
      if (args.stage === 'judge-only' && !judgeSourceCase) {
        throw new Error(`案例 ${caseNumber} 缺少已验证的 judge-only 来源结果`)
      }
      const extractionFingerprints: EvaluationCheckpointFingerprints = {
        inputDigest: resumeDigest,
        implementationDigest: extractionImplementationDigest,
        configDigest: extractionConfigDigest,
      }
      const extractionCacheCaseId = `resume-${resumeDigest}`
      const extractionCachePath = resolve(
        persistentExtractionCacheRoot,
        `${resumeExtractionCache.keyFor(canonicalResumeDocument)}.json`
      )
      const extractionCheckpoint = await readCheckpoint<TrustedResumeExtractionCacheSnapshot>({
        path: extractionCachePath,
        kind: 'resume_extraction',
        caseId: extractionCacheCaseId,
        fingerprints: extractionFingerprints,
      })
      if (extractionCheckpoint) {
        resumeExtractionCache.hydrate(canonicalResumeDocument, extractionCheckpoint.payload)
      }
      let extractionPersisted = Boolean(extractionCheckpoint)
      const persistResumeExtraction = async () => {
        if (extractionPersisted) return
        const snapshot = resumeExtractionCache.snapshot(canonicalResumeDocument)
        if (!snapshot) {
          const partial = resumeExtractionCache.partialSnapshot(canonicalResumeDocument)
          if (partial) await persistPartial(partial, canonicalResumeDocument)
          return
        }
        try {
          await writeCheckpoint({
            path: extractionCachePath,
            kind: 'resume_extraction',
            caseId: extractionCacheCaseId,
            fingerprints: extractionFingerprints,
            payload: snapshot,
          })
          extractionPersisted = true
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'UNKNOWN'
          if (code === 'CHECKPOINT_ALREADY_EXISTS') {
            const concurrentCheckpoint = await readCheckpoint<TrustedResumeExtractionCacheSnapshot>({
              path: extractionCachePath,
              kind: 'resume_extraction',
              caseId: extractionCacheCaseId,
              fingerprints: extractionFingerprints,
            })
            if (!concurrentCheckpoint) throw new Error('并发写入的 P01 缓存检查点不存在')
            resumeExtractionCache.hydrate(canonicalResumeDocument, concurrentCheckpoint.payload)
            extractionPersisted = true
            return
          }
          console.warn(JSON.stringify({
            event: 'resume_extraction_cache_persist_failed',
            resumeDigest,
            code,
          }))
        }
      }
      const statusPath = resolve(args.outputRoot, 'cases', `${prefix}-status.json`)
      const partialReportPath = resolve(args.outputRoot, 'cases', `${prefix}-partial.md`)
      const v5Path = resolve(args.outputRoot, 'cases', `${prefix}-v5-result.json`)
      const generationDiagnosticsPath = resolve(
        args.outputRoot,
        'cases',
        `${prefix}-generation-diagnostics.json`
      )
      const blindInputPath = resolve(args.outputRoot, 'cases', `${prefix}-blind-input.json`)
      const generationSummaryPath = resolve(args.outputRoot, 'cases', `${prefix}-generation-summary.json`)
      const abPath = resolve(args.outputRoot, 'cases', `${prefix}-ab.json`)
      const summaryPath = resolve(args.outputRoot, 'cases', `${prefix}-summary.json`)
      const existingStatus = args.resume ? await readStatusStrict(statusPath) : null
      if (existingStatus && digestJson(existingStatus.fingerprints) !== digestJson(fingerprints)) {
        throw new Error(`案例 ${caseNumber} 状态指纹不匹配`)
      }
      if (existingStatus?.stage === 'failed') {
        throw new Error(`案例 ${caseNumber} 已失败；禁止 --resume 自动重试整个案例`)
      }

      const budgetReservations = budget.journal().filter(
        entry => entry.type === 'call_reserved' && entry.caseId === id
      )
      const v5Checkpoint = args.resume
        ? await readCheckpoint<V5WorkflowResult>({ path: v5Path, kind: 'v5_result', caseId: id, fingerprints })
        : null
      let generationDiagnosticsCheckpoint = args.resume
        ? await readCheckpoint<V5DeliveryDiagnostics>({
            path: generationDiagnosticsPath,
            kind: 'generation_diagnostics',
            caseId: id,
            fingerprints,
          })
        : null
      const abCheckpoint = args.resume
        ? await readCheckpoint<DoubleOrderAbResult>({ path: abPath, kind: 'blind_ab', caseId: id, fingerprints })
        : null
      const generationSummaryCheckpoint = args.resume
        ? await readCheckpoint<GenerationCaseSummary>({
            path: generationSummaryPath,
            kind: 'generation_summary',
            caseId: id,
            fingerprints,
          })
        : null
      const blindInputCheckpoint = args.resume
        ? await readCheckpoint<BlindEvaluationInput>({
            path: blindInputPath,
            kind: 'blind_eval_input',
            caseId: id,
            fingerprints,
          })
        : null
      const summaryCheckpoint = args.resume
        ? await readCheckpoint<CaseSummary>({ path: summaryPath, kind: 'case_summary', caseId: id, fingerprints })
        : null
      const sourceV5Result = judgeSourceCase?.v5Result

      let persistedGenerationDiagnostics = generationDiagnosticsCheckpoint
        ? strictCheckpointDiagnostics(generationDiagnosticsCheckpoint.payload, caseNumber)
        : null
      const restoredV5Result = v5Checkpoint?.payload ?? sourceV5Result
      if (args.resume && restoredV5Result && !persistedGenerationDiagnostics) {
        throw new EvaluationRunnerSafetyError(
          'GENERATION_DIAGNOSTICS_MISSING',
          `案例 ${caseNumber} 的恢复结果缺少生成诊断检查点`
        )
      }
      if (restoredV5Result && persistedGenerationDiagnostics) {
        assertMatchingDiagnostics({
          expected: restoredV5Result.deliveryDiagnostics,
          actual: persistedGenerationDiagnostics,
          caseNumber,
          label: 'v5 结果',
        })
      }
      if (generationSummaryCheckpoint && persistedGenerationDiagnostics) {
        assertMatchingDiagnostics({
          expected: generationSummaryCheckpoint.payload.deliveryDiagnostics,
          actual: persistedGenerationDiagnostics,
          caseNumber,
          label: 'generation summary',
        })
      }
      if (summaryCheckpoint && persistedGenerationDiagnostics) {
        assertMatchingDiagnostics({
          expected: summaryCheckpoint.payload.deliveryDiagnostics,
          actual: persistedGenerationDiagnostics,
          caseNumber,
          label: 'case summary',
        })
      }

      const persistGenerationDiagnostics = async (value: unknown) => {
        const sanitized = sanitizeV5DeliveryDiagnostics(value)
        if (persistedGenerationDiagnostics) {
          assertMatchingDiagnostics({
            expected: persistedGenerationDiagnostics,
            actual: sanitized,
            caseNumber,
            label: '已冻结生成诊断',
          })
          return persistedGenerationDiagnostics
        }
        generationDiagnosticsCheckpoint = await writeCheckpoint({
          path: generationDiagnosticsPath,
          kind: 'generation_diagnostics',
          caseId: id,
          fingerprints,
          payload: sanitized,
        })
        persistedGenerationDiagnostics = generationDiagnosticsCheckpoint.payload
        return persistedGenerationDiagnostics
      }

      const writeStatus = async (
        stage: CaseStatus['stage'],
        error?: unknown
      ) => {
        const status: CaseStatus = {
          caseId: id,
          caseNumber,
          target,
          stage,
          updatedAt: new Date().toISOString(),
          fingerprints,
          ...(error ? { error: serializedError(error) } : {}),
          budget: budget.snapshot(),
        }
        await atomicWriteJson(statusPath, status)
        await atomicWriteText(partialReportPath, partialCaseReport(status))
      }

      if (!v5Checkpoint && budgetReservations.some(entry => entry.type === 'call_reserved' && !/^5\.0\.0-p12/.test(entry.label ?? ''))) {
        throw new Error(`案例 ${caseNumber} 有已结算或状态未知的生成调用但没有 v5 检查点；禁止自动重跑`)
      }
      if (!abCheckpoint && budgetReservations.some(entry => entry.type === 'call_reserved' && /^5\.0\.0-p12/.test(entry.label ?? ''))) {
        throw new Error(`案例 ${caseNumber} 有已执行的 P12 调用但没有盲评检查点；禁止自动重跑`)
      }
      if (summaryCheckpoint) {
        const completedCase = budget.snapshot().cases.find(item => item.caseId === id)?.completed === true
        const restoredV5Result = v5Checkpoint?.payload ?? sourceV5Result
        if (
          !restoredV5Result
          || !persistedGenerationDiagnostics
          || !abCheckpoint
          || (args.stage === 'judge-only' && !blindInputCheckpoint)
          || !completedCase
        ) {
          throw new Error(`案例 ${caseNumber} 的完成检查点集合不完整`)
        }
        assertV5EvaluationCandidateDeliverable(restoredV5Result, caseNumber)
        if (existingStatus?.stage !== 'completed') await writeStatus('completed')
        summaries.push(summaryCheckpoint.payload)
        completedResults.set(caseNumber, restoredV5Result)
        completedResumeDigests.add(resumeDigest)
        continue
      }
      if (args.stage === 'generation-only' && generationSummaryCheckpoint) {
        const completedCase = budget.snapshot().cases.find(item => item.caseId === id)?.completed === true
        if (!v5Checkpoint || !persistedGenerationDiagnostics || !blindInputCheckpoint || !completedCase) {
          throw new Error(`案例 ${caseNumber} 的 generation-only 检查点集合不完整`)
        }
        assertV5EvaluationCandidateDeliverable(v5Checkpoint.payload, caseNumber)
        if (existingStatus?.stage !== 'completed') await writeStatus('completed')
        generationSummaries.push(generationSummaryCheckpoint.payload)
        completedResults.set(caseNumber, v5Checkpoint.payload)
        completedResumeDigests.add(resumeDigest)
        continue
      }

      if (args.stage !== 'judge-only') {
        assertResumeExtractionReplaySafe({
          resume: args.resume,
          hasV5Checkpoint: Boolean(v5Checkpoint),
          hasTrustedExtractionCheckpoint: extractionPersisted,
          resumeDigest,
          completedResumeDigests,
        })
      }

      await writeStatus(v5Checkpoint || sourceV5Result ? 'generated' : 'running')
      console.log(JSON.stringify({
        event: 'case_started',
        caseNumber,
        target,
        resumed: Boolean(v5Checkpoint),
        judgeSourceLoaded: Boolean(sourceV5Result),
      }))
      let localCallOrdinal = 0
      const provider = new BudgetedEvaluationProvider({
        directProvider: {
          complete: async request => {
            const ordinal = ++localCallOrdinal
            const response = await deepSeekProvider.complete(request)
            // Nonprod-only, owner-readable diagnostics. Never emit source or
            // raw model output to shared harness events or console logs.
            try {
              await atomicWriteJson(resolve(args.outputRoot, 'private-calls', `${id}-${String(ordinal).padStart(3, '0')}.json`), {
                promptVersion: request.promptVersion,
                messages: request.messages,
                response: { content: response.content, finishReason: response.finishReason },
                providerMetadata: { requestedModel: model, returnedModel: response.model,
                  generationPolicy: isResumeExtractionRequest(request) ? extractionPolicy : generationPolicy,
                  inputTokens: response.inputTokens, outputTokens: response.outputTokens, reasoningTokens: response.reasoningTokens },
              })
            } catch {
              console.warn(JSON.stringify({ event: 'private_call_diagnostic_write_failed', ordinal }))
            }
            return response
          },
        },
        budget,
        caseId: id,
        model,
        componentQuotas: providerComponentQuotasForRun({
          resume: args.resume, resumeChunks, stage: args.stage,
          validatedShardIndexes: resumeExtractionCache.progress(canonicalResumeDocument).validatedShardIndices,
          artifactGenerationMode: args.artifactGenerationMode,
        }),
        usageSink,
      })

      const extractionObservations: P01ValidationObservationV1[] = []
      const persistP01ValidationDiagnostics = async () => {
        const observedPrimaries = new Set(extractionObservations
          .filter(item => item.component === 'P01').map(item => item.shardIndex))
        const trace = buildP01ValidationTrace({
          captureStatus: extractionObservations.length === 0
            ? 'not_observed'
            : observedPrimaries.size === resumeChunks ? 'complete' : 'partial',
          source: extractionObservations.length === 0 && extractionPersisted
            ? 'trusted_cache' : 'live',
          shardCount: resumeChunks,
          observations: extractionObservations,
        })
        if (!trace) throw new Error('Invalid P01 validation diagnostics projection')
        await writeCheckpoint({
          path: resolve(args.outputRoot, 'cases', `${prefix}-p01-validation-diagnostics.json`),
          kind: 'p01_validation_diagnostics',
          caseId: id,
          fingerprints,
          payload: trace,
        })
      }
      let p01DiagnosticsPersisted = false
      const persistP01DiagnosticsOnce = async () => {
        if (p01DiagnosticsPersisted) return
        await persistP01ValidationDiagnostics()
        p01DiagnosticsPersisted = true
      }

      try {
        let v5Result = v5Checkpoint?.payload ?? sourceV5Result
        if (!v5Result) {
          if (args.stage === 'judge-only') {
            throw new Error(`案例 ${caseNumber} 的 judge-only 来源结果在执行前丢失`)
          }
          const eventBus = createHarnessEventBus()
          eventBus.subscribe('extraction.validation.observed', event => {
            const observation = sanitizeP01ValidationObservation(event.payload)
            if (observation) extractionObservations.push(observation)
          })
          const workflow = new V5ResumeOptimizationWorkflow({
            provider,
            judgeProvider: provider,
            resumeExtractionCache,
            eventBus,
            enableDefaultSubscribers: false,
            artifactGenerationMode: args.artifactGenerationMode,
            jobTargetingPolicy: args.jobTargetingPolicy,
            entryWritingPolicy: args.entryWritingPolicy,
            onEntryStreamEvent: event => {
              // Audit progress only. Resume text belongs in protected final artifacts,
              // never in stdout or the general Harness event log.
              console.log(JSON.stringify({ type: event.type, sequence: event.sequence,
                ...(event.type === 'entry.preview' ? { order: event.order, paragraphs: event.paragraphs.length } : {}) }))
            },
            onTargetingAnalysis: analysis => writeCheckpoint({
              path: resolve(args.outputRoot, 'cases', `${prefix}-job-targeting.json`),
              kind: 'job_targeting_analysis', caseId: id, fingerprints, payload: analysis,
            }).then(() => undefined),
          })
          v5Result = await workflow.run({
            resumeMarkdown: history.resume_content,
            jobDescription: history.jd_content,
            enableQualityJudge: false,
            workflowTimeoutMs: budgetProfile.caseLimits.maxWallTimeMs,
          })
          const completedV5Result = v5Result
          await persistP01DiagnosticsOnce()
          await persistGenerationDiagnosticsBeforeResumeCache({
            persistGenerationDiagnostics: () => persistGenerationDiagnostics(completedV5Result.deliveryDiagnostics),
            persistResumeExtraction,
          })
          await writeCheckpoint({
            path: v5Path,
            kind: 'v5_result',
            caseId: id,
            fingerprints,
            payload: v5Result,
          })
          await atomicWriteText(resolve(args.outputRoot, 'cases', `${prefix}-v5.md`), v5Result.artifact.markdown)
          await writeStatus('generated')
        }
        const deliveryDiagnostics = await persistGenerationDiagnostics(v5Result.deliveryDiagnostics)
        assertV5EvaluationCandidateDeliverable(v5Result, caseNumber)

        let evaluationInput = blindInputCheckpoint?.payload
        if (args.stage === 'judge-only') {
          const expectedBlindInput: BlindEvaluationInput = {
            schemaVersion: V5_SCHEMA_VERSION,
            caseNumber,
            target,
            resumeEvidenceBundle: v5Result.resumeEvidenceBundle,
            jobRequirementBundle: v5Result.jobRequirementBundle,
            baselineArtifact: baselineArtifact(history.optimized_content),
            candidateArtifact: v5Result.artifact,
          }
          if (evaluationInput && digestJson(evaluationInput) !== digestJson(expectedBlindInput)) {
            throw new Error(`案例 ${caseNumber} 的 judge-only 盲评输入与已验证 source-run 不一致`)
          }
          if (!evaluationInput) {
            await writeCheckpoint({
              path: blindInputPath,
              kind: 'blind_eval_input',
              caseId: id,
              fingerprints,
              payload: expectedBlindInput,
            })
            evaluationInput = expectedBlindInput
          }
          if (args.resume) {
            const copiedMarkdown = await readFile(
              resolve(args.outputRoot, 'cases', `${prefix}-v5.md`),
              'utf8'
            )
            if (copiedMarkdown !== v5Result.artifact.markdown) {
              throw new Error(`案例 ${caseNumber} 的 judge-only Markdown 副本与 source-run 不一致`)
            }
          } else {
            await atomicWriteText(
              resolve(args.outputRoot, 'cases', `${prefix}-v5.md`),
              v5Result.artifact.markdown
            )
          }
        }

        if (args.stage === 'generation-only') {
          const blindInput: BlindEvaluationInput = blindInputCheckpoint?.payload ?? {
            schemaVersion: V5_SCHEMA_VERSION,
            caseNumber,
            target,
            resumeEvidenceBundle: v5Result.resumeEvidenceBundle,
            jobRequirementBundle: v5Result.jobRequirementBundle,
            baselineArtifact: baselineArtifact(history.optimized_content),
            candidateArtifact: v5Result.artifact,
          }
          if (!blindInputCheckpoint) {
            await writeCheckpoint({
              path: blindInputPath,
              kind: 'blind_eval_input',
              caseId: id,
              fingerprints,
              payload: blindInput,
            })
          }
          const candidateStats = measureArtifactMarkdown(v5Result.artifact.markdown)
          const generationSummary: GenerationCaseSummary = {
            caseNumber,
            target,
            runId: v5Result.runId,
            state: v5Result.state,
            usedSafeFallback: v5Result.usedSafeFallback,
            usedAnyFallback: v5Result.usedAnyFallback,
            deliveryDecision: v5Result.deliveryDecision,
            qualityGates: v5Result.qualityGates,
            matchScore: v5Result.matchScore.score,
            candidateChars: candidateStats.cjkCharacterCount,
            candidateBullets: candidateStats.businessBulletCount,
            deliveryDiagnostics,
          }
          await provider.drain()
          await budget.completeCase(id)
          await writeCheckpoint({
            path: generationSummaryPath,
            kind: 'generation_summary',
            caseId: id,
            fingerprints,
            payload: generationSummary,
          })
          generationSummaries.push(generationSummary)
          completedResults.set(caseNumber, v5Result)
          completedResumeDigests.add(resumeDigest)
          await writeStatus('completed')
          console.log(JSON.stringify({ event: 'case_generation_completed', caseNumber, state: v5Result.state }))
          continue
        }

        let abResult = abCheckpoint?.payload
        if (!abResult) {
          abResult = await runDoubleOrderBlindAb({
            runId: `${v5Result.runId}-ab`,
            resumeEvidenceBundle: evaluationInput?.resumeEvidenceBundle ?? v5Result.resumeEvidenceBundle,
            jobRequirementBundle: evaluationInput?.jobRequirementBundle ?? v5Result.jobRequirementBundle,
            originalJobDescription: history.jd_content,
            candidateLeft: evaluationInput?.baselineArtifact ?? baselineArtifact(history.optimized_content),
            candidateRight: evaluationInput?.candidateArtifact ?? v5Result.artifact,
          }, { provider })
          await writeCheckpoint({
            path: abPath,
            kind: 'blind_ab',
            caseId: id,
            fingerprints,
            payload: abResult,
          })
          await writeStatus('evaluated')
        }

        const baselineStats = measureArtifactMarkdown(
          evaluationInput?.baselineArtifact.markdown ?? history.optimized_content
        )
        const candidateStats = measureArtifactMarkdown(
          evaluationInput?.candidateArtifact.markdown ?? v5Result.artifact.markdown
        )
        const summary: CaseSummary = {
          caseNumber,
          target,
          runId: v5Result.runId,
          state: v5Result.state,
          usedSafeFallback: v5Result.usedSafeFallback,
          matchScore: v5Result.matchScore.score,
          baselineGate: evaluationGate(abResult, 'baseline'),
          candidateGate: evaluationGate(abResult, 'candidate'),
          baselineScore: evaluationScore(abResult, 'baseline'),
          candidateScore: evaluationScore(abResult, 'candidate'),
          winner: winner(abResult),
          orderConsistent: abResult.orderConsistent,
          scoreDriftMax: abResult.scoreDriftMax,
          baselineChars: baselineStats.cjkCharacterCount,
          candidateChars: candidateStats.cjkCharacterCount,
          baselineBullets: baselineStats.businessBulletCount,
          candidateBullets: candidateStats.businessBulletCount,
          deliveryDiagnostics,
        }
        await provider.drain()
        await budget.completeCase(id)
        await writeCheckpoint({
          path: summaryPath,
          kind: 'case_summary',
          caseId: id,
          fingerprints,
          payload: summary,
        })
        summaries.push(summary)
        completedResults.set(caseNumber, v5Result)
        completedResumeDigests.add(resumeDigest)
        await writeStatus('completed')
        const usageRows = await readJsonlStrict<EvaluationUsageEntry>(usagePath) ?? []
        await atomicWriteJson(resolve(args.outputRoot, 'results.partial.json'), {
          metadata: {
            runId: manifest.runId,
            historyDigest,
            implementationDigest,
            configDigest,
            judgeSource: manifest.judgeSource,
            selectedCases: args.selectedCases,
            budget: budget.snapshot(),
            extractionCache: resumeExtractionCache.stats(),
            usageRows,
          },
          summaries,
        })
        console.log(JSON.stringify({ event: 'case_completed', caseNumber, state: summary.state, winner: summary.winner }))
      } catch (error) {
        await finalizeFailedEvaluationCaseAndRethrow({
          primaryError: error,
          persistFailureDiagnostics: async () => {
            const failureDiagnostics = deliveryDiagnosticsFromError(error)
            // Each sidecar gets its own attempt; a disk error must not erase
            // the other diagnostic or replace the primary workflow failure.
            const diagnostics = await Promise.allSettled([
              persistP01DiagnosticsOnce(),
              failureDiagnostics ? persistGenerationDiagnostics(failureDiagnostics) : Promise.resolve(),
            ])
            const failed = diagnostics.find(item => item.status === 'rejected')
            if (failed?.status === 'rejected') throw failed.reason
          },
          triggerFailFast: async () => {
            if (budget.aborted) return
            try {
              await budget.failFast(error, id)
            } catch {
              // failFast intentionally throws after atomically journaling terminal state.
            }
          },
          drainProvider: () => provider.drain(),
          persistResumeExtraction,
          writeFailedStatus: () => writeStatus('failed', error),
          onStageError: (stage, cleanupError) => {
            const code = typeof cleanupError === 'object' && cleanupError !== null && 'code' in cleanupError
              ? String(cleanupError.code)
              : 'UNKNOWN'
            console.warn(JSON.stringify({
              event: 'case_failure_cleanup_error',
              caseNumber,
              stage,
              code,
            }))
          },
        })
      }
    }

    const usageRows = await readJsonlStrict<EvaluationUsageEntry>(usagePath) ?? []
    const metadata = {
      completedAt: new Date().toISOString(),
      runId: manifest.runId,
      historyDigest,
      implementationDigest,
      configDigest,
      judgeSource: manifest.judgeSource,
      source: args.historyPath,
      selectedCases: args.selectedCases,
      cases: args.stage === 'generation-only' ? generationSummaries.length : summaries.length,
      budget: budget.snapshot(),
      extractionCache: resumeExtractionCache.stats(),
      usageRows,
    }
    const completedSummaries = args.stage === 'generation-only' ? generationSummaries : summaries
    await atomicWriteJson(resolve(args.outputRoot, 'results.json'), {
      metadata,
      summaries: completedSummaries,
    })
    await atomicWriteText(
      resolve(args.outputRoot, 'REPORT.md'),
      args.stage === 'generation-only'
        ? generationReport({
            summaries: generationSummaries,
            historyDigest,
            selectedCases: args.selectedCases,
            budget: budget.snapshot(),
            extractionCache: resumeExtractionCache.stats(),
          })
        : report({
            summaries,
            results: completedResults,
            usage: usageRows,
            historyDigest,
            selectedCases: args.selectedCases,
            stage: args.stage,
            judgeSource: manifest.judgeSource,
            budget: budget.snapshot(),
            extractionCache: resumeExtractionCache.stats(),
          })
    )
    console.log(JSON.stringify({
      event: 'run_completed',
      outputRoot: args.outputRoot,
      calls: budget.snapshot().run.usage.physicalAttempts,
      inputTokens: budget.snapshot().run.usage.settledInputTokens,
      outputTokens: budget.snapshot().run.usage.settledOutputTokens,
    }))
  } catch (error) {
    executionFailed = true
    throw error
  } finally {
    await finalizeEvaluationResources({
      hadPrimaryFailure: executionFailed,
      stages: [
        { stage: 'resume_extraction_cache_clear', action: () => resumeExtractionCache.clear() },
        { stage: 'budget_dispose', action: () => budget.dispose() },
      ],
      onStageError: (stage, error) => {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'UNKNOWN'
        console.warn(JSON.stringify({ event: 'run_resource_cleanup_error', stage, code }))
      },
    })
  }
  } catch (error) {
    runFailed = true
    throw error
  } finally {
    await finalizeEvaluationResources({
      hadPrimaryFailure: runFailed,
      stages: [{ stage: 'run_lock_release', action: () => runLock.release() }],
      onStageError: (stage, error) => {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'UNKNOWN'
        console.warn(JSON.stringify({ event: 'run_resource_cleanup_error', stage, code }))
      },
    })
  }
}

if (import.meta.main) {
  try { await main() } catch (error) {
    console.error(JSON.stringify({ event: 'run_failed', error: serializedError(error) }))
    process.exitCode = 1
  }
}
