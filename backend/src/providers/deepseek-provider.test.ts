import { describe, expect, test } from 'bun:test'
import type OpenAI from 'openai'
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
