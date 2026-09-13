import { describe, expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { validateInterviewPreparation } from '@/v5/validators'
import type { EvidenceAtom, InterviewPreparation } from '@/v5/types'

function fixture(action = '关键动作：开展灰度和A/B测试，根据反馈调整语音逻辑并全国推送。') {
  const result = createV5ResultFixture()
  const template = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  let offset = 100
  const lines: Array<[string, EvidenceAtom['claimType']]> = [
    ['一线服务语音播报项目', 'other'], ['PRD已交叉验证部分需求分析与方案', 'other'],
    ['问题：一线员工需要统一服务提醒。', 'other'], [action, 'action'],
    ['结果/边界：简历自述效果仍需核验。', 'result'],
  ]
  const atoms = lines.map(([text, claimType], index): EvidenceAtom => {
    const start = offset; offset += text.length + 2
    return { ...template, evidenceId: `delivery-${index}`, sourceBlockId: `B${String(index + 1).padStart(4, '0')}`,
      sourceSpan: { start, end: start + text.length }, verbatimText: text, normalizedClaim: text,
      claimType, status: 'source_qualified', riskFlags: ['uncertain'], qualifiers: [] }
  })
  result.resumeEvidenceBundle.evidenceAtoms = atoms
  const preparation: InterviewPreparation = { schemaVersion: '5.0.0', questions: [], followUpQuestions: [], storyRecommendations: [{
    title: '一线服务语音播报项目', scopeId: template.sourceScopeId, evidenceIds: ['delivery-1', 'delivery-3'],
    background: '说明需求分析与方案验证的过程。', knownResult: null,
    preparationGap: 'PRD仅交叉验证部分需求分析与方案，不写成已完成开发上线。',
  }] }
  const validate = () => validateInterviewPreparation({ preparation, artifact: result.artifact,
    resume: result.resumeEvidenceBundle, job: result.jobRequirementBundle, match: result.matchAnalysis })
  return { result, template, atoms, preparation, validate }
}

describe('P10 source-bound delivery status', () => {
  test('rejects the real partial-PRD-proof to no-release inference without rewriting the output', () => {
    const f = fixture(), before = structuredClone(f.preparation)
    const checked = f.validate()
    expect(checked.passed).toBe(false)
    expect(checked.issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_DELIVERY_CONTRADICTION', severity: 'error', outputPath: 'storyRecommendations[0].preparationGap',
    }))
    expect(f.preparation).toEqual(before)
  })

  test.each([
    '全国推送来自简历自述，PRD仅佐证需求方案，需另备推送记录。',
    '不能声称由PRD证明上线；全国推送来自简历自述，需补充上线记录。',
    'PRD仅交叉验证需求与方案，不能仅凭PRD声称已完成开发上线；请另备推送记录。',
    '不能把佐证范围有限理解为未上线；全国推送来自简历自述，需补充记录核验。',
  ])('preserves source-specific qualification instead of treating it as a denial: %s', gap => {
    const f = fixture()
    f.preparation.storyRecommendations[0]!.preparationGap = gap
    expect(f.validate().passed).toBe(true)
  })

  test.each([
    '关键动作：完成方案，计划全国推送。',
    '关键动作：方案与原型已完成，待立项，尚未开发上线。',
    '关键动作：开展内部测试，尚未上线。',
  ])('allows the source-declared planned or unlaunched boundary: %s', action => {
    const f = fixture(action)
    expect(f.validate().passed).toBe(true)
  })

  test('does not use a different case in the same employment scope to infer this case was released', () => {
    const f = fixture('关键动作：方案与原型已完成，待立项。')
    let offset = f.atoms.at(-1)!.sourceSpan.end + 2
    const lines: Array<[string, EvidenceAtom['claimType']]> = [
      ['会员服务功能发布项目', 'other'], ['问题：用户操作复杂。', 'other'],
      ['关键动作：完成开发测试并全国推送。', 'action'], ['结果/边界：功能已上线。', 'result'],
    ]
    const additional = lines.map(([text, claimType], index): EvidenceAtom => {
      const start = offset; offset += text.length + 2
      return { ...f.template, evidenceId: `other-delivery-${index}`, sourceBlockId: `B${String(index + 6).padStart(4, '0')}`,
        sourceSpan: { start, end: start + text.length }, verbatimText: text, normalizedClaim: text,
        claimType, status: 'source_qualified', riskFlags: ['uncertain'], qualifiers: [] }
    })
    f.result.resumeEvidenceBundle.evidenceAtoms.push(...additional)
    expect(f.validate().passed).toBe(true)
  })

  test('retains a qualified outcome after a scope-local source explicitly reports release', () => {
    const f = fixture('关键动作：完成开发测试，功能已上线。')
    f.preparation.storyRecommendations[0]!.preparationGap = '不能写成已经上线，只能写方案完成。'
    expect(f.validate().issues.map(issue => issue.code)).toContain('INTERVIEW_DELIVERY_CONTRADICTION')
  })
})
