import type { HarnessEventBus } from '@/harness/event-bus'
import type { StepExecutionContext } from '@/harness/run-context'
import type { ZodTypeAny } from 'zod'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionInput {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  signal?: AbortSignal
  responseFormat?: 'json_object'
  structuredOutput?: {
    name: string
    schema: ZodTypeAny
    strict: true
  }
  maxOutputTokens?: number
  promptVersion?: string
  promptManifest?: {
    workflowVersion: string
    componentPromptId: string
    componentPromptVersion: string
    compiledPromptSha256: string
    schemaVersion: string
    validatorVersion: string
    adaptivePolicyVersion: string
    scoreFormulaVersion: string
    temperature: number
    inputDocumentIds: string[]
    repairAttempt: number
    inputSummary?: {
      envelopeBytes: number
      envelopeTopLevelFields: string[]
      messageCount: number
      messageCharacterCounts: number[]
      estimatedInputTokens: number
    }
  }
  callMetadata?: {
    callReason: 'business_stage' | 'validation_repair' | 'network_retry' | 'semantic_gate'
    contextMode: 'full' | 'scoped' | 'patch'
    repairScope: string[]
    retryIndex: number
    budgetRemaining: number | null
  }
  maxProviderAttempts?: number
  maxProviderModels?: number
  /** Internal content-only stream. Never forwards reasoning or raw provider frames. */
  onContentDelta?: (text: string) => void
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
  physicalAttempts?: number
  /** Already included in outputTokens; never add a second time. */
  reasoningTokens?: number
  inputCacheHitTokens?: number
  inputCacheMissTokens?: number
  requestedModel?: string
}

export interface LlmProvider {
  complete(input: ChatCompletionInput): Promise<ChatCompletionResult>
}

export type ChatModelProvider = LlmProvider

export type StructuredOutputProvider = LlmProvider
