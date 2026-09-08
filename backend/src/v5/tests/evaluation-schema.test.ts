import { describe, expect, test } from 'bun:test'
import {
  blindABEvaluationSchema,
  normalizeBlindABEvaluationSemantics,
  normalizeBlindABEvaluationSemanticsWithAudit,
  resumeQualityJudgeResultSchema,
} from '@/v5/schemas'
import { V5_SCHEMA_VERSION } from '@/v5/types'

const dimensionsA = {
  factualFidelity: 25,
  jobSpecificity: 18,
  evidenceSelection: 14,
  highValueEvidenceRecall: 9,
  careerCoherence: 9,
  concisenessReadability: 9,
  deliverability: 10,
}

const dimensionsB = {
  factualFidelity: 25,
  jobSpecificity: 12,
  evidenceSelection: 12,
  highValueEvidenceRecall: 8,
  careerCoherence: 8,
  concisenessReadability: 8,
  deliverability: 9,
}

function abEvaluation(candidateId: 'A' | 'B', overrides: Record<string, unknown> = {}) {
  return {
    candidateId,
    absoluteGate: 'pass',
    dimensions: candidateId === 'A' ? dimensionsA : dimensionsB,
    unsupportedClaims: [],
    attributionErrors: [],
    emptyScopes: [],
    missingHighValueEvidence: [],
    internalAuditLeaks: [],
    strengths: ['证据选择合理'],
    weaknesses: [],
    ...overrides,
  }
}

function blindABResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    evaluations: [abEvaluation('A'), abEvaluation('B')],
    pairwise: { winner: 'A', confidence: 'high', reason: 'A 的服务端维度总分更高' },
    ...overrides,
  }
}

function qualityDimension(name: string, score = 8, maxScore = 10) {
  return { name, score, maxScore, evidence: [], issues: [] }
}

function qualityResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    evaluatorId: 'quality-judge',
    dimensions: [
      qualityDimension('job_specificity'),
      qualityDimension('evidence_selection'),
      qualityDimension('career_coherence'),
      qualityDimension('result_expression'),
      qualityDimension('conciseness_readability'),
      qualityDimension('deliverability'),
    ],
    deliverabilityGate: 'pass',
    factualIncidentCandidates: [],
    ...overrides,
  }
}

describe('v5 evaluation semantic schemas', () => {
  test('accepts a semantically consistent blind A/B result', () => {
    expect(blindABEvaluationSchema.safeParse(blindABResult()).success).toBe(true)
  })

  test('bounds every P12 finding list without silently truncating judge output', () => {
    const fields = ['unsupportedClaims', 'attributionErrors', 'emptyScopes',
      'missingHighValueEvidence', 'internalAuditLeaks', 'strengths', 'weaknesses'] as const
    for (const field of fields) {
      const resultWith = (findings: string[]) => blindABResult({
        evaluations: [
          abEvaluation('A', { absoluteGate: 'fail', [field]: findings }),
          abEvaluation('B', { absoluteGate: 'fail' }),
        ],
      })
      expect(blindABEvaluationSchema.safeParse(resultWith(Array(5).fill('证'.repeat(120)))).success).toBe(true)
      for (const findings of [Array(6).fill('问题'), ['证'.repeat(121)]]) {
        const raw = resultWith(findings)
        expect(blindABEvaluationSchema.safeParse(raw).success).toBe(false)
        const normalized = normalizeBlindABEvaluationSemanticsWithAudit(raw)
        expect(normalized.value).toBe(raw)
        expect(normalized.audit.applied).toBe(false)
      }
    }
    for (const length of [240, 241]) {
      const raw = blindABResult({ pairwise: { winner: 'A', confidence: 'high', reason: '证'.repeat(length) } })
      expect(blindABEvaluationSchema.safeParse(raw).success).toBe(length === 240)
    }
  })

  test('requires exactly one A and one B candidate', () => {
    const parsed = blindABEvaluationSchema.safeParse(blindABResult({
      evaluations: [abEvaluation('A'), abEvaluation('A')],
    }))

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some(issue => issue.path.join('.') === 'evaluations')).toBe(true)
    }
  })

  test('rejects a passing absolute gate with any hard-gate issue', () => {
    for (const [field, value] of [
      ['unsupportedClaims', ['新增事实']],
      ['attributionErrors', ['归因升级']],
      ['emptyScopes', ['工作经历为空']],
      ['internalAuditLeaks', ['内部审计文字']],
    ] as const) {
      const parsed = blindABEvaluationSchema.safeParse(blindABResult({
        evaluations: [abEvaluation('A', { [field]: value }), abEvaluation('B')],
      }))
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues.some(issue => issue.path.join('.').endsWith(field))).toBe(true)
      }
      const normalized = normalizeBlindABEvaluationSemanticsWithAudit(blindABResult({
        evaluations: [abEvaluation('A', { [field]: value }), abEvaluation('B')],
      }))
      expect(normalized.audit).toMatchObject({
        applied: true,
        changes: expect.arrayContaining(['evaluations.A.absoluteGate:pass->fail']),
      })
      expect(blindABEvaluationSchema.safeParse(normalized.value).success).toBe(true)
    }
  })

  test('enforces P12 dimension bounds and server-computed winner', () => {
    expect(blindABEvaluationSchema.safeParse(blindABResult({
      evaluations: [
        abEvaluation('A', { dimensions: { ...dimensionsA, factualFidelity: 26 } }),
        abEvaluation('B'),
      ],
    })).success).toBe(false)

    expect(blindABEvaluationSchema.safeParse(blindABResult({
      pairwise: { winner: 'B', confidence: 'high', reason: '与维度总分矛盾' },
    })).success).toBe(false)

    expect(blindABEvaluationSchema.safeParse(blindABResult({
      pairwise: { winner: 'tie', confidence: 'low', reason: '总分不相等却报告平局' },
    })).success).toBe(false)
  })

  test('absolute gate takes priority over the dimension total', () => {
    const failedHighScoreA = abEvaluation('A', {
      absoluteGate: 'fail',
      unsupportedClaims: ['新增事实'],
    })
    const lowScoreB = abEvaluation('B', {
      dimensions: {
        factualFidelity: 1,
        jobSpecificity: 1,
        evidenceSelection: 1,
        highValueEvidenceRecall: 1,
        careerCoherence: 1,
        concisenessReadability: 1,
        deliverability: 1,
      },
    })

    expect(blindABEvaluationSchema.safeParse(blindABResult({
      evaluations: [failedHighScoreA, lowScoreB],
      pairwise: { winner: 'B', confidence: 'high', reason: '通过门禁的候选优先' },
    })).success).toBe(true)
    expect(blindABEvaluationSchema.safeParse(blindABResult({
      evaluations: [failedHighScoreA, lowScoreB],
      pairwise: { winner: 'A', confidence: 'high', reason: '错误地选择失败候选' },
    })).success).toBe(false)
  })

  test('normalizes only server-derived P12 gates and winner', () => {
    const raw = blindABResult({
      evaluations: [
        abEvaluation('A', { unsupportedClaims: ['新增事实'] }),
        abEvaluation('B'),
      ],
      pairwise: { winner: 'A', confidence: 'high', reason: '保留模型原始解释' },
    })
    const normalized = normalizeBlindABEvaluationSemantics(raw)

    expect(blindABEvaluationSchema.safeParse(normalized).success).toBe(true)
    expect(normalized).toMatchObject({
      evaluations: [
        { candidateId: 'A', absoluteGate: 'fail', unsupportedClaims: ['新增事实'] },
        { candidateId: 'B', absoluteGate: 'pass' },
      ],
      pairwise: {
        winner: 'B',
        confidence: 'low',
        reason: '服务端按绝对门禁优先规则确定胜者为 B。',
      },
    })
  })

  test('reports normalization explicitly, preserves compliant key order, and is idempotent', () => {
    const compliant = {
      pairwise: { reason: 'A 的服务端维度总分更高', confidence: 'high', winner: 'A' },
      evaluations: [abEvaluation('A'), abEvaluation('B')],
      schemaVersion: V5_SCHEMA_VERSION,
    }
    const compliantResult = normalizeBlindABEvaluationSemanticsWithAudit(compliant)
    expect(compliantResult.value).toBe(compliant)
    expect(compliantResult.audit).toEqual({ applied: false, changes: [] })

    const raw = blindABResult({
      evaluations: [abEvaluation('A', { emptyScopes: ['空范围'] }), abEvaluation('B')],
      pairwise: { winner: 'A', confidence: 'high', reason: '模型解释' },
    })
    const original = structuredClone(raw)
    const first = normalizeBlindABEvaluationSemanticsWithAudit(raw)
    const second = normalizeBlindABEvaluationSemanticsWithAudit(first.value)
    expect(raw).toEqual(original)
    expect(first.audit.applied).toBe(true)
    expect(first.audit.changes).toEqual(expect.arrayContaining([
      'evaluations.A.absoluteGate:pass->fail',
      'pairwise.winner:A->B',
      'pairwise.confidence:set-low',
      'pairwise.reason:set-deterministic',
    ]))
    expect(second.value).toBe(first.value)
    expect(second.audit).toEqual({ applied: false, changes: [] })
  })

  test('does not normalize malformed P12 ids, dimensions, or unknown fields', () => {
    for (const raw of [
      blindABResult({
        evaluations: [abEvaluation('A'), abEvaluation('A')],
      }),
      blindABResult({
        evaluations: [
          abEvaluation('A', { dimensions: { ...dimensionsA, factualFidelity: 26 } }),
          abEvaluation('B'),
        ],
      }),
      { ...blindABResult(), unexpected: true },
    ]) {
      expect(normalizeBlindABEvaluationSemantics(raw)).toBe(raw)
      expect(blindABEvaluationSchema.safeParse(normalizeBlindABEvaluationSemantics(raw)).success).toBe(false)
    }
  })

  test('requires all six P11 dimensions exactly once and score within maxScore', () => {
    expect(resumeQualityJudgeResultSchema.safeParse(qualityResult()).success).toBe(true)

    expect(resumeQualityJudgeResultSchema.safeParse(qualityResult({
      dimensions: [
        qualityDimension('job_specificity'),
        qualityDimension('job_specificity'),
        qualityDimension('career_coherence'),
        qualityDimension('result_expression'),
        qualityDimension('conciseness_readability'),
        qualityDimension('deliverability'),
      ],
    })).success).toBe(false)

    expect(resumeQualityJudgeResultSchema.safeParse(qualityResult({
      dimensions: [
        qualityDimension('job_specificity', 11, 10),
        qualityDimension('evidence_selection'),
        qualityDimension('career_coherence'),
        qualityDimension('result_expression'),
        qualityDimension('conciseness_readability'),
        qualityDimension('deliverability'),
      ],
    })).success).toBe(false)

    expect(resumeQualityJudgeResultSchema.safeParse(qualityResult({
      dimensions: [
        qualityDimension('job_specificity', 4, 5),
        qualityDimension('evidence_selection'),
        qualityDimension('career_coherence'),
        qualityDimension('result_expression'),
        qualityDimension('conciseness_readability'),
        qualityDimension('deliverability'),
      ],
    })).success).toBe(false)
  })
})
