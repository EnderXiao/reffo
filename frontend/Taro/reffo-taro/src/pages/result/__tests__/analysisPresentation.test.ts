import type {ProcessResult} from '@/types'
import {resumeTextFingerprint} from '@/shared/resume-strategy'
import {buildInterviewStoryViewItems} from '../model/interviewReferences'
import {
  buildGapViewItems,
  buildOptimizationStrategyViewItems,
  selectGapPreview,
  findResumeReferenceLines,
  hasStaleStrategyReview,
  representativeStrategyReference,
} from '../model/analysisPresentation'

function buildResult(): ProcessResult {
  return {
    analysis: {
      quality_score: 78,
      strengths: [],
      weaknesses: ['通用简历问题'],
      suggestions: [],
      capability_summary: '',
      structured_resume: {
        personal_info: {name: '张三'},
        education: [],
        experience: [],
        projects: [],
        skills: {hard_skills: [], soft_skills: []},
      },
    },
    matching: {
      match_score: 80,
      hard_requirements_match: [],
      skill_match: {matched_skills: [], missing_skills: [], match_percentage: 80},
      experience_match: {
        years_required: 0,
        years_actual: 0,
        relevant_experience: [],
        match_percentage: 80,
      },
      weaknesses: ['岗位匹配摘要'],
      weakness_details: [{
        id: 'G1',
        priority: 'high',
        weakness: '调研证据没有对齐岗位要求',
        evidence_type: 'wording_gap',
        jd_requirement: '负责用户调研',
        evidence: '源简历已有用户调研事实。',
        impact: '招聘方难以快速识别。',
        suggestion: '前置调研对象和产出。',
      }],
      optimization_suggestions: ['旧版策略摘要'],
      optimization_strategy_details: [{
        id: 'S1',
        related_gap_ids: ['G1'],
        strategy_point: '前置用户调研证据',
        rationale: '直接回应岗位的调研优先级。',
        optimization_example: {
          source_path: 'experience[0].responsibilities[0]',
          source_quote: '负责用户调研和方案落地',
          optimized_content: '围绕用户调研推进方案落地。',
        },
      }],
      jd_structure: undefined,
    },
    optimized: {optimized_resume: '', changes_summary: [], improvement_score: 0},
    interview: {questions: [], story_recommendations: [], follow_up_questions: []},
  }
}

describe('analysis presentation', () => {
  test('preserves generated storytelling points alongside source references', () => {
    const result = buildResult()
    result.interview.story_recommendations = [{
      title: '用户调研', background: '负责用户调研', result: '推进方案落地',
      storytelling_approach: ['  先说明调研背景  ', '说明本人负责的工作', ''],
    }]
    const [story] = buildInterviewStoryViewItems(result, '负责用户调研和方案落地', '岗位要求用户调研')
    expect(story.storytellingApproach).toEqual(['先说明调研背景', '说明本人负责的工作'])
    expect(story.resumeQuote).toBe('负责用户调研和方案落地')
    expect(story.jdQuote).toBe('岗位要求用户调研')
  })

  test('keeps source references when historical interview data has no storytelling points', () => {
    const result = buildResult()
    result.interview.story_recommendations = [{
      title: '用户调研', background: '负责用户调研', result: '推进方案落地',
      storytelling_approach: [],
    }]
    const [story] = buildInterviewStoryViewItems(result, '负责用户调研和方案落地', '岗位要求用户调研')
    expect(story.storytellingApproach).toEqual([])
    expect(story.resumeQuote).toBeTruthy()
    expect(story.jdQuote).toBeTruthy()
  })

  test('does not create generic stories when recommendations have not been generated', () => {
    expect(buildInterviewStoryViewItems(buildResult(), '负责用户调研和方案落地', '岗位要求用户调研')).toEqual([])
  })

  test('uses JD-specific structured gaps instead of generic resume weaknesses', () => {
    const gaps = buildGapViewItems(buildResult())

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({
      id: 'G1',
      title: '调研证据没有对齐岗位要求',
      jdRequirement: '负责用户调研',
      priority: 'high',
    })
  })

  test('必要条件全部常驻，普通项默认三条且不修改原始次序', () => {
    const result = buildResult()
    const base = result.matching.weakness_details![0]
    result.matching.weakness_details = Array.from({length: 7}, (_, index) => ({
      ...base, id: `G${index}`, priority: 'medium', is_required: index >= 3,
    }))
    const gaps = buildGapViewItems(result, Infinity)
    expect(selectGapPreview(gaps).map(item => item.id)).toEqual(['G3', 'G4', 'G5', 'G6'])
    expect(gaps.map(item => item.id)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'])
    expect(selectGapPreview(gaps, Infinity)).toHaveLength(7)
  })

  test('旧记录的高优先项不折叠，明确非必要的普通高优先项仍可收起', () => {
    const result = buildResult()
    const base = result.matching.weakness_details![0]
    result.matching.weakness_details = Array.from({length: 5}, (_, index) => ({...base, id: `G${index}`}))
    expect(selectGapPreview(buildGapViewItems(result, Infinity))).toHaveLength(5)
    result.matching.weakness_details = result.matching.weakness_details.map(item => ({...item, is_required: false}))
    expect(selectGapPreview(buildGapViewItems(result, Infinity))).toHaveLength(3)
  })

  test('keeps strategy explanation and exact before-after example together', () => {
    const strategies = buildOptimizationStrategyViewItems(buildResult())

    expect(strategies[0]).toMatchObject({
      strategyPoint: '前置用户调研证据',
      rationale: '直接回应岗位的调研优先级。',
      sourceQuote: '负责用户调研和方案落地',
      optimizedContent: '围绕用户调研推进方案落地。',
      structured: true,
    })
  })

  test('falls back to legacy matching strings', () => {
    const result = buildResult()
    result.matching.weakness_details = []
    result.matching.optimization_strategy_details = []

    expect(buildGapViewItems(result)[0]?.title).toBe('岗位匹配摘要')
    expect(buildOptimizationStrategyViewItems(result)[0]).toMatchObject({
      strategyPoint: '旧版策略摘要',
      structured: false,
    })
  })

  test('never substitutes resume quality weaknesses for missing job gaps', () => {
    const result = buildResult()
    result.matching.weakness_details = []
    result.matching.weaknesses = []
    expect(buildGapViewItems(result)).toEqual([])
  })

  test('allows H5 to show every gap and strategy without silent truncation', () => {
    const result = buildResult()
    result.matching.weakness_details = []
    result.matching.optimization_strategy_details = []
    result.matching.weaknesses = Array.from({length: 7}, (_, i) => `差距${i + 1}`)
    result.matching.optimization_suggestions = Array.from({length: 7}, (_, i) => `策略${i + 1}`)
    expect(buildGapViewItems(result, Infinity)).toHaveLength(7)
    expect(buildOptimizationStrategyViewItems(result, Infinity)).toHaveLength(7)
  })
})

describe('strategy outcome presentation', () => {
  test('只关联相同策略ID的当前说明，已对应正文的策略优先展示', () => {
    const result = buildResult()
    const detail = result.matching.optimization_strategy_details![0]
    result.matching.optimization_strategy_details = [2, 3, 4, 5].map(index => ({...detail, id: `S${index}`})).concat(detail)
    result.optimized.optimized_resume = '# 张三\n- 围绕用户调研推进方案落地。'
    result.optimized.strategy_review = {
      version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(result.optimized.optimized_resume),
      items: [{strategyId: 'S1', strategy: '前置用户调研', status: 'linked', explanation: '项目经历保留调研与交付事实。',
        references: [{outputPath: 'projects[0]', location: '项目经历', quote: '围绕用户调研推进方案落地。'}]}],
    }
    const items = buildOptimizationStrategyViewItems(result)
    expect(items).toHaveLength(4)
    expect(items[0].id).toBe('S1')
    expect(items[0].outcome?.status).toBe('linked')
    expect(items[1].outcome).toBeUndefined()
    expect(representativeStrategyReference(items[0].outcome, result.optimized.optimized_resume)?.location).toBe('项目经历')
    result.optimized.optimized_resume += '\n手动补充'
    expect(hasStaleStrategyReview(result)).toBe(true)
    expect(buildOptimizationStrategyViewItems(result).every(item => !item.outcome)).toBe(true)
  })

  test('只定位唯一的原句，跨行可定位，空白、不存在或多处命中均不猜测', () => {
    expect(findResumeReferenceLines('# 简历\n- 调研\n- 交付', '调研\n- 交付')).toEqual({start: 1, end: 2})
    expect(findResumeReferenceLines('参与调研\n参与调研', '参与调研')).toBeUndefined()
    expect(findResumeReferenceLines('参与調研', '参与调研')).toBeUndefined()
    expect(findResumeReferenceLines('正文', ' ')).toBeUndefined()
  })

  test('建议示例和未选入策略都不能成为生成正文引用', () => {
    const result = buildResult()
    expect(representativeStrategyReference(buildOptimizationStrategyViewItems(result)[0].outcome, '围绕用户调研推进方案落地。')).toBeUndefined()
    expect(representativeStrategyReference({strategyId: 'S1', strategy: '建议', status: 'not_selected', explanation: '',
      references: [{outputPath: 'projects[0]', location: '项目经历', quote: '正文'}]}, '正文')).toBeUndefined()
  })
})
