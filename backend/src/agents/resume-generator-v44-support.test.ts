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

  test('intersects plan paths with the retained evidence whitelist and source scope', () => {
    const plan = sanitizeResumePlan({
      resume_layers: {
        stable_core_evidence_paths: [
          'experience[0].achievements[0]',
          'experience[0].responsibilities[0]',
        ],
        job_customized_evidence_paths: ['projects[0].achievements[0]'],
      },
      evidence_pillars: [{
        selected_evidence: [{ source_path: 'experience[0].achievements[0]' }],
      }, {
        selected_evidence: [{ source_path: 'missing.path' }],
      }],
      experience_plan: [{
        source_path: 'experience[0]',
        treatment: 'expand',
        bullet_budget: 4,
        selected_evidence_paths: [
          'experience[0].achievements[0]',
          'experience[0].responsibilities[0]',
          'projects[0].achievements[0]',
        ],
      }],
      project_plan: [],
      safe_keyword_map: [{
        jd_term: '用户洞察',
        source_path: 'experience[0].responsibilities[0]',
        safe_phrase: '模型旁路内容',
      }],
      skills_to_feature: [],
      forbidden_claims: [],
    }, sourceResume)

    const experiencePlan = (plan.experience_plan as Array<Record<string, unknown>>)[0]
    expect(experiencePlan.treatment).toBe('compress')
    expect(experiencePlan.bullet_budget).toBe(1)
    expect(experiencePlan.selected_evidence_paths).toEqual(['experience[0].achievements[0]'])
    expect((plan.evidence_pillars as unknown[])).toHaveLength(1)
    expect((plan.safe_keyword_map as unknown[])).toHaveLength(0)
    expect(plan.resume_layers).toEqual({
      stable_core_evidence_paths: ['experience[0].achievements[0]'],
      job_customized_evidence_paths: [],
      customization_rationale: '',
    })
  })

  test('downgrades work to a timeline line and projects to omit after evidence cleaning', () => {
    const resumeWithProject: ResumeStructure = {
      ...sourceResume,
      projects: [{
        name: '增长项目',
        role: '产品经理',
        tech_stack: [],
        description: '设计增长方案',
        achievements: ['转化率提升约8%'],
      }],
    }
    const plan = sanitizeResumePlan({
      evidence_pillars: [],
      experience_plan: [{
        source_path: 'experience[0]',
        treatment: 'expand',
        bullet_budget: 3,
        selected_evidence_paths: ['experience[0].achievements[0]'],
      }],
      project_plan: [{
        source_path: 'projects[0]',
        treatment: 'include',
        bullet_budget: 2,
        selected_evidence_paths: ['projects[0].achievements[0]'],
      }],
      skills_to_feature: [],
      forbidden_claims: [],
    }, resumeWithProject)

    expect((plan.experience_plan as Array<Record<string, unknown>>)[0]).toMatchObject({
      treatment: 'timeline_line',
      bullet_budget: 0,
      selected_evidence_paths: [],
    })
    expect((plan.project_plan as Array<Record<string, unknown>>)[0]).toMatchObject({
      treatment: 'omit',
      bullet_budget: 0,
      selected_evidence_paths: [],
    })
    expect(plan.omit_reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_path: 'projects[0]' }),
    ]))
  })

  test('keeps content minimums within the actual row bullet capacity', () => {
    const manyAchievements = Array.from({ length: 8 }, (_, index) => `完成第 ${index + 1} 项产品交付`)
    const richResume: ResumeStructure = {
      ...sourceResume,
      experience: [{ ...sourceResume.experience[0], achievements: manyAchievements }],
    }
    const evidencePaths = manyAchievements.map((_, index) => `experience[0].achievements[${index}]`)
    const plan = sanitizeResumePlan({
      evidence_pillars: [{
        selected_evidence: evidencePaths.map(source_path => ({ source_path })),
      }],
      experience_plan: [{
        source_path: 'experience[0]',
        treatment: 'expand',
        bullet_budget: 2,
        selected_evidence_paths: evidencePaths,
      }],
      project_plan: [],
      skills_to_feature: [],
      content_budget: { mode: 'reconstruct_targeted' },
    }, richResume)

    expect((plan.experience_plan as Array<Record<string, unknown>>)[0].bullet_budget).toBe(2)
    expect(plan.content_budget).toMatchObject({
      eligible_business_evidence_count: 8,
      min_business_bullets: 2,
      target_business_bullets: 2,
    })
  })

  test('prioritizes stable planned projects and rebuilds layers after project caps', () => {
    const resumeWithProjects: ResumeStructure = {
      ...sourceResume,
      projects: [{
        name: '岗位定制项目',
        role: '产品经理',
        tech_stack: [],
        description: '完成岗位定制方案',
        achievements: [],
      }, {
        name: '核心职业项目',
        role: '产品经理',
        tech_stack: [],
        description: '沉淀核心职业能力',
        achievements: [],
      }],
    }
    const plan = sanitizeResumePlan({
      resume_layers: {
        stable_core_evidence_paths: ['projects[1].description'],
        job_customized_evidence_paths: ['projects[0].description'],
      },
      evidence_pillars: [{
        selected_evidence: [
          { source_path: 'projects[0].description', usage_layer: 'job_customized' },
          { source_path: 'projects[1].description', usage_layer: 'stable_core' },
        ],
      }],
      experience_plan: [],
      project_plan: [{
        source_path: 'projects[0]',
        treatment: 'include',
        bullet_budget: 1,
        selected_evidence_paths: ['projects[0].description'],
      }, {
        source_path: 'projects[1]',
        treatment: 'include',
        bullet_budget: 1,
        selected_evidence_paths: [],
      }],
      skills_to_feature: [],
      content_budget: { mode: 'preserve_compact', max_project_count: 1 },
    }, resumeWithProjects)

    const projectPlan = plan.project_plan as Array<Record<string, unknown>>
    expect(projectPlan.find(row => row.source_path === 'projects[0]')).toMatchObject({ treatment: 'omit' })
    expect(projectPlan.find(row => row.source_path === 'projects[1]')).toMatchObject({
      treatment: 'include',
      selected_evidence_paths: ['projects[1].description'],
    })
    expect(plan.resume_layers).toEqual({
      stable_core_evidence_paths: ['projects[1].description'],
      job_customized_evidence_paths: [],
      customization_rationale: '',
    })
    const remainingEvidence = (plan.evidence_pillars as Array<{
      selected_evidence: Array<Record<string, unknown>>
    }>).flatMap(pillar => pillar.selected_evidence)
    expect(remainingEvidence.map(row => row.source_path)).toEqual(['projects[1].description'])
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

  test('converts empty work headings to a compact timeline and removes empty projects', () => {
    const result = postProcessV44Resume(`# 张三

## 工作经历

### 示例公司｜产品经理

## 项目经历

### 虚构项目

- 转化率提升至99.5%

## 专业技能

- 用户研究`, sourceResume)

    expect(result).not.toContain('### 示例公司')
    expect(result).not.toContain('虚构项目')
    expect(result).not.toContain('99.5%')
    expect(result).toContain('## 其他经历')
    expect(result).toContain('示例公司｜产品经理｜2023-至今')
  })

  test('preserves a project with substantive prose content', () => {
    const result = postProcessV44Resume(`# 张三

## 项目经历

### 用户研究项目

围绕目标用户完成访谈与产品方案设计。

## 专业技能

用户研究`, sourceResume)

    expect(result).toContain('### 用户研究项目')
    expect(result).toContain('围绕目标用户完成访谈与产品方案设计。')
  })

  test('does not deduplicate similar bullets across different source scopes', () => {
    const result = postProcessV44Resume(`# 张三

## 工作经历

### 示例公司｜产品经理

- 负责用户研究与产品方案

### 另一家公司｜产品经理

- 负责用户研究与产品方案

## 专业技能

用户研究`, sourceResume)

    expect(result.match(/负责用户研究与产品方案/g)).toHaveLength(2)
  })

  test('keeps an independent safe clause when another clause has an unsupported number', () => {
    const result = postProcessV44Resume(`# 张三

## 工作经历

### 示例公司｜产品经理

- 负责用户研究与产品方案；目标提升至99.5%

## 专业技能

用户研究`, sourceResume)

    expect(result).toContain('- 负责用户研究与产品方案')
    expect(result).not.toContain('99.5%')
  })
})
