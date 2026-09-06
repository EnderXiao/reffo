import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { env } from '@/config/env'
import { deepSeekThinkingParameters, parseDeepSeekThinking, type DeepSeekThinkingSettings } from '@/config/deepseek-thinking'
import { createHarnessEvent } from '@/harness/events'
import { createDigest } from '@/harness/run-context'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

type DeepSeekChatBody = Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, 'reasoning_effort'>
  & ReturnType<typeof deepSeekThinkingParameters>

function composeAbortSignals(...candidates: Array<AbortSignal | undefined>) {
  const signals = [...new Set(candidates.filter((signal): signal is AbortSignal => Boolean(signal)))]

  if (signals.length <= 1) {
    return {
      signal: signals[0],
      dispose: () => undefined,
    }
  }

  const controller = new AbortController()
  const listeners = new Map<AbortSignal, () => void>()

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }

    const listener = () => controller.abort(signal.reason)
    listeners.set(signal, listener)
    signal.addEventListener('abort', listener, { once: true })
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener('abort', listener)
      }
    },
  }
}

export class DeepSeekProvider implements LlmProvider {
  private readonly client: OpenAI

  constructor(client?: OpenAI, private readonly thinkingSettings?: DeepSeekThinkingSettings) {
    this.client = client ?? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  }

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const model = input.model ?? env.AI_MODEL
    const settings = this.thinkingSettings ?? parseDeepSeekThinking(env.DEEPSEEK_THINKING_MODE, env.DEEPSEEK_REASONING_EFFORT)
    const thinking = deepSeekThinkingParameters(model, env.OPENAI_BASE_URL, settings)
    const startedAt = Date.now()
    const startedAtIso = new Date(startedAt).toISOString()
    const inputDigest = createDigest(input.messages.map((message) => message.content).join('\n'))
    const nativeStructuredOutput = env.V5_STRUCTURED_OUTPUT_MODE === 'native'
      || (env.V5_STRUCTURED_OUTPUT_MODE === 'auto' && /^https:\/\/api\.openai\.com(?:\/|$)/i.test(env.OPENAI_BASE_URL))

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
            temperature: settings.mode === 'enabled' ? undefined : input.temperature,
            ...thinking,
            maxOutputTokens: input.maxOutputTokens,
            strictSchema: input.structuredOutput?.name,
            strictSchemaTransport: input.structuredOutput
              ? nativeStructuredOutput ? 'native_json_schema' : 'json_object_plus_server_zod'
              : null,
            promptManifest: input.promptManifest,
          },
        })
      )
    }

    const responseFormat = input.structuredOutput
      ? nativeStructuredOutput
        ? zodResponseFormat(input.structuredOutput.schema, input.structuredOutput.name)
        : { type: 'json_object' as const }
      : input.responseFormat
        ? { type: input.responseFormat }
        : undefined
    const requestSignal = composeAbortSignals(input.signal, input.stepContext?.signal)
    const requestBody: DeepSeekChatBody = {
      model,
      messages: input.messages,
      response_format: responseFormat,
      ...(settings.mode === 'enabled' ? {} : { temperature: input.temperature }),
      ...thinking,
      max_tokens: input.maxOutputTokens,
    }
    const response = await (async () => {
      try {
        return await this.client.chat.completions.create(
          // DeepSeek's documented `max` effort is not in this SDK's OpenAI enum.
          // Keep that compatibility boundary local; the body is typed above.
          requestBody as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
          {
            signal: requestSignal.signal,
            // Physical retries must stay observable to the outer workflow budget.
            maxRetries: 0,
          }
        )
      } finally {
        requestSignal.dispose()
      }
    })()
    const latencyMs = Date.now() - startedAt
    const content = response.choices[0]?.message?.content

    // A reasoning-only truncation still has billable usage. Let the structured
    // stage reject `length` after the budget wrapper records the actual total.
    if (!content && !(input.structuredOutput && response.choices[0]?.finish_reason === 'length')) {
      throw new Error('AI 返回内容为空')
    }

    const result: ChatCompletionResult = {
      provider: 'deepseek',
      model: response.model || model,
      requestedModel: model,
      content: content ?? '',
      latencyMs,
      providerRequestId: response.id,
      finishReason: response.choices[0]?.finish_reason,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens,
      inputCacheHitTokens: (response.usage as (OpenAI.CompletionUsage & { prompt_cache_hit_tokens?: number }) | undefined)?.prompt_cache_hit_tokens,
      inputCacheMissTokens: (response.usage as (OpenAI.CompletionUsage & { prompt_cache_miss_tokens?: number }) | undefined)?.prompt_cache_miss_tokens,
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
            reasoningTokens: result.reasoningTokens,
            requestedModel: model,
            ...thinking,
            outputDigest: createDigest(result.content),
            promptManifest: input.promptManifest
              ? {
                  ...input.promptManifest,
                  modelProvider: result.provider,
                  modelSnapshot: result.model,
                  startedAt: startedAtIso,
                  durationMs: result.latencyMs,
                  inputTokens: result.inputTokens ?? null,
                  outputTokens: result.outputTokens ?? null,
                }
              : undefined,
          },
        })
      )
    }

    return result
  }
}

export const deepSeekProvider = new DeepSeekProvider()
