import type {ProcessResult} from '@/types'
import {
  buildGapViewItems,
  buildOptimizationStrategyViewItems,
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

  test('falls back to legacy matching strings before generic analysis strings', () => {
    const result = buildResult()
    result.matching.weakness_details = []
    result.matching.optimization_strategy_details = []

    expect(buildGapViewItems(result)[0]?.title).toBe('岗位匹配摘要')
    expect(buildOptimizationStrategyViewItems(result)[0]).toMatchObject({
      strategyPoint: '旧版策略摘要',
      structured: false,
    })
  })
})
