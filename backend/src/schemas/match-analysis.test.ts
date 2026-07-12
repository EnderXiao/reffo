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

  test('normalizes the new matching strategy fields', () => {
    const parsed = matchAnalysisOutputSchema.parse({
      match_score: 80,
      hard_requirements_match: {},
      skill_match: { matched: [], missing: [] },
      experience_match: '有相关经历',
      soft_skills_match: '',
      strengths: [],
      weaknesses: [],
      weakness_details: [],
      positioning_strategy: '突出可迁移能力',
      optimization_suggestions: ['前置相关证据'],
      context_fit: {
        company_alignment: '需面试确认',
        location_alignment: '',
        hypotheses_used: ['公司偏好假设'],
      },
    })

    expect(parsed.positioning_strategy).toBe('突出可迁移能力')
    expect(parsed.optimization_suggestions).toEqual(['前置相关证据'])
    expect(parsed.context_fit.hypotheses_used).toEqual(['公司偏好假设'])
  })
})
