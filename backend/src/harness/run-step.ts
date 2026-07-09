import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { createHarnessEvent, type StepStatus } from '@/harness/events'
import { createStepExecutionContext, type RunContext, type StepExecutionContext } from '@/harness/run-context'

export interface StepRunSnapshot {
  stepRunId: string
  stepName: string
  status: StepStatus
  startedAt: string
  finishedAt?: string
  errorCode?: string
  errorMessage?: string
}

export interface RunStepInput<TResult> {
  runContext: RunContext
  eventBus?: HarnessEventBus
  stepName: string
  timeoutMs?: number
  execute: (context: StepExecutionContext) => Promise<TResult>
}

export interface RunStepResult<TResult> {
  result: TResult
  step: StepRunSnapshot
}

export class StepRunError extends Error {
  readonly cause: unknown
  readonly step: StepRunSnapshot

  constructor(message: string, step: StepRunSnapshot, cause: unknown) {
    super(message)
    this.name = 'StepRunError'
    this.step = step
    this.cause = cause
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误'
}

function toErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code)
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return 'STEP_TIMEOUT'
  }

  return 'STEP_FAILED'
}

export async function runStep<TResult>(input: RunStepInput<TResult>): Promise<RunStepResult<TResult>> {
  const eventBus = input.eventBus ?? createHarnessEventBus()
  const controller = new AbortController()
  const stepContext = createStepExecutionContext(input.runContext, input.stepName, 1, controller.signal)
  const { stepRunId, attemptId } = stepContext
  const startedAt = new Date().toISOString()
  const stepBase = {
    runId: input.runContext.runId,
    requestId: input.runContext.requestId,
    stepRunId,
  }
  let timeout: ReturnType<typeof setTimeout> | null = null

  await eventBus.publish(
    createHarnessEvent({
      ...stepBase,
      type: 'step.started',
      payload: { stepName: input.stepName, startedAt },
    })
  )
  await eventBus.publish(
    createHarnessEvent({
      ...stepBase,
      attemptId,
      type: 'attempt.started',
      payload: { stepName: input.stepName, attemptNumber: 1 },
    })
  )

  if (input.timeoutMs && input.timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  }

  try {
    const result = await input.execute(stepContext)
    const finishedAt = new Date().toISOString()

    await eventBus.publish(
      createHarnessEvent({
        ...stepBase,
        attemptId,
        type: 'attempt.succeeded',
        payload: { stepName: input.stepName, attemptNumber: 1, finishedAt },
      })
    )
    await eventBus.publish(
      createHarnessEvent({
        ...stepBase,
        type: 'step.succeeded',
        payload: { stepName: input.stepName, finishedAt },
      })
    )

    return {
      result,
      step: {
        stepRunId,
        stepName: input.stepName,
        status: 'succeeded',
        startedAt,
        finishedAt,
      },
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const errorCode = toErrorCode(error)
    const errorMessage = toErrorMessage(error)

    await eventBus.publish(
      createHarnessEvent({
        ...stepBase,
        attemptId,
        type: 'attempt.failed',
        payload: { stepName: input.stepName, attemptNumber: 1, errorCode, errorMessage, finishedAt },
      })
    )
    await eventBus.publish(
      createHarnessEvent({
        ...stepBase,
        type: 'step.failed',
        payload: { stepName: input.stepName, errorCode, errorMessage, finishedAt },
      })
    )

    throw new StepRunError(errorMessage, {
      stepRunId,
      stepName: input.stepName,
      status: 'failed',
      startedAt,
      finishedAt,
      errorCode,
      errorMessage,
    }, error)
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
