import type { StepRunSnapshot } from '@/harness/run-step'
import { createCanonicalDigest, createDigest } from '@/harness/run-context'
import { env } from '@/config/env'
import { v5ReleaseWorkflowOptions } from '@/config/v5-release'
import { V5CheckpointError, V5CheckpointRepository } from '@/repositories/v5-checkpoint-repository'
import {
  V5AnalysisCacheRepository,
  type V5AnalysisCacheResultStatus,
} from '@/repositories/v5-analysis-cache-repository'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { createTrustedResumeExtractionCache } from '@/v5/resume-extraction-cache'
import { V5ResumeOptimizationWorkflow, type V5MatchingCheckpoint } from '@/v5/main/workflow'
import { toResumeAnalysis, toMatchAnalysis, toLegacyMvpProcessResponse, toInterviewPreparation } from '@/v5/main/compatibility'
import { V5_WORKFLOW_VERSION, type V5ResumeExtractionResult, type V5WorkflowResult } from '@/v5/types'
import type { ResumeAnalysis, InterviewSuggestions } from '@/types'
import manifest from '@/v5/prompts/manifest.json'

export const V5_ANALYSIS_CACHE_VERSION = 'v5-analysis-result-cache-v1'

/** 分步调用的会话级时间预算：/analyze 起算，后续步骤按剩余预算收紧各自上限。 */
export interface SessionBudget {
  deadlineMs: number
  totalMs: number
}

export class V5SessionBudgetError extends Error {
  readonly code = 'V5_SESSION_BUDGET_EXHAUSTED'
  readonly status = 503

  constructor() {
    super('本次生成会话的可用时间已用完，请重新开始')
    this.name = 'V5SessionBudgetError'
  }
}

/** 旧检查点没有 budget 字段时按独立上限运行，保持向后兼容。 */
export function sessionStepTimeoutMs(budget: SessionBudget | undefined, stepCapMs: number): number {
  if (!budget) return stepCapMs
  const remaining = budget.deadlineMs - Date.now()
  if (remaining <= 0) throw new V5SessionBudgetError()
  return Math.min(stepCapMs, remaining)
}

export function freshSessionBudget(): SessionBudget {
  return { deadlineMs: Date.now() + env.V5_SESSION_BUDGET_MS, totalMs: env.V5_SESSION_BUDGET_MS }
}

// 版本读取真实 Prompt manifest；变更模型、思考模式或 Prompt 后旧检查点不能混用。
export function singleStepFingerprint() {
  return createDigest({workflow: V5_WORKFLOW_VERSION, manifest, protocol: 'v5-single-step-v2',
    model: env.AI_MODEL, endpoint: env.OPENAI_BASE_URL, thinking: env.DEEPSEEK_THINKING_MODE,
    extractionThinking: env.DEEPSEEK_P01_THINKING_MODE, structuredOutput: env.V5_STRUCTURED_OUTPUT_MODE})
}

function extractionCacheFingerprints() {
  return {
    implementationFingerprint: createDigest({
      workflow: V5_WORKFLOW_VERSION,
      manifest,
      protocol: 'v5-single-step-v2',
    }),
    providerConfigFingerprint: createDigest({
      endpoint: env.OPENAI_BASE_URL,
      model: env.AI_MODEL,
      thinking: env.DEEPSEEK_THINKING_MODE,
      extractionThinking: env.DEEPSEEK_P01_THINKING_MODE,
      structuredOutput: env.V5_STRUCTURED_OUTPUT_MODE,
    }),
  }
}

const sharedResumeExtractionCache = createTrustedResumeExtractionCache({
  ...extractionCacheFingerprints(),
  maxEntries: 16,
})

export function analysisCacheKeyFor(source: string, owner: string) {
  const {canonicalDocument} = canonicalizeSourceDocument(source, 'v5-analysis-cache')
  return createDigest({
    cacheVersion: V5_ANALYSIS_CACHE_VERSION,
    owner,
    resumeSha256: canonicalDocument.sha256,
    releaseFingerprint: singleStepFingerprint(),
  })
}

interface ResumeCheckpoint {
  kind: 'resume'
  source: string
  extraction: V5ResumeExtractionResult
  analysis: ResumeAnalysis
  resumeDigest: string
  /** 会话级时间预算；旧检查点无此字段时各步按独立上限运行。 */
  budget?: SessionBudget
}
interface MatchingCheckpoint {
  kind: 'matching'
  resumeToken: string
  checkpoint: V5MatchingCheckpoint
  budget?: SessionBudget
  generated?: V5WorkflowResult
  /** 首次生成时的剩余预算快照：幂等读取返回同一响应，不随时间漂移。 */
  generatedRemainingBudgetMs?: number
  interview?: {runId: string; parentRunId?: string; remainingBudgetMs?: number; data: InterviewSuggestions; steps: StepRunSnapshot[]}
}
type Checkpoint = ResumeCheckpoint | MatchingCheckpoint

export interface SingleStepCacheMetadata {
  status: V5AnalysisCacheResultStatus | 'disabled' | 'not_applicable'
}

interface AnalyzeComputeResult {
  runId: string
  steps: StepRunSnapshot[]
  checkpoint: ResumeCheckpoint
}

export interface AnalyzeRequestOptions {
  onCacheMiss?: () => Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new V5CheckpointError()
  return value as Record<string, unknown>
}
function resumeDigest(value: unknown) {
  const {_v5_context: _token, ...resume} = record(value)
  return createCanonicalDigest(resume)
}
function checkpoint(value: unknown): Checkpoint {
  const row = record(value)
  if (row.kind !== 'resume' && row.kind !== 'matching') throw new V5CheckpointError()
  // 只读取服务端写入的私有存储；HTTP 传入的是随机句柄而非证据对象。
  return row as unknown as Checkpoint
}

type StageWorkflow = Pick<V5ResumeOptimizationWorkflow, 'extractResume' | 'matchResume' | 'generateResume' | 'prepareInterview'>

export class V5SingleStepAdapter {
  constructor(
    private readonly repository = new V5CheckpointRepository(singleStepFingerprint()),
    private readonly workflow: () => StageWorkflow = () => new V5ResumeOptimizationWorkflow({
      ...v5ReleaseWorkflowOptions(),
      resumeExtractionCache: sharedResumeExtractionCache,
    }),
    private readonly analysisCache = new V5AnalysisCacheRepository(),
  ) {}

  async analyze(source: string, owner: string, options: AnalyzeRequestOptions = {}) {
    const compute = async (): Promise<AnalyzeComputeResult> => {
      await options.onCacheMiss?.()
      const extraction = await this.workflow().extractResume({resumeMarkdown: source, workflowTimeoutMs: 120000})
      const analysis = toResumeAnalysis(extraction)
      return {
        runId: extraction.runId,
        steps: extraction.stepStatuses ?? [],
        checkpoint: {
          kind: 'resume',
          source,
          extraction,
          analysis,
          resumeDigest: resumeDigest(analysis.structured_resume),
        } satisfies ResumeCheckpoint,
      }
    }

    const resolved = owner === 'guest'
      ? {value: await compute(), cacheStatus: 'disabled' as const}
      : await this.analysisCache.resolve({
        cacheKey: analysisCacheKeyFor(source, owner),
        owner,
        fingerprint: singleStepFingerprint(),
        compute,
      })
    // 会话预算以本次 /analyze 响应起算：缓存命中时同样续期，
    // 避免复用的旧 deadline 在后续步骤一开始就过期。
    const budget = freshSessionBudget()
    const checkpoint = {...resolved.value.checkpoint, budget}
    const token = await this.repository.save(owner, checkpoint)
    return {
      runId: resolved.value.runId,
      steps: resolved.value.steps,
      remainingBudgetMs: budget.deadlineMs - Date.now(),
      data: {
        ...checkpoint.analysis,
        structured_resume: {...checkpoint.analysis.structured_resume, _v5_context: token},
      },
      cache: {status: resolved.cacheStatus} satisfies SingleStepCacheMetadata,
    }
  }

  private async resume(structured: unknown, owner: string) {
    const token = record(structured)._v5_context
    const stored = checkpoint((await this.repository.load(token, owner)).payload)
    if (stored.kind !== 'resume'
      || resumeDigest(stored.analysis.structured_resume) !== resumeDigest(structured)) throw new V5CheckpointError()
    return {stored, token: token as string}
  }

  async match(structured: unknown, jd: string, owner: string) {
    const {stored, token: resumeToken} = await this.resume(structured, owner)
    // Matching may perform bounded structured-output continuation calls when
    // the provider truncates a response. Keep the workflow budget above the
    // individual provider call budget so recoverable truncation is not turned
    // into a premature workflow timeout.
    const timeoutMs = sessionStepTimeoutMs(stored.budget, 180000)
    const result = await this.workflow().matchResume({resumeMarkdown: stored.source, jobDescription: jd, workflowTimeoutMs: timeoutMs}, stored.extraction)
    const budget = stored.budget
    const token = await this.repository.save(owner, {kind: 'matching', resumeToken, checkpoint: result, budget} satisfies MatchingCheckpoint)
    const matching = toMatchAnalysis({...result, resumeEvidenceBundle: stored.extraction.resumeEvidenceBundle})
    return {runId: result.runId, parentRunId: stored.extraction.runId, steps: result.stepStatuses ?? [],
      remainingBudgetMs: budget ? budget.deadlineMs - Date.now() : undefined,
      data: {...matching, jd_structure: {...matching.jd_structure, _v5_context: token}}}
  }

  private async matching(structured: unknown, matching: unknown, owner: string) {
    const {token: resumeToken} = await this.resume(structured, owner)
    const token = record(record(matching).jd_structure)._v5_context
    const row = await this.repository.load(token, owner)
    const stored = checkpoint(row.payload)
    if (stored.kind !== 'matching' || stored.resumeToken !== resumeToken) throw new V5CheckpointError()
    return {row, stored}
  }

  async generate(structured: unknown, matching: unknown, owner: string) {
    const {row, stored} = await this.matching(structured, matching, owner)
    let remainingBudgetMs = stored.generatedRemainingBudgetMs
    const result = stored.generated ?? await this.workflow().generateResume(stored.checkpoint, {workflowTimeoutMs: sessionStepTimeoutMs(stored.budget, 90000)})
    const response = toLegacyMvpProcessResponse(result)
    if (!stored.generated) {
      remainingBudgetMs = stored.budget ? Math.max(0, stored.budget.deadlineMs - Date.now()) : undefined
      await this.repository.update(row, {...stored, generated: result, generatedRemainingBudgetMs: remainingBudgetMs})
    }
    return {runId: result.runId, parentRunId: stored.checkpoint.runId, steps: result.stepStatuses ?? [],
      remainingBudgetMs,
      data: {optimized_resume: response.step3_optimized_resume,
      changes_summary: response.step3_changes_summary ?? [], strategy_review: response.step3_strategy_review, improvement_score: 0}}
  }

  async interview(analysis: unknown, matching: unknown, optimized: string, owner: string) {
    const {row, stored} = await this.matching(record(analysis).structured_resume, matching, owner)
    if (!stored.generated || stored.generated.artifact.markdown.trim() !== optimized.trim()) throw new V5CheckpointError()
    if (stored.interview) return stored.interview
    const result = await this.workflow().prepareInterview(stored.generated, sessionStepTimeoutMs(stored.budget, 60000))
    const interview = {runId: result.runId, parentRunId: stored.generated.runId, steps: result.stepStatuses ?? [],
      remainingBudgetMs: stored.budget ? Math.max(0, stored.budget.deadlineMs - Date.now()) : undefined,
      data: toInterviewPreparation(result.preparation)}
    await this.repository.update(row, {...stored, interview})
    return interview
  }
}

export const v5SingleStepAdapter = new V5SingleStepAdapter()
