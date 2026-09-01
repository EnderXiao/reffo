import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { createHarnessEvent } from '@/harness/events'
import { createDigest, createRunContext, type RunContext, type StepExecutionContext } from '@/harness/run-context'
import { runStep, StepRunError, type StepRunSnapshot } from '@/harness/run-step'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { TraceSubscriber } from '@/harness/subscribers/trace-subscriber'
import type { LlmProvider } from '@/providers/llm-provider'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import {
  DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  mergeResumeExtractionCandidates,
  ResumeExtractionChunkCapacityError,
  splitResumeDocument,
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
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { V5PromptBudgetError } from '@/v5/prompt-compiler'
import {
  V5ResumeExtractionCacheError,
  type ResumeExtractionComputeContext,
  type TrustedResumeExtractionCache,
} from '@/v5/resume-extraction-cache'
import { runV5StructuredStage, V5StructuredOutputError } from '@/v5/stage-runner'
import type { V5PromptComponent } from '@/v5/prompts'
import type {
  BlockingFactJudgeResult,
  GeneratedResumeArtifact,
  InterviewPreparation,
  JobExtractionCandidate,
  ResumeAgentState,
  ResumeExtractionCandidate,
  ResumeQualityJudgeResult,
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
  artifactEvidenceWhitelistIds,
  normalizeBlockingFactJudgeResult,
  plannedContentEvidenceIds,
  validateGeneratedResumeArtifact,
  validateInterviewPreparation,
  validateV5MatchAnalysis,
  validateV5ResumePlan,
} from '@/v5/validators'

export interface V5WorkflowInput {
  resumeMarkdown: string
  jobDescription: string
  outputLanguage?: string
  enableQualityJudge?: boolean
  workflowTimeoutMs?: number
}

export interface V5ResumeExtractionInput {
  resumeMarkdown: string
  workflowTimeoutMs?: number
}

export interface V5WorkflowOptions {
  provider?: LlmProvider
  judgeProvider?: LlmProvider
  resumeExtractionCache?: TrustedResumeExtractionCache
  eventBus?: HarnessEventBus
  enableDefaultSubscribers?: boolean
}

function createDefaultEventBus() {
  const eventBus = createHarnessEventBus()
  const traceSubscriber = new TraceSubscriber()
  const persistenceSubscriber = new PersistenceSubscriber()
  eventBus.subscribe('*', traceSubscriber.handle)
  eventBus.subscribe('*', persistenceSubscriber.handle)
  eventBus.subscribe('*', logHarnessEvent)
  return eventBus
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

function judgeIssues(result: BlockingFactJudgeResult): ValidationIssue[] {
  return result.issues.map(item => ({
    issueId: item.issueId,
    severity: item.severity,
    code: item.code.toUpperCase(),
    outputPath: null,
    claimId: item.claimId,
    evidenceIds: item.evidenceIds,
    requirementIds: [],
    message: item.message,
    expectedConstraint: item.safeRepairDirection,
    replacementText: null,
  }))
}

function normalizeBlockedError(error: unknown) {
  const cause = error instanceof StepRunError ? error.cause : error
  if (cause instanceof V5WorkflowBlockedError) return cause
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
        : cause.component === 'P01' || cause.component === 'P02'
          ? 'blocked_input_validation'
          : 'blocked_fact_validation',
      message: cause.message,
      issues: structuredIssues(cause),
    })
  }
  return new V5WorkflowBlockedError({
    code: typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : 'V5_PROVIDER_OR_WORKFLOW_FAILURE',
    state: 'provider_failure',
    message: cause instanceof Error ? cause.message : 'v5 工作流失败',
  })
}

export class V5WorkflowBlockedError extends Error {
  readonly code: string
  readonly state: ResumeAgentState
  readonly issues: ValidationIssue[]

  constructor(input: { code: string; state: ResumeAgentState; message: string; issues?: ValidationIssue[] }) {
    super(input.message)
    this.name = 'V5WorkflowBlockedError'
    this.code = input.code
    this.state = input.state
    this.issues = input.issues ?? []
  }
}

export class V5ResumeOptimizationWorkflow {
  private readonly provider?: LlmProvider
  private readonly judgeProvider?: LlmProvider
  private readonly resumeExtractionCache?: TrustedResumeExtractionCache
  private readonly eventBus: HarnessEventBus

  constructor(options: V5WorkflowOptions = {}) {
    this.provider = options.provider
    this.judgeProvider = options.judgeProvider ?? options.provider
    this.resumeExtractionCache = options.resumeExtractionCache
    this.eventBus = options.eventBus ?? (options.enableDefaultSubscribers === false ? createHarnessEventBus() : createDefaultEventBus())
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
        timeoutMs: Math.min(300000, remaining()),
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
      await setState(blocked.state)
      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.failed',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          errorCode: blocked.code,
          errorMessage: blocked.message,
          agentState: blocked.state,
          issueCodes: blocked.issues.map(item => item.code),
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
      },
    }))

    try {
      const sourceDocument = canonicalizeSourceDocument(input.resumeMarkdown)
      const jobDocument = canonicalizeSourceDocument(input.jobDescription)
      if (sourceDocument.canonicalDocument.blocks.length === 0 || jobDocument.canonicalDocument.blocks.length === 0) {
        throw new V5WorkflowBlockedError({
          code: 'CANONICAL_INPUT_EMPTY',
          state: 'blocked_input_validation',
          message: '源简历或 JD 规范化后没有可处理内容。',
        })
      }
      await setState('normalized')

      await setState('resume_extracting')
      await setState('job_extracting')
      const [resumeStep, jobStep] = await Promise.all([
        this.runResumeExtractionStep({
          document: sourceDocument.canonicalDocument,
          runContext,
          timeoutMs: Math.min(300000, remaining()),
        }),
        runStep({
          runContext,
          eventBus: this.eventBus,
          stepName: 'v5_p02_job_extract',
          timeoutMs: Math.min(300000, remaining()),
          execute: async stepContext => {
            const envelope = this.envelope(runContext.runId, {
              canonicalJobDocument: jobDocument.canonicalDocument,
              sourcedContext: [],
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
        }),
      ])
      steps.push(resumeStep.step, jobStep.step)
      const resumeEvidenceBundle = resumeStep.result.resumeEvidenceBundle
      const jobRequirementBundle = buildJobRequirementBundle(jobDocument.canonicalDocument, jobStep.result)
      await setState('resume_extracted')
      await setState('job_extracted')

      await setState('matching')
      const matchStep = await runStep({
        runContext,
        eventBus: this.eventBus,
        stepName: 'v5_p03_match',
        timeoutMs: Math.min(120000, remaining()),
        execute: stepContext => this.runRepairableStage<V5MatchAnalysis>({
          component: 'P03',
          repairComponent: 'P03R',
          envelope: this.envelope(runContext.runId, {
            resumeEvidenceBundle: this.withoutNonessentialPii(resumeEvidenceBundle),
            jobRequirementBundle,
          }),
          stepContext,
          documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
          validate: value => validateV5MatchAnalysis({ resume: resumeEvidenceBundle, job: jobRequirementBundle, match: value }),
        }),
      })
      steps.push(matchStep.step)
      const matchAnalysis = matchStep.result
      const matchScore = calculateV5MatchScore({ resume: resumeEvidenceBundle, job: jobRequirementBundle, match: matchAnalysis })
      await setState('matched')

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
          targetBusinessBulletMin: 0,
          targetBusinessBulletMax: Math.min(4, generationPolicy.targetBusinessBulletMax),
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
            relevantEvidenceAtoms: resumeEvidenceBundle.evidenceAtoms.filter(atom => atom.status !== 'excluded'),
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

      await setState('planning')
      const planStep = await runStep({
        runContext,
        eventBus: this.eventBus,
        stepName: 'v5_p05_plan',
        timeoutMs: Math.min(150000, remaining()),
        execute: stepContext => this.runRepairableStage<V5ResumePlan>({
          component: 'P05',
          repairComponent: 'P05R',
          envelope: this.envelope(runContext.runId, {
            resumeEvidenceBundle: this.withoutNonessentialPii(resumeEvidenceBundle),
            jobRequirementBundle,
            matchAnalysis,
            strategyProfile,
            generationPolicy,
          }),
          stepContext,
          documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
          validate: value => validateV5ResumePlan({
            resume: resumeEvidenceBundle,
            job: jobRequirementBundle,
            match: matchAnalysis,
            plan: value,
            policy: generationPolicy,
            profile: strategyProfile,
          }),
        }),
      })
      steps.push(planStep.step)
      const resumePlan = planStep.result
      await setState('planned')

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
      let artifact = draftStep.result.artifact
      let repairAttempts = draftStep.result.repairAttempts
      await setState('drafted')

      await setState('validating')
      let validation = validateGeneratedResumeArtifact({ artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy })
      while (!validation.passed && repairAttempts < 2) {
        repairAttempts += 1
        await setState(repairAttempts === 1 ? 'repairing_1' : 'repairing_2')
        artifact = await this.repairArtifact({
          runContext,
          runId: runContext.runId,
          artifact,
          issues: validation.issues,
          generationPayload,
          resumeEvidenceBundle,
          jobRequirementBundle,
          matchAnalysis,
          strategyProfile,
          generationPolicy,
          resumePlan,
          repairAttempt: repairAttempts,
          documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
          remaining,
          steps,
        })
        validation = validateGeneratedResumeArtifact({ artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy })
      }

      if (validation.passed) {
        await setState('reviewing')
        const reviewStep = await runStep({
          runContext,
          eventBus: this.eventBus,
          stepName: 'v5_p07_final_review',
          timeoutMs: Math.min(180000, remaining()),
          execute: stepContext => this.runArtifactStage({
            component: 'P07',
            envelope: this.envelope(runContext.runId, {
              ...generationPayload,
              draftArtifact: validation.value ?? artifact,
              serverMeasuredStats: (validation.value ?? artifact).renderStats,
            }),
            stepContext,
            repairAttempt: repairAttempts,
            documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
          }),
        })
        steps.push(reviewStep.step)
        artifact = reviewStep.result.artifact
        repairAttempts += reviewStep.result.repairAttempts
        await setState('validating')
        validation = validateGeneratedResumeArtifact({ artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy })
      }

      while (!validation.passed && repairAttempts < 2) {
        repairAttempts += 1
        await setState(repairAttempts === 1 ? 'repairing_1' : 'repairing_2')
        artifact = await this.repairArtifact({
          runContext,
          runId: runContext.runId,
          artifact,
          issues: validation.issues,
          generationPayload,
          resumeEvidenceBundle,
          jobRequirementBundle,
          matchAnalysis,
          strategyProfile,
          generationPolicy,
          resumePlan,
          repairAttempt: repairAttempts,
          documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
          remaining,
          steps,
        })
        validation = validateGeneratedResumeArtifact({ artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy })
      }

      let usedSafeFallback = false
      if (!validation.passed) {
        artifact = renderSourcePreservingArtifact({ resume: resumeEvidenceBundle, plan: resumePlan })
        await setState('validating')
        validation = validateGeneratedResumeArtifact({ artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy })
        usedSafeFallback = validation.passed
      }
      if (!validation.passed) {
        throw new V5WorkflowBlockedError({
          code: validation.issues.some(item => /SCOPE|HEADING|BUDGET|SECTION/.test(item.code))
            ? 'V5_STRUCTURE_VALIDATION_BLOCKED'
            : 'V5_FACT_VALIDATION_BLOCKED',
          state: validation.issues.some(item => /SCOPE|HEADING|BUDGET|SECTION/.test(item.code))
            ? 'blocked_structure_validation'
            : 'blocked_fact_validation',
          message: '生成结果与安全回退均未通过 v5 确定性门禁。',
          issues: validation.issues,
        })
      }
      artifact = validation.value ?? artifact

      await setState('fact_judging')
      let factJudge = await this.runFactJudge({
        runContext,
        runId: runContext.runId,
        artifact,
        resumeEvidenceBundle,
        jobRequirementBundle,
        documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
        remaining,
        steps,
      })
      while (!factJudge.passed && repairAttempts < 2 && !usedSafeFallback) {
        repairAttempts += 1
        await setState(repairAttempts === 1 ? 'repairing_1' : 'repairing_2')
        artifact = await this.repairArtifact({
          runContext,
          runId: runContext.runId,
          artifact,
          issues: judgeIssues(factJudge),
          generationPayload,
          resumeEvidenceBundle,
          jobRequirementBundle,
          matchAnalysis,
          strategyProfile,
          generationPolicy,
          resumePlan,
          repairAttempt: repairAttempts,
          documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
          remaining,
          steps,
        })
        validation = validateGeneratedResumeArtifact({ artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy })
        if (!validation.passed) continue
        artifact = validation.value ?? artifact
        await setState('fact_judging')
        factJudge = await this.runFactJudge({
          runContext,
          runId: runContext.runId,
          artifact,
          resumeEvidenceBundle,
          jobRequirementBundle,
          documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
          remaining,
          steps,
        })
      }
      if (!factJudge.passed) {
        if (!usedSafeFallback) {
          artifact = renderSourcePreservingArtifact({ resume: resumeEvidenceBundle, plan: resumePlan })
          validation = validateGeneratedResumeArtifact({ artifact, resume: resumeEvidenceBundle, plan: resumePlan, policy: generationPolicy })
          if (validation.passed) {
            artifact = validation.value ?? artifact
            usedSafeFallback = true
            factJudge = await this.runFactJudge({
              runContext,
              runId: runContext.runId,
              artifact,
              resumeEvidenceBundle,
              jobRequirementBundle,
              documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
              remaining,
              steps,
            })
          }
        }
        if (!factJudge.passed) {
          throw new V5WorkflowBlockedError({
            code: 'V5_BLOCKING_FACT_JUDGE_FAILED',
            state: 'blocked_fact_validation',
            message: '阻断式语义事实 Judge 检出未修复 error。',
            issues: judgeIssues(factJudge),
          })
        }
      }

      let interviewPreparation: InterviewPreparation | undefined
      try {
        const interviewStep = await runStep({
          runContext,
          eventBus: this.eventBus,
          stepName: 'v5_p10_interview',
          timeoutMs: Math.min(120000, remaining()),
          execute: stepContext => this.runRepairableStage<InterviewPreparation>({
            component: 'P10',
            repairComponent: 'P10R',
            envelope: this.envelope(runContext.runId, {
              artifact,
              evidenceAtoms: resumeEvidenceBundle.evidenceAtoms.filter(atom => artifact.usedEvidenceIds.includes(atom.evidenceId)),
              requirementAtoms: jobRequirementBundle.requirementAtoms,
              matchAnalysis,
              sourcedContext: jobRequirementBundle.sourcedContext,
            }),
            stepContext,
            documentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
            validate: value => validateInterviewPreparation({
              preparation: value,
              artifact,
              resume: resumeEvidenceBundle,
              job: jobRequirementBundle,
              match: matchAnalysis,
            }),
          }),
        })
        steps.push(interviewStep.step)
        interviewPreparation = interviewStep.result
      } catch (error) {
        await this.eventBus.publish(createHarnessEvent({
          type: 'step.partial',
          runId: runContext.runId,
          requestId: runContext.requestId,
          payload: { stepName: 'v5_p10_interview', errorCode: 'INTERVIEW_PREPARATION_FAILED' },
        }))
      }

      if (input.enableQualityJudge) {
        try {
          const qualityStep = await runStep({
            runContext,
            eventBus: this.eventBus,
            stepName: 'v5_p11_quality_judge',
            timeoutMs: Math.min(120000, remaining()),
            execute: stepContext => runV5StructuredStage<ResumeQualityJudgeResult>({
              component: 'P11',
              envelope: this.envelope(runContext.runId, {
                artifact,
                resumePlan,
                strategyProfile,
                generationPolicy,
                primaryRequirementIds: resumePlan.primaryRequirementIds,
                highValueEvidenceIds: resumePlan.stableCoreEvidenceIds,
                blockingFactJudgeResult: factJudge,
              }),
              options: {
                provider: this.judgeProvider,
                eventBus: this.eventBus,
                stepContext,
                inputDocumentIds: [sourceDocument.canonicalDocument.documentId, jobDocument.canonicalDocument.documentId],
              },
            }).then(result => result.value),
          })
          steps.push(qualityStep.step)
          await this.eventBus.publish(createHarnessEvent({
            type: 'evaluation.completed',
            runId: runContext.runId,
            requestId: runContext.requestId,
            stepRunId: qualityStep.step.stepRunId,
            payload: {
              evaluatorName: 'v5_resume_quality_judge',
              evaluatorVersion: '5.0.0-p11',
              passed: qualityStep.result.deliverabilityGate === 'pass',
              score: qualityStep.result.dimensions.reduce((sum, item) => sum + item.score, 0),
              issues: qualityStep.result.dimensions.flatMap(item => item.issues),
            },
          }))
        } catch (error) {
          await this.eventBus.publish(createHarnessEvent({
            type: 'step.partial',
            runId: runContext.runId,
            requestId: runContext.requestId,
            payload: { stepName: 'v5_p11_quality_judge', errorCode: 'QUALITY_JUDGE_FAILED_NON_BLOCKING' },
          }))
        }
      }

      await setState(usedSafeFallback ? 'succeeded_with_safe_fallback' : 'succeeded')
      const finishedAt = new Date().toISOString()
      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.succeeded',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt,
          agentState: state,
          usedSafeFallback,
          stepCount: steps.length,
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
        strategyProfile,
        generationPolicy,
        resumePlan,
        artifact,
        interviewPreparation,
        usedSafeFallback,
        validationIssues: [...validation.issues, ...judgeIssues(factJudge)].filter(item => item.severity !== 'info'),
      }
    } catch (error) {
      if (error instanceof StepRunError) steps.push(error.step)
      const blocked = normalizeBlockedError(error)
      await setState(blocked.state)
      await this.eventBus.publish(createHarnessEvent({
        type: 'workflow.failed',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          errorCode: blocked.code,
          errorMessage: blocked.message,
          agentState: blocked.state,
          issueCodes: blocked.issues.map(item => item.code),
          issueSummaries: blocked.issues.map(item => ({
            code: item.code,
            outputPath: item.outputPath,
            evidenceIds: item.evidenceIds,
            requirementIds: item.requirementIds,
            message: item.message,
            expectedConstraint: item.expectedConstraint,
          })),
        },
      }))
      throw blocked
    }
  }

  private envelope<T>(runId: string, payload: T): V5StageEnvelope<T> {
    return { schemaVersion: V5_SCHEMA_VERSION, runId, workflowVersion: V5_WORKFLOW_VERSION, payload }
  }

  private withoutNonessentialPii(bundle: V5WorkflowResult['resumeEvidenceBundle']) {
    return {
      ...bundle,
      identity: {
        ...bundle.identity,
        email: { value: null, evidenceIds: [] },
        phone: { value: null, evidenceIds: [] },
        links: [],
      },
      evidenceAtoms: bundle.evidenceAtoms.filter(atom => !atom.riskFlags.includes('sensitive_pii')),
    }
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
          runId: input.runContext.runId,
          stepContext,
        })
        const resumeExtractionCandidate = this.resumeExtractionCache
          ? await this.resumeExtractionCache.resolve(input.document, compute)
          : await compute({
              chunks: splitResumeDocument(input.document),
              concurrency: DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
            })
        return {
          resumeExtractionCandidate,
          resumeEvidenceBundle: buildResumeEvidenceBundle(input.document, resumeExtractionCandidate),
        }
      },
    })
  }

  private async extractResumeCandidate(input: {
    document: ReturnType<typeof canonicalizeSourceDocument>['canonicalDocument']
    chunks: ReturnType<typeof splitResumeDocument>
    extractionConcurrency: number
    runId: string
    stepContext: StepExecutionContext
  }) {
    const extracted: ResumeExtractionCandidate[] = []
    for (let index = 0; index < input.chunks.length; index += input.extractionConcurrency) {
      const batch = input.chunks.slice(index, index + input.extractionConcurrency)
      extracted.push(...await Promise.all(batch.map(chunk => this.runRepairableStage<ResumeExtractionCandidate>({
        component: 'P01',
        repairComponent: 'P01R',
        envelope: this.envelope(input.runId, { canonicalSourceDocument: chunk }),
        stepContext: input.stepContext,
        documentIds: [chunk.documentId],
        validate: value => validateResumeExtractionCandidate(chunk, value),
      }))))
    }
    const merged = extracted.length === 1 ? extracted[0] : mergeResumeExtractionCandidates(extracted)
    const mergedValidation = validateResumeExtractionCandidate(input.document, merged)
    if (!mergedValidation.passed) {
      throw new V5WorkflowBlockedError({
        code: 'P01_CHUNK_MERGE_VALIDATION_FAILED',
        state: 'blocked_input_validation',
        message: 'P01 分块提取结果合并后未通过完整源文档校验。',
        issues: mergedValidation.issues,
      })
    }
    return mergedValidation.value ?? merged
  }

  private async runRepairableStage<T>(input: {
    component: V5PromptComponent
    repairComponent: V5PromptComponent
    envelope: unknown
    stepContext: StepExecutionContext
    documentIds: string[]
    validate: (value: T) => ValidationResult<T>
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
      currentOutput = result.value
      const validation = input.validate(result.value)
      if (validation.passed) return validation.value ?? result.value
      validationIssues = validation.issues
    } catch (error) {
      if (!(error instanceof V5StructuredOutputError)) throw error
      if (error.code === 'V5_OUTPUT_TRUNCATED') throw error
      currentOutput = error.unsafeOutput
      validationIssues = structuredIssues(error)
    }

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
      throw new V5WorkflowBlockedError({
        code: `${input.component}_VALIDATION_FAILED`,
        state: input.component === 'P01' || input.component === 'P02' ? 'blocked_input_validation' : 'blocked_fact_validation',
        message: `${input.component} 在一次完整业务修复后仍未通过。`,
        issues: repairedValidation.issues,
      })
    }
    return repairedValidation.value ?? repairResult.value
  }

  private async runArtifactStage(input: {
    component: 'P06' | 'P07'
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
          originalEnvelope: input.envelope,
          previousArtifact: error.unsafeOutput,
          validationIssues: structuredIssues(error),
          repairAttempt: input.repairAttempt + 1,
          inputDocumentIds: input.documentIds,
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
    generationPayload: unknown
    resumeEvidenceBundle: V5WorkflowResult['resumeEvidenceBundle']
    jobRequirementBundle: V5WorkflowResult['jobRequirementBundle']
    matchAnalysis: V5MatchAnalysis
    strategyProfile: V5WorkflowResult['strategyProfile']
    generationPolicy: V5WorkflowResult['generationPolicy']
    resumePlan: V5ResumePlan
    repairAttempt: number
    documentIds: string[]
    remaining: () => number
    steps: StepRunSnapshot[]
  }) {
    const allowedEvidenceIds = artifactEvidenceWhitelistIds(input.resumeEvidenceBundle, input.resumePlan)
    const repairStep = await runStep({
      runContext: input.runContext,
      eventBus: this.eventBus,
      stepName: `v5_p08_repair_${input.repairAttempt}`,
      timeoutMs: Math.min(180000, input.remaining()),
      execute: stepContext => runV5StructuredStage<GeneratedResumeArtifact>({
        component: 'P08',
        envelope: this.envelope(input.runId, {
          evidenceAtoms: input.resumeEvidenceBundle.evidenceAtoms.filter(atom => allowedEvidenceIds.has(atom.evidenceId)),
          requirementAtoms: input.jobRequirementBundle.requirementAtoms,
          identityAndTimeline: {
            identity: input.resumeEvidenceBundle.identity,
            timeline: input.resumeEvidenceBundle.timeline,
          },
          matchAnalysis: input.matchAnalysis,
          strategyProfile: input.strategyProfile,
          generationPolicy: input.generationPolicy,
          resumePlan: input.resumePlan,
          generationPayload: input.generationPayload,
          previousArtifact: input.artifact,
          validationIssues: input.issues,
          serverMeasuredStats: input.artifact.renderStats,
          repairAttempt: input.repairAttempt,
          inputDocumentIds: input.documentIds,
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

  private async runFactJudge(input: {
    runContext: ReturnType<typeof createRunContext>
    runId: string
    artifact: GeneratedResumeArtifact
    resumeEvidenceBundle: V5WorkflowResult['resumeEvidenceBundle']
    jobRequirementBundle: V5WorkflowResult['jobRequirementBundle']
    documentIds: string[]
    remaining: () => number
    steps: StepRunSnapshot[]
  }) {
    const step = await runStep({
      runContext: input.runContext,
      eventBus: this.eventBus,
      stepName: 'v5_p09_fact_judge',
      timeoutMs: Math.min(120000, input.remaining()),
      execute: stepContext => runV5StructuredStage<BlockingFactJudgeResult>({
        component: 'P09',
        envelope: this.envelope(input.runId, {
          artifact: input.artifact,
          evidenceAtoms: input.resumeEvidenceBundle.evidenceAtoms.filter(atom => input.artifact.usedEvidenceIds.includes(atom.evidenceId)),
          adjacentScopeEvidence: input.resumeEvidenceBundle.evidenceAtoms.filter(atom => (
            input.artifact.claims.some(claim => claim.evidenceIds.some(id => (
              input.resumeEvidenceBundle.evidenceAtoms.find(candidate => candidate.evidenceId === id)?.sourceScopeId === atom.sourceScopeId
            )))
          )),
          requirementAtoms: input.jobRequirementBundle.requirementAtoms,
          allowedIdentityAndTimeline: {
            identity: input.resumeEvidenceBundle.identity,
            timeline: input.resumeEvidenceBundle.timeline,
          },
        }),
        options: {
          provider: this.judgeProvider,
          eventBus: this.eventBus,
          stepContext,
          inputDocumentIds: input.documentIds,
        },
      }).then(result => normalizeBlockingFactJudgeResult(result.value, input.artifact)),
    })
    input.steps.push(step.step)
    return step.result
  }
}
