import type { ValidationIssue } from '@/v5/types'

export type V6RepairDecision = 'skip' | 'deterministic_fallback' | 'local_llm'

export interface V6RepairPolicyInput {
  issues: ValidationIssue[]
  hasDeterministicFallback: boolean
}

export interface V6RepairPolicy {
  decide(input: V6RepairPolicyInput): V6RepairDecision
}

/** Default low-cost policy. A valid deterministic fallback wins over another LLM call. */
export const defaultV6RepairPolicy: V6RepairPolicy = {
  decide: ({ issues, hasDeterministicFallback }) => {
    if (issues.length === 0) return 'skip'
    if (hasDeterministicFallback) return 'deterministic_fallback'
    return 'local_llm'
  },
}

