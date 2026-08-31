import { describe, expect, test } from 'bun:test'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import { ResumeOptimizationWorkflow } from '@/workflows/resume-optimization-workflow'
import type { InterviewSuggestions, JDStructure, MatchAnalysis, ResumeAnalysis, ResumeStructure } from '@/types'

const sourceResume: ResumeStructure = {
  personal_info: {
    name: '张三',
    contact: 'zhangsan@example.com',
    current_position: '高级后端开发工程师',
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
      company: 'ABC科技有限公司',
      position: '高级后端开发工程师',
      time_range: '2021.03 - 至今',
      responsibilities: ['负责电商平台后端系统开发', '参与系统架构设计和性能优化'],
      achievements: ['订单系统吞吐量提升至 5000 QPS', '数据库查询响应时间降低 60%'],
    },
  ],
  projects: [
    {
      name: '电商平台订单系统',
      role: '技术负责人',
      tech_stack: ['Java', 'Spring Cloud', 'MySQL', 'Redis', 'RocketMQ'],
      description: '重构电商平台订单系统，支持高并发订单处理。',
      achievements: ['通过消息队列实现异步处理，系统吞吐量提升 3 倍'],
    },
  ],
  skills: {
    hard_skills: ['Java', 'Spring Boot', 'MySQL', 'Redis', 'Kubernetes'],
    soft_skills: ['团队协作', '问题解决'],
  },
}

const resumeAnalysis: ResumeAnalysis = {
  quality_score: 82,
  strengths: ['后端工程经验扎实'],
  weaknesses: ['可进一步突出分布式系统经验'],
  suggestions: ['强化 JD 相关项目成果'],
  capability_summary: '候选人具备后端架构、性能优化和团队协作能力。',
  structured_resume: sourceResume,
}

const jd: JDStructure = {
  basic_info: {
    title: '高级 Java 后端工程师',
    company: '目标公司',
  },
  hard_requirements: {
    education: '本科及以上',
    experience_years: '3年以上',
    required_skills: ['Java', 'Spring Boot', 'MySQL', 'Redis'],
  },
  responsibilities: ['负责核心业务系统后端开发', '参与系统架构设计和性能优化'],
  tasks: ['订单系统开发', '数据库性能优化'],
  soft_skills: ['团队协作', '问题解决'],
  nice_to_have: ['电商业务经验', 'Kubernetes 经验'],
}

const matchAnalysis: MatchAnalysis = {
  match_score: 88,
  hard_requirements_match: {
    Java: true,
    Redis: true,
  },
  skill_match: {
    matched: ['Java', 'Spring Boot', 'MySQL', 'Redis'],
    missing: [],
  },
  experience_match: '候选人的电商订单系统经验与 JD 高度匹配。',
  soft_skills_match: '具备团队协作和问题解决能力。',
  strengths: ['电商后端经验', '性能优化经验'],
  weaknesses: [],
  jd_structure: jd,
}

const interviewSuggestions: InterviewSuggestions = {
  questions: ['请介绍订单系统重构项目。'],
  story_recommendations: [
    {
      title: '订单系统性能优化',
      background: '电商平台订单量增长。',
      result: '系统吞吐量提升 3 倍。',
      storytelling_approach: [
        '先说明订单量增长背景，再说明性能优化动作和结果。',
        '突出个人负责的性能优化范围和可核验结果。',
      ],
    },
  ],
  follow_up_questions: ['如何保证分布式事务一致性？'],
}

const invalidResume = '# 张三\n\nXXX'

const validResume = `# 张三

**联系方式**：zhangsan@example.com
**当前职位**：高级后端开发工程师

---

## 工作经历

### ABC科技有限公司 | 高级后端开发工程师 | 2021.03 - 至今

**职责与成就：**

- 负责电商平台后端系统开发，围绕 Java、Spring Boot、MySQL、Redis 建设核心服务能力。
- 参与系统架构设计和性能优化，订单系统吞吐量提升至 5000 QPS。
- 优化数据库查询链路，查询响应时间降低 60%，支撑高并发业务稳定运行。

## 项目经验

### 电商平台订单系统 | 技术负责人 | 2022.01 - 2022.08

- 基于 Spring Cloud、RocketMQ、MySQL 和 Redis 重构订单处理流程。
- 通过异步处理和索引优化提升系统吞吐能力，支持高并发订单场景。

## 教育背景

### 清华大学 | 计算机科学与技术 | 本科 | 2015.09 - 2019.06

## 技能清单

**编程语言与框架**：Java, Spring Boot, Spring Cloud
**数据库与中间件**：MySQL, Redis, RocketMQ
**工程能力**：Kubernetes, 性能优化, 团队协作, 问题解决`

function createWorkflow(input: { revise: () => Promise<string>; advise?: () => Promise<InterviewSuggestions> }) {
  const eventBus = new FakeHarnessEventBus()
  const workflow = new ResumeOptimizationWorkflow(
    eventBus,
    {
      analyzer: {
        analyze: async () => resumeAnalysis,
        repairBusinessOutput: async (_resumeMarkdown, currentOutput) => currentOutput,
      },
      jdParser: { parse: async () => jd },
      matcher: {
        match: async () => matchAnalysis,
        repairBusinessOutput: async (_resume, _jd, currentOutput) => currentOutput,
      },
      generator: { generate: async () => invalidResume },
      reviser: { revise: input.revise },
      advisor: {
        advise: input.advise ?? (async () => interviewSuggestions),
        repairBusinessOutput: async (_analysis, _matching, _optimizedResume, currentOutput) => currentOutput,
      },
    },
    { enableDefaultSubscribers: false }
  )

  return { eventBus, workflow }
}

describe('ResumeOptimizationWorkflow self-healing loop', () => {
  test('revises a failed quality gate and returns the repaired resume', async () => {
    let reviseCount = 0
    const { eventBus, workflow } = createWorkflow({
      revise: async () => {
        reviseCount += 1
        return validResume
      },
    })

    const result = await workflow.run({
      resume_markdown: 'source resume markdown',
      jd_text: 'target jd text',
      workflowTimeoutMs: 60000,
    })

    expect(result.workflow_status).toBe('succeeded')
    expect(result.step3_optimized_resume).toBe(validResume)
    expect(reviseCount).toBe(1)
    expect(result.recovery_summary?.[0]).toMatchObject({
      triggerStep: 'validate_resume',
      action: 'revise_output',
      result: 'succeeded',
      attempts: 1,
    })
    expect(result.step_statuses?.map((step) => step.stepName)).toEqual([
      'analyze_resume',
      'parse_jd',
      'match_resume_to_jd',
      'generate_resume',
      'validate_resume',
      'revise_resume',
      'validate_resume',
      'generate_interview_advice',
    ])
    expect(eventBus.events.some((event) => event.type === 'recovery.succeeded')).toBe(true)
  })

  test('returns partial when revisions exceed the self-healing budget', async () => {
    let reviseCount = 0
    const { eventBus, workflow } = createWorkflow({
      revise: async () => {
        reviseCount += 1
        return invalidResume
      },
    })

    const result = await workflow.run({
      resume_markdown: 'source resume markdown',
      jd_text: 'target jd text',
      workflowTimeoutMs: 60000,
    })

    expect(result.workflow_status).toBe('partial')
    expect(result.step3_optimized_resume).toBe(invalidResume)
    expect(reviseCount).toBe(2)
    expect(result.recoverable_errors?.[0]).toMatchObject({
      stepName: 'validate_resume',
      errorCode: 'QUALITY_GATE_FAILED',
    })
    expect(result.recovery_summary?.[0]).toMatchObject({
      triggerStep: 'validate_resume',
      action: 'revise_output',
      result: 'failed',
      attempts: 2,
    })
    expect(eventBus.events.some((event) => event.type === 'recovery.failed')).toBe(true)
  })

  test('keeps the repaired resume when interview advice fails recoverably', async () => {
    const { workflow } = createWorkflow({
      revise: async () => validResume,
      advise: async () => {
        throw new Error('advice unavailable')
      },
    })

    const result = await workflow.run({
      resume_markdown: 'source resume markdown',
      jd_text: 'target jd text',
      workflowTimeoutMs: 60000,
    })

    expect(result.workflow_status).toBe('partial')
    expect(result.step3_optimized_resume).toBe(validResume)
    expect(result.step4_interview_suggestions).toBeUndefined()
    expect(result.recoverable_errors?.[0]).toMatchObject({
      stepName: 'generate_interview_advice',
      errorCode: 'STEP_FAILED',
    })
    expect(result.recovery_summary?.[0]).toMatchObject({
      action: 'revise_output',
      result: 'succeeded',
    })
  })
})
