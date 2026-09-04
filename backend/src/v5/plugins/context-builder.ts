import type { ValidationIssue } from '@/v5/types'

export type V6ContextMode = 'full' | 'scoped' | 'patch'

export interface RepairContextInput {
  runId: string
  originalEnvelope: unknown
  currentOutput: unknown
  validationIssues: ValidationIssue[]
  mode?: V6ContextMode
}

/**
 * Single repair-envelope shape. Keeping this in one module lets V6 replace
 * full-context repair with scoped/patch context without changing workflow code.
 */
export function buildRepairContext(input: RepairContextInput) {
  const mode = input.mode ?? 'scoped'
  if (mode === 'full') {
    return {
      runId: input.runId,
      originalEnvelope: input.originalEnvelope,
      currentOutput: input.currentOutput,
      validationIssues: input.validationIssues,
    }
  }

  if (mode === 'patch') {
    return {
      runId: input.runId,
      currentOutput: input.currentOutput,
      validationIssues: input.validationIssues,
    }
  }

  return {
    runId: input.runId,
    originalEnvelope: input.originalEnvelope,
    currentOutput: input.currentOutput,
    validationIssues: input.validationIssues,
  }
}

