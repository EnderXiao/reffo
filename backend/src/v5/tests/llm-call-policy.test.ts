import { describe, expect, test } from 'bun:test'
import type { ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import {
  BoundedV6LlmCallPolicy,
  V6LlmCallBudgetExceededError,
} from '@/v5/plugins/llm-call-policy'

const providerResult: ChatCompletionResult = {
  provider: 'fake',
  model: 'fake-model',
  content: '{}',
  latencyMs: 1,
  inputTokens: 100,
  outputTokens: 20,
}

function provider(onCall?: (maxProviderAttempts: number | undefined, maxProviderModels: number | undefined, budgetRemaining: number | null | undefined) => void): LlmProvider {
  return {
    complete: async input => {
      onCall?.(input.maxProviderAttempts, input.maxProviderModels, input.callMetadata?.budgetRemaining)
      return providerResult
    },
  }
}

describe('V6 LLM call policy', () => {
  test('records actual usage and exposes remaining call budget to Harness metadata', async () => {
    const policy = new BoundedV6LlmCallPolicy({ maxCalls: 2, maxRepairCalls: 1, maxTotalTokens: 2_000 })
    let received: [number | undefined, number | undefined, number | null | undefined] | undefined
    await policy.execute({
      provider: provider((attempts, models, remaining) => { received = [attempts, models, remaining] }),
      request: { messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 100 },
      estimatedInputTokens: 100,
    })

    expect(received).toEqual([1, 1, 1])
    expect(policy.snapshot()).toMatchObject({
      calls: 1,
      committedTokens: 120,
      pendingTokens: 0,
      remainingCalls: 1,
      physicalCalls: 1,
    })
  })

  test('blocks a second repair before provider invocation', async () => {
    const policy = new BoundedV6LlmCallPolicy({ maxCalls: 3, maxRepairCalls: 1, maxTotalTokens: 3_000 })
    let calls = 0
    const fake = provider(() => { calls += 1 })
    const request = {
      messages: [{ role: 'user' as const, content: 'repair' }],
      maxOutputTokens: 100,
      callMetadata: {
        callReason: 'validation_repair' as const,
        contextMode: 'patch' as const,
        repairScope: ['field'],
        retryIndex: 0,
        budgetRemaining: null,
      },
    }
    await policy.execute({ provider: fake, request, estimatedInputTokens: 100 })

    await expect(policy.execute({ provider: fake, request, estimatedInputTokens: 100 }))
      .rejects.toBeInstanceOf(V6LlmCallBudgetExceededError)
    expect(calls).toBe(1)
  })

  test('reserves concurrent calls before either provider response settles', async () => {
    const policy = new BoundedV6LlmCallPolicy({ maxCalls: 1, maxRepairCalls: 0, maxTotalTokens: 2_000 })
    let release: (() => void) | undefined
    const blockedProvider: LlmProvider = {
      complete: () => new Promise(resolve => {
        release = () => resolve(providerResult)
      }),
    }
    const first = policy.execute({
      provider: blockedProvider,
      request: { messages: [{ role: 'user', content: 'first' }], maxOutputTokens: 100 },
      estimatedInputTokens: 100,
    })
    await expect(policy.execute({
      provider: blockedProvider,
      request: { messages: [{ role: 'user', content: 'second' }], maxOutputTokens: 100 },
      estimatedInputTokens: 100,
    })).rejects.toBeInstanceOf(V6LlmCallBudgetExceededError)
    release?.()
    await first
  })
})
