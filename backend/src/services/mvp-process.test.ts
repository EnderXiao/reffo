import { describe, expect, test } from 'bun:test'
import { processResumeOptimization, type MvpProcessAgents } from './mvp-process'
import type { JDStructure, MatchAnalysis, ResumeAnalysis, ResumeStructure } from '@/types'

const structuredResume: ResumeStructure = {
  personal_info: {
    name: '张三',
    current_position: '后端工程师',
  },
  education: [
    {
      school: '清华大学',
      major: '计算机科学与技术',
      degree: '本科',
      time_range: '2015.09 - 2019.06',
    },
  ],
  experience: [
    {
      company: 'ABC科技',
      position: '后端工程师',
      time_range: '2020.01 - 至今',
      responsibilities: ['负责订单系统开发'],
      achievements: ['系统吞吐量提升 3 倍'],
    },
  ],
  skills: {
    hard_skills: ['Java', 'Spring Boot', 'MySQL'],
  },
}

const analysisResult: ResumeAnalysis = {
  quality_score: 82,
  strengths: ['有后端项目经验'],
  weaknesses: ['缺少更多量化成果'],
  suggestions: ['突出系统性能优化'],
  capability_summary: '具备后端系统开发经验。',
  structured_resume: structuredResume,
}

const jdStructure: JDStructure = {
  basic_info: {
    title: '高级后端工程师',
  },
  hard_requirements: {
    required_skills: ['Java', 'Spring Boot'],
  },
  responsibilities: ['负责核心业务系统开发'],
  tasks: ['设计订单服务'],
  soft_skills: ['沟通协作'],
  nice_to_have: ['Kubernetes'],
}

const matchResult: MatchAnalysis = {
  match_score: 88,
  hard_requirements_match: {
    Java: true,
    'Spring Boot': true,
  },
  skill_match: {
    matched: ['Java', 'Spring Boot'],
    missing: ['Kubernetes'],
  },
  experience_match: '后端经验匹配岗位要求。',
  soft_skills_match: '具备团队协作经验。',
  strengths: ['核心技能匹配'],
  weaknesses: ['容器化经验不足'],
  jd_structure: jdStructure,
}

describe('processResumeOptimization', () => {
  test('runs analyzer, matcher, and generator with injected mock agents', async () => {
    const calls: string[] = []
    const agents: MvpProcessAgents = {
      analyzer: {
        async analyze(resumeMarkdown) {
          calls.push(`analyze:${resumeMarkdown}`)
          return analysisResult
        },
      },
      matcher: {
        async match(resume, jdText) {
          calls.push(`match:${resume.personal_info.name}:${jdText}`)
          expect(resume).toEqual(structuredResume)
          return matchResult
        },
      },
      generator: {
        async generate(sourceResume, jd, matchAnalysis) {
          calls.push(`generate:${sourceResume.personal_info.name}:${jd.basic_info.title}`)
          expect(sourceResume).toEqual(structuredResume)
          expect(jd).toEqual(jdStructure)
          expect(matchAnalysis).toEqual(matchResult)
          return '# 张三\n\n优化后的简历'
        },
      },
    }

    const result = await processResumeOptimization(
      {
        resume_markdown: '# 张三',
        jd_text: '高级后端工程师',
      },
      agents
    )

    expect(calls).toEqual([
      'analyze:# 张三',
      'match:张三:高级后端工程师',
      'generate:张三:高级后端工程师',
    ])
    expect(result).toEqual({
      step1_analysis: analysisResult,
      step2_matching: matchResult,
      step3_optimized_resume: '# 张三\n\n优化后的简历',
    })
  })
})
