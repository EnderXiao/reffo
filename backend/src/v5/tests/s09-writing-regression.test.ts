import { expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { inspectSupportedWriting } from '@/v5/writing/facts'
import { buildWritingIntents } from '@/v5/writing/intents'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import type { EvidenceAtom } from '@/v5/types'

function atom(text: string): EvidenceAtom {
  const doc = canonicalizeSourceDocument(text).canonicalDocument, block = doc.blocks[0]
  return { evidenceId: 'source:practice', sourceDocumentHash: doc.sha256, sourceBlockId: block.sourceBlockId,
    sourceScopeId: 'scope:practice', sourceSpan: { start: block.canonicalStart, end: block.canonicalEnd },
    verbatimText: text, normalizedClaim: text, claimType: 'action', status: 'source_supported',
    attributionLevel: 'unspecified', sourceActionVerb: null, qualifiers: [], numericAtoms: [], riskFlags: [] }
}
const codes = (source: string, output: string) => inspectSupportedWriting(output, [atom(source)], 'skills[0]').map(i => i.code)

test.each([
  ['推动销售重新议价。', '协调销售重新议价。'],
  ['推动研发修复线上问题。', '与开发协作修复线上问题。'],
  ['促成商务开展合同谈判。', '协调商务开展合同谈判。'],
  ['支持工艺部门开展评审。', '协调工艺部门开展评审。'],
])('accepts an existing actor with an explicit action: %s', (source, output) => {
  expect(codes(source, output)).not.toContain('WRITER_COLLABORATOR_ADDED')
})

test.each([
  ['推动销售增长。', '协调销售部门完成增长。'],
  ['改善工艺流程。', '协调工艺部门改善流程。'],
  ['推动销售重新议价，工艺改善。', '协调销售、工艺等部门落实改善动作。'],
  ['未推动销售重新议价。', '协调销售重新议价。'],
  ['计划推动销售重新议价。', '协调销售重新议价。'],
  ['推动销售重新议价。', '协调市场重新议价。'],
])('does not manufacture a department or collaboration from %s', (source, output) => {
  expect(codes(source, output)).toContain('WRITER_COLLABORATOR_ADDED')
})

test.each(['5年制造业财务经验。', '财务模型提升收入20%。', '三年财务分析经验。'])('does not carry an unanchored numeric assertion through analysis prose: %s', assertion => {
  const f = createTargetingFixture()
  f.business.verbatimText = '负责工厂预算与经营分析。'; f.business.riskFlags = []
  f.fit.links = [{ targetId: 'job:task:t1', status: 'transferable', evidenceIds: [f.business.evidenceId],
    similarity: assertion, difference: '目标业务场景不同。', expressionAngle: '强调专业年限和经营分析经验。' }]
  const before = structuredClone(f.fit)
  const result = buildWritingIntents({ ...f, selectedEvidenceIds: new Set([f.business.evidenceId]) })
  expect(result).toHaveLength(1)
  expect(result[0].similarity).toBe('')
  expect(result[0].expressionAngle).toBe('')
  expect(result[0].difference).toBe('目标业务场景不同。')
  expect(result[0].evidenceIds).toEqual([f.business.evidenceId])
  expect(f.fit).toEqual(before)
})

test('a source-backed quantity remains available; another unrelated fact cannot authorize it', () => {
  const f = createTargetingFixture()
  f.business.verbatimText = '交付3项功能。'; f.business.riskFlags = []
  f.fit.links = [{ targetId: 'job:task:t1', status: 'transferable', evidenceIds: [f.business.evidenceId],
    similarity: '交付3项功能。', difference: '目标业务场景不同。', expressionAngle: '强调交付过程。' }]
  const input = { ...f, selectedEvidenceIds: new Set([f.business.evidenceId]) }
  expect(buildWritingIntents(input)[0].similarity).toBe('交付3项功能。')
  f.skill.verbatimText = '具有5年财务经验。'
  f.fit.links[0].similarity = '具有5年财务经验。'
  expect(buildWritingIntents(input)[0].similarity).toBe('')
})
