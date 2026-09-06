import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { createHarnessEvent } from '@/harness/events'
import { createDigest, createRunContext, type RunContext, type StepExecutionContext } from '@/harness/run-context'
import { runStep, StepRunError, type StepRunSnapshot } from '@/harness/run-step'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { TraceSubscriber } from '@/harness/subscribers/trace-subscriber'
import type { LlmProvider } from '@/providers/llm-provider'
import { env } from '@/config/env'
import { buildRequirementAnalysis } from '@/v5/targeting/presentation'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { compileWritingArtifact, SupportedWritingError, WRITING_COMPILER_VERSION, WRITING_QUALITY_CODES } from '@/v5/writing/compiler'
import { SUPPORTED_WRITING_POLICY } from '@/v5/writing/facts'
import { compileCompositionArtifact, CompositionCompileError } from '@/v5/composition/compiler'
import {
  materializeDslComposition,
  P06_DSL_CONTRACT_VERSION,
  P06DslValidationError,
  type P06DslOutput,
} from '@/v5/composition/dsl'
import { CompositionBlueprintFeasibilityError } from '@/v5/composition/validator'
import type {
  CompositionCompileDiagnostics,
  P06CompositionOutput,
} from '@/v5/composition/contract'
import {
  DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  consolidateResumeExtractionScopes,
  mergeResumeExtractionCandidates,
  normalizeResumeExtractionChunkCandidate,
  orderResumeExtractionCandidates,
  resumeExtractionInitialRepairBudget,
  resumeExtractionMaxRepairBudget,
  ResumeExtractionChunkCapacityError,
  ResumeExtractionChunkPlanError,
  settleResumeExtractionBatch,
  splitResumeDocument,
  validateResumeExtractionChunkPlan,
} from '@/v5/chunked-resume-extraction'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import {
  buildJobRequirementBundle,
  buildResumeEvidenceBundle,
  V5EvidenceValidationError,
  validateJobExtractionCandidate,
  validateResumeExtractionCandidate,
} from '@/v5/evidence'
import { calculateV5MatchScore } from '@/v5/match-score'
import {
  assessV5DeliveryGate,
  buildV5DeliveryDiagnostics,
  buildV5FailureDiagnostics,
} from '@/v5/delivery-gate'
import { V5WorkflowBlockedError } from '@/v5/errors'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { V5PromptBudgetError } from '@/v5/prompt-compiler'
import {
  P01_VALIDATION_OBSERVATION_VERSION,
  bucketP01ValidationIssues,
  type P01ValidationLayer,
  type P01ValidationObservationV1,
  type P01ValidationOutcome,
} from '@/v5/p01-validation-diagnostics'
import type {
  V5WorkflowPlugin,
  V5WorkflowPluginContext,
  V5WorkflowPluginManifest,
} from '@/v5/plugins/contract'
import {
  V5PluginExecutionError,
  V5WorkflowPluginRegistry,
} from '@/v5/plugins/registry'
import {
  V5ResumeExtractionCacheError,
  type ResumeExtractionComputeContext,
  type TrustedResumeExtractionCache,
} from '@/v5/resume-extraction-cache'
import {
  runV5StructuredStage,
  V5ProviderCallError,
  V5StructuredOutputError,
} from '@/v5/stage-runner'
import type { V5PromptComponent } from '@/v5/prompts'
import { JOB_TARGETING_POLICY, type JobFitMap, type TargetedJobExtraction } from '@/v5/targeting/contracts'
import { buildJobTargets, validateTargetedJobExtraction } from '@/v5/targeting/profile'
import { compactTargetingResume, coreTaskEvidence, projectLegacyMatch, targetingEvidenceScores, validateJobFitMap } from '@/v5/targeting/fit'
import type {
  GeneratedResumeArtifact,
  JobExtractionCandidate,
  ResumeAgentState,
  ResumeExtractionCandidate,
  StrategyResolution,
  ValidationIssue,
  ValidationResult,
  V5ResumeExtractionResult,
  V5MatchAnalysis,
  V5ResumePlan,
  V5StageEnvelope,
  V5WorkflowResult,
} from '@/v5/types'
import { V5_SCHEMA_VERSION, V5_WORKFLOW_VERSION } from '@/v5/types'
import {
  buildDeterministicV5ResumePlan,
  plannedContentEvidenceIds,
  RELAXED_PLAN_ADVISORY_CODES,
  RELAXED_RELEASE_ADVISORY_CODES,
  validateGeneratedResumeArtifact,
  validateV5MatchAnalysis,
  validateV5ResumePlan,
} from '@/v5/validators'

export interface V5WorkflowInput {
  resumeMarkdown: string
  jobDescription: string
  outputLanguage?: string
  /** @deprecated Release gating is deterministic; this flag is ignored. */
  enableQualityJudge?: boolean
  workflowTimeoutMs?: number
}

interface RepairableStageResolution {
  origin: 'primary' | 'repair' | 'deterministic_primary' | 'deterministic_fallback'
  repairCount: number
  triggerIssueCodes: string[]
}

export interface V5ResumeExtractionInput {
  resumeMarkdown: string
  workflowTimeoutMs?: number
}

export type V5ArtifactGenerationMode = 'writer_v1' | 'dsl_v1' | 'composition_v1' | 'legacy'

export interface V5WorkflowOptions {
  provider?: LlmProvider
  judgeProvider?: LlmProvider
  resumeExtractionCache?: TrustedResumeExtractionCache
  eventBus?: HarnessEventBus
  enableDefaultSubscribers?: boolean
  pluginOverrides?: Partial<Record<V5BuiltinPluginId, V5WorkflowPlugin<unknown, unknown>>>
  /** Writer is opt-in until real-data/human acceptance; never selected from raw HTTP input. */
  artifactGenerationMode?: V5ArtifactGenerationMode
  jobTargetingPolicy?: typeof JOB_TARGETING_POLICY
  onTargetingAnalysis?: (analysis: { profile: TargetedJobExtraction['jobSuccessProfile']; targets: ReturnType<typeof buildJobTargets>; fit: JobFitMap }) => Promise<void>
}

export function calculateResumeExtractionTimeoutMs(remainingMs: number) {
  const safeRemainingMs = Math.max(1, Math.floor(remainingMs))
  return Math.min(
    safeRemainingMs,
    600000,
    Math.max(300000, Math.floor(safeRemainingMs * 0.7))
  )
}

const P08_STRUCTURAL_REPAIR_CODES = new Set([
  'BUDGET_EXCEEDED',
  'CLAIM_TEXT_AMBIGUOUS',
  'CLAIM_TEXT_NOT_FOUND',
  'DUPLICATE_CLAIM_ID',
  'EMPTY_SCOPE',
  'HEADING_POLICY_VIOLATION',
  'SECTION_ORDER_MISMATCH',
  'TRANSFORMATION_CONTRACT_MISMATCH',
])

export function shouldAttemptV5ArtifactRepair(issues: ValidationIssue[]) {
  const errors = issues.filter(item => item.severity === 'error')
  return errors.length > 0 && errors.every(item => P08_STRUCTURAL_REPAIR_CODES.has(item.code))
}

export function hasV5BlockingStructureIssue(issues: ValidationIssue[]) {
  return issues.some(item => (
    item.severity === 'error'
    && /SCOPE|HEADING|BUDGET|SECTION|TIMELINE/.test(item.code)
  ))
}

export type V5BuiltinPluginId =
  | 'canonical-source'
  | 'resume-extraction'
  | 'job-extraction'
  | 'matching'
  | 'adaptive-policy'
  | 'resume-planning'
  | 'artifact-generation'
  | 'fact-judge'
  | 'quality-judge'
  | 'response-compatibility'

function createDefaultEventBus() {
  const eventBus = createHarnessEventBus()
  const traceSubscriber = new TraceSubscriber()
  const persistenceSubscriber = new PersistenceSubscriber()
  eventBus.subscribe('*', traceSubscriber.handle)
  eventBus.subscribe('*', persistenceSubscriber.handle)
  eventBus.subscribe('*', logHarnessEvent)
  return eventBus
}

export function buildModelSafeResumeEvidenceBundle(bundle: V5WorkflowResult['resumeEvidenceBundle']) {
  const evidenceAtoms = bundle.evidenceAtoms.filter(atom => (
    atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii')
  ))
  const allowedEvidenceIds = new Set(evidenceAtoms.map(atom => atom.evidenceId))
  const filterEvidenceIds = (ids: string[]) => ids.filter(id => allowedEvidenceIds.has(id))
  const timeline = bundle.timeline
    .map(item => ({ ...item, evidenceIds: filterEvidenceIds(item.evidenceIds) }))
    .filter(item => item.evidenceIds.length > 0)
  const allowedScopeIds = new Set(timeline.map(item => item.scopeId))
  return {
    ...bundle,
    identity: {
      name: {
        value: bundle.identity.name.value,
        evidenceIds: filterEvidenceIds(bundle.identity.name.evidenceIds),
      },
      email: { value: null, evidenceIds: [] },
      phone: { value: null, evidenceIds: [] },
      cityLevelLocation: {
        value: bundle.identity.cityLevelLocation.value,
        evidenceIds: filterEvidenceIds(bundle.identity.cityLevelLocation.evidenceIds),
      },
      links: [],
    },
    timeline,
    sections: bundle.sections
      .map(item => ({
        ...item,
        scopeIds: item.scopeIds.filter(id => allowedScopeIds.has(id)),
        evidenceIds: filterEvidenceIds(item.evidenceIds),
      }))
      .filter(item => item.scopeIds.length > 0 || item.evidenceIds.length > 0),
    evidenceAtoms,
    unmappedFragments: [],
    conflicts: bundle.conflicts
      .map(item => ({ ...item, evidenceIds: filterEvidenceIds(item.evidenceIds) }))
      .filter(item => item.evidenceIds.length > 0),
  }
}

export function buildCompactMatchingResumeContext(bundle: V5WorkflowResult['resumeEvidenceBundle']) {
  const safe = buildModelSafeResumeEvidenceBundle(bundle)
  return {
    sourceDocument: { primaryLanguage: safe.sourceDocument.primaryLanguage },
    timeline: safe.timeline.map(item => ({
      scopeId: item.scopeId,
      kind: item.kind,
      organization: item.organization,
      title: item.title,
    })),
    evidenceAtoms: safe.evidenceAtoms.map(atom => ({
      evidenceId: atom.evidenceId,
      sourceScopeId: atom.sourceScopeId,
      verbatimText: atom.verbatimText,
      normalizedClaim: atom.normalizedClaim,
      claimType: atom.claimType,
      status: atom.status,
      attributionLevel: atom.attributionLevel,
      sourceActionVerb: atom.sourceActionVerb,
      qualifiers: atom.qualifiers,
      numericAtoms: atom.numericAtoms,
      riskFlags: atom.riskFlags,
    })),
    conflicts: safe.conflicts,
    extractionCoverage: {
      coverageRatio: safe.extractionCoverage.coverageRatio,
      highImportanceUnmappedCount: safe.extractionCoverage.highImportanceUnmappedCount,
    },
  }
}

export function buildCompactMatchingJobContext(bundle: V5WorkflowResult['jobRequirementBundle']) {
  return {
    basicInfo: bundle.basicInfo,
    requirementAtoms: bundle.requirementAtoms.map(atom => ({
      requirementId: atom.requirementId,
      verbatimText: atom.verbatimText,
      normalizedRequirement: atom.normalizedRequirement,
      category: atom.category,
      importance: atom.importance,
      logicGroupId: atom.logicGroupId,
      logicOperator: atom.logicOperator,
      explicitness: atom.explicitness,
    })),
    explicitCompanySignals: bundle.explicitCompanySignals,
    explicitLocationSignals: bundle.explicitLocationSignals,
    uncertainties: bundle.uncertainties,
    sourcedContext: bundle.sourcedContext,
  }
}

function structuredIssues(error: V5StructuredOutputError): ValidationIssue[] {
  if (error.validationIssues.length === 0) {
    return [{
      issueId: `issue_${createDigest([error.component, error.code]).slice(0, 16)}`,
      severity: 'error',
      code: error.code,
      outputPath: null,
      claimId: null,
      evidenceIds: [],
      requirementIds: [],
      message: error.message,
      expectedConstraint: '输出必须通过当前阶段严格 JSON Schema',
      replacementText: null,
    }]
  }
  return error.validationIssues.map((item, index) => ({
    issueId: `issue_${createDigest([error.component, item.path, item.code, index]).slice(0, 16)}`,
    severity: 'error',
    code: error.code,
    outputPath: item.path || null,
    claimId: null,
    evidenceIds: [],
    requirementIds: [],
    message: item.message,
    expectedConstraint: '输出必须通过当前阶段严格 JSON Schema',
    replacementText: null,
  }))
}

function unwrapStepRunError(error: unknown) {
  let cause = error
  while (cause instanceof StepRunError) cause = cause.cause
  return cause
}

function normalizeBlockedError(error: unknown): V5WorkflowBlockedError {
  const cause = unwrapStepRunError(error)
  if (cause instanceof V5PluginExecutionError) {
    if (cause.code === 'PLUGIN_TIMEOUT' || cause.code === 'PLUGIN_CANCELLED') {
      return new V5WorkflowBlockedError({
        code: cause.code === 'PLUGIN_TIMEOUT' ? 'V5_WORKFLOW_TIMEOUT' : 'V5_WORKFLOW_CANCELLED',
        state: 'provider_failure',
        message: cause.message,
        retryable: true,
        httpStatus: 503,
      })
    }
    const nested = normalizeBlockedError(cause.cause)
    return nested
  }
  if (cause instanceof V5WorkflowBlockedError) return cause
  if (cause instanceof V5ProviderCallError) {
    return new V5WorkflowBlockedError({
      code: cause.retryable ? 'V5_PROVIDER_TEMPORARY_FAILURE' : 'V5_PROVIDER_REQUEST_FAILED',
      state: 'provider_failure',
      message: cause.retryable ? '模型服务暂时不可用。' : '模型请求未被接受或未完成。',
      retryable: cause.retryable,
      httpStatus: cause.retryable ? 503 : 502,
    })
  }
  if (cause instanceof V5PromptBudgetError) {
    return new V5WorkflowBlockedError({
      code: cause.code,
      state: 'blocked_input_validation',
      message: cause.message,
    })
  }
  if (cause instanceof ResumeExtractionChunkCapacityError) {
    return new V5WorkflowBlockedError({
      code: cause.code,
      state: 'blocked_input_validation',
      message: cause.message,
    })
  }
  if (cause instanceof ResumeExtractionChunkPlanError) {
    return new V5WorkflowBlockedError({
      code: cause.code,
      state: 'blocked_input_validation',
      message: cause.message,
    })
  }
  if (cause instanceof V5EvidenceValidationError) {
    return new V5WorkflowBlockedError({
      code: cause.code,
      state: 'blocked_input_validation',
      message: cause.message,
      issues: cause.issues,
    })
  }
  if (cause instanceof V5ResumeExtractionCacheError) {
    return new V5WorkflowBlockedError({
      code: cause.code,
      state: 'blocked_input_validation',
      message: cause.message,
    })
  }
  if (cause instanceof V5StructuredOutputError) {
    return new V5WorkflowBlockedError({
      code: cause.code,
      state: cause.code === 'V5_OUTPUT_TRUNCATED'
        ? 'provider_failure'
        : ['P01', 'P01R', 'P02', 'P02R'].includes(cause.component)
          ? 'blocked_input_validation'
          : 'blocked_fact_validation',
      message: cause.message,
      issues: structuredIssues(cause),
      retryable: false,
      httpStatus: cause.code === 'V5_OUTPUT_TRUNCATED' ? 502 : undefined,
    })
  }
  return new V5WorkflowBlockedError({
    code: typeof cause === 'object' && cause !== null && 'code' in cause
      ? String(cause.code)
      : 'V5_INTERNAL_WORKFLOW_FAILURE',
    state: 'workflow_failure',
    message: 'v5 工作流内部失败。',
    retryable: false,
    httpStatus: 500,
  })
}

function rejectedArtifactWarnings(error: unknown, phase: string): ValidationIssue[] {
  const blocked = normalizeBlockedError(error)
  const issues = blocked.issues.length > 0 ? blocked.issues : [{
    issueId: `issue_${createDigest([phase, blocked.code, blocked.message]).slice(0, 16)}`,
    severity: 'error' as const,
    code: blocked.code,
    outputPath: null,
    claimId: null,
    evidenceIds: [],
    requirementIds: [],
    message: blocked.message,
    expectedConstraint: '模型稿不可用时改用本地确定性安全渲染',
    replacementText: null,
  }]
  return issues.map(item => ({
    ...item,
    severity: 'warning' as const,
    message: `已丢弃模型稿（${phase}）：${item.message}`,
  }))
}

export { V5WorkflowBlockedError } from '@/v5/errors'

export class V5ResumeOptimizationWorkflow {
  private readonly provider?: LlmProvider
  private readonly judgeProvider?: LlmProvider
  private readonly resumeExtractionCache?: TrustedResumeExtractionCache
  private readonly eventBus: HarnessEventBus
  private readonly pluginOverrides: V5WorkflowOptions['pluginOverrides']
  private readonly artifactGenerationMode: V5ArtifactGenerationMode
  private readonly jobTargetingPolicy?: typeof JOB_TARGETING_POLICY
  private readonly onTargetingAnalysis?: V5WorkflowOptions['onTargetingAnalysis']

  constructor(options: V5WorkflowOptions = {}) {
    this.provider = options.provider
    this.judgeProvider = options.judgeProvider ?? options.provider
    this.resumeExtractionCache = options.resumeExtractionCache
    this.eventBus = options.eventBus ?? (options.enableDefaultSubscribers === false ? createHarnessEventBus() : createDefaultEventBus())
    this.pluginOverrides = options.pluginOverrides
    this.artifactGenerationMode = options.artifactGenerationMode ?? 'dsl_v1'
    this.jobTargetingPolicy = options.jobTargetingPolicy
    this.onTargetingAnalysis = options.onTargetingAnalysis
    if (this.jobTargetingPolicy && this.artifactGenerationMode !== 'writer_v1') throw new Error('JOB_TARGETING_REQUIRES_WRITER')
    if (this.jobTargetingPolicy && env.APP_ENV === 'prod') throw new Error('JOB_TARGETING_NOT_PRODUCTION_ACCEPTED')
  }

  async extractResume(input: V5ResumeExtractionInput): Promise<V5ResumeExtractionResult> {
    const runContext = createRunContext(V5_WORKFLOW_VERSION)
    const deadline = Date.now() + (input.workflowTimeoutMs ?? 300000)
    const remaining = () => Math.max(1, deadline - Date.now())
    let state: ResumeAgentState = 'received'
    const setState = async (next: ResumeAgentState) => {
      const previous = state
      state = next
      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.state.changed',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: { previous, state: next },
      }))
    }

    await this.eventBus.publish(createHarnessEvent({
      type: 'workflow.started',
      runId: runContext.runId,
      requestId: runContext.requestId,
      payload: {
        workflowName: runContext.workflowName,
        workflowVersion: runContext.workflowVersion,
        inputDigest: createDigest({ resume: input.resumeMarkdown }),
        startedAt: runContext.startedAt,
        releaseStatus: 'preproduction_candidate',
        executionMode: 'extract_only',
      },
    }))

    try {
      const sourceDocument = canonicalizeSourceDocument(input.resumeMarkdown)
      if (sourceDocument.canonicalDocument.blocks.length === 0) {
        throw new V5WorkflowBlockedError({
          code: 'CANONICAL_INPUT_EMPTY',
          state: 'blocked_input_validation',
          message: '源简历规范化后没有可处理内容。',
        })
      }
      await setState('normalized')
      await setState('resume_extracting')

      const resumeStep = await this.runResumeExtractionStep({
        document: sourceDocument.canonicalDocument,
        runContext,
        timeoutMs: remaining(),
      })
      await setState('resume_extracted')

      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.succeeded',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          agentState: state,
          usedSafeFallback: false,
          stepCount: 1,
          executionMode: 'extract_only',
        },
      }))

      return {
        state: 'resume_extracted',
        releaseStatus: 'preproduction_candidate',
        runId: runContext.runId,
        canonicalSourceDocument: sourceDocument.canonicalDocument,
        resumeExtractionCandidate: resumeStep.result.resumeExtractionCandidate,
        resumeEvidenceBundle: resumeStep.result.resumeEvidenceBundle,
      }
    } catch (error) {
      const blocked = normalizeBlockedError(error)
      blocked.runId ??= runContext.runId
      await setState(blocked.state)
      const deliveryDiagnostics = buildV5FailureDiagnostics({
        state: blocked.state,
        code: blocked.code,
        retryable: blocked.retryable,
        issues: blocked.issues,
      })
      blocked.deliveryDiagnostics = deliveryDiagnostics
      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.failed',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          errorCode: blocked.code,
          errorMessage: 'v5 简历提取未完成。',
          agentState: blocked.state,
          issueCodes: deliveryDiagnostics.outcome.decisionReasonCodes,
          deliveryDiagnostics,
          executionMode: 'extract_only',
        },
      }))
      throw blocked
    }
  }

  async run(input: V5WorkflowInput): Promise<V5WorkflowResult> {
    const runContext = createRunContext(V5_WORKFLOW_VERSION)
    const steps: StepRunSnapshot[] = []
    const deadline = Date.now() + (input.workflowTimeoutMs ?? 600000)
    const remaining = () => Math.max(1, deadline - Date.now())
    const pluginRegistry = new V5WorkflowPluginRegistry()
    const pluginManifest: V5WorkflowPluginManifest = { plugins: [] }
    const pluginContext: V5WorkflowPluginContext = {
      runContext,
      eventBus: this.eventBus,
      remainingMs: remaining,
      shared: {},
      config: {
        enableQualityJudge: false,
        releaseGateMode: 'deterministic_product_delivery_v2',
        artifactGenerationMode: this.artifactGenerationMode,
      },
      manifest: pluginManifest,
      completedPluginIds: new Set(),
      providers: { primary: this.provider, judge: this.judgeProvider },
    }
    let state: ResumeAgentState = 'received'
    const setState = async (next: ResumeAgentState) => {
      const previous = state
      state = next
      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.state.changed',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: { previous, state: next },
      }))
    }

    await this.eventBus.publish(createHarnessEvent({
      type: 'workflow.started',
      runId: runContext.runId,
      requestId: runContext.requestId,
      payload: {
        workflowName: runContext.workflowName,
        workflowVersion: runContext.workflowVersion,
        inputDigest: createDigest({ resume: input.resumeMarkdown, jd: input.jobDescription }),
        startedAt: runContext.startedAt,
        releaseStatus: 'preproduction_candidate',
        artifactGenerationMode: this.artifactGenerationMode,
      },
    }))

    try {
      const { sourceDocument, jobDocument } = await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'canonical-source',
          version: '5.0.0',
          stage: 'normalize',
          failureMapping: { apiCode: 'CANONICAL_INPUT_INVALID', agentState: 'blocked_input_validation' },
          run: async (_context, workflowInput: V5WorkflowInput) => {
            const normalizedResume = canonicalizeSourceDocument(workflowInput.resumeMarkdown)
            const normalizedJob = canonicalizeSourceDocument(workflowInput.jobDescription)
            if (normalizedResume.canonicalDocument.blocks.length === 0 || normalizedJob.canonicalDocument.blocks.length === 0) {
              throw new V5WorkflowBlockedError({
                code: 'CANONICAL_INPUT_EMPTY',
                state: 'blocked_input_validation',
                message: '源简历或 JD 规范化后没有可处理内容。',
              })
            }
            await setState('normalized')
            return { sourceDocument: normalizedResume, jobDocument: normalizedJob }
          },
        },
        input,
      })

      await setState('resume_extracting')
      // Resume scope planning and extraction are the highest-risk, highest-cost
      // input gate. Do not start an unrelated JD call until P01 has completed:
      // a deterministic scope-plan failure must cost zero provider calls beyond
      // the work that could actually validate the resume.
      const resumeResult = await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'resume-extraction',
          version: '5.0.0-p01',
          stage: 'extract',
          dependencies: ['canonical-source'],
          failureMapping: { apiCode: 'V5_RESUME_EXTRACTION_FAILED', agentState: 'blocked_input_validation' },
          run: async () => {
            const resumeStep = await this.runResumeExtractionStep({
              document: sourceDocument.canonicalDocument,
              runContext,
              timeoutMs: calculateResumeExtractionTimeoutMs(remaining()),
            })
            steps.push(resumeStep.step)
            return resumeStep.result
          },
        },
        input,
      })
      await setState('resume_extracted')

      await setState('job_extracting')
      const jobCandidate = await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'job-extraction',
          version: this.jobTargetingPolicy ? '5.1.0-p02-job-success-profile-v1' : '5.0.0-p02',
          stage: 'extract',
          dependencies: ['canonical-source'],
          failureMapping: { apiCode: 'V5_JOB_EXTRACTION_FAILED', agentState: 'blocked_input_validation' },
          run: async () => {
            const jobStep = await runStep({
              runContext,
              eventBus: this.eventBus,
              stepName: 'v5_p02_job_extract',
              timeoutMs: Math.min(300000, remaining()),
              execute: async stepContext => {
                const envelope = this.envelope(runContext.runId, {
                  canonicalJobDocument: jobDocument.canonicalDocument,
                  sourcedContext: [],
                  ...(this.jobTargetingPolicy ? { jobTargetingPolicy: this.jobTargetingPolicy } : {}),
                })
                if (this.jobTargetingPolicy) return this.runRepairableStage<TargetedJobExtraction>({
                  component: 'P02', repairComponent: 'P02R', envelope, stepContext,
                  documentIds: [jobDocument.canonicalDocument.documentId],
                  validate: value => validateTargetedJobExtraction(jobDocument.canonicalDocument, value),
                })
                return this.runRepairableStage<JobExtractionCandidate>({
                  component: 'P02',
                  repairComponent: 'P02R',
                  envelope,
                  stepContext,
                  documentIds: [jobDocument.canonicalDocument.documentId],
                  validate: value => validateJobExtractionCandidate(jobDocument.canonicalDocument, value),
                })
              },
            })
            steps.push(jobStep.step)
            return jobStep.result
          },
        },
        input,
      })
      const resumeEvidenceBundle = resumeResult.resumeEvidenceBundle
      const jobRequirementBundle = buildJobRequirementBundle(jobDocument.canonicalDocument, jobCandidate)
      const targetedCandidate = this.jobTargetingPolicy && 'jobSuccessProfile' in jobCandidate ? jobCandidate as TargetedJobExtraction : undefined
      if (this.jobTargetingPolicy && !targetedCandidate) throw new Error('JOB_TARGETING_PROFILE_MISSING')
      const jobTargets = targetedCandidate ? buildJobTargets(targetedCandidate, jobRequirementBundle) : []
      let jobFitMap: JobFitMap | undefined
      await setState('job_extracted')

      await setState('matching')
      const matchAnalysis = await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'matching',
          version: this.jobTargetingPolicy ? '5.1.0-p03-job-fit-map-v1' : '5.0.0-p03',
          stage: 'match',
          dependencies: ['resume-extraction', 'job-extraction'],
          failureMapping: { apiCode: 'V5_MATCHING_FAILED', agentState: 'blocked_fact_validation' },
          run: async () => {
            const matchStep = await runStep({
              runContext,
              eventBus: this.eventBus,
              stepName: 'v5_p03_match',
              timeoutMs: Math.min(120000, remaining()),
              execute: async stepContext => {
                if (targetedCandidate) {
                  const { candidatePortrait: _presentationOnly, ...matchingProfile } = targetedCandidate.jobSuccessProfile
                  jobFitMap = await this.runRepairableStage<JobFitMap>({
                    component: 'P03', repairComponent: 'P03R', stepContext,
                    documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
                    envelope: this.envelope(runContext.runId, {
                      jobTargetingPolicy: JOB_TARGETING_POLICY, jobSuccessProfile: matchingProfile,
                      targets: jobTargets, resumeContext: compactTargetingResume(buildModelSafeResumeEvidenceBundle(resumeEvidenceBundle)),
                    }),
                    validate: value => validateJobFitMap(value, jobTargets, resumeEvidenceBundle),
                  })
                  return projectLegacyMatch(jobFitMap, jobTargets, resumeEvidenceBundle, jobRequirementBundle)
                }
                return this.runRepairableStage<V5MatchAnalysis>({
                component: 'P03',
                repairComponent: 'P03R',
                envelope: this.envelope(runContext.runId, {
                  resumeEvidenceBundle: buildCompactMatchingResumeContext(resumeEvidenceBundle),
                  jobRequirementBundle: buildCompactMatchingJobContext(jobRequirementBundle),
                }),
                stepContext,
                documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
                validate: value => validateV5MatchAnalysis({ resume: resumeEvidenceBundle, job: jobRequirementBundle, match: value }),
                })
              },
            })
            steps.push(matchStep.step)
            return matchStep.result
          },
        },
        input,
      })
      const matchScore = calculateV5MatchScore({ resume: resumeEvidenceBundle, job: jobRequirementBundle, match: matchAnalysis })
      if (targetedCandidate && !jobFitMap) throw new Error('JOB_TARGETING_FIT_MAP_MISSING')
      const targeting = targetedCandidate && jobFitMap ? { profile: targetedCandidate.jobSuccessProfile, targets: jobTargets, fit: jobFitMap } : undefined
      if (targeting) await this.onTargetingAnalysis?.(targeting)
      const targetingScores = targeting ? targetingEvidenceScores(targeting.fit, targeting.targets, resumeEvidenceBundle) : undefined
      await setState('matched')

      const { strategyProfile, generationPolicy } = await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'adaptive-policy',
          version: '5.0.0-p04',
          stage: 'strategy',
          dependencies: ['matching'],
          failureMapping: { apiCode: 'V5_ADAPTIVE_POLICY_FAILED', agentState: 'blocked_fact_validation' },
          run: async () => {
            let { profile: strategyProfile, policy: generationPolicy, requiresResolution } = buildAdaptiveStrategy({
              resume: resumeEvidenceBundle,
              job: jobRequirementBundle,
              match: matchAnalysis,
              requestedOutputLanguage: input.outputLanguage,
            })
            if (requiresResolution) {
        const conservativeProfile = {
          ...strategyProfile,
          evidenceRichness: 'sparse' as const,
          confidence: 'low' as const,
          reasons: [
            ...strategyProfile.reasons,
            { signal: 'low_confidence_conservative_candidate', evidenceIds: [], requirementIds: [] },
          ],
        }
        const sourcePreservingPolicy = {
          ...generationPolicy,
          mode: 'preserve_sparse' as const,
          summaryPolicy: 'omit_if_unsupported' as const,
          targetBusinessBulletMin: Math.min(2, generationPolicy.targetBusinessBulletMin),
          targetBusinessBulletTarget: Math.max(
            Math.min(2, generationPolicy.targetBusinessBulletMin),
            Math.min(4, generationPolicy.targetBusinessBulletTarget)
          ),
          targetBusinessBulletMax: Math.max(
            Math.min(2, generationPolicy.targetBusinessBulletMin),
            Math.min(4, generationPolicy.targetBusinessBulletMax)
          ),
          hardTotalListItemMax: Math.min(8, generationPolicy.hardTotalListItemMax),
          hardProjectMax: Math.min(1, generationPolicy.hardProjectMax),
          fallbackPolicy: 'source_preserving' as const,
        }
        const profileCandidates = new Map([
          ['adaptive_primary', strategyProfile],
          ['conservative', conservativeProfile],
        ])
        const policyCandidates = new Map([
          ['adaptive_primary', generationPolicy],
          ['conservative', sourcePreservingPolicy],
        ])
        const resolutionStep = await runStep({
          runContext,
          eventBus: this.eventBus,
          stepName: 'v5_p04_strategy_resolution',
          timeoutMs: Math.min(60000, remaining()),
          execute: stepContext => runV5StructuredStage<StrategyResolution>({
            component: 'P04',
            envelope: this.envelope(runContext.runId, {
              candidateProfiles: [...profileCandidates].map(([id, value]) => ({ id, value })),
              candidatePolicies: [...policyCandidates].map(([id, value]) => ({ id, value })),
              ambiguityReasons: strategyProfile.reasons,
            relevantEvidenceAtoms: buildCompactMatchingResumeContext(resumeEvidenceBundle).evidenceAtoms,
              requirementMatches: matchAnalysis.requirementMatches,
            }),
            options: {
              provider: this.provider,
              eventBus: this.eventBus,
              stepContext,
              repairAttempt: 0,
              inputDocumentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
            },
          }).then(result => result.value),
        })
        steps.push(resolutionStep.step)
        const selectedPairIsValid = resolutionStep.result.selectedProfileId === resolutionStep.result.selectedPolicyId
        strategyProfile = selectedPairIsValid
          ? profileCandidates.get(resolutionStep.result.selectedProfileId) ?? conservativeProfile
          : conservativeProfile
        generationPolicy = selectedPairIsValid
          ? policyCandidates.get(resolutionStep.result.selectedPolicyId) ?? sourcePreservingPolicy
          : sourcePreservingPolicy
            }
            await setState('policy_ready')
            return { strategyProfile, generationPolicy }
          },
        },
        input,
      })

      await setState('planning')
      let planValidationIssues: ValidationIssue[] = []
      let planResolution: RepairableStageResolution = {
        origin: 'deterministic_primary',
        repairCount: 0,
        triggerIssueCodes: [],
      }
      const resumePlan = await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'resume-planning',
          version: '5.0.0-p05',
          stage: 'plan',
          dependencies: ['adaptive-policy'],
          failureMapping: { apiCode: 'V5_RESUME_PLANNING_FAILED', agentState: 'blocked_fact_validation' },
          run: async () => {
            const planStep = await runStep({
              runContext,
              eventBus: this.eventBus,
              stepName: 'v5_code_resume_plan',
              timeoutMs: Math.min(30000, remaining()),
              execute: async () => {
                const deterministicPlan = buildDeterministicV5ResumePlan({
                  resume: resumeEvidenceBundle,
                  job: jobRequirementBundle,
                  match: matchAnalysis,
                  policy: generationPolicy,
                  profile: strategyProfile,
                  targetingScores,
                  targetingTaskEvidence: targeting ? coreTaskEvidence(targeting.fit, targeting.targets, resumeEvidenceBundle) : undefined,
                })
                const validation = validateV5ResumePlan({
                  resume: resumeEvidenceBundle,
                  job: jobRequirementBundle,
                  match: matchAnalysis,
                  plan: deterministicPlan,
                  policy: generationPolicy,
                  profile: strategyProfile,
                  gateMode: 'relaxed_release',
                })
                if (!validation.passed) {
                  throw new V5WorkflowBlockedError({
                    code: 'P05_DETERMINISTIC_PLAN_VALIDATION_FAILED',
                    state: 'blocked_fact_validation',
                    message: '本地确定性简历计划未通过代码硬门禁。',
                    issues: validation.issues,
                  })
                }
                planValidationIssues = validation.issues
                planResolution = {
                  origin: 'deterministic_primary',
                  repairCount: 0,
                  triggerIssueCodes: validation.issues.map(item => item.code),
                }
                return validation.value ?? deterministicPlan
              },
            })
            steps.push(planStep.step)
            return planStep.result
          },
        },
        input,
      })
      await setState('planned')

      const {
        artifact,
        repairAttempts,
        validation,
        usedSafeFallback,
        fallbackIssues,
        artifactGenerationDiagnostics,
      } = await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'artifact-generation',
          version: '5.3.0-writer-v1-dsl-v1-composition-v1-legacy',
          stage: 'generate',
          dependencies: ['resume-planning'],
          failureMapping: { apiCode: 'V5_ARTIFACT_GENERATION_FAILED', agentState: 'blocked_fact_validation' },
          run: async () => {
            if (this.artifactGenerationMode === 'writer_v1') {
              const writingPlan = buildWritingPlan({
                resume: resumeEvidenceBundle, job: jobRequirementBundle, match: matchAnalysis,
                plan: resumePlan, policy: generationPolicy,
                targeting,
              })
              await setState('drafting')
              const writerStep = await runStep({
                runContext, eventBus: this.eventBus, stepName: 'v5_p06c_supported_writer',
                timeoutMs: Math.min(180000, remaining()),
                execute: async stepContext => {
                  const output = await runV5StructuredStage<P06CompositionOutput>({
                    component: 'P06C', envelope: this.envelope(runContext.runId, writingPayload(writingPlan)),
                    options: {
                      provider: this.provider, eventBus: this.eventBus, stepContext,
                      inputDocumentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
                    },
                  })
                  try {
                    return compileWritingArtifact({
                      composition: output.value, writingPlan, resume: resumeEvidenceBundle,
                      plan: resumePlan, policy: generationPolicy,
                    })
                  } catch (error) {
                    if (!(error instanceof SupportedWritingError)) throw error
                    throw new V5WorkflowBlockedError({
                      code: 'V5_SUPPORTED_WRITING_BLOCKED', state: error.issues.filter(issue => issue.severity === 'error')
                        .every(issue => WRITING_QUALITY_CODES.has(issue.code)) ? 'blocked_quality_validation' : 'blocked_fact_validation',
                      message: '正文未通过本地写作校验；未调用模型重写。', issues: error.issues,
                    })
                  }
                },
              })
              steps.push(writerStep.step)
              await setState('drafted')
              await setState('validating')
              const artifact = writerStep.result.artifact
              const validation = validateGeneratedResumeArtifact({
                artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy,
                gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1',
              })
              validation.issues.push(...writerStep.result.writingIssues)
              if (!validation.passed) throw new V5WorkflowBlockedError({
                code: 'V5_SUPPORTED_WRITING_BLOCKED', state: hasV5BlockingStructureIssue(validation.issues)
                  ? 'blocked_structure_validation' : 'blocked_fact_validation',
                message: '写作成品未通过本地结构与事实边界检查。', issues: validation.issues,
              })
              const artifactGenerationDiagnostics = {
                mode: 'writer_v1' as const, contractVersion: SUPPORTED_WRITING_POLICY,
                compilerVersion: WRITING_COMPILER_VERSION,
              }
              pluginContext.shared.artifactGeneration = artifactGenerationDiagnostics
              return {
                artifact: validation.value ?? artifact, repairAttempts: 0, validation,
                usedSafeFallback: false, fallbackIssues: [] as ValidationIssue[], artifactGenerationDiagnostics,
              }
            }
            if (this.artifactGenerationMode === 'dsl_v1') {
              let blueprint: ReturnType<typeof buildCompositionBlueprint> | null = null
              let artifact: GeneratedResumeArtifact | null = null
              let compositionDiagnostics: CompositionCompileDiagnostics | null = null
              let usedSafeFallback = false
              let fallbackIssues: ValidationIssue[] = []

              try {
                blueprint = buildCompositionBlueprint({
                  resume: resumeEvidenceBundle,
                  job: jobRequirementBundle,
                  plan: resumePlan,
                  policy: generationPolicy,
                })
              } catch (error) {
                if (!(error instanceof CompositionBlueprintFeasibilityError)) throw error
                fallbackIssues = error.issues.map(item => ({
                  ...item,
                  severity: 'warning' as const,
                  message: `已丢弃模型链路（P06D Blueprint 预检失败）：${item.message}`,
                }))
                artifact = renderSourcePreservingArtifact({
                  resume: resumeEvidenceBundle,
                  plan: resumePlan,
                })
                usedSafeFallback = true
              }

              await setState('drafting')
              if (blueprint) {
                const blueprintEvidenceIds = new Set(
                  blueprint.slots.flatMap(slot => slot.allowedEvidenceIds)
                )
                const dslPayload = {
                  blueprint,
                  evidenceAtoms: resumeEvidenceBundle.evidenceAtoms
                    .filter(atom => (
                      blueprintEvidenceIds.has(atom.evidenceId)
                      && atom.status !== 'excluded'
                      && !atom.riskFlags.includes('sensitive_pii')
                    ))
                    .map(atom => ({
                      evidenceId: atom.evidenceId,
                      sourceDocumentHash: atom.sourceDocumentHash,
                      sourceBlockId: atom.sourceBlockId,
                      sourceScopeId: atom.sourceScopeId,
                      sourceSpan: atom.sourceSpan,
                      verbatimText: atom.verbatimText,
                      claimType: atom.claimType,
                      status: atom.status,
                      riskFlags: atom.riskFlags,
                    })),
                }

                try {
                  const dslStep = await runStep({
                    runContext,
                    eventBus: this.eventBus,
                    stepName: 'v5_p06d_controlled_dsl',
                    timeoutMs: Math.min(180000, remaining()),
                    execute: async stepContext => {
                      const dsl = await runV5StructuredStage<P06DslOutput>({
                        component: 'P06D',
                        envelope: this.envelope(runContext.runId, dslPayload),
                        options: {
                          provider: this.provider,
                          eventBus: this.eventBus,
                          stepContext,
                          inputDocumentIds: [
                            sourceDocument.canonicalDocument.documentId,
                            jobDocument.canonicalDocument.documentId,
                          ],
                        },
                      })
                      const composition = materializeDslComposition({
                        dsl: dsl.value,
                        blueprint,
                        resume: resumeEvidenceBundle,
                        plan: resumePlan,
                      })
                      if (!composition.passed || !composition.value) {
                        throw new P06DslValidationError(composition.issues)
                      }
                      return compileCompositionArtifact({
                        composition: composition.value,
                        blueprint,
                        resume: resumeEvidenceBundle,
                        plan: resumePlan,
                        policy: generationPolicy,
                      })
                    },
                  })
                  steps.push(dslStep.step)
                  artifact = dslStep.result.artifact
                  compositionDiagnostics = dslStep.result.diagnostics
                } catch (error) {
                  if (error instanceof StepRunError) steps.push(error.step)
                  const cause = unwrapStepRunError(error)
                  const isRejectedDsl = (
                    cause instanceof P06DslValidationError
                    || (
                      cause instanceof V5StructuredOutputError
                      && cause.code !== 'V5_OUTPUT_TRUNCATED'
                    )
                  )
                  if (!isRejectedDsl) throw error
                  fallbackIssues = cause instanceof P06DslValidationError
                    ? cause.issues.map(item => ({
                        ...item,
                        severity: 'warning' as const,
                        message: `已丢弃模型稿（P06D DSL 校验失败）：${item.message}`,
                      }))
                    : rejectedArtifactWarnings(error, 'P06D 结构化输出失败')
                  artifact = renderSourcePreservingArtifact({
                    resume: resumeEvidenceBundle,
                    plan: resumePlan,
                  })
                  usedSafeFallback = true
                }
              }
              await setState('drafted')

              if (!artifact) throw new Error('P06D 成品链路未产生 Artifact。')
              await setState('validating')
              const validation = validateGeneratedResumeArtifact({
                artifact,
                resume: resumeEvidenceBundle,
                plan: resumePlan,
                policy: generationPolicy,
                gateMode: 'relaxed_release',
              })
              if (!validation.passed && !usedSafeFallback) {
                throw new Error('P06D 确定性编译器输出未通过 Artifact 不变量校验。')
              }
              if (!validation.passed) {
                const blockedByStructure = hasV5BlockingStructureIssue(validation.issues)
                throw new V5WorkflowBlockedError({
                  code: blockedByStructure
                    ? 'V5_STRUCTURE_VALIDATION_BLOCKED'
                    : 'V5_FACT_VALIDATION_BLOCKED',
                  state: blockedByStructure
                    ? 'blocked_structure_validation'
                    : 'blocked_fact_validation',
                  message: 'P06D 的服务端安全回退未通过 v5 确定性门禁。',
                  issues: [...fallbackIssues, ...validation.issues],
                })
              }

              const artifactGenerationDiagnostics = {
                mode: 'dsl_v1' as const,
                contractVersion: P06_DSL_CONTRACT_VERSION,
                compilerVersion: compositionDiagnostics?.compilerVersion ?? null,
              }
              pluginContext.shared.artifactGeneration = artifactGenerationDiagnostics
              return {
                artifact: validation.value ?? artifact,
                repairAttempts: 0,
                validation,
                usedSafeFallback,
                fallbackIssues,
                artifactGenerationDiagnostics,
              }
            }

            if (this.artifactGenerationMode === 'composition_v1') {
              const blueprint = buildCompositionBlueprint({
                resume: resumeEvidenceBundle,
                job: jobRequirementBundle,
                plan: resumePlan,
                policy: generationPolicy,
              })
              const blueprintEvidenceIds = new Set(
                blueprint.slots.flatMap(slot => slot.allowedEvidenceIds)
              )
              const compositionPayload = {
                blueprint,
                evidenceAtoms: resumeEvidenceBundle.evidenceAtoms
                  .filter(atom => (
                    blueprintEvidenceIds.has(atom.evidenceId)
                    && atom.status !== 'excluded'
                    && !atom.riskFlags.includes('sensitive_pii')
                  ))
                  .map(atom => ({
                    evidenceId: atom.evidenceId,
                    sourceScopeId: atom.sourceScopeId,
                    verbatimText: atom.verbatimText,
                    claimType: atom.claimType,
                    status: atom.status,
                    riskFlags: atom.riskFlags,
                  })),
              }

              await setState('drafting')
              let artifact: GeneratedResumeArtifact
              let compositionDiagnostics: CompositionCompileDiagnostics | null = null
              let usedSafeFallback = false
              let fallbackIssues: ValidationIssue[] = []
              try {
                const compositionStep = await runStep({
                  runContext,
                  eventBus: this.eventBus,
                  stepName: 'v5_p06c_composition',
                  timeoutMs: Math.min(180000, remaining()),
                  execute: async stepContext => {
                    const composition = await runV5StructuredStage<P06CompositionOutput>({
                      component: 'P06C',
                      envelope: this.envelope(runContext.runId, compositionPayload),
                      options: {
                        provider: this.provider,
                        eventBus: this.eventBus,
                        stepContext,
                        inputDocumentIds: [
                          sourceDocument.canonicalDocument.documentId,
                          jobDocument.canonicalDocument.documentId,
                        ],
                      },
                    })
                    return compileCompositionArtifact({
                      composition: composition.value,
                      blueprint,
                      resume: resumeEvidenceBundle,
                      plan: resumePlan,
                      policy: generationPolicy,
                    })
                  },
                })
                steps.push(compositionStep.step)
                artifact = compositionStep.result.artifact
                compositionDiagnostics = compositionStep.result.diagnostics
              } catch (error) {
                if (error instanceof StepRunError) steps.push(error.step)
                const cause = unwrapStepRunError(error)
                const isRejectedComposition = (
                  cause instanceof CompositionCompileError
                  || (
                    cause instanceof V5StructuredOutputError
                    && cause.code !== 'V5_OUTPUT_TRUNCATED'
                  )
                )
                if (!isRejectedComposition) throw error
                fallbackIssues = cause instanceof CompositionCompileError
                  ? cause.issues.map(item => ({
                      ...item,
                      severity: 'warning' as const,
                      message: `已丢弃模型稿（P06C Composition 校验失败）：${item.message}`,
                    }))
                  : rejectedArtifactWarnings(error, 'P06C 结构化输出失败')
                artifact = renderSourcePreservingArtifact({
                  resume: resumeEvidenceBundle,
                  plan: resumePlan,
                })
                usedSafeFallback = true
              }
              await setState('drafted')

              await setState('validating')
              const validation = validateGeneratedResumeArtifact({
                artifact,
                resume: resumeEvidenceBundle,
                plan: resumePlan,
                policy: generationPolicy,
                gateMode: 'relaxed_release',
              })
              if (!validation.passed && !usedSafeFallback) {
                throw new Error('P06 Composition 编译器输出未通过 Artifact 不变量校验。')
              }
              if (!validation.passed) {
                const blockedByStructure = hasV5BlockingStructureIssue(validation.issues)
                throw new V5WorkflowBlockedError({
                  code: blockedByStructure
                    ? 'V5_STRUCTURE_VALIDATION_BLOCKED'
                    : 'V5_FACT_VALIDATION_BLOCKED',
                  state: blockedByStructure
                    ? 'blocked_structure_validation'
                    : 'blocked_fact_validation',
                  message: 'P06C 的安全回退未通过 v5 确定性门禁。',
                  issues: validation.issues,
                })
              }

              const artifactGenerationDiagnostics = {
                mode: 'composition_v1' as const,
                contractVersion: compositionDiagnostics?.contractVersion ?? blueprint.contractVersion,
                compilerVersion: compositionDiagnostics?.compilerVersion ?? null,
              }
              pluginContext.shared.artifactGeneration = artifactGenerationDiagnostics
              return {
                artifact: validation.value ?? artifact,
                repairAttempts: 0,
                validation,
                usedSafeFallback,
                fallbackIssues,
                artifactGenerationDiagnostics,
              }
            }

            const allowedEvidenceIds = plannedContentEvidenceIds(resumeEvidenceBundle, resumePlan)
            const generationPayload = {
              identityAndTimeline: {
                identity: resumeEvidenceBundle.identity,
                timeline: resumeEvidenceBundle.timeline,
              },
              evidenceAtoms: resumeEvidenceBundle.evidenceAtoms.filter(atom => allowedEvidenceIds.has(atom.evidenceId)),
              requirementAtoms: jobRequirementBundle.requirementAtoms.filter(atom => resumePlan.primaryRequirementIds.includes(atom.requirementId)),
              matchPositioning: matchAnalysis.positioning,
              resumePlan,
            }

            await setState('drafting')
            let artifact: GeneratedResumeArtifact
            let repairAttempts = 0
            let usedSafeFallback = false
            let fallbackIssues: ValidationIssue[] = []
            try {
              const draftStep = await runStep({
                runContext,
                eventBus: this.eventBus,
                stepName: 'v5_p06_draft',
                timeoutMs: Math.min(180000, remaining()),
                execute: stepContext => this.runArtifactStage({
                  component: 'P06',
                  envelope: this.envelope(runContext.runId, generationPayload),
                  stepContext,
                  repairAttempt: 0,
                  documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
                }),
              })
              steps.push(draftStep.step)
              artifact = draftStep.result.artifact
              repairAttempts = draftStep.result.repairAttempts
              await setState('drafted')
            } catch (error) {
              if (error instanceof StepRunError) steps.push(error.step)
              const blocked = normalizeBlockedError(error)
              if (!['blocked_fact_validation', 'blocked_structure_validation'].includes(blocked.state)) {
                throw blocked
              }
              fallbackIssues = rejectedArtifactWarnings(error, 'P06/P08 结构化生成失败')
              artifact = renderSourcePreservingArtifact({ resume: resumeEvidenceBundle, plan: resumePlan })
              usedSafeFallback = true
            }

            await setState('validating')
            let validation = validateGeneratedResumeArtifact({
              artifact,
              resume: resumeEvidenceBundle,
              plan: resumePlan,
              policy: generationPolicy,
              gateMode: 'relaxed_release',
            })
            const blockingIssues = validation.issues.filter(item => item.severity === 'error')
            if (
              !validation.passed
              && !usedSafeFallback
              && repairAttempts < 1
              && shouldAttemptV5ArtifactRepair(blockingIssues)
            ) {
              repairAttempts = 1
              await setState('repairing_1')
              try {
                artifact = await this.repairArtifact({
                  runContext,
                  runId: runContext.runId,
                  artifact,
                  issues: blockingIssues,
                  resumeEvidenceBundle,
                  jobRequirementBundle,
                  resumePlan,
                  repairAttempt: repairAttempts,
                  documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
                  remaining,
                  steps,
                })
                validation = validateGeneratedResumeArtifact({
                  artifact,
                  resume: resumeEvidenceBundle,
                  plan: resumePlan,
                  policy: generationPolicy,
                  gateMode: 'relaxed_release',
                })
              } catch (error) {
                if (error instanceof StepRunError) steps.push(error.step)
                const blocked = normalizeBlockedError(error)
                if (!['blocked_fact_validation', 'blocked_structure_validation'].includes(blocked.state)) {
                  throw blocked
                }
                fallbackIssues.push(...rejectedArtifactWarnings(error, 'P08 硬错误修复失败'))
              }
            }

            if (!validation.passed && !usedSafeFallback) {
              fallbackIssues.push(...validation.issues
                .filter(item => item.severity !== 'info')
                .map(item => ({
                  ...item,
                  severity: 'warning' as const,
                  message: `已丢弃模型稿：${item.message}`,
                })))
              artifact = renderSourcePreservingArtifact({ resume: resumeEvidenceBundle, plan: resumePlan })
              await setState('validating')
              validation = validateGeneratedResumeArtifact({
                artifact,
                resume: resumeEvidenceBundle,
                plan: resumePlan,
                policy: generationPolicy,
                gateMode: 'relaxed_release',
              })
              usedSafeFallback = validation.passed
            }
            if (!validation.passed) {
              const blockedByStructure = hasV5BlockingStructureIssue(validation.issues)
              throw new V5WorkflowBlockedError({
                code: blockedByStructure
                  ? 'V5_STRUCTURE_VALIDATION_BLOCKED'
                  : 'V5_FACT_VALIDATION_BLOCKED',
                state: blockedByStructure
                  ? 'blocked_structure_validation'
                  : 'blocked_fact_validation',
                message: '生成结果与安全回退均未通过 v5 确定性门禁。',
                issues: validation.issues,
              })
            }
            artifact = validation.value ?? artifact
            const artifactGenerationDiagnostics = {
              mode: 'legacy' as const,
              contractVersion: null,
              compilerVersion: null,
            }
            pluginContext.shared.artifactGeneration = artifactGenerationDiagnostics
            return {
              artifact,
              repairAttempts,
              validation,
              usedSafeFallback,
              fallbackIssues,
              artifactGenerationDiagnostics,
            }
          },
        },
        input,
      })

      const advisoryIssueCodes = [...new Set([
        ...planValidationIssues.filter(item => (
          item.severity === 'warning'
          && RELAXED_PLAN_ADVISORY_CODES.has(item.code)
        )).map(item => item.code),
        ...validation.issues.filter(item => (
          item.severity === 'warning'
          && (RELAXED_RELEASE_ADVISORY_CODES.has(item.code) || WRITING_QUALITY_CODES.has(item.code))
        )).map(item => item.code),
      ])].sort()
      const resultValidationIssues = [
        ...planValidationIssues,
        ...fallbackIssues,
        ...validation.issues,
      ].filter(item => item.severity !== 'info')
      const artifactOrigin = usedSafeFallback
        ? 'server_renderer' as const
        : this.artifactGenerationMode === 'legacy'
          ? repairAttempts > 0 ? 'model_repair' as const : 'model' as const
          : 'server_compiler' as const
      const planOrigin = planResolution.origin === 'primary'
        ? 'model_primary' as const
        : planResolution.origin === 'repair'
          ? 'model_repair' as const
          : 'deterministic_quality' as const
      const usedAnyFallback = usedSafeFallback
        || planResolution.origin === 'deterministic_fallback'
      const deliveryGate = assessV5DeliveryGate({
        validationPassed: validation.passed,
        usedSafeFallback,
        hasAdvisoryQualityIssues: advisoryIssueCodes.length > 0,
        advisoryIssueCodes,
        advisoryPolicy: this.artifactGenerationMode === 'writer_v1' ? 'warnings_only' : 'legacy_block',
      })
      const finalState: ResumeAgentState = deliveryGate.deliveryDecision === 'deliver'
        ? 'succeeded'
        : 'blocked_quality_validation'
      const deliveryDiagnostics = buildV5DeliveryDiagnostics({
        assessment: deliveryGate,
        resume: resumeEvidenceBundle,
        match: matchAnalysis,
        plan: resumePlan,
        policy: generationPolicy,
        artifact,
        state: finalState,
        planOrigin,
        artifactOrigin,
        usedSafeFallback,
        usedAnyFallback,
        interview: deliveryGate.deliveryDecision === 'deliver'
          ? 'deferred'
          : 'skipped_by_gate',
        finalValidationIssues: [...planValidationIssues, ...validation.issues],
        rejectedCandidateIssues: fallbackIssues,
      })

      return await this.executePlugin({
        registry: pluginRegistry,
        context: pluginContext,
        plugin: {
          id: 'response-compatibility',
          version: '5.0.0',
          stage: 'response',
          dependencies: ['artifact-generation'],
          failureMapping: { apiCode: 'V5_RESPONSE_BUILD_FAILED', agentState: 'provider_failure' },
          run: async (): Promise<V5WorkflowResult> => {
            const isDeliverable = deliveryGate.deliveryDecision === 'deliver'
            await setState(finalState)
            const finishedAt = new Date().toISOString()
            await this.eventBus.publish(createHarnessEvent({
              type: isDeliverable ? 'workflow.succeeded' : 'workflow.partial',
              runId: runContext.runId,
              requestId: runContext.requestId,
              payload: {
                workflowName: runContext.workflowName,
                workflowVersion: runContext.workflowVersion,
                finishedAt,
                agentState: state,
                usedSafeFallback,
                stepCount: steps.length,
                pluginManifest: pluginManifest.plugins,
                artifactGeneration: artifactGenerationDiagnostics,
                deliveryDiagnostics,
                deliveryDecision: deliveryGate.deliveryDecision,
                qualityGates: deliveryGate.qualityGates,
                issueCodes: deliveryDiagnostics.outcome.decisionReasonCodes,
                ...(!isDeliverable ? {
                  errorCode: 'V5_PRODUCT_QUALITY_BLOCKED',
                  errorMessage: '生成流程已完成，但结果未达到可交付质量标准。',
                } : {}),
              },
            }))

            return {
              state,
              releaseStatus: 'preproduction_candidate',
              runId: runContext.runId,
              resumeEvidenceBundle,
              jobRequirementBundle,
              matchAnalysis,
              matchScore,
              ...(targetedCandidate ? { requirementAnalysis: buildRequirementAnalysis(targetedCandidate, jobDocument.canonicalDocument) } : {}),
              strategyProfile,
              generationPolicy,
              resumePlan,
              artifact,
              usedSafeFallback,
              usedAnyFallback,
              executionStatus: 'completed',
              qualityGates: deliveryGate.qualityGates,
              deliveryDecision: deliveryGate.deliveryDecision,
              deliveryDiagnostics,
              generationProvenance: {
                planOrigin,
                artifactOrigin,
                planRepairCount: planResolution.repairCount,
                artifactRepairCount: repairAttempts,
                rejectedPlanIssueCodes: planResolution.triggerIssueCodes,
              },
              validationIssues: resultValidationIssues,
            }
          },
        },
        input,
      })
    } catch (error) {
      if (error instanceof StepRunError) steps.push(error.step)
      const blocked = normalizeBlockedError(error)
      blocked.runId ??= runContext.runId
      await setState(blocked.state)
      const deliveryDiagnostics = buildV5FailureDiagnostics({
        state: blocked.state,
        code: blocked.code,
        retryable: blocked.retryable,
        issues: blocked.issues,
      })
      blocked.deliveryDiagnostics = deliveryDiagnostics
      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.failed',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          errorCode: blocked.code,
          errorMessage: 'v5 工作流未完成。',
          agentState: blocked.state,
          issueCodes: deliveryDiagnostics.outcome.decisionReasonCodes,
          deliveryDiagnostics,
        },
      }))
      throw blocked
    }
  }

  private async executePlugin<TInput, TOutput>(input: {
    registry: V5WorkflowPluginRegistry
    context: V5WorkflowPluginContext
    plugin: V5WorkflowPlugin<TInput, TOutput> & { id: V5BuiltinPluginId }
    input: TInput
    enabled?: boolean
  }): Promise<TOutput> {
    input.registry.register(input.plugin)
    const override = this.pluginOverrides?.[input.plugin.id]
    if (override) input.registry.replace(override)
    if (input.enabled === false) input.registry.disable(input.plugin.id)
    input.registry.assertReady()
    const result = await input.registry.execute<TInput, TOutput>(input.plugin.id, input.context, input.input)
    return result.output as TOutput
  }

  private envelope<T>(runId: string, payload: T): V5StageEnvelope<T> {
    return { schemaVersion: V5_SCHEMA_VERSION, runId, workflowVersion: V5_WORKFLOW_VERSION, payload }
  }

  private runResumeExtractionStep(input: {
    document: ReturnType<typeof canonicalizeSourceDocument>['canonicalDocument']
    runContext: RunContext
    timeoutMs: number
  }) {
    return runStep({
      runContext: input.runContext,
      eventBus: this.eventBus,
      stepName: 'v5_p01_resume_extract',
      timeoutMs: input.timeoutMs,
      execute: async stepContext => {
        const compute = (context: ResumeExtractionComputeContext) => this.extractResumeCandidate({
          document: input.document,
          chunks: context.chunks,
          extractionConcurrency: context.concurrency,
          getValidatedShard: context.getValidatedShard,
          storeValidatedShard: context.storeValidatedShard,
          runId: input.runContext.runId,
          stepContext,
        })
        let resumeExtractionCandidate: ResumeExtractionCandidate
        let trustedShardCount: number
        if (this.resumeExtractionCache) {
          resumeExtractionCandidate = await this.resumeExtractionCache.resolve(input.document, compute)
          trustedShardCount = this.resumeExtractionCache.shardCountFor(input.document)
        } else {
          const chunks = splitResumeDocument(input.document)
          resumeExtractionCandidate = await compute({
            chunks,
            concurrency: DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
          })
          trustedShardCount = chunks.length
        }
        return {
          resumeExtractionCandidate,
          resumeEvidenceBundle: buildResumeEvidenceBundle(
            input.document,
            resumeExtractionCandidate,
            { trustedShardCount }
          ),
        }
      },
    })
  }

  private async extractResumeCandidate(input: {
    document: ReturnType<typeof canonicalizeSourceDocument>['canonicalDocument']
    chunks: ReturnType<typeof splitResumeDocument>
    extractionConcurrency: number
    getValidatedShard?: ResumeExtractionComputeContext['getValidatedShard']
    storeValidatedShard?: ResumeExtractionComputeContext['storeValidatedShard']
    runId: string
    stepContext: StepExecutionContext
  }) {
    // Revalidate cache-provided or otherwise precomputed chunks at the final
    // provider boundary. Deterministic ownership errors must never be handed to
    // P01, and therefore can never consume a P01R repair call.
    validateResumeExtractionChunkPlan(input.document, input.chunks)

    const publishValidationObservation = async (observation: {
      shardIndex: number
      component: 'P01' | 'P01R'
      attempt: 0 | 1
      layer: P01ValidationLayer
      outcome: P01ValidationOutcome
      issues: unknown[]
    }) => {
      const payload: P01ValidationObservationV1 = {
        version: P01_VALIDATION_OBSERVATION_VERSION,
        shardIndex: observation.shardIndex,
        shardCount: input.chunks.length,
        component: observation.component,
        attempt: observation.attempt,
        layer: observation.layer,
        outcome: observation.outcome,
        issueBuckets: bucketP01ValidationIssues(observation.issues, observation.layer),
      }
      await this.eventBus.publish(createHarnessEvent({
        type: 'extraction.validation.observed',
        runId: input.stepContext.runId,
        requestId: input.stepContext.requestId,
        stepRunId: input.stepContext.stepRunId,
        attemptId: input.stepContext.attemptId,
        payload: { ...payload },
      }))
    }

    type PrimaryShardResult = {
      chunkIndex: number
      envelope: V5StageEnvelope<unknown>
      status: 'passed'
      candidate: ResumeExtractionCandidate
      validationIssues: ValidationIssue[]
      validationLayer: null
    } | {
      chunkIndex: number
      envelope: V5StageEnvelope<unknown>
      status: 'repair_required'
      currentOutput: unknown
      validationIssues: ValidationIssue[]
      validationLayer: 'schema' | 'domain'
    }

    const runPrimary = async (
      chunk: ReturnType<typeof splitResumeDocument>[number],
      chunkIndex: number
    ): Promise<PrimaryShardResult> => {
      const envelope = this.envelope(input.runId, {
        canonicalSourceDocument: chunk,
        extractionSequence: {
          index: chunkIndex,
          ordinal: chunkIndex + 1,
          total: input.chunks.length,
          firstSourceBlockId: chunk.blocks[0]?.sourceBlockId ?? null,
          lastSourceBlockId: chunk.blocks.at(-1)?.sourceBlockId ?? null,
        },
      })
      const cached = input.getValidatedShard?.(chunkIndex)
      if (cached) {
        return {
          chunkIndex, envelope, status: 'passed', candidate: cached,
          validationIssues: [], validationLayer: null,
        }
      }
      try {
        const result = await runV5StructuredStage<ResumeExtractionCandidate>({
          component: 'P01',
          envelope,
          options: {
            provider: this.provider,
            eventBus: this.eventBus,
            stepContext: input.stepContext,
            inputDocumentIds: [chunk.documentId],
          },
        })
        const validation = validateResumeExtractionCandidate(
          chunk,
          normalizeResumeExtractionChunkCandidate(chunk, result.value),
          { trustedShardCount: 1 }
        )
        const normalizedOutput = validation.value ?? result.value
        if (validation.passed) {
          await input.storeValidatedShard?.(chunkIndex, normalizedOutput)
          await publishValidationObservation({
            shardIndex: chunkIndex,
            component: 'P01',
            attempt: 0,
            layer: 'domain',
            outcome: 'passed',
            issues: validation.issues,
          })
          return {
            chunkIndex,
            envelope,
            status: 'passed',
            candidate: normalizedOutput,
            validationIssues: validation.issues,
            validationLayer: null,
          }
        }
        await publishValidationObservation({
          shardIndex: chunkIndex,
          component: 'P01',
          attempt: 0,
          layer: 'domain',
          outcome: 'failed',
          issues: validation.issues,
        })
        return {
          chunkIndex,
          envelope,
          status: 'repair_required',
          currentOutput: normalizedOutput,
          validationIssues: validation.issues.filter(issue => issue.severity === 'error'),
          validationLayer: 'domain',
        }
      } catch (error) {
        if (!(error instanceof V5StructuredOutputError)) throw error
        await publishValidationObservation({
          shardIndex: chunkIndex,
          component: 'P01',
          attempt: 0,
          layer: 'schema',
          outcome: 'failed',
          issues: error.validationIssues.length > 0
            ? error.validationIssues
            : [{ code: error.code, path: null }],
        })
        // A truncated value is not a coherent repair input. Retrying it with a
        // larger envelope only compounds cost, so preserve the hard failure.
        if (error.code === 'V5_OUTPUT_TRUNCATED') throw error
        return {
          chunkIndex,
          envelope,
          status: 'repair_required',
          currentOutput: error.unsafeOutput,
          validationIssues: structuredIssues(error).filter(issue => issue.severity === 'error'),
          validationLayer: 'schema',
        }
      }
    }

    // Phase 1 is a bounded streaming map. Every primary shard reaches the
    // barrier before any repair starts; provider response speed therefore
    // cannot decide which shard receives the shared repair budget.
    const primaryResults: Array<{ chunkIndex: number; candidate: PrimaryShardResult }> = []
    for (let index = 0; index < input.chunks.length; index += input.extractionConcurrency) {
      const batch = input.chunks.slice(index, index + input.extractionConcurrency)
      const completed = await settleResumeExtractionBatch(batch.map(async (chunk, batchIndex) => ({
        chunkIndex: index + batchIndex,
        candidate: await runPrimary(chunk, index + batchIndex),
      })))
      primaryResults.push(...completed)
    }

    const orderedPrimaryResults = orderResumeExtractionCandidates(
      primaryResults,
      input.chunks.length
    )
    const initialRepairBudget = resumeExtractionInitialRepairBudget(input.chunks.length)
    const hardRepairBudget = resumeExtractionMaxRepairBudget(input.chunks.length)
    const repairQueue = orderedPrimaryResults.filter(primary => primary.status === 'repair_required')
    if (repairQueue.length > hardRepairBudget) {
      // The barrier makes this failure provable before paying for any repair.
      // Valid primary shards are already checkpointed for a later bounded run.
      await publishValidationObservation({
        shardIndex: repairQueue[0].chunkIndex,
        component: 'P01R', attempt: 1, layer: 'repair_gate', outcome: 'blocked_before_call',
        issues: [{ code: 'P01_REPAIR_BUDGET_EXHAUSTED', severity: 'error', path: null }],
      })
      throw new V5WorkflowBlockedError({
        code: 'P01_REPAIR_BUDGET_EXHAUSTED',
        state: 'blocked_input_validation',
        message: `P01 有 ${repairQueue.length} 个分片需要修复，超过 ${hardRepairBudget} 次上限，已在全部修复请求前阻断。`,
        issues: repairQueue.flatMap(primary => primary.validationIssues),
      })
    }
    let unlockedRepairBudget = initialRepairBudget
    let repairCalls = 0
    const resolvedCandidates = new Map<number, ResumeExtractionCandidate>(
      orderedPrimaryResults.flatMap(primary => (
        primary.status === 'passed' ? [[primary.chunkIndex, primary.candidate] as const] : []
      ))
    )

    // Phase 2 is a deterministic reduce. Repairs are selected in source order;
    // each successful repair proves this batch is recoverable and unlocks one
    // more slot, up to the code-owned hard ceiling.
    for (const primary of orderedPrimaryResults) {
      if (primary.status === 'passed') continue
      if (repairCalls >= unlockedRepairBudget) {
        const unresolvedIssues = orderedPrimaryResults.flatMap(item => (
          item.status === 'repair_required' && !resolvedCandidates.has(item.chunkIndex)
            ? item.validationIssues
            : []
        ))
        await publishValidationObservation({
          shardIndex: primary.chunkIndex,
          component: 'P01R',
          attempt: 1,
          layer: 'repair_gate',
          outcome: 'blocked_before_call',
          issues: [{ code: 'P01_REPAIR_BUDGET_EXHAUSTED', severity: 'error', path: null }],
        })
        throw new V5WorkflowBlockedError({
          code: 'P01_REPAIR_BUDGET_EXHAUSTED',
          state: 'blocked_input_validation',
          message: `P01 已使用 ${repairCalls} 次代码调度的修复额度；硬上限为 ${hardRepairBudget} 次，已在额外请求前阻断。`,
          issues: unresolvedIssues,
        })
      }

      repairCalls += 1
      const chunk = input.chunks[primary.chunkIndex]
      let repairResult
      try {
        repairResult = await runV5StructuredStage<ResumeExtractionCandidate>({
          component: 'P01R',
          envelope: this.envelope(input.stepContext.runId, {
            originalEnvelope: primary.envelope,
            currentOutput: primary.currentOutput,
            validationIssues: primary.validationIssues,
          }),
          options: {
            provider: this.provider,
            eventBus: this.eventBus,
            stepContext: input.stepContext,
            inputDocumentIds: [chunk.documentId],
            repairAttempt: 1,
          },
        })
      } catch (error) {
        if (error instanceof V5StructuredOutputError) {
          await publishValidationObservation({
            shardIndex: primary.chunkIndex,
            component: 'P01R',
            attempt: 1,
            layer: 'schema',
            outcome: 'failed',
            issues: error.validationIssues.length > 0
              ? error.validationIssues
              : [{ code: error.code, path: null }],
          })
        }
        throw error
      }
      const repairedValidation = validateResumeExtractionCandidate(
        chunk,
        normalizeResumeExtractionChunkCandidate(chunk, repairResult.value),
        { trustedShardCount: 1 }
      )
      if (!repairedValidation.passed) {
        await publishValidationObservation({
          shardIndex: primary.chunkIndex,
          component: 'P01R',
          attempt: 1,
          layer: 'domain',
          outcome: 'failed',
          issues: repairedValidation.issues,
        })
        throw new V5WorkflowBlockedError({
          code: 'P01_VALIDATION_FAILED',
          state: 'blocked_input_validation',
          message: `P01 分片 ${primary.chunkIndex + 1} 在一次完整业务修复后仍未通过。`,
          issues: repairedValidation.issues,
        })
      }
      await input.storeValidatedShard?.(
        primary.chunkIndex,
        repairedValidation.value ?? repairResult.value
      )
      await publishValidationObservation({
        shardIndex: primary.chunkIndex,
        component: 'P01R',
        attempt: 1,
        layer: 'domain',
        outcome: 'passed',
        issues: repairedValidation.issues,
      })
      resolvedCandidates.set(
        primary.chunkIndex,
        repairedValidation.value ?? repairResult.value
      )
      unlockedRepairBudget = Math.min(hardRepairBudget, unlockedRepairBudget + 1)
    }

    const extracted = orderedPrimaryResults.map(primary => {
      const candidate = resolvedCandidates.get(primary.chunkIndex)
      if (!candidate) {
        throw new Error(`P01 unresolved shard reached merge: ${primary.chunkIndex}`)
      }
      return { chunkIndex: primary.chunkIndex, candidate }
    })
    const ordered = orderResumeExtractionCandidates(extracted, input.chunks.length)
    const merged = ordered.length === 1 ? ordered[0] : mergeResumeExtractionCandidates(ordered)
    const consolidated = consolidateResumeExtractionScopes(input.document, merged)
    const mergedValidation = validateResumeExtractionCandidate(
      input.document,
      consolidated,
      { trustedShardCount: ordered.length }
    )
    if (!mergedValidation.passed) {
      throw new V5WorkflowBlockedError({
        code: 'P01_CHUNK_MERGE_VALIDATION_FAILED',
        state: 'blocked_input_validation',
        message: 'P01 分块提取结果合并后未通过完整源文档校验。',
        issues: mergedValidation.issues,
      })
    }
    return mergedValidation.value ?? consolidated
  }

  private async runRepairableStage<T>(input: {
    component: V5PromptComponent
    repairComponent: V5PromptComponent
    envelope: unknown
    stepContext: StepExecutionContext
    documentIds: string[]
    validate: (value: T) => ValidationResult<T>
    fallback?: () => T
    fallbackBeforeRepair?: boolean
    beforeRepair?: () => void
    onResolution?: (resolution: RepairableStageResolution) => void
  }): Promise<T> {
    let currentOutput: unknown
    let validationIssues: ValidationIssue[] = []
    try {
      const result = await runV5StructuredStage<T>({
        component: input.component,
        envelope: input.envelope,
        options: {
          provider: this.provider,
          eventBus: this.eventBus,
          stepContext: input.stepContext,
          inputDocumentIds: input.documentIds,
        },
      })
      const validation = input.validate(result.value)
      const normalizedOutput = validation.value ?? result.value
      currentOutput = normalizedOutput
      if (validation.passed) {
        input.onResolution?.({ origin: 'primary', repairCount: 0, triggerIssueCodes: [] })
        return normalizedOutput
      }
      // Server-resolved warnings describe normalization already reflected in
      // currentOutput. Sending them back to the model wastes tokens and can
      // make it undo deterministic repairs; only unresolved errors reach PxxR.
      validationIssues = validation.issues.filter(issue => issue.severity === 'error')
    } catch (error) {
      if (!(error instanceof V5StructuredOutputError)) throw error
      if (error.code === 'V5_OUTPUT_TRUNCATED' && !input.fallbackBeforeRepair) throw error
      currentOutput = error.unsafeOutput
      validationIssues = structuredIssues(error).filter(issue => issue.severity === 'error')
    }

    if (input.fallbackBeforeRepair && input.fallback) {
      const fallback = input.fallback()
      const fallbackValidation = input.validate(fallback)
      if (!fallbackValidation.passed) {
        throw new V5WorkflowBlockedError({
          code: `${input.component}_DETERMINISTIC_FALLBACK_VALIDATION_FAILED`,
          state: input.component === 'P01' || input.component === 'P02' ? 'blocked_input_validation' : 'blocked_fact_validation',
          message: `${input.component} 的模型稿未通过，确定性兜底也未满足代码硬门禁。`,
          issues: fallbackValidation.issues,
        })
      }
      input.onResolution?.({
        origin: 'deterministic_fallback',
        repairCount: 0,
        triggerIssueCodes: [...new Set(validationIssues.map(item => item.code))],
      })
      return fallbackValidation.value ?? fallback
    }

    input.beforeRepair?.()
    const repairResult = await runV5StructuredStage<T>({
      component: input.repairComponent,
      envelope: this.envelope(input.stepContext.runId, {
        originalEnvelope: input.envelope,
        currentOutput,
        validationIssues,
      }),
      options: {
        provider: this.provider,
        eventBus: this.eventBus,
        stepContext: input.stepContext,
        inputDocumentIds: input.documentIds,
        repairAttempt: 1,
      },
    })
    const repairedValidation = input.validate(repairResult.value)
    if (!repairedValidation.passed) {
      if (input.fallback) {
        const fallback = input.fallback()
        const fallbackValidation = input.validate(fallback)
        if (fallbackValidation.passed) {
          input.onResolution?.({
            origin: 'deterministic_fallback',
            repairCount: 1,
            triggerIssueCodes: [...new Set([...validationIssues, ...repairedValidation.issues].map(item => item.code))],
          })
          return fallbackValidation.value ?? fallback
        }
        throw new V5WorkflowBlockedError({
          code: `${input.component}_DETERMINISTIC_FALLBACK_VALIDATION_FAILED`,
          state: input.component === 'P01' || input.component === 'P02' ? 'blocked_input_validation' : 'blocked_fact_validation',
          message: `${input.component} 的模型稿与修复稿均未通过，确定性兜底也未满足硬门禁。`,
          issues: fallbackValidation.issues,
        })
      }
      throw new V5WorkflowBlockedError({
        code: `${input.component}_VALIDATION_FAILED`,
        state: input.component === 'P01' || input.component === 'P02' ? 'blocked_input_validation' : 'blocked_fact_validation',
        message: `${input.component} 在一次完整业务修复后仍未通过。`,
        issues: repairedValidation.issues,
      })
    }
    input.onResolution?.({
      origin: 'repair',
      repairCount: 1,
      triggerIssueCodes: [...new Set(validationIssues.map(item => item.code))],
    })
    return repairedValidation.value ?? repairResult.value
  }

  private async runArtifactStage(input: {
    component: 'P06'
    envelope: unknown
    stepContext: StepExecutionContext
    repairAttempt: number
    documentIds: string[]
  }): Promise<{ artifact: GeneratedResumeArtifact; repairAttempts: number }> {
    try {
      const result = await runV5StructuredStage<GeneratedResumeArtifact>({
        component: input.component,
        envelope: input.envelope,
        options: {
          provider: this.provider,
          eventBus: this.eventBus,
          stepContext: input.stepContext,
          repairAttempt: input.repairAttempt,
          inputDocumentIds: input.documentIds,
        },
      })
      return { artifact: result.value, repairAttempts: 0 }
    } catch (error) {
      if (!(error instanceof V5StructuredOutputError) || input.repairAttempt >= 2) throw error
      if (error.code === 'V5_OUTPUT_TRUNCATED') throw error
      const repaired = await runV5StructuredStage<GeneratedResumeArtifact>({
        component: 'P08',
        envelope: this.envelope(input.stepContext.runId, {
          repairMode: 'schema_only',
          previousArtifact: error.unsafeOutput,
          validationIssues: structuredIssues(error),
          repairAttempt: input.repairAttempt + 1,
        }),
        options: {
          provider: this.provider,
          eventBus: this.eventBus,
          stepContext: input.stepContext,
          repairAttempt: input.repairAttempt + 1,
        },
      })
      return { artifact: repaired.value, repairAttempts: 1 }
    }
  }

  private async repairArtifact(input: {
    runContext: ReturnType<typeof createRunContext>
    runId: string
    artifact: GeneratedResumeArtifact
    issues: ValidationIssue[]
    resumeEvidenceBundle: V5WorkflowResult['resumeEvidenceBundle']
    jobRequirementBundle: V5WorkflowResult['jobRequirementBundle']
    resumePlan: V5ResumePlan
    repairAttempt: number
    documentIds: string[]
    remaining: () => number
    steps: StepRunSnapshot[]
  }) {
    const allowedEvidenceIds = plannedContentEvidenceIds(input.resumeEvidenceBundle, input.resumePlan)
    const repairStep = await runStep({
      runContext: input.runContext,
      eventBus: this.eventBus,
      stepName: `v5_p08_repair_${input.repairAttempt}`,
      timeoutMs: Math.min(180000, input.remaining()),
      execute: stepContext => runV5StructuredStage<GeneratedResumeArtifact>({
        component: 'P08',
        envelope: this.envelope(input.runId, {
          repairMode: 'artifact_structural',
          evidenceAtoms: input.resumeEvidenceBundle.evidenceAtoms.filter(atom => allowedEvidenceIds.has(atom.evidenceId)),
          requirementAtoms: input.jobRequirementBundle.requirementAtoms.filter(atom => (
            input.resumePlan.primaryRequirementIds.includes(atom.requirementId)
            || input.resumePlan.safeKeywordMappings.some(mapping => mapping.requirementId === atom.requirementId)
            || input.resumePlan.evidencePillars.some(pillar => pillar.requirementIds.includes(atom.requirementId))
          )),
          identityAndTimeline: {
            identity: input.resumeEvidenceBundle.identity,
            timeline: input.resumeEvidenceBundle.timeline,
          },
          resumePlan: input.resumePlan,
          previousArtifact: input.artifact,
          validationIssues: input.issues,
          repairAttempt: input.repairAttempt,
        }),
        options: {
          provider: this.provider,
          eventBus: this.eventBus,
          stepContext,
          repairAttempt: input.repairAttempt,
        },
      }).then(result => result.value),
    })
    input.steps.push(repairStep.step)
    return repairStep.result
  }

}
