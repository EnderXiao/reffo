import { describe, expect, test } from 'bun:test'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { interviewPreparationSchema } from '@/v5/schemas'
import { deriveInterviewCaseGroups } from '@/v5/interview-source-structure'
import { createHistoricalV5ResultWithInterviewPreparation } from '@/v5/tests/fixtures'
import { validateInterviewPreparation } from '@/v5/validators'

function fixture() {
  const result = createHistoricalV5ResultWithInterviewPreparation()
  const preparation = result.interviewPreparation!
  const story = preparation.storyRecommendations[0]!
  story.storytellingApproach = ['围绕产品交付背景说明本人职责。', '按已有需求整理与交付记录准备实际动作。', '区分团队交付和个人贡献，准备当前证据未说明的效果口径。']
  story.requirementLinks = [{
    requirementId: result.jobRequirementBundle.requirementAtoms[0]!.requirementId,
    evidenceIds: [...story.evidenceIds],
    focus: '围绕需求整理与交付记录，说明产品规划判断及本人贡献。',
  }]
  const validate = () => validateInterviewPreparation({ preparation, artifact: result.artifact,
    resume: result.resumeEvidenceBundle, job: result.jobRequirementBundle, match: result.matchAnalysis })
  return { result, preparation, story, validate }
}

describe('explicit interview story requirement links', () => {
  test('requires the link field for newly generated stories and permits no reliable link', () => {
    const f = fixture()
    expect(interviewPreparationSchema.safeParse(f.preparation).success).toBe(true)
    f.story.requirementLinks = []
    expect(interviewPreparationSchema.safeParse(f.preparation).success).toBe(true)
    delete f.story.requirementLinks
    const parsed = interviewPreparationSchema.safeParse(f.preparation)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({
      path: ['storyRecommendations', 0, 'requirementLinks'],
    }))
  })

  test('accepts an explicit supported link without mutating its source contract', () => {
    const f = fixture(), before = structuredClone(f.preparation)
    expect(f.validate().passed).toBe(true)
    expect(f.preparation).toEqual(before)
  })

  test('keeps stored historical stories readable without inferring links', () => {
    const f = fixture()
    delete f.story.requirementLinks
    expect(f.validate().passed).toBe(true)
    expect(f.story.requirementLinks).toBeUndefined()
  })

  test('rejects an unknown requirement rather than expanding by evidence overlap', () => {
    const f = fixture()
    f.story.requirementLinks![0]!.requirementId = 'unknown-requirement'
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INVALID_INTERVIEW_REFERENCE', requirementIds: ['unknown-requirement'],
      outputPath: 'storyRecommendations[0].requirementLinks[0]', severity: 'error',
    }))
  })

  test('rejects valid global evidence that the selected story did not cite', () => {
    const f = fixture()
    const original = f.result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === f.story.evidenceIds[0])!
    f.result.resumeEvidenceBundle.evidenceAtoms.push({ ...structuredClone(original), evidenceId: 'other-story-evidence' })
    f.story.requirementLinks![0]!.evidenceIds = ['other-story-evidence']
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_REQUIREMENT_LINK_EVIDENCE_MISMATCH', evidenceIds: ['other-story-evidence'], severity: 'error',
    }))
  })

  test('rejects excluded evidence even if a stored story still cites it', () => {
    const f = fixture(), id = f.story.evidenceIds[0]!
    f.result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === id)!.status = 'excluded'
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INVALID_INTERVIEW_REFERENCE', outputPath: 'storyRecommendations[0].requirementLinks[0]',
      evidenceIds: [id], severity: 'error',
    }))
  })

  test('rejects a cross-scope link even when included in an invalid story', () => {
    const f = fixture(), id = f.story.evidenceIds[0]!
    f.result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === id)!.sourceScopeId = 'other-scope'
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_REQUIREMENT_LINK_EVIDENCE_MISMATCH', severity: 'error',
    }))
  })

  test('allows title and stage context in one case but rejects a neighboring case in the same scope', () => {
    const f = fixture()
    const template = f.result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === f.story.evidenceIds[0])!
    let offset = 5000
    const lines = ['反馈分诊项目', '研究与方向形成阶段', 'C | 研究阶段', '问题：重复反馈需要归类。',
      '关键动作：参与归并反馈并形成研究材料。', '结果/边界：形成研究报告，尚未上线。',
      '告警排查项目', '研究与方向形成阶段', 'C | 研究阶段', '问题：指标异常需要定位。',
      '关键动作：核查查询条件。', '结果/边界：形成排查记录，业务影响待确认。']
    const atoms = lines.map((text, index) => {
      const start = offset
      offset += text.length + 2
      return { ...structuredClone(template), evidenceId: `case-link-${index}`, sourceBlockId: `B${String(index + 100).padStart(4, '0')}`,
        sourceSpan: { start, end: start + text.length }, verbatimText: text, normalizedClaim: text,
        claimType: 'other' as const, qualifiers: [], numericAtoms: [], riskFlags: [] }
    })
    f.result.resumeEvidenceBundle.evidenceAtoms.push(...atoms)
    expect(deriveInterviewCaseGroups(f.result.resumeEvidenceBundle).filter(group => group.title.includes('项目'))).toHaveLength(2)
    f.story.evidenceIds = atoms.slice(0, 6).map(atom => atom.evidenceId)
    f.story.requirementLinks![0]!.evidenceIds = [...f.story.evidenceIds]
    expect(f.validate().passed).toBe(true)
    f.story.evidenceIds.push(atoms[10]!.evidenceId)
    f.story.requirementLinks![0]!.evidenceIds.push(atoms[10]!.evidenceId)
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_REQUIREMENT_LINK_EVIDENCE_MISMATCH', severity: 'error',
    }))
  })

  test('merges repeated links to the same requirement rather than displaying it twice', () => {
    const f = fixture()
    f.story.requirementLinks!.push(structuredClone(f.story.requirementLinks![0]!))
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_REQUIREMENT_LINK_DUPLICATED', outputPath: 'storyRecommendations[0].requirementLinks[1]', severity: 'error',
    }))
  })

  test.each(['empty evidence', 'empty focus'])('rejects an incomplete explicit relation: %s', missing => {
    const f = fixture()
    if (missing === 'empty evidence') f.story.requirementLinks![0]!.evidenceIds = []
    else f.story.requirementLinks![0]!.focus = '  '
    expect(interviewPreparationSchema.safeParse(f.preparation).success).toBe(false)
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_REQUIREMENT_LINK_INCOMPLETE', severity: 'error',
    }))
  })

  test('P10 and repair use the same explicit association and selective-topic contract', () => {
    for (const component of ['P10', 'P10R'] as const) {
      const compiled = compileV5Prompt({ component, envelope: { payload: {} } })
      expect(compiled.promptVersion).toContain('interview-links-v5-r14')
      const prompt = compiled.messages.map(message => message.content).join('\n')
      expect(prompt).toContain('requirementLinks')
      expect(prompt).toContain('不按证据交集、同公司或 actionIds 扩散岗位关联')
      expect(prompt).toContain('不是必须逐项展示的清单')
      expect(prompt).not.toContain('未入选故事的主题仍由系统独立展示')
    }
  })
})
