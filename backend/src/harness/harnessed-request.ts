import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { createHarnessEvent, type WorkflowStatus } from '@/harness/events'
import { createDigest, createRunContext, type RunContext, type StepExecutionContext } from '@/harness/run-context'
import { runStep, StepRunError, type StepRunSnapshot } from '@/harness/run-step'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { TraceSubscriber } from '@/harness/subscribers/trace-subscriber'

export interface HarnessResponseMeta {
  run_id: string
  workflow_status: WorkflowStatus
  step_statuses: StepRunSnapshot[]
  duration_ms: number
}

export interface HarnessedRequestContext {
  runContext: RunContext
  eventBus: HarnessEventBus
  steps: StepRunSnapshot[]
  getRemainingWorkflowTimeout: () => number
}

export interface HarnessedRequestInput<TResult> {
  workflowVersion: string
  inputDigestSource: unknown
  workflowTimeoutMs?: number
  execute: (context: HarnessedRequestContext) => Promise<TResult>
}

export interface HarnessedStepInput<TResult> extends Omit<HarnessedRequestInput<TResult>, 'execute'> {
  stepName: string
  stepTimeoutMs?: number
  execute: (stepContext: StepExecutionContext, context: HarnessedRequestContext) => Promise<TResult>
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

export async function runHarnessedRequest<TResult>(
  input: HarnessedRequestInput<TResult>
): Promise<{ result: TResult; meta: HarnessResponseMeta }> {
  const runContext = createRunContext(input.workflowVersion)
  const eventBus = createDefaultEventBus()
  const steps: StepRunSnapshot[] = []
  const startedAtMs = Date.now()
  const workflowDeadline = startedAtMs + (input.workflowTimeoutMs ?? 480000)
  const getRemainingWorkflowTimeout = () => Math.max(1, workflowDeadline - Date.now())

  await eventBus.publish(
    createHarnessEvent({
      type: 'workflow.started',
      runId: runContext.runId,
      requestId: runContext.requestId,
      payload: {
        workflowName: runContext.workflowName,
        workflowVersion: runContext.workflowVersion,
        inputDigest: createDigest(input.inputDigestSource),
        startedAt: runContext.startedAt,
      },
    })
  )

  try {
    const result = await input.execute({ runContext, eventBus, steps, getRemainingWorkflowTimeout })
    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - startedAtMs

    await eventBus.publish(
      createHarnessEvent({
        type: 'workflow.succeeded',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt,
          durationMs,
        },
      })
    )

    return {
      result,
      meta: {
        run_id: runContext.runId,
        workflow_status: 'succeeded',
        step_statuses: steps,
        duration_ms: durationMs,
      },
    }
  } catch (error) {
    if (error instanceof StepRunError) {
      steps.push(error.step)
    }

    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - startedAtMs
    const errorMessage = error instanceof Error ? error.message : '未知错误'

    await eventBus.publish(
      createHarnessEvent({
        type: 'workflow.failed',
        runId: runContext.runId,
        requestId: runContext.requestId,
        payload: {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt,
          durationMs,
          errorCode: error instanceof StepRunError ? error.step.errorCode : undefined,
          errorMessage,
        },
      })
    )

    throw error instanceof StepRunError ? error.cause : error
  }
}

export async function runHarnessedStep<TResult>(
  input: HarnessedStepInput<TResult>
): Promise<{ result: TResult; meta: HarnessResponseMeta }> {
  return runHarnessedRequest({
    workflowVersion: input.workflowVersion,
    inputDigestSource: input.inputDigestSource,
    workflowTimeoutMs: input.workflowTimeoutMs,
    execute: async ({ runContext, eventBus, steps, getRemainingWorkflowTimeout }) => {
      const stepResult = await runStep({
        runContext,
        eventBus,
        stepName: input.stepName,
        timeoutMs: Math.min(input.stepTimeoutMs ?? 120000, getRemainingWorkflowTimeout()),
        execute: (stepContext) => input.execute(stepContext, { runContext, eventBus, steps, getRemainingWorkflowTimeout }),
      })
      steps.push(stepResult.step)

      return stepResult.result
    },
  })
}
