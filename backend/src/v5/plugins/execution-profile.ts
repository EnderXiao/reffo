export interface V6ExecutionProfile {
  id: string
  planning: 'llm' | 'deterministic'
  finalReview: 'llm' | 'deterministic_gate_only'
  interview: 'sync' | 'disabled'
  maxArtifactRepairCalls: 0 | 1 | 2
  repairAfterFactJudge: boolean
}

export const V6_LOW_COST_PROFILE: V6ExecutionProfile = {
  id: 'v6-low-cost',
  planning: 'deterministic',
  finalReview: 'deterministic_gate_only',
  interview: 'disabled',
  maxArtifactRepairCalls: 1,
  repairAfterFactJudge: false,
}

export const V6_STRICT_REVIEW_PROFILE: V6ExecutionProfile = {
  id: 'v6-strict-review',
  planning: 'llm',
  finalReview: 'llm',
  interview: 'sync',
  maxArtifactRepairCalls: 2,
  repairAfterFactJudge: true,
}
