import { describe, expect, test } from 'bun:test'
import {
  buildSourceProfile,
  postProcessV44Resume,
  sanitizeResumePlan,
} from '@/agents/resume-generator-v44-support'
import type { MatchAnalysis, ResumeStructure } from '@/types'

const sourceResume: ResumeStructure = {
  personal_info: { name: '张三' },
  education: [],
  experience: [{
    company: '示例公司',
    position: '产品经理',
    time_range: '2023-至今',
    responsibilities: ['负责用户研究与产品方案'],
    achievements: [
      '核心转化率提升约11%',
      '支持90+任务类型；完成率提升至86%（个人材料自述，受运营推动影响）',
    ],
  }],
  projects: [],
  skills: { hard_skills: ['用户研究'] },
}

const matchAnalysis = {
  match_score: 82,
  hard_requirements_match: {},
  skill_match: { matched: ['用户研究'], missing: [] },
  experience_match: '',
  soft_skills_match: '',
  strengths: [],
  weaknesses: [],
  jd_structure: {
    basic_info: { title: '产品经理' },
    hard_requirements: { required_skills: [] },
    responsibilities: [],
    tasks: [],
    soft_skills: [],
    nice_to_have: [],
  },
} satisfies MatchAnalysis

describe('v4.4 resume generation support', () => {
  test('builds compact source profile from evidence fields only', () => {
    expect(buildSourceProfile(sourceResume, matchAnalysis)).toMatchObject({
      structured_evidence_count: 3,
      source_is_compact: true,
      match_score: 82,
    })
  })

  test('replaces model quotes with exact source evidence and removes risky segments', () => {
    const plan = sanitizeResumePlan({
      evidence_pillars: [{
        selected_evidence: [{
          source_path: 'experience[0].achievements[1]',
          source_quote: '模型擅自删改的内容',
          safe_usage: '完成率提升至99.5%',
          verification_status: 'verified',
        }],
      }],
      experience_plan: [],
      project_plan: [],
      skills_to_feature: [],
      forbidden_claims: [],
    }, sourceResume)

    const evidence = (plan.evidence_pillars as Array<{
      selected_evidence: Array<Record<string, unknown>>
    }>)[0].selected_evidence[0]
    expect(evidence.source_quote).toBe(sourceResume.experience[0].achievements[1])
    expect(evidence.safe_usage).toBe('支持90+任务类型')
    expect(evidence.verification_status).toBe('self_reported')
  })

  test('removes unsupported numbers, duplicate bullets, and internal audit phrases', () => {
    const result = postProcessV44Resume(`# 张三

## 工作经历

- 核心转化率提升约11%
- 通过实验推动核心转化率提升约11%
- 目标下发及时率提升至99.5%
- 个人简历记录支持90+任务类型

## 专业技能

- 用户研究`, sourceResume)

    expect(result).toContain('核心转化率提升约11%')
    expect(result).toContain('支持90+任务类型')
    expect(result).not.toContain('99.5%')
    expect(result).not.toContain('个人简历记录')
    expect(result.match(/约11%/g)).toHaveLength(1)
  })
})
