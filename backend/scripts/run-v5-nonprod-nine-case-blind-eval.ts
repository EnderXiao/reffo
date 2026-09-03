import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  BudgetedEvaluationProvider,
  EXPECTED_NONPROD_HISTORY_SHA256,
  V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
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
  createImplementationDigest,
  digestJson,
  parseEvaluationRunnerArgs,
  readCheckpoint,
  readJsonlStrict,
  restoreEvaluationBudget,
  sha256,
  v5CasePhysicalCallUpperBound,
  writeCheckpoint,
  type EvaluationCheckpointFingerprints,
  type EvaluationRunStage,
  type EvaluationUsageEntry,
} from '@/v5/evaluation-runner-support'
import type { GeneratedResumeArtifact, V5WorkflowResult } from '@/v5/types'
import { V5_SCHEMA_VERSION, V5_WORKFLOW_VERSION } from '@/v5/types'
import { measureArtifactMarkdown } from '@/v5/validators'
import {
  V5_RESUME_EXTRACTION_CACHE_VERSION,
  createTrustedResumeExtractionCache,
  type ResumeExtractionCacheStats,
} from '@/v5/resume-extraction-cache'

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
}

interface GenerationCaseSummary {
  caseNumber: number
  target: string
  runId: string
  state: string
  usedSafeFallback: boolean
  matchScore: number
  candidateChars: number
  candidateBullets: number
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
    issues?: Array<{ code: string; outputPath: string | null }>
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
  budgetProfile: ReturnType<typeof budgetProfileForCases>
  provider: {
    endpoint: string
    model: string
    maxProviderAttempts: 1
    fallbackEnabled: false
  }
  extractionCache: {
    protocolVersion: typeof V5_RESUME_EXTRACTION_CACHE_VERSION
    persistence: 'single_process_only'
  }
}

const backendRoot = resolve(import.meta.dir, '..')
const args = parseEvaluationRunnerArgs(process.argv.slice(2), { backendRoot })

function usage() {
  return `Reffo v5 nonprod 安全评测运行器

用法：
  bun run scripts/run-v5-nonprod-nine-case-blind-eval.ts --stage extract-only --dry-run --cases 2
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --stage generation-only --live --output <新目录> --cases 2 --fail-fast
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --stage judge-only --source-run <生成目录> --live --output <新目录> --cases 2 --fail-fast
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --live --output <新目录> --cases 1-9 --fail-fast
  bun --env-file=.env.nonprod run scripts/run-v5-nonprod-nine-case-blind-eval.ts --live --resume --output <原目录> --cases <原选择>

参数：
  --history <path>  指定固定的 9 条 nonprod 数据文件
  --output <path>   指定全新输出目录；非 --resume 时目录必须为空
  --cases <list>    例如 2、1,3,5 或 1-9；默认仅案例 2 canary
  --stage <stage>   extract-only、generation-only、judge-only 或 full；默认 full
  --source-run      judge-only 使用的冻结 generation-only/full 输出目录
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

function serializedError(error: unknown) {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    const issues = 'issues' in error && Array.isArray(error.issues)
      ? error.issues.flatMap(item => {
          if (!isRecord(item) || typeof item.code !== 'string') return []
          return [{
            code: item.code,
            outputPath: typeof item.outputPath === 'string' ? item.outputPath : null,
            claimId: typeof item.claimId === 'string' ? item.claimId : null,
            evidenceIds: Array.isArray(item.evidenceIds)
              ? item.evidenceIds.filter(id => typeof id === 'string').slice(0, 10)
              : [],
          }]
        }).slice(0, 30)
      : []
    return {
      name: error.name || 'Error',
      message: error.message.slice(0, 500),
      ...(code ? { code } : {}),
      ...(issues.length > 0 ? { issues } : {}),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 500) }
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
  budget: ReturnType<EvaluationBudgetController['snapshot']>
  extractionCache: Readonly<ResumeExtractionCacheStats>
}) {
  const average = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
  const rows = input.summaries.map(item => {
    const prefix = casePrefix(item.caseNumber, item.target)
    return `| ${item.caseNumber} | ${item.target} | ${item.baselineGate} / ${item.candidateGate} | ${item.baselineScore} → ${item.candidateScore} | ${item.winner} | ${item.baselineChars} → ${item.candidateChars} | ${item.baselineBullets} → ${item.candidateBullets} | [v5 简历](cases/${prefix}-v5.md) | [盲评检查点](cases/${prefix}-ab.json) |`
  }).join('\n')
  const differentiation = sameSourceDifferentiation(input.results)
  const successfulUsage = input.usage.filter(item => item.outcome === 'success')
  const totalInput = successfulUsage.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0)
  const totalOutput = successfulUsage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0)
  const totalLatency = input.usage.reduce((sum, item) => sum + (item.latencyMs ?? 0), 0)
  const differentiationText = differentiation.pairCount > 0
    ? `中位数 ${differentiation.medianSimilarity}，范围 ${differentiation.minSimilarity}–${differentiation.maxSimilarity}`
    : '当前选择不足以计算（需要案例 3–8 中至少两例）'
  return `# Reffo v5 nonprod 简历生成与双顺序盲评

运行时间：${new Date().toISOString()}

数据摘要 SHA-256：${input.historyDigest}

## 总体结果

- 选择案例：${input.selectedCases.join(', ')}
- 完成案例：${input.summaries.length}/${input.selectedCases.length}
- v5 胜 / 旧版胜 / 平局 / 顺序不一致：${input.summaries.filter(item => item.winner === 'v5').length} / ${input.summaries.filter(item => item.winner === 'baseline').length} / ${input.summaries.filter(item => item.winner === 'tie').length} / ${input.summaries.filter(item => item.winner === 'order_inconsistent').length}
- 旧版平均分：${average(input.summaries.map(item => item.baselineScore)).toFixed(1)}
- v5 平均分：${average(input.summaries.map(item => item.candidateScore)).toFixed(1)}
- v5 安全回退：${input.summaries.filter(item => item.usedSafeFallback).length}（安全回退会使运行立即终止，不进入有效结果集）
- 同源岗位 v5 正文四元组相似度：${differentiationText}
- 物理模型尝试：${input.budget.run.usage.physicalAttempts} 次；已结算输入 ${input.budget.run.usage.settledInputTokens} tokens；已结算输出 ${input.budget.run.usage.settledOutputTokens} tokens
- Provider 成功响应：${successfulUsage.length}；响应所报输入 ${totalInput} tokens；输出 ${totalOutput} tokens；累计 Provider 延迟 ${totalLatency} ms
- 受信 P01 提取缓存：命中 ${input.extractionCache.hits}，未命中 ${input.extractionCache.misses}，并发合并 ${input.extractionCache.coalesced}，完整性失败 ${input.extractionCache.integrityFailures}

## 逐案结果

| # | 目标岗位 | 绝对门禁（旧/v5） | 双顺序均分 | 胜者 | 字符数 | bullets | 简历 | 盲评 |
|---:|---|---|---:|---|---:|---:|---|---|
${rows}

## 说明

- baseline 使用历史 nonprod 已保存的优化简历；v5 使用同一冻结实现和配置处理原始简历与 JD。
- 只使用直接 DeepSeek provider；禁用 fallback、SDK 自动重试和整案自动重跑。
- 每次真实物理请求前先预留调用、输入、输出与墙钟预算；失败请求同样计数并触发共享取消。
- 每案先通过 v5 确定性门禁和 P09 阻断式事实 Judge，再进行 P12 A/B 与 B/A 双顺序匿名评测。
- v5 安全回退或 v5 绝对门禁非 pass 都会立即终止批次，不能计为有效候选结果。
- P01 缓存只在当前进程内复用；恢复时若需要跨进程重复提取已完成案例的同源简历，运行器会直接阻断。
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
    return `| ${item.caseNumber} | ${item.target} | ${item.state} | ${item.matchScore} | ${item.candidateChars} | ${item.candidateBullets} | [v5 简历](cases/${prefix}-v5.md) | [冻结盲评输入](cases/${prefix}-blind-input.json) |`
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

| # | 目标岗位 | 状态 | 匹配分 | 字符数 | 业务 bullets | 简历 | 盲评输入 |
|---:|---|---|---:|---:|---:|---|---|
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

async function main() {
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

  const requiredPhysicalCalls = Math.max(...selected.map(({ history }) => (
    v5CasePhysicalCallUpperBound(
      splitResumeDocument(canonicalizeSourceDocument(history.resume_content).canonicalDocument).length,
      args.stage
    )
  )))
  const budgetProfile = budgetProfileForCases(args.selectedCases, args.stage, requiredPhysicalCalls)
  const implementationDigest = await createImplementationDigest(backendRoot)
  const model = process.env.AI_MODEL?.trim() || 'deepseek-chat'
  if (model !== 'deepseek-chat') {
    throw new Error(`评测模型必须精确为 deepseek-chat，当前为 ${model}`)
  }
  const contextWindowTokens = Number.parseInt(process.env.V5_CONTEXT_WINDOW_TOKENS || '64000', 10)
  if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens <= 0) {
    throw new Error('V5_CONTEXT_WINDOW_TOKENS 必须是正安全整数')
  }
  const configDigest = digestJson({
    runnerProtocolVersion: V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
    workflowVersion: V5_WORKFLOW_VERSION,
    runtime: { bunVersion: Bun.version },
    selectedCases: args.selectedCases,
    stage: args.stage,
    sourceRun: args.sourceRun,
    providerEndpoint,
    model,
    maxProviderAttempts: 1,
    fallbackEnabled: false,
    qualityJudgeEnabled: false,
    doubleOrderBlindEvaluation: true,
    structuredOutputMode,
    contextWindowTokens,
    budgetProfile,
    extractionCache: {
      protocolVersion: V5_RESUME_EXTRACTION_CACHE_VERSION,
      chunkPlanVersion: RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
      maxBlocks: DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
      maxCharacters: DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
      maxEstimatedOutputTokens: DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
      concurrency: DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
      persistence: 'single_process_only',
    },
  })
  const preflightCases = selected.map(({ number, history }) => {
    const resume = canonicalizeSourceDocument(history.resume_content)
    const job = canonicalizeSourceDocument(history.jd_content)
    const resumeChunks = splitResumeDocument(resume.canonicalDocument).length
    return {
      caseNumber: number,
      resumeDigest: resume.rawSha256,
      resumeBlocks: resume.canonicalDocument.blocks.length,
      resumeChunks,
      jobBlocks: job.canonicalDocument.blocks.length,
      physicalCallUpperBoundWithoutCache: v5CasePhysicalCallUpperBound(resumeChunks, args.stage),
      withinCaseCallBudget: v5CasePhysicalCallUpperBound(resumeChunks, args.stage) <= budgetProfile.caseLimits.maxPhysicalCalls,
    }
  })
  const noCacheCallUpperBound = preflightCases.reduce(
    (sum, item) => sum + item.physicalCallUpperBoundWithoutCache,
    0
  )
  const uniqueResumeUpperBound = args.stage === 'judge-only'
    ? selected.length * V5_JUDGE_CALL_UPPER_BOUND
    : [...new Map(preflightCases.map(item => [item.resumeDigest, item])).values()]
      .reduce((sum, item) => sum + item.resumeChunks * 2, 0)
      + selected.length * (args.stage === 'extract-only'
        ? 0
        : args.stage === 'generation-only'
          ? V5_GENERATION_NON_EXTRACTION_CALL_UPPER_BOUND
          : V5_NON_EXTRACTION_CALL_UPPER_BOUND)
  const overCaseCallBudget = preflightCases.filter(item => !item.withinCaseCallBudget)
  const blockingReasons = [
    ...(overCaseCallBudget.length > 0
      ? [`案例 ${overCaseCallBudget.map(item => item.caseNumber).join(', ')} 的调用上界超过单案 ${budgetProfile.caseLimits.maxPhysicalCalls} 次`]
      : []),
    ...(uniqueResumeUpperBound > budgetProfile.runLimits.maxPhysicalCalls
      ? [`启用受信共享提取缓存后批次调用上界 ${uniqueResumeUpperBound} 仍超过全局 ${budgetProfile.runLimits.maxPhysicalCalls} 次`]
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
    failFast: args.failFast,
    provider: { endpoint: providerEndpoint, model, fallbackEnabled: false, maxProviderAttempts: 1 },
    budgetProfile,
    implementationDigest,
    configDigest,
    cases: preflightCases,
    physicalCallUpperBoundWithoutCache: noCacheCallUpperBound,
    physicalCallUpperBoundWithTrustedResumeExtractionCache: uniqueResumeUpperBound,
    extractionCacheReady: true,
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
      || manifest.extractionCache?.protocolVersion !== V5_RESUME_EXTRACTION_CACHE_VERSION
      || manifest.extractionCache?.persistence !== 'single_process_only'
    ) {
      throw new Error('run manifest 与当前运行选择不一致')
    }
    const restored = await restoreEvaluationBudget({ journalPath, journalSink: budgetJournalSink })
    if (!restored) throw new Error('恢复目录缺少 budget journal')
    if (restored.snapshot().runId !== manifest.runId) {
      restored.dispose()
      throw new Error('budget journal runId 与 manifest 不一致')
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
      budgetProfile,
      provider: {
        endpoint: providerEndpoint,
        model,
        maxProviderAttempts: 1,
        fallbackEnabled: false,
      },
      extractionCache: {
        protocolVersion: V5_RESUME_EXTRACTION_CACHE_VERSION,
        persistence: 'single_process_only',
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

  const resumeExtractionCache = createTrustedResumeExtractionCache({
    implementationFingerprint: implementationDigest,
    providerConfigFingerprint: configDigest,
    chunkMaxBlocks: DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
    chunkMaxCharacters: DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
    chunkMaxEstimatedOutputTokens: DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
    chunkConcurrency: DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  })
  const summaries: CaseSummary[] = []
  const generationSummaries: GenerationCaseSummary[] = []
  const completedResults = new Map<number, V5WorkflowResult>()
  const completedResumeDigests = new Set<string>()

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
      const resumeDigest = sha256(history.resume_content)
      const prefix = casePrefix(caseNumber, target)
      const inputDigest = digestJson({
        historyDigest,
        caseNumber,
        company: history.company,
        position: history.position,
        resume: history.resume_content,
        jd: history.jd_content,
        baseline: history.optimized_content,
      })
      const fingerprints: EvaluationCheckpointFingerprints = { inputDigest, implementationDigest, configDigest }
      const statusPath = resolve(args.outputRoot, 'cases', `${prefix}-status.json`)
      const partialReportPath = resolve(args.outputRoot, 'cases', `${prefix}-partial.md`)
      const v5Path = resolve(args.outputRoot, 'cases', `${prefix}-v5-result.json`)
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
        if (
          !v5Checkpoint
          || !abCheckpoint
          || !completedCase
          || summaryCheckpoint.payload.candidateGate !== 'pass'
        ) {
          throw new Error(`案例 ${caseNumber} 的完成检查点集合不完整`)
        }
        if (existingStatus?.stage !== 'completed') await writeStatus('completed')
        summaries.push(summaryCheckpoint.payload)
        completedResults.set(caseNumber, v5Checkpoint.payload)
        completedResumeDigests.add(resumeDigest)
        continue
      }
      if (args.stage === 'generation-only' && generationSummaryCheckpoint) {
        const completedCase = budget.snapshot().cases.find(item => item.caseId === id)?.completed === true
        if (!v5Checkpoint || !blindInputCheckpoint || !completedCase || generationSummaryCheckpoint.payload.usedSafeFallback) {
          throw new Error(`案例 ${caseNumber} 的 generation-only 检查点集合不完整`)
        }
        if (existingStatus?.stage !== 'completed') await writeStatus('completed')
        generationSummaries.push(generationSummaryCheckpoint.payload)
        completedResults.set(caseNumber, v5Checkpoint.payload)
        completedResumeDigests.add(resumeDigest)
        continue
      }

      assertResumeExtractionReplaySafe({
        resume: args.resume,
        hasV5Checkpoint: Boolean(v5Checkpoint),
        resumeDigest,
        completedResumeDigests,
      })

      await writeStatus(v5Checkpoint ? 'generated' : 'running')
      console.log(JSON.stringify({ event: 'case_started', caseNumber, target, resumed: Boolean(v5Checkpoint) }))
      const provider = new BudgetedEvaluationProvider({
        directProvider: deepSeekProvider,
        budget,
        caseId: id,
        model,
        usageSink,
      })

      try {
        let v5Result = v5Checkpoint?.payload
        if (!v5Result) {
          const eventBus = createHarnessEventBus()
          const workflow = new V5ResumeOptimizationWorkflow({
            provider,
            judgeProvider: provider,
            resumeExtractionCache,
            eventBus,
            enableDefaultSubscribers: false,
          })
          v5Result = await workflow.run({
            resumeMarkdown: history.resume_content,
            jobDescription: history.jd_content,
            enableQualityJudge: false,
            workflowTimeoutMs: budgetProfile.caseLimits.maxWallTimeMs,
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
        if (v5Result.usedSafeFallback || v5Result.state === 'succeeded_with_safe_fallback') {
          throw Object.assign(new Error('v5 使用了安全回退；该候选不能进入有效盲评，批次已停止'), {
            code: 'V5_SAFE_FALLBACK_FAIL_FAST',
          })
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
            matchScore: v5Result.matchScore.score,
            candidateChars: candidateStats.cjkCharacterCount,
            candidateBullets: candidateStats.businessBulletCount,
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
            resumeEvidenceBundle: v5Result.resumeEvidenceBundle,
            jobRequirementBundle: v5Result.jobRequirementBundle,
            candidateLeft: baselineArtifact(history.optimized_content),
            candidateRight: v5Result.artifact,
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

        const baselineStats = measureArtifactMarkdown(history.optimized_content)
        const candidateStats = measureArtifactMarkdown(v5Result.artifact.markdown)
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
        }
        if (summary.candidateGate !== 'pass') {
          throw Object.assign(new Error(`v5 双顺序绝对门禁结果为 ${summary.candidateGate}；批次已停止`), {
            code: 'V5_ABSOLUTE_GATE_FAIL_FAST',
          })
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
            selectedCases: args.selectedCases,
            budget: budget.snapshot(),
            extractionCache: resumeExtractionCache.stats(),
            usageRows,
          },
          summaries,
        })
        console.log(JSON.stringify({ event: 'case_completed', caseNumber, state: summary.state, winner: summary.winner }))
      } catch (error) {
        if (!budget.aborted) {
          try {
            await budget.failFast(error, id)
          } catch {
            // failFast intentionally throws after atomically journaling terminal state.
          }
        }
        await provider.drain()
        await writeStatus('failed', error)
        throw error
      }
    }

    const usageRows = await readJsonlStrict<EvaluationUsageEntry>(usagePath) ?? []
    const metadata = {
      completedAt: new Date().toISOString(),
      runId: manifest.runId,
      historyDigest,
      implementationDigest,
      configDigest,
      source: args.historyPath,
      selectedCases: args.selectedCases,
      cases: summaries.length,
      budget: budget.snapshot(),
      extractionCache: resumeExtractionCache.stats(),
      usageRows,
    }
    await atomicWriteJson(resolve(args.outputRoot, 'results.json'), { metadata, summaries })
    await atomicWriteText(resolve(args.outputRoot, 'REPORT.md'), report({
      summaries,
      results: completedResults,
      usage: usageRows,
      historyDigest,
      selectedCases: args.selectedCases,
      budget: budget.snapshot(),
      extractionCache: resumeExtractionCache.stats(),
    }))
    console.log(JSON.stringify({
      event: 'run_completed',
      outputRoot: args.outputRoot,
      calls: budget.snapshot().run.usage.physicalAttempts,
      inputTokens: budget.snapshot().run.usage.settledInputTokens,
      outputTokens: budget.snapshot().run.usage.settledOutputTokens,
    }))
  } finally {
    resumeExtractionCache.clear()
    budget.dispose()
  }
  } finally {
    await runLock.release()
  }
}

await main()
