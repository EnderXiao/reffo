import { test, expect } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { buildWritingFact, inspectSupportedWriting, writingDisplayText } from '@/v5/writing/facts'
import { omitSplitQuantityTail } from '@/v5/writing/entries'

test('entry ability abstraction does not require repeating team words but keeps ownership and result checks', () => {
  const atom = createV5ResultFixture().resumeEvidenceBundle.evidenceAtoms.find(a => a.claimType === 'deliverable')!
  atom.riskFlags = ['team_attribution']
  atom.verbatimText = '参与团队需求分析和方案设计。'
  expect(inspectSupportedWriting('能够进行需求分析和方案设计。', [atom], 'skills[0]', true)).toEqual([])
  expect(inspectSupportedWriting('能够进行需求分析和方案设计。', [atom], 'skills[0]').some(i => i.code === 'WRITER_BOUNDARY_LOST')).toBe(true)
  for (const text of ['能够独立完成方案设计。', '主导需求分析和方案设计。', '具备交付30个功能的经验。']) {
    expect(inspectSupportedWriting(text, [atom], 'skills[0]', true).some(i => i.severity === 'error')).toBe(true)
  }
  expect(inspectSupportedWriting('能够进行需求分析和方案设计。', [atom], 'project.example.bullets[0]', true).some(i => i.code === 'WRITER_BOUNDARY_LOST')).toBe(true)
})

test('split quantity omission retains intact results and never promotes the following editorial clause', () => {
  const resume = createV5ResultFixture().resumeEvidenceBundle
  const atom = resume.evidenceAtoms.find(a => a.claimType === 'deliverable')!
  Object.assign(atom, { claimType: 'result', verbatimText: '数字化率100%；上线3个月累计查看20', riskFlags: [], sourceBlockId: 'B0090' })
  atom.sourceSpan = { start: 500, end: 500 + atom.verbatimText.length }
  resume.evidenceAtoms.push({ ...atom, evidenceId: 'unit-tail', sourceBlockId: 'B0091',
    verbatimText: '万+。不等同于激励效果。', sourceSpan: {start: atom.sourceSpan.end + 1, end: atom.sourceSpan.end + 15} })
  const before = structuredClone(resume)
  const fact = buildWritingFact(atom)!
  expect(omitSplitQuantityTail(fact, resume).text).toBe('数字化率100%')
  expect(omitSplitQuantityTail(fact, resume).protectedNumbers).toEqual(['100%'])
  expect(resume).toEqual(before)
  expect(fact.text).toContain('查看20')
  resume.evidenceAtoms.at(-1)!.sourceSpan.start = atom.sourceSpan.end + 2
  resume.evidenceAtoms.at(-1)!.riskFlags = ['uncertain']
  expect(omitSplitQuantityTail(fact, resume).text).toBe('数字化率100%')
  resume.evidenceAtoms.at(-1)!.sourceScopeId = 'unrelated'
  expect(omitSplitQuantityTail(fact, resume)).toEqual(fact)
  expect(inspectSupportedWriting('累计查看20次。', [atom], 'project.example.bullets[0]', true).some(i => i.code === 'WRITER_NUMBER_CHANGED')).toBe(true)
})

test('source labels are removed without dropping substantive qualifications', () => {
  expect(writingDisplayText('结果/边界个人简历自述：有效率95%；未验证。')).toBe('有效率95%；未验证。')
  expect(writingDisplayText('个人材料记录：团队完成研究，未上线。')).toBe('团队完成研究，未上线。')
})
