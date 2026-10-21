import { expect, test } from 'bun:test'
import { validateJudgeCitations } from '@/v5/judge-citations'
import type { BlindABEvaluation } from '@/v5/types'

function evaluation(finding: string): BlindABEvaluation {
  return { schemaVersion: '5.0.0', evaluations: [{ candidateId: 'A', absoluteGate: 'fail',
    dimensions: { factualFidelity: 20, jobSpecificity: 10, evidenceSelection: 10, highValueEvidenceRecall: 5, careerCoherence: 5, concisenessReadability: 5, deliverability: 5 },
    unsupportedClaims: [finding], attributionErrors: [], emptyScopes: [], internalAuditLeaks: [],
    missingHighValueEvidence: [], strengths: [], weaknesses: [],
  }], pairwise: { winner: 'B', confidence: 'low', reason: '测试' } }
}
test('P12 accepts actual quotations, without asserting the interpretation is correct', () => {
  expect(() => validateJudgeCitations(evaluation('「交付3个功能」说明需核对。'), [{ candidateId: 'A', markdown: '参与团队迭代，交付3个功能。' }])).not.toThrow()
})
test.each(['无摘录，新增了结果。', '「新增50%收入」无来源。', '「交付…功能」省略摘录。'])('P12 rejects unlocatable quotations: %s', finding => {
  expect(() => validateJudgeCitations(evaluation(finding), [{ candidateId: 'A', markdown: '交付3个功能。' }])).toThrow(expect.objectContaining({ code: 'V5_JUDGE_CITATION_INVALID' }))
})
test('P12 cannot quote the opposite candidate or source evidence as this candidate', () => {
  expect(() => validateJudgeCitations(evaluation('「交付3个功能」无来源。'), [
    { candidateId: 'A', markdown: '参与需求整理。' }, { candidateId: 'B', markdown: '交付3个功能。' },
  ])).toThrow(expect.objectContaining({ code: 'V5_JUDGE_CITATION_INVALID' }))
})
