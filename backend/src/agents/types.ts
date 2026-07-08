import type { HarnessEventBus } from '@/harness/event-bus'
import type { StepExecutionContext } from '@/harness/run-context'

export interface AgentExecutionOptions {
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
  promptVariant?: string
}
