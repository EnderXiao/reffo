import { describe, expect, test } from 'bun:test'
import {
  assertBusinessEvaluationPassed,
  BusinessEvaluationError,
  evaluateWithBusinessRecovery,
} from '@/harness/business-recovery'
import { evaluateMatchAnalysisBusiness, evaluateResumeAnalysisBusiness } from '@/harness/evaluators/business-evaluators'
import { createRunContext, createStepExecutionContext } from '@/harness/run-context'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import type { MatchAnalysis, ResumeAnalysis } from '@/types'

const incompleteAnalysis: ResumeAnalysis = {
  quality_score: 70,
  strengths: ['有项目经历'],
  weaknesses: ['姓名未提取'],
  suggestions: ['补全结构化信息'],
  capability_summary: '候选人具备前端开发经历。',
  structured_resume: {
    personal_info: { name: '' },
    education: [],
    experience: [
      {
        company: 'ABC科技',
        position: '前端工程师',
        time_range: '2024 - 至今',
        responsibilities: ['负责 Web 页面开发'],
        achievements: [],
      },
    ],
    skills: { hard_skills: ['React'] },
  },
}

const incompleteMatch: MatchAnalysis = {
  match_score: 70,
  hard_requirements_match: { React: true },
  skill_match: { matched: ['React'], missing: [] },
  experience_match: '具备前端开发经历。',
  soft_skills_match: '协作能力待进一步核验。',
  strengths: ['React 开发经历'],
  weaknesses: ['React 经验表达未对齐'],
  weakness_details: [{
    id: 'G1',
    priority: 'medium',
    weakness: 'React 经验表达未对齐',
    evidence_type: 'wording_gap',
    jd_requirement: '使用 React 开发核心功能',
    evidence: '源简历包含 React 开发经历。',
    impact: '技术关键词不够醒目。',
    suggestion: '前置已有 React 证据。',
  }],
  optimization_strategy_details: [{
    id: 'S1',
    related_gap_ids: ['G1'],
    strategy_point: '',
    rationale: '',
    optimization_example: { source_path: '', source_quote: '', optimized_content: '' },
  }],
  jd_structure: {
    basic_info: { title: '前端工程师' },
    hard_requirements: { required_skills: ['React'] },
    responsibilities: ['使用 React 开发核心功能'],
    tasks: [],
    soft_skills: [],
    nice_to_have: [],
  },
}

describe('business recovery', () => {
  test('reextracts resume analysis business gaps from source once', async () => {
    const eventBus = new FakeHarnessEventBus()
    const runContext = createRunContext('test')
    const controller = new AbortController()
    const stepContext = createStepExecutionContext(runContext, 'analyze_resume', 1, controller.signal)
    let repairCount = 0

    const recovered = await evaluateWithBusinessRecovery({
      eventBus,
      stepContext,
      outputName: 'ResumeAnalysis',
      currentOutput: incompleteAnalysis,
      evaluate: evaluateResumeAnalysisBusiness,
      repair: async ({ currentOutput }) => {
        repairCount += 1
        return {
          ...currentOutput,
          structured_resume: {
            ...currentOutput.structured_resume,
            personal_info: { ...currentOutput.structured_resume.personal_info, name: '张三' },
          },
        }
      },
    })

    expect(recovered.evaluation.passed).toBe(true)
    expect(repairCount).toBe(1)
    expect(eventBus.events.some((event) => event.type === 'recovery.succeeded')).toBe(true)
    expect(eventBus.events.find((event) => event.type === 'recovery.planned')?.payload).toMatchObject({
      action: 'reextract_from_source',
      issueCodes: ['MISSING_PERSON_NAME'],
    })
  })

  test('throws business evaluation error with structured issues', () => {
    const evaluation = evaluateResumeAnalysisBusiness(incompleteAnalysis)

    expect(() =>
      assertBusinessEvaluationPassed({
        evaluation,
        errorPrefix: '简历分析业务校验失败',
      })
    ).toThrow(BusinessEvaluationError)
  })

  test('repairs incomplete matching strategy details instead of failing immediately', async () => {
    const eventBus = new FakeHarnessEventBus()
    const runContext = createRunContext('test')
    const controller = new AbortController()
    const stepContext = createStepExecutionContext(runContext, 'match_resume_to_jd', 1, controller.signal)
    const initialEvaluation = evaluateMatchAnalysisBusiness(incompleteMatch)
    expect(initialEvaluation.issues.map(issue => issue.code)).toEqual(['INCOMPLETE_OPTIMIZATION_STRATEGY_DETAIL'])
    let repairCount = 0

    const recovered = await evaluateWithBusinessRecovery({
      eventBus,
      stepContext,
      outputName: 'MatchAnalysis',
      currentOutput: incompleteMatch,
      evaluate: evaluateMatchAnalysisBusiness,
      repair: async ({ currentOutput }) => {
        repairCount += 1
        return {
          ...currentOutput,
          optimization_strategy_details: [{
            id: 'S1',
            related_gap_ids: ['G1'],
            strategy_point: '前置 React 开发证据',
            rationale: '使已有 React 经历更直接回应 JD。',
            optimization_example: {
              source_path: 'experience[0].responsibilities[0]',
              source_quote: '负责 Web 页面开发',
              optimized_content: '使用 React 负责 Web 页面开发',
            },
          }],
        }
      },
    })

    expect(recovered.evaluation.passed).toBe(true)
    expect(repairCount).toBe(1)
    expect(eventBus.events.find((event) => event.type === 'recovery.planned')?.payload).toMatchObject({
      action: 'repair_business_output',
      issueCodes: ['INCOMPLETE_OPTIMIZATION_STRATEGY_DETAIL'],
    })
  })
})
