import type {ChatCompletionInput, LlmProvider} from '@/providers/llm-provider'
import {V5WorkflowBlockedError} from '@/v5/errors'

export const MATCHING_RESOURCE_POLICY_VERSION = 'matching-resources-v1'
export const MATCHING_STEP_TIMEOUT_MS = 300_000
export const MATCHING_REQUEST_TIMEOUT_MS = 360_000
export const MATCHING_MAX_REPAIR_BATCHES = 4
export const MATCHING_MAX_PHYSICAL_CALLS = 8
const MIN_REPAIR_BATCH_MS = 20_000
const FINAL_VALIDATION_RESERVE_MS = 5_000
const MAX_PROVIDER_CALL_MS = 120_000
const MAX_REPAIR_BATCH_MS = 90_000

function blocked(code: string, message: string) {
  return new V5WorkflowBlockedError({code, state: 'workflow_failure', message})
}

function boundedSignal(signals: Array<AbortSignal | undefined>, timeoutMs: number, reason: Error) {
  const controller = new AbortController()
  const listeners = new Map<AbortSignal, () => void>()
  for (const signal of new Set(signals.filter((item): item is AbortSignal => !!item))) {
    if (signal.aborted) {controller.abort(signal.reason); break}
    const listener = () => controller.abort(signal.reason)
    listeners.set(signal, listener)
    signal.addEventListener('abort', listener, {once: true})
  }
  const timer = setTimeout(() => controller.abort(reason), Math.max(1, timeoutMs))
  timer.unref?.()
  return {signal: controller.signal, dispose: () => {
    clearTimeout(timer)
    for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener)
  }}
}

/** Shared by the primary request, transport recovery and every scoped repair. */
export class MatchingResourceBudget {
  private readonly deadline: number
  private readonly now: () => number
  private calls = 0

  constructor(private readonly options: {timeoutMs: number; signal?: AbortSignal; now?: () => number}) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('INVALID_MATCHING_TIMEOUT')
    this.now = options.now ?? Date.now
    this.deadline = this.now() + Math.min(options.timeoutMs, MATCHING_STEP_TIMEOUT_MS)
  }

  get remainingCalls() {return Math.max(0, MATCHING_MAX_PHYSICAL_CALLS - this.calls)}
  get physicalCalls() {return this.calls}
  remainingMs() {return Math.max(0, this.deadline - this.now())}

  preflightRepairs(batchCount: number) {
    this.options.signal?.throwIfAborted()
    if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > MATCHING_MAX_REPAIR_BATCHES) {
      throw blocked('P03_REPAIR_CALL_BUDGET_EXCEEDED', '岗位匹配修复所需批次数超过本次有界调用预算；未发起新的修复请求。')
    }
    if (this.remainingCalls < batchCount) {
      throw blocked('P03_REPAIR_CALL_BUDGET_EXCEEDED', '岗位匹配剩余模型调用预算不足以完成全部修复批次；未发起新的修复请求。')
    }
    if (this.remainingMs() < batchCount * MIN_REPAIR_BATCH_MS + FINAL_VALIDATION_RESERVE_MS) {
      throw blocked('P03_REPAIR_TIME_BUDGET_EXCEEDED', '岗位匹配剩余时间不足以完成全部修复批次与最终校验；已有有效阶段已保留。')
    }
  }

  async runRepairBatch<T>(remainingBatches: number, execute: (signal: AbortSignal) => Promise<T>) {
    this.preflightRepairs(remainingBatches)
    const timeoutMs = Math.min(MAX_REPAIR_BATCH_MS,
      Math.floor((this.remainingMs() - FINAL_VALIDATION_RESERVE_MS) / remainingBatches))
    const bounded = boundedSignal([this.options.signal], timeoutMs,
      blocked('P03_REPAIR_TIME_BUDGET_EXCEEDED', '岗位匹配局部修复已达到分配的时间预算，已停止后续调用。'))
    try {
      bounded.signal.throwIfAborted()
      const result = await execute(bounded.signal)
      bounded.signal.throwIfAborted()
      return result
    } catch (error) {
      if (bounded.signal.aborted) throw bounded.signal.reason
      throw error
    } finally {bounded.dispose()}
  }

  bind(provider: LlmProvider): LlmProvider {
    return {complete: async (input: ChatCompletionInput) => {
      this.options.signal?.throwIfAborted()
      input.signal?.throwIfAborted()
      input.stepContext?.signal?.throwIfAborted()
      if (!this.remainingCalls) throw blocked('P03_CALL_BUDGET_EXCEEDED', '岗位匹配已用尽本次模型调用预算，已停止继续请求。')
      const availableMs = this.remainingMs() - FINAL_VALIDATION_RESERVE_MS
      if (availableMs <= 0) throw blocked('P03_REPAIR_TIME_BUDGET_EXCEEDED', '岗位匹配已用尽本次时间预算，已停止继续请求。')
      const bounded = boundedSignal([this.options.signal, input.signal, input.stepContext?.signal],
        Math.min(MAX_PROVIDER_CALL_MS, availableMs),
        blocked('P03_REPAIR_TIME_BUDGET_EXCEEDED', '岗位匹配模型请求已达到本次时间预算，已停止继续请求。'))
      this.calls += 1
      try {
        bounded.signal.throwIfAborted()
        const result = await provider.complete({...input, signal: bounded.signal,
          maxProviderAttempts: 1, maxProviderModels: 1,
          callMetadata: {...(input.callMetadata ?? {callReason: input.promptManifest?.repairAttempt ? 'validation_repair' : 'business_stage',
            contextMode: input.promptManifest?.repairAttempt ? 'scoped' : 'full', repairScope: [], retryIndex: 0}),
            budgetRemaining: this.remainingCalls}})
        bounded.signal.throwIfAborted()
        return result
      } catch (error) {
        if (bounded.signal.aborted) throw bounded.signal.reason
        throw error
      } finally {bounded.dispose()}
    }}
  }
}
