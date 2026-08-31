import { createHarnessEvent } from '@/harness/events'
import type { HarnessEventBus } from '@/harness/event-bus'
import type { EvaluationIssue, EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'
import { publishEvaluationCompleted } from '@/harness/evaluators/evaluation-events'
import type { StepExecutionContext } from '@/harness/run-context'

export type BusinessRecoveryAction = 'repair_business_output' | 'reextract_from_source'

interface BusinessRecoveryPolicy {
  action: BusinessRecoveryAction
  issueCodes: Set<string>
}

const recoveryPoliciesByStep: Record<string, BusinessRecoveryPolicy> = {
  analyze_resume: {
    action: 'reextract_from_source',
    issueCodes: new Set([
      'MISSING_PERSON_NAME',
      'MISSING_SOURCE_EXPERIENCE',
      'MISSING_HARD_SKILLS',
    ]),
  },
  match_resume_to_jd: {
    action: 'repair_business_output',
    issueCodes: new Set([
      'MISSING_EXPERIENCE_MATCH',
      'MISSING_WEAKNESS_EVIDENCE_TYPE',
      'INVALID_WEAKNESS_EVIDENCE_TYPE',
    ]),
  },
  generate_interview_advice: {
    action: 'repair_business_output',
    issueCodes: new Set([
      'MISSING_STORY_RECOMMENDATIONS',
      'INCOMPLETE_STORY_RECOMMENDATION',
    ]),
  },
}

export class BusinessEvaluationError extends Error {
  readonly code = 'BUSINESS_EVALUATION_FAILED'
  readonly evaluatorName: string
  readonly issues: EvaluationIssue[]

  constructor(message: string, evaluation: EvaluationResult) {
    super(message)
    this.name = 'BusinessEvaluationError'
    this.evaluatorName = evaluation.evaluatorName
    this.issues = evaluation.issues.filter((issue) => issue.severity === 'error')
  }
}

export interface BusinessRecoveryInput<TOutput> {
  eventBus: HarnessEventBus
  stepContext: StepExecutionContext
  outputName: string
  currentOutput: TOutput
  evaluate: (output: TOutput) => EvaluationResult
  repair: (input: {
    currentOutput: TOutput
    evaluation: EvaluationResult
  }) => Promise<TOutput>
  maxAttempts?: number
}

function getRepairableIssues(stepName: string, evaluation: EvaluationResult) {
  const policy = recoveryPoliciesByStep[stepName]

  if (!policy) {
    return []
  }

  return evaluation.issues.filter((issue) => issue.severity === 'error' && policy.issueCodes.has(issue.code))
}

function getRecoveryAction(stepName: string): BusinessRecoveryAction {
  return recoveryPoliciesByStep[stepName]?.action ?? 'repair_business_output'
}

async function publishBusinessRecoveryStatus<TOutput>(
  input: BusinessRecoveryInput<TOutput>,
  type: 'recovery.planned' | 'recovery.started' | 'recovery.succeeded' | 'recovery.failed',
  payload: Record<string, unknown>
) {
  await input.eventBus.publish(
    createHarnessEvent({
      type,
      runId: input.stepContext.runId,
      requestId: input.stepContext.requestId,
      stepRunId: input.stepContext.stepRunId,
      attemptId: input.stepContext.attemptId,
      payload: {
        triggerStep: input.stepContext.stepName,
        action: getRecoveryAction(input.stepContext.stepName),
        outputName: input.outputName,
        ...payload,
      },
    })
  )
}

export async function evaluateWithBusinessRecovery<TOutput>(
  input: BusinessRecoveryInput<TOutput>
): Promise<{ output: TOutput; evaluation: EvaluationResult }> {
  const maxAttempts = input.maxAttempts ?? 1
  let output = input.currentOutput
  let evaluation = input.evaluate(output)

  await publishEvaluationCompleted({
    eventBus: input.eventBus,
    stepContext: input.stepContext,
    evaluation,
  })

  if (evaluation.passed || maxAttempts <= 0) {
    return { output, evaluation }
  }

  const repairableIssues = getRepairableIssues(input.stepContext.stepName, evaluation)
  const errorIssues = evaluation.issues.filter((issue) => issue.severity === 'error')

  if (repairableIssues.length === 0 || repairableIssues.length !== errorIssues.length) {
    return { output, evaluation }
  }

  const payload = {
    attempts: 1,
    maxAttempts,
    evaluatorName: evaluation.evaluatorName,
    issueCodes: repairableIssues.map((issue) => issue.code),
    reason: repairableIssues.map((issue) => issue.message).join('；'),
  }

  await publishBusinessRecoveryStatus(input, 'recovery.planned', payload)
  await publishBusinessRecoveryStatus(input, 'recovery.started', payload)

  try {
    output = await input.repair({ currentOutput: output, evaluation })
    evaluation = input.evaluate(output)

    await publishEvaluationCompleted({
      eventBus: input.eventBus,
      stepContext: input.stepContext,
      evaluation,
    })

    await publishBusinessRecoveryStatus(input, evaluation.passed ? 'recovery.succeeded' : 'recovery.failed', {
      ...payload,
      passed: evaluation.passed,
      remainingIssueCodes: evaluation.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.code),
    })

    return { output, evaluation }
  } catch (error) {
    await publishBusinessRecoveryStatus(input, 'recovery.failed', {
      ...payload,
      errorCode: error instanceof Error ? error.name : 'BUSINESS_REPAIR_FAILED',
      reason: error instanceof Error ? error.message : '业务输出修复失败',
    })

    return { output, evaluation }
  }
}

export function assertBusinessEvaluationPassed(input: {
  evaluation: EvaluationResult
  errorPrefix: string
}) {
  if (input.evaluation.passed) {
    return
  }

  const errorMessages = input.evaluation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
    .join('；') || '业务校验未通过'

  throw new BusinessEvaluationError(`${input.errorPrefix}: ${errorMessages}`, input.evaluation)
}

export function getBusinessEvaluationErrorDetails(error: unknown) {
  if (!(error instanceof BusinessEvaluationError)) {
    return undefined
  }

  return {
    evaluatorName: error.evaluatorName,
    issues: error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path,
      severity: issue.severity,
    })),
    recoverable_errors: error.issues.map((issue) => ({
      errorCode: issue.code,
      message: issue.message,
      path: issue.path,
    })),
  }
}

export function buildBusinessFailureSampleReason(error: unknown, stepName?: string) {
  if (error instanceof BusinessEvaluationError) {
    const issueCodes = error.issues.map((issue) => issue.code).join(',')
    return `business_evaluation_failed step=${stepName ?? 'unknown'} evaluator=${error.evaluatorName} issues=${issueCodes}`
  }

  const message = error instanceof Error ? error.message : '未知错误'
  return `workflow_failed step=${stepName ?? 'unknown'} message=${message}`
}
