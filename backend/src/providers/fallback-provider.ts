import { env } from '@/config/env'
import { deepSeekProvider } from '@/providers/deepseek-provider'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

export class FallbackLlmProvider implements LlmProvider {
  constructor(private readonly primary: LlmProvider = deepSeekProvider) {}

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const models = [input.model ?? env.AI_MODEL, ...env.AI_FALLBACK_MODELS]
    const uniqueModels = [...new Set(models.filter(Boolean))]
    let lastError: unknown

    for (const model of uniqueModels) {
      try {
        return await this.primary.complete({ ...input, model })
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error('所有 LLM provider fallback 均调用失败')
  }
}

export const fallbackLlmProvider = new FallbackLlmProvider()
