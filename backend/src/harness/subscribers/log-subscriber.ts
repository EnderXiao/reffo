import type { HarnessEvent } from '@/harness/events'

const LOGGABLE_EVENTS = new Set<HarnessEvent['type']>([
  'workflow.started',
  'workflow.succeeded',
  'workflow.failed',
  'workflow.partial',
  'step.started',
  'step.succeeded',
  'step.failed',
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
      occurredAt: event.occurredAt,
      payload: event.payload,
    })
  )
}
