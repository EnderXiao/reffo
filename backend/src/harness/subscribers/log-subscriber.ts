import type { HarnessEvent } from '@/harness/events'

const LOGGABLE_EVENTS = new Set<HarnessEvent['type']>([
  'workflow.started',
  'workflow.succeeded',
  'workflow.failed',
  'workflow.partial',
  'step.started',
  'step.succeeded',
  'step.failed',
  'step.partial',
  'attempt.started',
  'attempt.succeeded',
  'attempt.failed',
  'recovery.planned',
  'recovery.started',
  'recovery.succeeded',
  'recovery.failed',
  'provider.requested',
  'provider.responded',
  'output.parsed',
  'output.validated',
  'evaluation.completed',
])

export function logHarnessEvent(event: HarnessEvent) {
  if (!LOGGABLE_EVENTS.has(event.type)) {
    return
  }

  console.log(
    JSON.stringify({
      type: event.type,
      requestId: event.requestId,
      runId: event.runId,
      stepRunId: event.stepRunId,
      attemptId: event.attemptId,
      occurredAt: event.occurredAt,
      payload: event.payload,
    })
  )
}
