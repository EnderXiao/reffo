import { describe, expect, test } from 'bun:test'
import { BudgetAwareThinkingProvider, V5_THINKING_DISABLE_REMAINING_MS } from '@/providers/budget-aware-thinking-provider'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

function recordingProvider() {
  const received: ChatCompletionInput[] = []
  const inner: LlmProvider = {
    async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
      received.push(input)
      return { provider: 'fake', model: 'fake', content: '{}', latencyMs: 1 }
    },
  }
  return { inner, received }
}

function baseInput(): ChatCompletionInput {
  return { messages: [{ role: 'user', content: 'hi' }] }
}

describe('BudgetAwareThinkingProvider', () => {
  test('keeps the request unchanged while budget is healthy', async () => {
    const { inner, received } = recordingProvider()
    const provider = new BudgetAwareThinkingProvider(inner, () => V5_THINKING_DISABLE_REMAINING_MS + 1)

    await provider.complete(baseInput())

    expect(received).toHaveLength(1)
    expect(received[0].thinkingOverride).toBeUndefined()
  })

  test('disables thinking once the shared budget drops to the threshold', async () => {
    const { inner, received } = recordingProvider()
    const provider = new BudgetAwareThinkingProvider(inner, () => V5_THINKING_DISABLE_REMAINING_MS)

    await provider.complete(baseInput())

    expect(received).toHaveLength(1)
    expect(received[0].thinkingOverride).toBe('disabled')
  })

  test('does not override an explicit disable decision', async () => {
    const { inner, received } = recordingProvider()
    const provider = new BudgetAwareThinkingProvider(inner, () => 1)

    await provider.complete({ ...baseInput(), thinkingOverride: 'disabled' })

    expect(received).toHaveLength(1)
    expect(received[0].thinkingOverride).toBe('disabled')
  })

  test('treats a missing budget as healthy', async () => {
    const { inner, received } = recordingProvider()
    const provider = new BudgetAwareThinkingProvider(inner, () => Number.POSITIVE_INFINITY)

    await provider.complete(baseInput())

    expect(received[0].thinkingOverride).toBeUndefined()
  })
})
