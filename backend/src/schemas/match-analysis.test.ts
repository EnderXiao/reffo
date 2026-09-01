import { describe, expect, test } from 'bun:test'
import { jdStructureSchema, matchAnalysisOutputSchema } from '@/schemas/match-analysis'

describe('final prompt response schemas', () => {
  test('adds safe defaults for context fields to legacy JD output', () => {
    const parsed = jdStructureSchema.parse({
      basic_info: { title: '产品经理' },
      hard_requirements: { required_skills: [] },
      responsibilities: [],
      tasks: [],
      soft_skills: [],
      nice_to_have: [],
    })

    expect(parsed.requirement_hierarchy).toEqual({
      must_have: [],
      core_outcomes: [],
      differentiators: [],
    })
    expect(parsed.company_context.confidence).toBe('unknown')
    expect(parsed.location_context.confidence).toBe('unknown')
    expect(parsed.uncertainties).toEqual([])
  })

  test('normalizes structured gaps and derives legacy strategy summaries', () => {
    const parsed = matchAnalysisOutputSchema.parse({
      match_score: 80,
      hard_requirements_match: {},
      skill_match: { matched: [], missing: [] },
      experience_match: '有相关经历',
      soft_skills_match: '',
      strengths: [],
      weakness_details: [{
        id: 'G1',
        priority: 'high',
        weakness: '用户调研证据未按 JD 优先级呈现',
        evidence_type: 'wording_gap',
        jd_requirement: '负责用户调研和需求分析',
        evidence: '源简历已有用户调研经历，但表达较泛。',
        impact: '关键能力不容易被快速识别。',
        suggestion: '前置用户调研的对象和产出。',
      }],
      positioning_strategy: '突出可迁移能力',
      optimization_strategy_details: [{
        id: 'S1',
        related_gap_ids: ['G1'],
        strategy_point: '前置用户调研证据',
        rationale: '直接回应 JD 的用户调研优先级。',
        optimization_example: {
          source_path: 'experience[0].responsibilities[0]',
          source_quote: '负责用户调研和方案落地',
          optimized_content: '围绕用户调研推进方案落地。',
        },
      }],
      context_fit: {
        company_alignment: '需面试确认',
        location_alignment: '',
        hypotheses_used: ['公司偏好假设'],
      },
    })

    expect(parsed.positioning_strategy).toBe('突出可迁移能力')
    expect(parsed.weaknesses).toEqual(['用户调研证据未按 JD 优先级呈现'])
    expect(parsed.optimization_suggestions).toEqual(['前置用户调研证据'])
    expect(parsed.optimization_strategy_details[0]?.optimization_example.source_quote)
      .toBe('负责用户调研和方案落地')
    expect(parsed.context_fit.hypotheses_used).toEqual(['公司偏好假设'])
  })

  test('keeps legacy string summaries readable when structured details are absent', () => {
    const parsed = matchAnalysisOutputSchema.parse({
      match_score: 70,
      hard_requirements_match: {},
      skill_match: { matched: [], missing: [] },
      experience_match: '经验需要进一步核验',
      strengths: [],
      weaknesses: ['旧版岗位差距'],
      optimization_suggestions: ['旧版优化策略'],
    })

    expect(parsed.weaknesses).toEqual(['旧版岗位差距'])
    expect(parsed.optimization_suggestions).toEqual(['旧版优化策略'])
    expect(parsed.weakness_details).toEqual([])
    expect(parsed.optimization_strategy_details).toEqual([])
  })
})
