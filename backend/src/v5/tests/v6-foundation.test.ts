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

    expect(context).toEqual({ runId: 'run-1', fields: {}, relatedRecords: [], validationIssues: [] })
  })

  test('scopes fields and referenced records without copying complete envelopes', () => {
    const context = buildRepairContext({
      runId: 'run-2',
      originalEnvelope: {
        evidenceAtoms: [
          { evidenceId: 'ev-1', verbatimText: '保留事实' },
          { evidenceId: 'ev-2', verbatimText: '无关事实' },
        ],
        requirementAtoms: [{ requirementId: 'req-1', normalizedRequirement: 'React' }],
        unrelated: 'do-not-copy',
      },
      currentOutput: {
        claims: [
          { claimId: 'claim-1', outputText: '需要修复', evidenceIds: ['ev-1'] },
          { claimId: 'claim-2', outputText: '不要发送' },
        ],
      },
      validationIssues: [{
        issueId: 'issue-1',
        severity: 'error',
        code: 'CLAIM_INVALID',
        outputPath: 'claims[0].outputText',
        claimId: 'claim-1',
        evidenceIds: ['ev-1'],
        requirementIds: ['req-1'],
        message: '修复',
        expectedConstraint: '逐字引用',
        replacementText: '保留事实',
      }],
      mode: 'scoped',
    })

    expect(context).toEqual({
      runId: 'run-2',
      fields: { claims: [{ outputText: '需要修复' }] },
      relatedRecords: [
        { evidenceId: 'ev-1', verbatimText: '保留事实' },
        { requirementId: 'req-1', normalizedRequirement: 'React' },
      ],
      validationIssues: expect.any(Array),
    })
    expect(JSON.stringify(context)).not.toContain('无关事实')
    expect(JSON.stringify(context)).not.toContain('do-not-copy')
  })

  test('patch mode emits only fields, patch hints and referenced records', () => {
    const context = buildRepairContext({
      runId: 'run-3',
      originalEnvelope: { evidenceAtoms: [{ evidenceId: 'ev-1', verbatimText: '事实' }] },
      currentOutput: { summary: '当前摘要', claims: [{ outputText: '失败字段' }] },
      validationIssues: [{
        issueId: 'issue-1', severity: 'error', code: 'SUMMARY_INVALID', outputPath: 'summary',
        claimId: null, evidenceIds: ['ev-1'], requirementIds: [], message: '修复',
        expectedConstraint: '必须保留', replacementText: '替换摘要',
      }],
      mode: 'patch',
    })

    expect(context).toEqual({
      runId: 'run-3',
      fields: { summary: '当前摘要' },
      patchHints: [{ outputPath: 'summary', replacementText: '替换摘要', expectedConstraint: '必须保留' }],
      relatedRecords: [{ evidenceId: 'ev-1', verbatimText: '事实' }],
    })
    expect(JSON.stringify(context)).not.toContain('当前摘要当前摘要')
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
