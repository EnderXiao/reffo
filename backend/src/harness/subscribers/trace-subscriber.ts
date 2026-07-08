import type { HarnessEvent } from '@/harness/events'

export interface RunTrace {
  runId: string
  requestId: string
  events: HarnessEvent[]
}

export class TraceSubscriber {
  private readonly traces = new Map<string, RunTrace>()

  handle = (event: HarnessEvent) => {
    const trace = this.traces.get(event.runId) ?? {
      runId: event.runId,
      requestId: event.requestId,
      events: [],
    }

    trace.events.push(event)
    this.traces.set(event.runId, trace)
  }

  getTrace(runId: string) {
    return this.traces.get(runId) ?? null
  }
}
