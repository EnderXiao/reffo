import type { HarnessEventBus } from '@/harness/event-bus'
import type { StepExecutionContext } from '@/harness/run-context'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionInput {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  responseFormat?: 'json_object'
  promptVersion?: string
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
}

export interface ChatCompletionResult {
  provider: string
  model: string
  content: string
  latencyMs: number
  providerRequestId?: string
  finishReason?: string | null
  inputTokens?: number
  outputTokens?: number
}

export interface LlmProvider {
  complete(input: ChatCompletionInput): Promise<ChatCompletionResult>
}

export type ChatModelProvider = LlmProvider

export type StructuredOutputProvider = LlmProvider
