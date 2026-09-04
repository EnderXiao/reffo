import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { env } from '@/config/env'
import { createHarnessEvent } from '@/harness/events'
import { createDigest } from '@/harness/run-context'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

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

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  }

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const model = input.model ?? env.AI_MODEL
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
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
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
    const response = await (async () => {
      try {
        return await this.client.chat.completions.create(
          {
            model,
            messages: input.messages,
            response_format: responseFormat,
            temperature: input.temperature,
            max_tokens: input.maxOutputTokens,
          },
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
      physicalAttempts: 1,
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
            outputDigest: createDigest(result.content),
            callReason: input.callMetadata?.callReason,
            contextMode: input.callMetadata?.contextMode,
            repairScope: input.callMetadata?.repairScope,
            retryIndex: input.callMetadata?.retryIndex ?? 0,
            budgetRemaining: input.callMetadata?.budgetRemaining ?? null,
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
