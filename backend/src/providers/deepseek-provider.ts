import OpenAI from 'openai'
import { env } from '@/config/env'
import { createHarnessEvent } from '@/harness/events'
import { createDigest } from '@/harness/run-context'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

export class DeepSeekProvider implements LlmProvider {
  private readonly client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  }

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const model = input.model ?? env.AI_MODEL
    const startedAt = Date.now()
    const inputDigest = createDigest(input.messages.map((message) => message.content).join('\n'))

    if (input.eventBus && input.stepContext) {
      await input.eventBus.publish(
        createHarnessEvent({
          type: 'provider.requested',
          runId: input.stepContext.runId,
          requestId: input.stepContext.requestId,
          stepRunId: input.stepContext.stepRunId,
          attemptId: input.stepContext.attemptId,
          payload: {
            provider: 'deepseek',
            model,
            promptVersion: input.promptVersion,
            inputDigest,
          },
        })
      )
    }

    const response = await this.client.chat.completions.create(
      {
        model,
        messages: input.messages,
        response_format: input.responseFormat ? { type: input.responseFormat } : undefined,
        temperature: input.temperature,
      },
      input.stepContext?.signal ? { signal: input.stepContext.signal } : undefined
    )
    const latencyMs = Date.now() - startedAt
    const content = response.choices[0]?.message?.content

    if (!content) {
      throw new Error('AI 返回内容为空')
    }

    const result: ChatCompletionResult = {
      provider: 'deepseek',
      model,
      content,
      latencyMs,
      providerRequestId: response.id,
      finishReason: response.choices[0]?.finish_reason,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    }

    if (input.eventBus && input.stepContext) {
      await input.eventBus.publish(
        createHarnessEvent({
          type: 'provider.responded',
          runId: input.stepContext.runId,
          requestId: input.stepContext.requestId,
          stepRunId: input.stepContext.stepRunId,
          attemptId: input.stepContext.attemptId,
          payload: {
            provider: result.provider,
            model: result.model,
            latencyMs: result.latencyMs,
            providerRequestId: result.providerRequestId,
            finishReason: result.finishReason,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            outputDigest: createDigest(result.content),
          },
        })
      )
    }

    return result
  }
}

export const deepSeekProvider = new DeepSeekProvider()
