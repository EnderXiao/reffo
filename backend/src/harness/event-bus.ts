import type { HarnessEvent, HarnessEventType } from '@/harness/events'

export type HarnessEventHandler = (event: HarnessEvent) => void | Promise<void>

interface Subscription {
  type?: HarnessEventType
  handler: HarnessEventHandler
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
        await subscription.handler(event)
      }
    }
  }
}

export function createHarnessEventBus() {
  return new HarnessEventBus()
}
