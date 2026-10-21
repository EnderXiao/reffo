import { describe, expect, test } from 'bun:test'
import { toInterviewPreparation } from '@/v5/main/compatibility'
import { interviewPreparationSchema } from '@/v5/schemas'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { validateInterviewPreparation } from '@/v5/validators'
import type { EvidenceAtom, InterviewPreparation } from '@/v5/types'

function fixture() {
  const result = createV5ResultFixture()
  const template = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  let offset = 100
  const lines: Array<[string, EvidenceAtom['claimType']]> = [
    ['体验反馈分诊项目', 'other'],
    ['问题：重复投诉影响用户使用，反馈需要归类。', 'other'],
    ['关键动作：参与归并反馈、拆分迭代优先级，与团队完成开发测试，功能已上线。', 'action'],
    ['结果/边界：团队交付反馈分诊功能，个人参与需求整理与测试，业务影响待核验。', 'result'],
    ['SQL告警排查项目', 'other'],
    ['问题：业务指标波动，需要核对统计口径。', 'other'],
    ['关键动作：使用SQL核对筛选条件，向业务方逐项确认异常来源。', 'action'],
    ['结果/边界：完成排查记录，指标波动的业务影响尚未确认。', 'result'],
  ]
  result.resumeEvidenceBundle.evidenceAtoms = lines.map(([text, claimType], index): EvidenceAtom => {
    const start = offset
    offset += text.length + 2
    return {
      ...template, evidenceId: `story-${index}`, sourceBlockId: `B${String(index + 1).padStart(4, '0')}`,
      sourceSpan: { start, end: start + text.length }, verbatimText: text, normalizedClaim: text,
      claimType, status: 'source_qualified', riskFlags: ['uncertain'], qualifiers: [], numericAtoms: [],
    }
  })
  const requirements = result.jobRequirementBundle.requirementAtoms.map(atom => atom.requirementId)
  const preparation: InterviewPreparation = {
    schemaVersion: '5.0.0',
    questions: (['core_task', 'project_deep_dive', 'gap_or_transfer', 'context_scenario'] as const).map(category => ({
      question: '请介绍反馈分诊项目中的参与范围与需求取舍。', category,
      relatedRequirementIds: requirements, relatedEvidenceIds: ['story-2'],
      preparationFocus: '准备反馈归类过程与本人参与的需求整理记录。', assumptionContextIds: [],
    })),
    storyRecommendations: [{
      title: '体验反馈分诊', scopeId: template.sourceScopeId, evidenceIds: ['story-1', 'story-2', 'story-3'],
      background: '参与处理重复投诉，将反馈整理成团队可执行的迭代需求。',
      knownResult: null, preparationGap: '准备上线记录，核实业务影响及本人参与的环节。',
      storytellingApproach: [
        '先从重复投诉对用户使用的影响切入，交代为什么反馈归类应先于直接增加功能。',
        '围绕归并反馈与拆分迭代优先级，说明自己参与需求整理和测试时做了哪些判断，以及怎样与团队确认取舍。',
        '以团队已交付的反馈分诊功能收束，区分个人参与和团队产出；对接岗位产品规划要求时，补备优先级讨论与上线记录，业务影响尚待核实。',
      ],
    }, {
      title: 'SQL告警排查', scopeId: template.sourceScopeId, evidenceIds: ['story-5', 'story-6', 'story-7'],
      background: '围绕指标波动核对筛选条件，并与业务方确认异常来源。',
      knownResult: null, preparationGap: '准备排查记录，补充口径核验依据与待确认的业务影响。',
      storytellingApproach: [
        '以指标波动引出的统计口径问题开场，解释为什么先检查筛选条件再判断业务变化。',
        '按SQL核对、异常来源确认的顺序展示排查过程，准备查询片段与业务方确认记录，回应岗位对SQL和数据分析的要求。',
        '以已完成的排查记录说明交付物，明确当前只能确认排查完成，不能把尚未确认的业务影响当作改进成果。',
        '为统计口径出现分歧的追问准备核验路径，说明如何复查筛选条件，并列出仍需业务方确认的信息。',
      ],
    }],
    followUpQuestions: ['产品规划的优先级由谁确认？', '数据分析成果如何验收？', '岗位如何分配团队与个人职责？'].map(question => ({
      question, purpose: '确认岗位实际工作机制。', relatedRequirementIds: requirements, assumptionContextIds: [],
    })),
  }
  const validate = () => validateInterviewPreparation({ preparation, artifact: result.artifact,
    resume: result.resumeEvidenceBundle, job: result.jobRequirementBundle, match: result.matchAnalysis })
  return { result, preparation, validate }
}

describe('P10 story-specific storytelling plans', () => {
  test('accepts distinct concrete plans in the model output schema and semantic validation', () => {
    const f = fixture(), before = structuredClone(f.preparation)
    expect(interviewPreparationSchema.safeParse(f.preparation).success).toBe(true)
    expect(f.validate().passed).toBe(true)
    expect(f.preparation).toEqual(before)
  })

  test('requires storytelling plans on every newly generated story', () => {
    const f = fixture()
    delete f.preparation.storyRecommendations[1]!.storytellingApproach
    const parsed = interviewPreparationSchema.safeParse(f.preparation)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({
      path: ['storyRecommendations', 1, 'storytellingApproach'],
    }))
  })

  test.each([
    { label: 'null', points: null },
    { label: 'empty list', points: [] },
    { label: 'only two steps', points: ['交代投诉背景。', '介绍反馈归类。'] },
    { label: 'more than five steps', points: Array.from({ length: 6 }, (_, index) => `准备第${index + 1}项材料。`) },
    { label: 'empty step', points: ['交代投诉背景。', '', '说明个人参与范围。'] },
    { label: 'whitespace-only step', points: ['交代投诉背景。', ' \n\t ', '说明个人参与范围。'] },
  ])('rejects invalid model plans: $label', ({ points }) => {
    const f = fixture()
    const candidate = { ...f.preparation, storyRecommendations: f.preparation.storyRecommendations.map((story, index) => (
      index === 0 ? { ...story, storytellingApproach: points } : story
    )) }
    expect(interviewPreparationSchema.safeParse(candidate).success).toBe(false)
  })

  test('accepts five substantive steps without truncation', () => {
    const f = fixture(), story = f.preparation.storyRecommendations[1]!
    story.storytellingApproach!.push('若被追问排查效率，先确认是否留存过程耗时，再决定是否使用量化表述。')
    expect(interviewPreparationSchema.parse(f.preparation).storyRecommendations[1]!.storytellingApproach)
      .toEqual(story.storytellingApproach!)
  })

  test('projects both model-authored plans verbatim without replacing them with reference templates', () => {
    const f = fixture(), before = structuredClone(f.preparation)
    const projected = toInterviewPreparation(f.preparation)
    expect(projected.story_recommendations.map(story => story.storytelling_approach))
      .toEqual(f.preparation.storyRecommendations.map(story => story.storytellingApproach!))
    expect(projected.story_recommendations[0]!.storytelling_approach)
      .not.toEqual(projected.story_recommendations[1]!.storytelling_approach)
    expect(f.preparation).toEqual(before)
  })

  test('keeps historical missing plans readable without fabricating a template', () => {
    const f = fixture()
    delete f.preparation.storyRecommendations[0]!.storytellingApproach
    const projected = toInterviewPreparation(f.preparation)
    expect(projected.story_recommendations[0]!.storytelling_approach).toEqual([])
    expect(projected.story_recommendations[1]!.storytelling_approach)
      .toEqual(f.preparation.storyRecommendations[1]!.storytellingApproach!)
    expect(f.validate().passed).toBe(true)
  })

  test('rejects a repeated step even when punctuation and whitespace differ', () => {
    const f = fixture(), story = f.preparation.storyRecommendations[0]!
    story.storytellingApproach![1] = ` ${story.storytellingApproach![0]!.replace('。', '！')} `
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_STORY_APPROACH_DUPLICATED', severity: 'error',
      outputPath: 'storyRecommendations[0].storytellingApproach',
    }))
  })

  test.each([false, true])('rejects a plan copied wholesale across different stories, reordered: %s', reverse => {
    const f = fixture(), plan = [...f.preparation.storyRecommendations[0]!.storytellingApproach!]
    f.preparation.storyRecommendations[1]!.storytellingApproach = reverse ? plan.reverse() : plan
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_STORY_APPROACH_DUPLICATED', severity: 'error',
      outputPath: 'storyRecommendations[1].storytellingApproach',
    }))
  })

  test.each([
    '从岗位描述中【负责产品规划与数据分析】对齐讲述重点，优先说明这段经历如何回应岗位要求。',
    '从源简历中【参与归并反馈】回到可核验事实，避免把岗位要求包装成自己已经做过的经历。',
    '从岗位描述中【引用内容】回应这项要求。',
  ])('rejects the observed fixed reference template as analysis: %s', template => {
    const f = fixture()
    f.preparation.storyRecommendations[0]!.storytellingApproach![0] = template
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_STORY_APPROACH_GENERIC', severity: 'error',
      outputPath: 'storyRecommendations[0].storytellingApproach',
    }))
  })

  test('rejects a storytelling step that changes a source-reported release into an unreleased plan', () => {
    const f = fixture()
    f.preparation.storyRecommendations[0]!.storytellingApproach![2] = '不能写成已经上线，只能写方案完成。'
    expect(f.validate().issues).toContainEqual(expect.objectContaining({
      code: 'INTERVIEW_DELIVERY_CONTRADICTION', severity: 'error',
      outputPath: 'storyRecommendations[0].storytellingApproach[2]',
    }))
  })

  test('allows a storytelling step that qualifies the proof without denying the source-reported release', () => {
    const f = fixture()
    f.preparation.storyRecommendations[0]!.storytellingApproach![2]
      = '以团队交付收束；上线来自简历自述，需另备上线记录，同时明确本人只参与需求整理与测试。'
    expect(f.validate().passed).toBe(true)
  })
})
