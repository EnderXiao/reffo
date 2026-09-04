import { describe, expect, test } from 'bun:test'
import { buildRepairContext } from '@/v5/plugins/context-builder'
import { defaultV6RepairPolicy } from '@/v5/plugins/repair-policy'

describe('v6 low-cost repair foundation', () => {
  test('builds one stable repair envelope shape', () => {
    const context = buildRepairContext({
      runId: 'run-1',
      originalEnvelope: { payload: { source: 'input' } },
      currentOutput: { value: 'draft' },
      validationIssues: [],
    })

    expect(context).toEqual({
      runId: 'run-1',
      originalEnvelope: { payload: { source: 'input' } },
      currentOutput: { value: 'draft' },
      validationIssues: [],
    })
  })

  test('prefers deterministic fallback over another LLM repair', () => {
    expect(defaultV6RepairPolicy.decide({ issues: [{
      issueId: 'issue-1',
      severity: 'error',
      code: 'TEST',
      outputPath: 'value',
      claimId: null,
      evidenceIds: [],
      requirementIds: [],
      message: 'test',
      expectedConstraint: 'test',
      replacementText: null,
    }], hasDeterministicFallback: true })).toBe('deterministic_fallback')
    expect(defaultV6RepairPolicy.decide({ issues: [], hasDeterministicFallback: false })).toBe('skip')
  })
})
