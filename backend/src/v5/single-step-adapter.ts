import {currentInterviewSnapshot, interviewGenerationBasis, savedInterviewGenerationBasis} from '@/v5/current-interview-snapshot'
import type {ResumeHistoryRecord} from '@/types'
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
import {validateActionPlan,type ResumeActionPlan} from '@/shared/resume-actions'
import {resumeStageFingerprint} from '@/v5/stage-fingerprints'
import {resumeStageCacheRepository, type ResumeStageCacheRepository} from '@/repositories/resume-stage-cache-repository'
import {saveCompletionBaseline} from '@/services/resume-completion-baseline'
import {resumeEvidenceBundleSchema,jobRequirementBundleSchema,canonicalMatchAnalysisSchema} from '@/v5/schemas'
import {validateCompletionDocument, isCompletionV4, serializeDraft} from '@/shared/resume-completion'
import { createTrustedResumeExtractionCache } from '@/v5/resume-extraction-cache'
import { V5ResumeOptimizationWorkflow, type V5MatchingCheckpoint } from '@/v5/main/workflow'
import { toResumeAnalysis, toMatchAnalysis, toLegacyMvpProcessResponse, toInterviewPreparation } from '@/v5/main/compatibility'
import { V5_WORKFLOW_VERSION, type V5ResumeExtractionResult, type V5WorkflowResult } from '@/v5/types'
import type { ResumeAnalysis, InterviewSuggestions } from '@/types'
import manifest from '@/v5/prompts/manifest.json'
import { deliveredResumeMarkdown } from '@/v5/delivery-markdown'
import { ENTRY_WRITING_POLICY, SKELETON_POLICY_VERSION } from '@/v5/writing/entries'
import { V5_PROMPT_BUDGET_VERSION, V5_PROMPT_MAX_OUTPUT_TOKENS } from '@/v5/prompt-compiler'
import {MATCHING_REQUEST_TIMEOUT_MS} from '@/v5/targeting/matching-budget'

export const V5_ANALYSIS_CACHE_VERSION = 'v5-analysis-result-cache-v1'

export {singleStepFingerprint} from '@/v5/single-step-fingerprint'

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

function extractionCacheFingerprints() {
  return {
    implementationFingerprint: resumeStageFingerprint('extraction'),
    providerConfigFingerprint: createDigest({
      endpoint: env.OPENAI_BASE_URL,
      model: env.AI_MODEL,
      thinking: env.DEEPSEEK_THINKING_MODE,
      extractionThinking: env.DEEPSEEK_P01_THINKING_MODE,
      structuredOutput: env.V5_STRUCTURED_OUTPUT_MODE,
    }),
  }
}

export function clearOwnerResumeExtractionCache(owner: string) {ownerExtractionCaches.delete(owner)}
const ownerExtractionCaches = new Map<string, ReturnType<typeof createTrustedResumeExtractionCache>>()
const ownerExtractionCacheExpiry = new Map<string, number>()
function ownerExtractionCache(owner: string) {
  if (owner === 'guest') return createTrustedResumeExtractionCache({...extractionCacheFingerprints(),maxEntries: 1})
  if ((ownerExtractionCacheExpiry.get(owner)??0) <= Date.now()) ownerExtractionCaches.delete(owner)
  let cache = ownerExtractionCaches.get(owner)
  if (!cache) {
    if (ownerExtractionCaches.size >= 16) ownerExtractionCaches.delete(ownerExtractionCaches.keys().next().value!)
    cache = createTrustedResumeExtractionCache({...extractionCacheFingerprints(),maxEntries: 8})
    ownerExtractionCaches.set(owner,cache)
    ownerExtractionCacheExpiry.set(owner,Date.now()+env.RESUME_STAGE_CACHE_TTL_MS)
  }
  return cache
}

export function analysisCacheKeyFor(source: string, owner: string) {
  const {canonicalDocument} = canonicalizeSourceDocument(source, 'v5-analysis-cache')
  return createDigest({
    cacheVersion: V5_ANALYSIS_CACHE_VERSION,
    owner,
    resumeSha256: canonicalDocument.sha256,
    releaseFingerprint: resumeStageFingerprint('extraction'),
  })
}

interface ResumeCheckpoint {
  kind: 'resume'
  source: string
  extraction: V5ResumeExtractionResult
  analysis: ResumeAnalysis
  resumeDigest: string
  sourceDigest?: string
  stageFingerprint?: string
  /** 会话级时间预算；旧检查点无此字段时各步按独立上限运行。 */
  budget?: SessionBudget
}
interface MatchingCheckpoint {
  kind: 'matching'
  resumeToken: string
  sourceDigest?: string
  stageFingerprint?: string
  checkpoint: V5MatchingCheckpoint
  budget?: SessionBudget
  generated?: V5WorkflowResult
  generationFingerprint?: string
  completionContext?: string
  /** 首次生成时的剩余预算快照：幂等读取返回同一响应，不随时间漂移。 */
  generatedRemainingBudgetMs?: number
  interview?: {runId: string; parentRunId?: string; remainingBudgetMs?: number; data: InterviewSuggestions; steps: StepRunSnapshot[]; fingerprint?: string; snapshotDigest?: string}
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
    private readonly repository = new V5CheckpointRepository('v5-stage-checkpoint-v1'),
    private readonly workflow: (owner: string) => StageWorkflow = owner => new V5ResumeOptimizationWorkflow({
      ...v5ReleaseWorkflowOptions(),
      resumeExtractionCache: ownerExtractionCache(owner),
    }),
    private readonly analysisCache = new V5AnalysisCacheRepository(),
    private readonly stageCache: Pick<ResumeStageCacheRepository, 'resolve'> = resumeStageCacheRepository,
  ) {}

  async analyze(source: string, owner: string, options: AnalyzeRequestOptions = {}) {
    const compute = async (): Promise<AnalyzeComputeResult> => {
      await options.onCacheMiss?.()
      const extraction = await this.workflow(owner).extractResume({resumeMarkdown: source, workflowTimeoutMs: 120000})
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
          sourceDigest: canonicalizeSourceDocument(source, 'stage-source').canonicalDocument.sha256,
          stageFingerprint: resumeStageFingerprint('extraction'),
        } satisfies ResumeCheckpoint,
      }
    }

    const resolved = owner === 'guest'
      ? {value: await compute(), cacheStatus: 'disabled' as const}
      : await this.analysisCache.resolve({
        cacheKey: analysisCacheKeyFor(source, owner),
        owner,
        fingerprint: resumeStageFingerprint('extraction'),
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
    if (stored.kind !== 'resume' || (stored.stageFingerprint && stored.stageFingerprint !== resumeStageFingerprint('extraction'))
      || resumeDigest(stored.analysis.structured_resume) !== resumeDigest(structured)) throw new V5CheckpointError()
    return {stored, token: token as string}
  }

  async match(structured: unknown, jd: string, owner: string) {
    const {stored, token: resumeToken} = await this.resume(structured, owner)
    // Matching may perform bounded structured-output continuation calls when
    // the provider truncates a response. Keep the workflow budget above the
    // individual provider call budget so recoverable truncation is not turned
    // into a premature workflow timeout.
    const budgetTimeoutMs = sessionStepTimeoutMs(stored.budget, MATCHING_REQUEST_TIMEOUT_MS)
    const cached = await this.stageCache.resolve<V5MatchingCheckpoint>({owner,stage:'matching',timeoutMs: budgetTimeoutMs,
      dependency:{extraction: stored.extraction.resumeEvidenceBundle, jd: canonicalizeSourceDocument(jd,'stage-jd').canonicalDocument.sha256},
      sourceDigest: stored.sourceDigest ?? canonicalizeSourceDocument(stored.source,'stage-source').canonicalDocument.sha256,
      compute: ({timeoutMs,signal}) => this.workflow(owner).matchResume({resumeMarkdown: stored.source,jobDescription:jd,workflowTimeoutMs:Math.min(budgetTimeoutMs,timeoutMs),signal},stored.extraction),
      validate: (value): value is V5MatchingCheckpoint => !!value && typeof value === 'object' && (value as V5MatchingCheckpoint).state === 'matched'
        && jobRequirementBundleSchema.safeParse((value as V5MatchingCheckpoint).jobRequirementBundle).success
        && resumeEvidenceBundleSchema.safeParse((value as V5MatchingCheckpoint).extraction?.resumeEvidenceBundle).success
        && (()=>{const {actionPlan,...analysis}=(value as V5MatchingCheckpoint).matchAnalysis as V5MatchingCheckpoint['matchAnalysis'] & {actionPlan?:ResumeActionPlan};return canonicalMatchAnalysisSchema.safeParse(analysis).success && (!actionPlan || !validateActionPlan(actionPlan).length)})()})
    const result = cached.value
    // Tokens are fresh request capabilities; cached artifacts never retain an old resume token.
    const budget = stored.budget
    const token = await this.repository.save(owner, {kind:'matching',resumeToken,checkpoint:result,
      sourceDigest:stored.sourceDigest,stageFingerprint:resumeStageFingerprint('matching'),budget} satisfies MatchingCheckpoint)
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
    if (stored.kind !== 'matching' || stored.resumeToken !== resumeToken
      || (stored.stageFingerprint && stored.stageFingerprint !== resumeStageFingerprint('matching'))) throw new V5CheckpointError()
    return {row, stored}
  }

  async generate(structured: unknown, matching: unknown, owner: string) {
    const {row, stored} = await this.matching(structured, matching, owner)
    const reusableGenerated = stored.generationFingerprint === resumeStageFingerprint('generation') ? stored.generated : undefined
    const cached = reusableGenerated ? {value:reusableGenerated} : await this.stageCache.resolve<V5WorkflowResult>({owner,stage:'generation',
      dependency:{source:stored.checkpoint.extraction.resumeEvidenceBundle,job:stored.checkpoint.jobRequirementBundle,analysis:stored.checkpoint.matchAnalysis,
        fit:stored.checkpoint.jobFitMap ?? null},sourceDigest:stored.sourceDigest ?? stored.checkpoint.extraction.canonicalSourceDocument.sha256,
      compute:({timeoutMs,signal})=>this.workflow(owner).generateResume(stored.checkpoint,{workflowTimeoutMs:Math.min(sessionStepTimeoutMs(stored.budget,180000),timeoutMs),signal}),
      validate:(value):value is V5WorkflowResult=>!!value && typeof value==='object' && !!(value as V5WorkflowResult).runId
        && (!(value as V5WorkflowResult).completionDocument || validateCompletionDocument((value as V5WorkflowResult).completionDocument).ok)})
    const result = cached.value
    const response = toLegacyMvpProcessResponse(result)
    const completionContext = reusableGenerated && stored.completionContext ? stored.completionContext
      : response.step3_completion_document && response.step3_completion_document.schemaVersion !== 'resume-completion-v1'
        ? await saveCompletionBaseline(owner,response.step3_completion_document, result.actionPlan && result.resolvedActionPlan
          ? {actionPlan:result.actionPlan,resolvedPlan:result.resolvedActionPlan,review:result.actionReview,changeManifest:result.changeManifest,identityState:result.identityState,deliveryState:result.deliveryState,interviewBasis:interviewGenerationBasis(result),matching:toMatchAnalysis(result)} : undefined) : undefined
    const remainingBudgetMs = reusableGenerated ? stored.generatedRemainingBudgetMs : (stored.budget ? Math.max(0, stored.budget.deadlineMs - Date.now()) : undefined)
    if (!reusableGenerated || completionContext !== stored.completionContext) await this.repository.update(row, {...stored,generated:result,generationFingerprint:resumeStageFingerprint('generation'),completionContext,generatedRemainingBudgetMs:remainingBudgetMs})
    return {runId: result.runId, parentRunId: stored.checkpoint.runId, steps: result.stepStatuses ?? [],
      remainingBudgetMs, data: {optimized_resume: response.step3_optimized_resume,
      ...(response.step3_completion_document ? {completion_document: response.step3_completion_document} : {}),
      ...(completionContext ? {completion_context:completionContext} : {}),
      ...(result.actionPlan ? {action_plan: result.actionPlan} : {}),
      ...(result.resolvedActionPlan ? {resolved_action_plan: result.resolvedActionPlan} : {}),
      ...(result.actionReview ? {action_review: result.actionReview} : {}),
      ...(result.changeManifest ? {change_manifest: result.changeManifest} : {}),
      ...(result.identityState ? {identity_state: result.identityState} : {}),
      ...(result.deliveryState ? {delivery_state: result.deliveryState} : {}),
      preparation_topics: result.preparationTopics ?? [],
      changes_summary: response.step3_changes_summary ?? [], strategy_review: response.step3_strategy_review, improvement_score: null}}
  }

  async interview(analysis: unknown, matching: unknown, optimized: string, owner: string, options: {history?: ResumeHistoryRecord} = {}) {
    const durable = options.history ? savedInterviewGenerationBasis(options.history) : undefined
    const loaded = durable ? undefined : await this.matching(record(analysis).structured_resume, matching, owner)
    const generated = durable ?? loaded?.stored.generated
    if (!generated || (!options.history && deliveredResumeMarkdown(generated as V5WorkflowResult).trim() !== optimized.trim())) throw new V5CheckpointError()
    if (options.history && options.history.optimized_content.trim() !== optimized.trim()) throw new V5CheckpointError()
    const current = options.history ? currentInterviewSnapshot(generated, options.history)
      : generated.completionDocument && isCompletionV4(generated.completionDocument)
        ? currentInterviewSnapshot(generated, {optimized_content: serializeDraft(generated.completionDocument),
          process_result: {optimized: {completion_document: generated.completionDocument}}} as ResumeHistoryRecord) : generated
    const stored = loaded?.stored
    const snapshotDigest = createDigest({snapshot: current.interviewSnapshot ?? current.artifact, preparationTopics: current.preparationTopics ?? []})
    if (stored?.interview?.fingerprint === resumeStageFingerprint('interview') && stored.interview.snapshotDigest === snapshotDigest) return stored.interview
    const cached = await this.stageCache.resolve({owner,stage:'interview',timeoutMs:sessionStepTimeoutMs(stored?.budget,60000),dependency:{document:current.completionDocument,
      allowedFacts:current.resumeEvidenceBundle,job:current.jobRequirementBundle,preparationTopics:current.preparationTopics ?? []},
      sourceDigest:current.resumeEvidenceBundle.sourceDocument.sha256,
      compute:async({timeoutMs,signal})=>{const result=await this.workflow(owner).prepareInterview(current,Math.min(60000,timeoutMs),signal); return {runId:result.runId,parentRunId:current.runId,remainingBudgetMs:stored?.budget ? Math.max(0, stored.budget.deadlineMs - Date.now()) : undefined,steps:result.stepStatuses??[],data:toInterviewPreparation(result.preparation,current,
        {sourceText: options.history?.resume_content ?? loaded?.stored.checkpoint.input.resumeMarkdown}),fingerprint:resumeStageFingerprint('interview'),snapshotDigest}},
      validate:(value):value is {runId:string;parentRunId?:string;remainingBudgetMs?:number;steps:StepRunSnapshot[];data:InterviewSuggestions;fingerprint:string}=>!!value && typeof value==='object' && typeof (value as {runId?:unknown}).runId==='string' && !!(value as {data?:unknown}).data})
    const interview = cached.value
    if (loaded) await this.repository.update(loaded.row, {...loaded.stored, interview})

    return interview
  }
}

export const v5SingleStepAdapter = new V5SingleStepAdapter()
