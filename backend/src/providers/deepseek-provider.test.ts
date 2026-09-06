import { describe, expect, test } from 'bun:test'
import type OpenAI from 'openai'
import { z } from 'zod'
import { deepSeekThinkingParameters, evaluationDeepSeekPolicy, parseDeepSeekThinking } from '@/config/deepseek-thinking'
import { createRunContext, createStepExecutionContext } from '@/harness/run-context'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import { DeepSeekProvider } from '@/providers/deepseek-provider'

type FakeCompletionOptions = {
  signal?: AbortSignal | null
  maxRetries?: number
}
type FakeCompletionCreate = (
  body: unknown,
  options?: FakeCompletionOptions
) => Promise<unknown>

function createClient(create: FakeCompletionCreate) {
  return {
    chat: {
      completions: { create },
    },
  } as unknown as OpenAI
}

function createResponse() {
  return {
    id: 'request-1',
    choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }
}

function createAbortError() {
  const error = new Error('request aborted')
  error.name = 'AbortError'
  return error
}

describe('DeepSeekProvider abort signals', () => {
  test('records V6 call reason, context and retry metadata in Harness events', async () => {
    const eventBus = new FakeHarnessEventBus()
    const runContext = createRunContext()
    const provider = new DeepSeekProvider(createClient(async () => createResponse()))

    await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
      eventBus,
      stepContext: createStepExecutionContext(runContext, 'test-step'),
      callMetadata: {
        callReason: 'validation_repair',
        contextMode: 'patch',
        repairScope: ['requirements.0.quote'],
        retryIndex: 1,
        budgetRemaining: 3,
      },
    })

    expect(eventBus.events.find(event => event.type === 'provider.requested')?.payload).toMatchObject({
      callReason: 'validation_repair',
      contextMode: 'patch',
      repairScope: ['requirements.0.quote'],
      retryIndex: 1,
      budgetRemaining: 3,
    })
    expect(eventBus.events.find(event => event.type === 'provider.responded')?.payload).toMatchObject({
      callReason: 'validation_repair',
      contextMode: 'patch',
      retryIndex: 1,
    })
  })

  test('passes a caller signal to the OpenAI SDK request', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | null | undefined
    let receivedMaxRetries: number | undefined
    const provider = new DeepSeekProvider(createClient(async (_body, options) => {
      receivedSignal = options?.signal
      receivedMaxRetries = options?.maxRetries
      return createResponse()
    }))

    await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
      signal: controller.signal,
    })

    expect(receivedSignal).toBe(controller.signal)
    expect(receivedMaxRetries).toBe(0)
  })

  test('combines caller and step signals and propagates either cancellation', async () => {
    const callerController = new AbortController()
    const stepController = new AbortController()
    let receivedSignal: AbortSignal | null | undefined
    const provider = new DeepSeekProvider(createClient((_body, options) => {
      receivedSignal = options?.signal

      return new Promise((_resolve, reject) => {
        const rejectAsAborted = () => reject(createAbortError())
        if (receivedSignal?.aborted) {
          rejectAsAborted()
          return
        }
        receivedSignal?.addEventListener('abort', rejectAsAborted, { once: true })
      })
    }))
    const runContext = createRunContext()
    const completion = provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
      signal: callerController.signal,
      stepContext: createStepExecutionContext(runContext, 'test-step', 1, stepController.signal),
    })

    stepController.abort('step cancelled')

    await expect(completion).rejects.toMatchObject({ name: 'AbortError' })
    expect(receivedSignal).not.toBe(callerController.signal)
    expect(receivedSignal).not.toBe(stepController.signal)
    expect(receivedSignal?.aborted).toBe(true)
    expect(receivedSignal?.reason).toBe('step cancelled')
  })
})

describe('explicit DeepSeek V4 thinking', () => {
  test('leaves legacy requests unchanged without an explicit mode', async () => {
    let sent: Record<string, unknown> = {}
    const provider = new DeepSeekProvider(createClient(async body => {
      sent = body as Record<string, unknown>
      return createResponse()
    }), parseDeepSeekThinking())
    await provider.complete({ model: 'deepseek-chat', messages: [], temperature: 0, maxOutputTokens: 100 })
    expect(sent.temperature).toBe(0)
    expect(sent).not.toHaveProperty('thinking')
    expect(sent).not.toHaveProperty('reasoning_effort')
  })

  test('sends enabled/high, omits ineffective temperature and retains the total cap', async () => {
    let sent: Record<string, unknown> = {}
    const provider = new DeepSeekProvider(createClient(async body => {
      sent = body as Record<string, unknown>
      return { ...createResponse(), model: 'deepseek-v4-flash-0731',
        usage: { prompt_tokens: 30, completion_tokens: 90, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 70 } } }
    }), parseDeepSeekThinking('enabled'))
    const result = await provider.complete({ model: 'deepseek-v4-flash', messages: [], temperature: 0, maxOutputTokens: 100 })
    expect(sent).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 100 })
    expect(sent).not.toHaveProperty('temperature')
    expect(result).toMatchObject({ model: 'deepseek-v4-flash-0731', requestedModel: 'deepseek-v4-flash',
      inputTokens: 30, outputTokens: 90, reasoningTokens: 70, inputCacheHitTokens: 10, inputCacheMissTokens: 20 })
    expect(result).not.toHaveProperty('reasoning_content')
  })

  test('allows disabled mode without sending reasoning effort', () => {
    expect(deepSeekThinkingParameters('deepseek-v4-flash', 'https://api.deepseek.com', parseDeepSeekThinking('disabled')))
      .toEqual({ thinking: { type: 'disabled' } })
  })

  test('does not leak DeepSeek settings to other endpoints or silently switch models', () => {
    expect(() => deepSeekThinkingParameters('deepseek-v4-flash', 'https://example.com', parseDeepSeekThinking('enabled'))).toThrow()
    expect(() => evaluationDeepSeekPolicy('deepseek-v4-pro', 'enabled')).toThrow()
    expect(() => evaluationDeepSeekPolicy('deepseek-v4-flash')).toThrow()
    expect(() => evaluationDeepSeekPolicy('deepseek-chat', 'enabled')).toThrow()
    expect(() => parseDeepSeekThinking('true')).toThrow()
    expect(() => parseDeepSeekThinking('enabled', 'medium')).toThrow()
  })

  test('fingerprints distinguish explicit mode and effort', () => {
    const high = evaluationDeepSeekPolicy('deepseek-v4-flash', 'enabled', 'high')
    expect(high).not.toEqual(evaluationDeepSeekPolicy('deepseek-v4-flash', 'enabled', 'low'))
    expect(high).not.toEqual(evaluationDeepSeekPolicy('deepseek-v4-flash', 'disabled'))
    expect(evaluationDeepSeekPolicy('deepseek-chat')).toBeNull()
  })

  test('retains actual usage for a reasoning-only structured truncation', async () => {
    const provider = new DeepSeekProvider(createClient(async () => ({
      id: 'truncated', model: 'deepseek-v4-flash',
      choices: [{ message: { content: '', reasoning_content: 'private reasoning is not stored' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 20, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } },
    })), parseDeepSeekThinking('enabled'))
    const result = await provider.complete({ model: 'deepseek-v4-flash', messages: [], maxOutputTokens: 100,
      structuredOutput: { name: 'test', schema: z.object({ ok: z.boolean() }), strict: true } })
    expect(result).toMatchObject({ content: '', finishReason: 'length', outputTokens: 100, reasoningTokens: 100 })
    expect(JSON.stringify(result)).not.toContain('private reasoning')
  })
})
