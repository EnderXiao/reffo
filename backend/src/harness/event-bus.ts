import type { HarnessEvent, HarnessEventType } from '@/harness/events'

export type HarnessEventHandler = (event: HarnessEvent) => void | Promise<void>

interface Subscription {
  type?: HarnessEventType
  handler: HarnessEventHandler
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class HarnessEventBus {
  private readonly subscriptions: Subscription[] = []

  subscribe(type: HarnessEventType | '*', handler: HarnessEventHandler) {
    const subscription: Subscription = {
      type: type === '*' ? undefined : type,
      handler,
    }

    this.subscriptions.push(subscription)

    return () => {
      const index = this.subscriptions.indexOf(subscription)
      if (index >= 0) {
        this.subscriptions.splice(index, 1)
      }
    }
  }

  async publish(event: HarnessEvent) {
    for (const subscription of this.subscriptions) {
      if (!subscription.type || subscription.type === event.type) {
        try {
          await subscription.handler(event)
        } catch (error) {
          console.error('[HarnessEventBus] subscriber failed', {
            eventType: event.type,
            runId: event.runId,
            stepRunId: event.stepRunId,
            message: toErrorMessage(error),
          })
        }
      }
    }
  }
}

export function createHarnessEventBus() {
  return new HarnessEventBus()
}
