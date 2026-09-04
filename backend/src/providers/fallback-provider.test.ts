import { describe, expect, test } from 'bun:test'
import { createRunContext, createStepExecutionContext } from '@/harness/run-context'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import { FallbackLlmProvider } from '@/providers/fallback-provider'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

function createStepInput(eventBus: FakeHarnessEventBus): ChatCompletionInput {
  const runContext = createRunContext()
  return {
    messages: [{ role: 'user', content: 'hello' }],
    model: 'test-model',
    eventBus,
    stepContext: createStepExecutionContext(runContext, 'analyze_resume'),
  }
}

function createResult(model: string): ChatCompletionResult {
  return {
    provider: 'fake',
    model,
    content: '{"ok":true}',
    latencyMs: 1,
  }
}

describe('FallbackLlmProvider transient retry', () => {
  test('retries the same model for transient provider errors', async () => {
    const eventBus = new FakeHarnessEventBus()
    let callCount = 0
    const provider: LlmProvider = {
      complete: async (input) => {
        callCount += 1
        if (callCount === 1) {
          const error = new Error('temporary upstream timeout') as Error & { status: number }
          error.status = 503
          throw error
        }

        return createResult(input.model ?? 'unknown')
      },
    }
    const fallback = new FallbackLlmProvider(provider)

    const result = await fallback.complete(createStepInput(eventBus))

    expect(result.model).toBe('test-model')
    expect(callCount).toBe(2)
    expect(eventBus.events.map((event) => event.type)).toContain('recovery.planned')
    expect(eventBus.events.map((event) => event.type)).toContain('recovery.started')
    expect(eventBus.events.map((event) => event.type)).toContain('recovery.succeeded')
    expect(eventBus.events.find((event) => event.type === 'recovery.succeeded')?.payload).toMatchObject({
      action: 'retry_same_step',
      model: 'test-model',
      attempts: 2,
      maxAttempts: 2,
    })
  })

  test('does not retry permanent provider errors on the same model', async () => {
    const eventBus = new FakeHarnessEventBus()
    let callCount = 0
    const provider: LlmProvider = {
      complete: async () => {
        callCount += 1
        const error = new Error('invalid api key') as Error & { status: number }
        error.status = 401
        throw error
      },
    }
    const fallback = new FallbackLlmProvider(provider)

    await expect(fallback.complete(createStepInput(eventBus))).rejects.toThrow('invalid api key')

    expect(callCount).toBe(1)
    expect(eventBus.events.find((event) => event.type === 'recovery.failed')?.payload).toMatchObject({
      action: 'fallback_model',
      model: 'test-model',
      attempts: 1,
    })
  })

  test('limits fallback model attempts when the caller supplies a physical model bound', async () => {
    let callCount = 0
    const provider: LlmProvider = {
      complete: async () => {
        callCount += 1
        throw new Error('invalid api key')
      },
    }
    const fallback = new FallbackLlmProvider(provider)
    const input = createStepInput(new FakeHarnessEventBus())
    input.model = 'primary'
    input.maxProviderModels = 1
    await expect(fallback.complete(input)).rejects.toThrow('invalid api key')
    expect(callCount).toBe(1)
  })

  test('stops immediately when the caller signal aborts during a provider failure', async () => {
    const eventBus = new FakeHarnessEventBus()
    const controller = new AbortController()
    let callCount = 0
    const provider: LlmProvider = {
      complete: async () => {
        callCount += 1
        controller.abort('evaluation budget exceeded')
        const error = new Error('temporary upstream timeout') as Error & { status: number }
        error.status = 503
        throw error
      },
    }
    const fallback = new FallbackLlmProvider(provider)
    const input = createStepInput(eventBus)
    input.signal = controller.signal
    input.maxProviderAttempts = 3

    await expect(fallback.complete(input)).rejects.toThrow('temporary upstream timeout')

    expect(callCount).toBe(1)
    expect(eventBus.events.filter((event) => event.type.startsWith('recovery.'))).toHaveLength(0)
  })
})
