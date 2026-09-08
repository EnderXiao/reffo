import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { env } from '@/config/env'
import { deepSeekThinkingParameters, parseDeepSeekThinking, isResumeExtractionRequest, resolveDeepSeekStageThinking, type DeepSeekThinkingSettings, type DeepSeekExtractionThinkingMode } from '@/config/deepseek-thinking'
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

  constructor(client?: OpenAI, private readonly thinkingSettings?: DeepSeekThinkingSettings,
    private readonly extractionThinkingMode: DeepSeekExtractionThinkingMode = env.DEEPSEEK_P01_THINKING_MODE) {
    this.client = client ?? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  }

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const model = input.model ?? env.AI_MODEL
    const settings = resolveDeepSeekStageThinking(
      this.thinkingSettings ?? parseDeepSeekThinking(env.DEEPSEEK_THINKING_MODE, env.DEEPSEEK_REASONING_EFFORT),
      this.extractionThinkingMode,
      isResumeExtractionRequest(input)
    )
    const thinking = deepSeekThinkingParameters(model, env.OPENAI_BASE_URL, settings)
    const maxOutputTokens = input.maxOutputTokens
      ?? (settings.mode === 'enabled' ? env.DEEPSEEK_THINKING_MAX_TOKENS : undefined)
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
            maxOutputTokens,
            strictSchema: input.structuredOutput?.name,
            strictSchemaTransport: input.structuredOutput
              ? nativeStructuredOutput ? 'native_json_schema' : 'json_object_plus_server_zod'
              : null,
            callReason: input.callMetadata?.callReason,
            contextMode: input.callMetadata?.contextMode,
            repairScope: input.callMetadata?.repairScope,
            retryIndex: input.callMetadata?.retryIndex ?? 0,
            budgetRemaining: input.callMetadata?.budgetRemaining ?? null,
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
      max_tokens: maxOutputTokens,
    }
    const responseThinking = thinking
    const physicalAttempts = 1
    const response = await (async () => {
      try {
        if (input.onContentDelta) {
          const stream = await this.client.chat.completions.create({
            ...requestBody, stream: true, stream_options: { include_usage: true },
          } as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
          { signal: requestSignal.signal, maxRetries: 0 })
          let content = '', id = '', resolvedModel = model
          let finishReason: OpenAI.ChatCompletion['choices'][number]['finish_reason'] = 'stop'
          let finished = false
          let usage: OpenAI.CompletionUsage | undefined
          // Bound accumulation even if a faulty provider ignores max_tokens.
          const maxCharacters = Math.max(65536, (maxOutputTokens ?? 16384) * 32)
          for await (const chunk of stream) {
            requestSignal.signal?.throwIfAborted()
            id = chunk.id || id
            resolvedModel = chunk.model || resolvedModel
            if (chunk.usage) usage = chunk.usage
            const choice = chunk.choices.find(item => item.index === 0)
            if (choice?.finish_reason) { finishReason = choice.finish_reason; finished = true }
            const delta = choice?.delta.content
            if (delta) {
              content += delta
              if (content.length > maxCharacters) throw new Error('PROVIDER_STREAM_SIZE_EXCEEDED')
              input.onContentDelta(delta)
            }
          }
          // A clean transport EOF without a terminal model frame is incomplete.
          if (!finished) throw new Error('PROVIDER_STREAM_INCOMPLETE')
          return { id, model: resolvedModel, choices: [{ message: { content }, finish_reason: finishReason }], usage }
        }
        const createCompletion = (body: DeepSeekChatBody) => this.client.chat.completions.create(
          // DeepSeek's documented `max` effort is not in this SDK's OpenAI enum.
          // Keep that compatibility boundary local; the body is typed above.
          body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
          {
            signal: requestSignal.signal,
            // Physical retries must stay observable to the outer workflow budget.
            maxRetries: 0,
          }
        )

        // One complete invocation is exactly one physical request. Recovery belongs
        // to the observable orchestration/budget layer, never an implicit second call.
        return await createCompletion(requestBody)
      } finally {
        requestSignal.dispose()
      }
    })()
    const latencyMs = Date.now() - startedAt
    const content = response.choices[0]?.message?.content

    // A reasoning-only truncation still has billable usage. Let the structured
    // stage reject `length` after the budget wrapper records the actual total.
    if (!content && !input.structuredOutput) {
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
      physicalAttempts,
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
            physicalAttempts: result.physicalAttempts,
            callReason: input.callMetadata?.callReason,
            contextMode: input.callMetadata?.contextMode,
            retryIndex: input.callMetadata?.retryIndex ?? 0,
            reasoningTokens: result.reasoningTokens,
            requestedModel: model,
            ...responseThinking,
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
