import { describe, expect, test } from 'bun:test'
import type OpenAI from 'openai'
import { z } from 'zod'
import { deepSeekThinkingParameters, evaluationDeepSeekPolicy, parseDeepSeekThinking, parseDeepSeekExtractionThinking, isResumeExtractionRequest, resolveDeepSeekStageThinking } from '@/config/deepseek-thinking'
import { compileV5Prompt } from '@/v5/prompt-compiler'
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
  test('routes real compiled P01/P01R metadata without disabling JD or Writer thinking', async () => {
    const sent: Array<Record<string, unknown>> = []
    const eventBus = new FakeHarnessEventBus()
    const provider = new DeepSeekProvider(createClient(async body => {
      sent.push(body as Record<string, unknown>)
      return createResponse()
    }), parseDeepSeekThinking('enabled', 'low'), 'disabled')
    for (const component of ['P01', 'P01R', 'P02', 'P03', 'P06C'] as const) {
      const compiled = compileV5Prompt({ component, envelope: { payload: {} } })
      await provider.complete({ model: 'deepseek-v4-flash', messages: compiled.messages,
        promptVersion: compiled.promptVersion, promptManifest: compiled.manifest,
        maxOutputTokens: 14400, eventBus,
        stepContext: createStepExecutionContext(createRunContext(), component),
      })
    }
    for (const body of sent.slice(0, 2)) {
      expect(body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 14400 })
      expect(body).not.toHaveProperty('reasoning_effort')
    }
    for (const body of sent.slice(2)) expect(body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low' })
    expect(eventBus.events.filter(e => e.type === 'provider.requested').map(e => e.payload.thinking))
      .toEqual(sent.map(body => body.thinking))
    expect(sent).toHaveLength(5)
  })

  test('P01 disabled mode never performs the reasoning-only internal retry', async () => {
    let calls = 0
    const provider = new DeepSeekProvider(createClient(async () => {
      calls += 1
      return { ...createResponse(), choices: [{ message: { content: '' }, finish_reason: 'stop' }] }
    }), parseDeepSeekThinking('enabled'), 'disabled')
    await expect(provider.complete({ model: 'deepseek-v4-flash', messages: [],
      promptVersion: '5.0.0-p01-resume-evidence-r17', maxOutputTokens: 14400 })).rejects.toThrow('AI 返回内容为空')
    expect(calls).toBe(1)
  })

  test('defaults to inheritance and selects stages only from trusted exact metadata', () => {
    expect(parseDeepSeekExtractionThinking()).toBe('inherit')
    expect(() => parseDeepSeekExtractionThinking('default')).toThrow('INVALID_DEEPSEEK_P01_THINKING_MODE')
    const global = parseDeepSeekThinking('enabled', 'max')
    expect(resolveDeepSeekStageThinking(global, 'inherit', true)).toEqual(global)
    expect(resolveDeepSeekStageThinking(global, 'disabled', false)).toEqual(global)
    expect(isResumeExtractionRequest({ promptVersion: '5.0.0-p01r-resume-evidence-repair-r17' })).toBe(true)
    expect(isResumeExtractionRequest({ promptVersion: 'user said P01' })).toBe(false)
    expect(isResumeExtractionRequest({ promptVersion: '5.0.0-p01-resume-evidence-r17',
      promptManifest: { componentPromptId: 'P02' } })).toBe(false)
    expect(isResumeExtractionRequest({})).toBe(false)
  })

  test('extraction mode alters extraction policy fingerprints without altering global policy', () => {
    const global = parseDeepSeekThinking('enabled', 'low')
    const policy = (override: 'inherit' | 'disabled', extraction: boolean) => {
      const settings = resolveDeepSeekStageThinking(global, override, extraction)
      return evaluationDeepSeekPolicy('deepseek-v4-flash', settings.mode, settings.effort)
    }
    expect(policy('disabled', true)).not.toEqual(policy('inherit', true))
    expect(policy('disabled', false)).toEqual(policy('inherit', false))
    expect(() => evaluationDeepSeekPolicy('deepseek-chat', 'disabled')).toThrow()
  })

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

  test('reserves a default completion budget when thinking request omits maxOutputTokens', async () => {
    let sent: Record<string, unknown> = {}
    const provider = new DeepSeekProvider(createClient(async body => {
      sent = body as Record<string, unknown>
      return createResponse()
    }), parseDeepSeekThinking('enabled', 'low'))

    await provider.complete({ model: 'deepseek-v4-flash', messages: [] })

    expect(sent.max_tokens).toBe(12000)
  })

  test('returns structured empty-output usage without a hidden physical retry', async () => {
    const sent: Array<Record<string, unknown>> = []
    const provider = new DeepSeekProvider(createClient(async body => {
      sent.push(body as Record<string, unknown>)
      if (sent.length === 1) {
        return {
          id: 'reasoning-only', model: 'deepseek-v4-flash',
          choices: [{ message: { content: '', reasoning_content: 'omitted' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 20 } },
        }
      }
      return createResponse()
    }), parseDeepSeekThinking('enabled', 'high'))

    const result = await provider.complete({ model: 'deepseek-v4-flash', messages: [], maxProviderAttempts: 1,
      structuredOutput: { name: 'test', schema: z.object({ ok: z.boolean() }), strict: true } })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ reasoning_effort: 'high', max_tokens: 12000 })
    expect(result).toMatchObject({ content: '', physicalAttempts: 1, inputTokens: 2, outputTokens: 20, reasoningTokens: 20 })
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
