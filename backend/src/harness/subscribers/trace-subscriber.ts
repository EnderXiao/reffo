import type { HarnessEvent } from '@/harness/events'

export interface RunTrace {
  runId: string
  requestId: string
  events: HarnessEvent[]
}

/** 保留最近 N 个 run 的完整事件链，防止长进程内存无限增长。 */
const MAX_TRACED_RUNS = 256

export class TraceSubscriber {
  private readonly traces = new Map<string, RunTrace>()

  handle = (event: HarnessEvent) => {
    if (!this.traces.has(event.runId) && this.traces.size >= MAX_TRACED_RUNS) {
      const oldestRunId = this.traces.keys().next().value
      if (oldestRunId !== undefined) this.traces.delete(oldestRunId)
    }

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
