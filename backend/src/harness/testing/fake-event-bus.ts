import { HarnessEventBus } from '@/harness/event-bus'
import type { HarnessEvent } from '@/harness/events'

export class FakeHarnessEventBus extends HarnessEventBus {
  readonly events: HarnessEvent[] = []

  async publish(event: HarnessEvent) {
    this.events.push(event)
    await super.publish(event)
  }
}
