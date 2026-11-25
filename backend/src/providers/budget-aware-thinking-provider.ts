import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

/**
 * 剩余时间预算低于阈值时，自动关闭 thinking 模式。
 *
 * V5 流程的 LLM 调用是串行链，thinking 模式单次调用 20-90s；
 * 当共享预算所剩无几时继续开 thinking 几乎必然超时，
 * 关闭 thinking 用更快的非推理模式保住交付。
 *
 * 包装位置在 provider 外层：stage-runner、repair、judge、P01 分片
 * 等所有 complete 调用都会经过预算检查，调用方无需感知。
 */
export const V5_THINKING_DISABLE_REMAINING_MS = 90_000

export class BudgetAwareThinkingProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly remainingMs: () => number,
    private readonly disableBelowMs = V5_THINKING_DISABLE_REMAINING_MS,
  ) {}

  complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    if (input.thinkingOverride !== 'disabled' && this.remainingMs() <= this.disableBelowMs) {
      return this.inner.complete({ ...input, thinkingOverride: 'disabled' })
    }

    return this.inner.complete(input)
  }
}
