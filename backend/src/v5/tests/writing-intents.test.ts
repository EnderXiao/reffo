import { describe, expect, test } from 'bun:test'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { buildWritingIntents } from '@/v5/writing/intents'

function fixture() {
  const t = createTargetingFixture()
  t.business.riskFlags = []
  t.fit.narratives = []
  t.fit.links = [{ targetId: 'job:task:t1', status: 'weak_signal', evidenceIds: [t.business.evidenceId],
    similarity: '有产品设计实践。', difference: '未证明模型评估。', expressionAngle: '突出已做的方案设计，不扩展为模型评估。' }]
  return { ...t, selectedEvidenceIds: new Set([t.business.evidenceId]) }
}

describe('writing value independent of complete qualification', () => {
  test('preserves concrete partial practice without restoring unsafe narratives or upgrading status', () => {
    const input = fixture(), before = structuredClone(input)
    const result = buildWritingIntents(input)
    expect(result).toHaveLength(1)
    expect(result[0].selectionBasis).toBe('partial_practice')
    expect(result[0].expressionAngle).toContain('方案设计')
    expect(result[0].difference).toBe('未证明模型评估。')
    expect(input).toEqual(before)
  })
  test.each(['self_assessment', 'skill', 'excluded', 'unknown_target', 'unknown_link', 'unselected'])(
    'does not create an experience from %s', mutation => {
      const input = fixture()
      if (mutation === 'self_assessment') input.business.riskFlags = ['self_assessment_only']
      if (mutation === 'skill') input.business.claimType = 'skill'
      if (mutation === 'excluded') input.business.status = 'excluded'
      if (mutation === 'unknown_target') input.fit.links[0].targetId = 'unknown'
      if (mutation === 'unknown_link') input.fit.links[0].status = 'unknown'
      if (mutation === 'unselected') input.selectedEvidenceIds.clear()
      expect(buildWritingIntents(input)).toEqual([])
    })
  test('keeps selected practice but does not inherit prose supported by a removed fact', () => {
    const input = fixture()
    input.fit.links[0].evidenceIds.push(input.skill.evidenceId)
    input.fit.links[0].expressionAngle = '完整掌握SQL和模型评估'
    const result = buildWritingIntents(input)
    expect(result[0].evidenceIds).toEqual([input.business.evidenceId])
    expect(result[0].similarity).toBe('')
    expect(result[0].expressionAngle).toBe('')
    expect(result[0].difference).toContain('不继承')
  })
  test('deduplicates repeated task/attribute guidance without losing target references', () => {
    const input = fixture()
    input.fit.links.push({ ...input.fit.links[0], targetId: 'job:condition:c1' })
    const result = buildWritingIntents(input)
    expect(result).toHaveLength(1)
    expect(result[0].targetIds).toEqual(['job:task:t1', 'job:condition:c1'])
  })
})
