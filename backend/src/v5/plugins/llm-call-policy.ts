import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'

export interface V6LlmCallBudgetLimits {
  maxCalls: number
  maxRepairCalls: number
  maxTotalTokens: number
}

export interface V6LlmCallBudgetSnapshot {
  calls: number
  repairCalls: number
  committedTokens: number
  pendingTokens: number
  physicalCalls: number
  remainingCalls: number
  remainingRepairCalls: number
  remainingTokens: number
}

export interface V6LlmCallPolicy {
  execute(input: {
    provider: LlmProvider
    request: ChatCompletionInput
    estimatedInputTokens: number
  }): Promise<ChatCompletionResult>
  snapshot(): V6LlmCallBudgetSnapshot
}

export class V6LlmCallBudgetExceededError extends Error {
  readonly code = 'V6_LLM_CALL_BUDGET_EXCEEDED' as const

  constructor(readonly metric: 'calls' | 'repairCalls' | 'totalTokens', readonly limit: number) {
    super(`V6 LLM ${metric} budget exceeded: limit ${limit}`)
    this.name = 'V6LlmCallBudgetExceededError'
  }
}

interface Reservation {
  estimatedTokens: number
  repair: boolean
  settled: boolean
}

function requireBudgetInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
  return value
}

export class BoundedV6LlmCallPolicy implements V6LlmCallPolicy {
  private calls = 0
  private repairCalls = 0
  private committedTokens = 0
  private pendingTokens = 0
  private physicalCalls = 0

  constructor(private readonly limits: V6LlmCallBudgetLimits) {
    requireBudgetInteger(limits.maxCalls, 'maxCalls')
    requireBudgetInteger(limits.maxRepairCalls, 'maxRepairCalls')
    requireBudgetInteger(limits.maxTotalTokens, 'maxTotalTokens')
  }

  async execute(input: {
    provider: LlmProvider
    request: ChatCompletionInput
    estimatedInputTokens: number
  }) {
    const reservation = this.reserve(input.request, input.estimatedInputTokens)
    try {
      const result = await input.provider.complete({
        ...input.request,
        maxProviderAttempts: 1,
        maxProviderModels: 1,
        callMetadata: {
          callReason: input.request.callMetadata?.callReason ?? 'business_stage',
          contextMode: input.request.callMetadata?.contextMode ?? 'scoped',
          repairScope: input.request.callMetadata?.repairScope ?? [],
          retryIndex: input.request.callMetadata?.retryIndex ?? 0,
          budgetRemaining: this.snapshot().remainingCalls,
        },
      })
      this.settle(reservation, result)
      return result
    } catch (error) {
      this.settle(reservation)
      throw error
    }
  }

  snapshot(): V6LlmCallBudgetSnapshot {
    return {
      calls: this.calls,
      repairCalls: this.repairCalls,
      committedTokens: this.committedTokens,
      pendingTokens: this.pendingTokens,
      physicalCalls: this.physicalCalls,
      remainingCalls: Math.max(0, this.limits.maxCalls - this.calls),
      remainingRepairCalls: Math.max(0, this.limits.maxRepairCalls - this.repairCalls),
      remainingTokens: Math.max(0, this.limits.maxTotalTokens - this.committedTokens - this.pendingTokens),
    }
  }

  private reserve(request: ChatCompletionInput, estimatedInputTokens: number): Reservation {
    requireBudgetInteger(estimatedInputTokens, 'estimatedInputTokens')
    const repair = request.callMetadata?.callReason === 'validation_repair'
      || (request.promptManifest?.repairAttempt ?? 0) > 0
    const estimatedOutputTokens = Math.min(
      request.maxOutputTokens ?? 8_192,
      Math.max(512, Math.ceil((request.maxOutputTokens ?? 8_192) * 0.4))
    )
    const estimatedTokens = estimatedInputTokens + estimatedOutputTokens
    if (this.calls >= this.limits.maxCalls) {
      throw new V6LlmCallBudgetExceededError('calls', this.limits.maxCalls)
    }
    if (repair && this.repairCalls >= this.limits.maxRepairCalls) {
      throw new V6LlmCallBudgetExceededError('repairCalls', this.limits.maxRepairCalls)
    }
    if (this.committedTokens + this.pendingTokens + estimatedTokens > this.limits.maxTotalTokens) {
      throw new V6LlmCallBudgetExceededError('totalTokens', this.limits.maxTotalTokens)
    }
    this.calls += 1
    if (repair) this.repairCalls += 1
    this.pendingTokens += estimatedTokens
    return { estimatedTokens, repair, settled: false }
  }

  private settle(reservation: Reservation, result?: ChatCompletionResult) {
    if (reservation.settled) return
    reservation.settled = true
    this.pendingTokens = Math.max(0, this.pendingTokens - reservation.estimatedTokens)
    this.committedTokens += result?.inputTokens !== undefined && result.outputTokens !== undefined
      ? result.inputTokens + result.outputTokens
      : reservation.estimatedTokens
    this.physicalCalls += result?.physicalAttempts ?? 1
  }
}
