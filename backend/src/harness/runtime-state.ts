import type { EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'
import type { RunContext } from '@/harness/run-context'
import type { StepRunSnapshot } from '@/harness/run-step'
import type { InterviewSuggestions, JDStructure, MatchAnalysis, ResumeAnalysis } from '@/types'

export type HarnessErrorCategory =
  | 'provider_transient'
  | 'provider_permanent'
  | 'json_parse'
  | 'schema_validation'
  | 'quality_gate'
  | 'timeout'
  | 'unknown'

export interface HarnessAttemptError {
  code: string
  category: HarnessErrorCategory
  message: string
  retryable: boolean
  repairable: boolean
}

export interface HarnessAttemptUsage {
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
}

export interface HarnessAttemptResult<TOutput = unknown> {
  stepName: string
  attemptNumber: number
  status: 'succeeded' | 'failed' | 'skipped'
  output?: TOutput
  rawOutput?: string
  parsedOutput?: unknown
  provider?: string
  model?: string
  usage?: HarnessAttemptUsage
  error?: HarnessAttemptError
  evaluation?: EvaluationResult
}

export type HarnessResultClassification =
  | 'ok'
  | 'provider_transient_error'
  | 'provider_permanent_error'
  | 'structured_output_invalid'
  | 'quality_gate_failed'
  | 'non_critical_step_failed'

export type HarnessDecision =
  | { action: 'accept' }
  | { action: 'retry_same_step'; reason: string }
  | { action: 'repair_json'; reason: string }
  | { action: 'revise_output'; reason: string; revisionStep: 'revise_resume' }
  | { action: 'fallback_model'; reason: string }
  | { action: 'return_partial'; reason: string }
  | { action: 'fail'; reason: string }

export interface RecoverySummary {
  triggerStep: string
  action: HarnessDecision['action']
  issueCodes?: string[]
  result: 'succeeded' | 'failed' | 'skipped'
  attempts: number
  reason?: string
}

export interface RunRuntimeState {
  runContext: RunContext
  steps: StepRunSnapshot[]
  attempts: HarnessAttemptResult[]
  evaluations: EvaluationResult[]
  recoverySummary: RecoverySummary[]
  latestOutputs: {
    resumeAnalysis?: ResumeAnalysis
    jd?: JDStructure
    matchAnalysis?: MatchAnalysis
    optimizedResume?: string
    interviewSuggestions?: InterviewSuggestions
  }
}

export function createRunRuntimeState(runContext: RunContext): RunRuntimeState {
  return {
    runContext,
    steps: [],
    attempts: [],
    evaluations: [],
    recoverySummary: [],
    latestOutputs: {},
  }
}

export function classifyAttemptResult(result: HarnessAttemptResult): HarnessResultClassification {
  if (result.status === 'succeeded' && result.evaluation?.passed === false) {
    return 'quality_gate_failed'
  }

  if (result.status === 'succeeded') {
    return 'ok'
  }

  switch (result.error?.category) {
    case 'provider_transient':
    case 'timeout':
      return 'provider_transient_error'
    case 'provider_permanent':
      return 'provider_permanent_error'
    case 'json_parse':
    case 'schema_validation':
      return 'structured_output_invalid'
    case 'quality_gate':
      return 'quality_gate_failed'
    default:
      return 'non_critical_step_failed'
  }
}

export function decideNextAction(classification: HarnessResultClassification): HarnessDecision {
  switch (classification) {
    case 'ok':
      return { action: 'accept' }
    case 'quality_gate_failed':
      return {
        action: 'revise_output',
        reason: '优化简历质量门禁未通过，需要基于评估问题修订输出。',
        revisionStep: 'revise_resume',
      }
    case 'structured_output_invalid':
      return { action: 'repair_json', reason: '结构化输出解析或 schema 校验失败。' }
    case 'provider_transient_error':
      return { action: 'retry_same_step', reason: '模型服务暂时性失败，可重试当前 step。' }
    case 'provider_permanent_error':
      return { action: 'fail', reason: '模型服务永久性失败，不应继续重试。' }
    case 'non_critical_step_failed':
    default:
      return { action: 'return_partial', reason: '非关键 step 失败，返回 partial 结果。' }
  }
}

export function buildQualityGateAttempt(input: {
  stepName: string
  attemptNumber: number
  evaluation: EvaluationResult
}): HarnessAttemptResult<EvaluationResult> {
  return {
    stepName: input.stepName,
    attemptNumber: input.attemptNumber,
    status: input.evaluation.passed ? 'succeeded' : 'failed',
    output: input.evaluation,
    evaluation: input.evaluation,
    error: input.evaluation.passed
      ? undefined
      : {
          code: 'QUALITY_GATE_FAILED',
          category: 'quality_gate',
          message: input.evaluation.issues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join('；') || '优化简历质量门禁未通过',
          retryable: false,
          repairable: true,
        },
  }
}
