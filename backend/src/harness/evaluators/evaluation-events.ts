import { createHarnessEvent } from '@/harness/events'
import type { HarnessEventBus } from '@/harness/event-bus'
import type { StepExecutionContext } from '@/harness/run-context'
import type { EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'

export async function publishEvaluationCompleted(input: {
  eventBus: HarnessEventBus
  stepContext: StepExecutionContext
  evaluation: EvaluationResult
}) {
  await input.eventBus.publish(
    createHarnessEvent({
      type: 'evaluation.completed',
      runId: input.stepContext.runId,
      requestId: input.stepContext.requestId,
      stepRunId: input.stepContext.stepRunId,
      attemptId: input.stepContext.attemptId,
      payload: { ...input.evaluation },
    })
  )
}

export async function assertBusinessEvaluation(input: {
  eventBus: HarnessEventBus
  stepContext: StepExecutionContext
  evaluation: EvaluationResult
  errorPrefix: string
}) {
  await publishEvaluationCompleted(input)

  if (!input.evaluation.passed) {
    const errorMessages = input.evaluation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message)
      .join('；') || '业务校验未通过'

    throw new Error(`${input.errorPrefix}: ${errorMessages}`)
  }
}
