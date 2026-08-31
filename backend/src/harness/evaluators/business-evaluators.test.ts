import { describe, expect, test } from 'bun:test'
import {
  evaluateInterviewSuggestionsBusiness,
  evaluateMatchAnalysisBusiness,
  evaluateResumeAnalysisBusiness,
  evaluateSourceResumeForGeneration,
} from '@/harness/evaluators/business-evaluators'
import type { InterviewSuggestions, JDStructure, MatchAnalysis, ResumeAnalysis, ResumeStructure } from '@/types'

const sourceResume: ResumeStructure = {
  personal_info: { name: '张三' },
  education: [],
  experience: [
    {
      company: 'ABC科技有限公司',
      position: '后端工程师',
      time_range: '2021 - 至今',
      responsibilities: ['负责订单系统开发'],
      achievements: ['性能提升 60%'],
    },
  ],
  skills: { hard_skills: ['Java', 'Redis'] },
}

const jd: JDStructure = {
  basic_info: { title: 'Java 后端工程师' },
  hard_requirements: { required_skills: ['Java', 'Redis'] },
  responsibilities: ['负责核心系统开发'],
  tasks: ['订单系统开发'],
  soft_skills: ['协作'],
  nice_to_have: [],
}

const analysis: ResumeAnalysis = {
  quality_score: 80,
  strengths: ['后端经验'],
  weaknesses: ['表达可优化'],
  suggestions: ['突出项目成果'],
  capability_summary: '具备后端开发和性能优化能力。',
  structured_resume: sourceResume,
}

const matchAnalysis: MatchAnalysis = {
  match_score: 88,
  hard_requirements_match: { Java: true, Redis: true },
  skill_match: { matched: ['Java', 'Redis'], missing: [] },
  experience_match: '电商订单系统经验匹配。',
  soft_skills_match: '协作能力匹配。',
  strengths: ['后端经验'],
  weaknesses: [],
  jd_structure: jd,
}

const suggestions: InterviewSuggestions = {
  questions: ['问题1', '问题2', '问题3'],
  story_recommendations: [{
    title: '订单系统',
    background: '高并发场景',
    result: '性能提升',
    storytelling_approach: [
      '先说明问题，再说明优化动作和结果。',
      '重点交代个人职责边界，避免把团队成果归为个人成果。',
    ],
  }],
  follow_up_questions: ['团队挑战是什么？'],
}

describe('business evaluators', () => {
  test('passes complete single-step business outputs', () => {
    expect(evaluateResumeAnalysisBusiness(analysis).passed).toBe(true)
    expect(evaluateMatchAnalysisBusiness(matchAnalysis).passed).toBe(true)
    expect(evaluateSourceResumeForGeneration(sourceResume).passed).toBe(true)
    expect(evaluateInterviewSuggestionsBusiness(suggestions).passed).toBe(true)
  })

  test('passes match weaknesses with evidence type labels', () => {
    const matchWithWeaknessEvidence: MatchAnalysis = {
      ...matchAnalysis,
      weaknesses: ['Redis 高可用经验表达不够贴近 JD'],
      weakness_details: [
        {
          weakness: 'Redis 高可用经验表达不够贴近 JD',
          evidence_type: 'wording_gap',
          evidence: '源简历写到了 Redis，但没有显式描述高可用设计。',
          suggestion: '在相关项目中补充 Redis 高可用使用场景和职责边界。',
        },
      ],
    }

    expect(evaluateMatchAnalysisBusiness(matchWithWeaknessEvidence).passed).toBe(true)
  })

  test('passes when compound JD skills are covered by split match skills', () => {
    const compoundSkillMatch: MatchAnalysis = {
      ...matchAnalysis,
      skill_match: {
        matched: ['HTML', 'CSS', 'JavaScript', 'React'],
        missing: [],
      },
      jd_structure: {
        ...jd,
        hard_requirements: {
          required_skills: ['HTML/CSS/JavaScript', 'Vue/React'],
        },
      },
    }

    expect(evaluateMatchAnalysisBusiness(compoundSkillMatch).passed).toBe(true)
  })

  test('does not block when required skill checks are incomplete', () => {
    const evaluation = evaluateMatchAnalysisBusiness({
      ...matchAnalysis,
      skill_match: {
        matched: [],
        missing: [],
        required_skill_checks: [{
          requirement: 'Java',
          status: 'matched',
          evidence: '简历明确写明 Java',
        }],
      },
      jd_structure: {
        ...jd,
        hard_requirements: {required_skills: ['Java', 'Redis', 'English']},
      },
    })

    expect(evaluation.passed).toBe(true)
    expect(evaluation.issues.some(issue => issue.code === 'JD_REQUIRED_SKILLS_NOT_CHECKED')).toBe(true)
    expect(evaluation.issues.find(issue => issue.code === 'JD_REQUIRED_SKILLS_NOT_CHECKED')?.severity).toBe('warning')
  })

  test('fails incomplete source resume and match analysis', () => {
    const emptyResume: ResumeStructure = {
      personal_info: { name: '' },
      education: [],
      experience: [],
      skills: { hard_skills: [] },
    }
    const invalidMatch: MatchAnalysis = {
      ...matchAnalysis,
      experience_match: '',
      skill_match: { matched: [], missing: [] },
    }

    expect(evaluateResumeAnalysisBusiness({ ...analysis, structured_resume: emptyResume }).passed).toBe(false)
    expect(evaluateSourceResumeForGeneration(emptyResume).passed).toBe(false)
    expect(evaluateMatchAnalysisBusiness(invalidMatch).passed).toBe(false)
  })

  test('fails match weaknesses without evidence type labels', () => {
    const invalidMatch: MatchAnalysis = {
      ...matchAnalysis,
      weaknesses: ['微服务经验没有显式体现'],
      weakness_details: [],
    }

    const evaluation = evaluateMatchAnalysisBusiness(invalidMatch)

    expect(evaluation.passed).toBe(false)
    expect(evaluation.issues.some((issue) => issue.code === 'MISSING_WEAKNESS_EVIDENCE_TYPE')).toBe(true)
  })

  test('fails interview suggestions without stories', () => {
    expect(evaluateInterviewSuggestionsBusiness({ ...suggestions, story_recommendations: [] }).passed).toBe(false)
  })

  test('fails interview stories without storytelling approach', () => {
    const evaluation = evaluateInterviewSuggestionsBusiness({
      ...suggestions,
      story_recommendations: [{
        ...suggestions.story_recommendations[0],
        storytelling_approach: [],
      }],
    })

    expect(evaluation.passed).toBe(false)
    expect(evaluation.issues.some((issue) => issue.code === 'INCOMPLETE_STORY_RECOMMENDATION')).toBe(true)
  })
})
