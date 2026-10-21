import { describe, expect, test } from 'bun:test'
import { deriveInterviewCaseGroups } from '@/v5/interview-source-structure'
import { buildInterviewContext } from '@/v5/interview-context'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { validateInterviewPreparation } from '@/v5/validators'
import type { EvidenceAtom, InterviewPreparation } from '@/v5/types'

function fixture() {
  const result = createV5ResultFixture()
  const template = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  let offset = 100
  const lines: Array<[string, EvidenceAtom['claimType']]> = [
    ['任务平台重构方案', 'deliverable'], ['问题：规则交叉影响执行。', 'other'], ['关键动作：拆分审批与验收。', 'action'],
    ['结果/边界：已完成原型，待立项。', 'result'], ['激励关系治理规划', 'other'], ['问题：结算依赖人工。', 'other'],
    ['关键动作：统一指标与结算关系。', 'action'], ['结果/边界：分析规划交付，主导程度待确认。', 'result'],
  ]
  const atoms = lines.map(([text, claimType], index): EvidenceAtom => {
    const start = offset; offset += text.length + 2
    return { ...template, evidenceId: `case-${index}`, sourceBlockId: `B${String(index + 1).padStart(4, '0')}`,
      sourceSpan: { start, end: start + text.length }, verbatimText: text, claimType, status: 'source_qualified', riskFlags: ['uncertain'] }
  })
  result.resumeEvidenceBundle.evidenceAtoms = atoms
  result.artifact.claims = [{ ...result.artifact.claims.find(claim => !claim.outputPath.startsWith('identity'))!, evidenceIds: ['case-2', 'case-6'] }]
  const preparation: InterviewPreparation = { schemaVersion: '5.0.0', followUpQuestions: [], questions: [{
    question: '在任务平台重构中，如何统一审批与激励关系？', category: 'project_deep_dive',
    relatedEvidenceIds: ['case-2', 'case-6'], relatedRequirementIds: [], assumptionContextIds: [], preparationFocus: '说明取舍。',
  }], storyRecommendations: [{ title: '任务平台重构', scopeId: template.sourceScopeId, evidenceIds: ['case-2', 'case-6'],
    background: '拆分审批，统一激励关系。', knownResult: null, preparationGap: '准备已确认反馈。' }] }
  const validate = () => validateInterviewPreparation({ preparation, artifact: result.artifact,
    resume: result.resumeEvidenceBundle, job: result.jobRequirementBundle, match: result.matchAnalysis })
  return { result, atoms, preparation, validate }
}

describe('P10 proven source case boundaries', () => {
  test('separates explicit adjacent cases even when both belong to the same employer scope', () => {
    const f = fixture(), groups = deriveInterviewCaseGroups(f.result.resumeEvidenceBundle)
    expect(groups.map(group => group.title)).toEqual(['任务平台重构方案', '激励关系治理规划'])
    expect(groups[0]!.evidenceIds).toEqual(['case-0', 'case-1', 'case-2', 'case-3'])
    expect(groups[1]!.evidenceIds).toEqual(['case-4', 'case-5', 'case-6', 'case-7'])
    expect(f.validate().issues.filter(issue => issue.code === 'INTERVIEW_CASE_GROUP_MIXED').map(issue => issue.outputPath))
      .toEqual(['questions[0].question', 'storyRecommendations[0]'])
  })

  test('allows an explicit comparison question and a story restricted to its own case', () => {
    const f = fixture()
    f.preparation.questions[0]!.question = '请分别介绍任务平台重构和激励关系治理，并对比取舍。'
    f.preparation.storyRecommendations[0]!.evidenceIds = ['case-2', 'case-3']
    expect(f.validate().passed).toBe(true)
  })

  test('selects original case titles and exposes an unambiguous group for each selected fact', () => {
    const f = fixture(), context = buildInterviewContext(f.result)
    expect(context.resumeEvidenceBundle.caseGroups.map(group => group.title)).toEqual(['任务平台重构方案', '激励关系治理规划'])
    const first = context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === 'case-2')!
    const second = context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === 'case-6')!
    expect(first.caseGroupId).not.toBe(second.caseGroupId)
    expect(first.caseTitle).toBe('任务平台重构方案')
    expect(context.resumeEvidenceBundle.evidenceAtoms.some(atom => atom.evidenceId === 'case-0')).toBe(true)
    expect(context.resumeEvidenceBundle.evidenceAtoms.some(atom => atom.evidenceId === 'case-4')).toBe(true)
    expect(context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === 'case-1')?.verbatimText)
      .toBe('问题：规则交叉影响执行。')
    expect(context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === 'case-5')?.verbatimText)
      .toBe('问题：结算依赖人工。')
  })

  test('does not infer a case across missing source blocks or distant source spans', () => {
    const f = fixture()
    f.atoms[2]!.sourceBlockId = 'B0099'
    f.atoms[6]!.sourceSpan.start += 20
    expect(deriveInterviewCaseGroups(f.result.resumeEvidenceBundle)).toEqual([])
  })

  test('does not invent project boundaries from ordinary prose or incomplete case cards', () => {
    const f = fixture()
    f.atoms[1]!.verbatimText = '背景：规则交叉影响执行。'
    f.atoms[7]!.verbatimText = '进一步分析规划。'
    expect(deriveInterviewCaseGroups(f.result.resumeEvidenceBundle)).toEqual([])
    expect(f.validate().passed).toBe(true)
  })
})
