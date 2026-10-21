import { describe, expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { validateInterviewPreparation } from '@/v5/validators'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import type { InterviewPreparation } from '@/v5/types'

function fixture(question: string, source = '参与团队需求分析与方案交付。') {
  const result = createV5ResultFixture()
  const atom = result.resumeEvidenceBundle.evidenceAtoms.find(item => item.claimType === 'deliverable')!
  Object.assign(atom, { verbatimText: source, status: 'source_supported', riskFlags: [] })
  const requirement = result.jobRequirementBundle.requirementAtoms[0]
  const match = result.matchAnalysis.requirementMatches.find(item => item.requirementId === requirement.requirementId)!
  Object.assign(match, { status: 'currently_unproven', evidenceIds: [] })
  const preparation: InterviewPreparation = { schemaVersion: '5.0.0', storyRecommendations: [], followUpQuestions: [], questions: [{
    question, category: 'gap_or_transfer', relatedRequirementIds: [requirement.requirementId],
    relatedEvidenceIds: [atom.evidenceId], preparationFocus: '核对职责边界。', assumptionContextIds: [],
  }] }
  const validate = () => validateInterviewPreparation({ preparation, artifact: result.artifact, resume: result.resumeEvidenceBundle,
    job: result.jobRequirementBundle, match: result.matchAnalysis })
  return { atom, preparation, validate }
}

describe('P10 source-backed negative premises', () => {
  test.each([
    '你的材料显示主导研究与协同推进。请说明在没有团队管理职责的情况下，你如何推动跨角色协作？',
    '你没有产品管理经验，如何适应该岗位？',
    '你从未负责过产品线，准备如何适应？',
    '在缺乏增长经验的情况下，你会如何开展工作？',
    '你未曾承担团队管理职责，如何推进合作？',
  ])('rejects absence-of-evidence as a candidate fact: %s', question => {
    const f = fixture(question), before = structuredClone(f.preparation)
    const checked = f.validate()
    expect(checked.passed).toBe(false)
    expect(checked.issues).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_INTERVIEW_NEGATIVE_PREMISE', severity: 'error', outputPath: 'questions[0].question',
    }))
    expect(f.preparation).toEqual(before)
  })

  test.each([
    '材料尚未说明团队管理职责，请说明是否承担及职责边界？',
    '材料没有提供团队管理经验，请说明你实际承担的职责。',
    '假设你没有团队管理职责，如何推动跨角色协作？',
    '如果未来负责新的领域，而你没有管理经验，你如何补齐？',
    '若没有团队管理职责，你将如何推动跨角色合作？',
    '不能据此断言你没有团队管理经验，请介绍你的实际职责。',
  ])('preserves uncertainty, document limits and explicit hypothetical questions: %s', question => {
    expect(fixture(question).validate().passed).toBe(true)
  })

  test.each([
    ['我没有团队管理职责。', '在没有团队管理职责的情况下，你如何推进合作？'],
    ['我从未负责过产品线。', '你没有产品线经验，如何准备迁移？'],
    ['此前缺乏增长经验。', '在缺乏增长经验的情况下，你如何开展工作？'],
  ])('retains an actual source-declared limitation: %s', (source, question) => {
    expect(fixture(question, source).validate().passed).toBe(true)
  })

  test.each([
    '我没有SQL经验。',
    '不能据此断言我没有团队管理职责。',
    '如果没有团队管理职责，应通过协作推进。',
    '材料没有提供团队管理职责。',
  ])('does not borrow an unrelated, hypothetical or negated limitation: %s', source => {
    expect(fixture('在没有团队管理职责的情况下，你如何推进合作？', source).validate().passed).toBe(false)
  })

  test('does not treat an uncertain source statement as an established absence', () => {
    const f = fixture('在没有团队管理职责的情况下，你如何推进合作？', '没有团队管理职责。')
    f.atom.riskFlags = ['uncertain']
    expect(f.validate().passed).toBe(false)
  })

  test('corrected question passes the same validator without rewriting source facts', () => {
    const f = fixture('在没有团队管理职责的情况下，你如何推进合作？')
    expect(f.validate().passed).toBe(false)
    f.preparation.questions[0].question = '材料尚未明确团队管理职责，请说明是否承担及实际职责边界？'
    expect(f.validate().passed).toBe(true)
    expect(compileV5Prompt({ component: 'P10', envelope: { payload: {} } }).promptVersion).toBe('5.0.0-p10-interview-preparation-r9')
    const repair = compileV5Prompt({ component: 'P10R', envelope: { payload: {} } })
    expect(repair.promptVersion).toBe('5.0.0-p10r-interview-repair-r9')
    expect(repair.messages[0].content).toContain('UNSUPPORTED_INTERVIEW_NEGATIVE_PREMISE')
  })
})
