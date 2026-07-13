import { describe, expect, test } from 'bun:test'
import {
  assertBusinessEvaluationPassed,
  BusinessEvaluationError,
  evaluateWithBusinessRecovery,
} from '@/harness/business-recovery'
import { evaluateResumeAnalysisBusiness } from '@/harness/evaluators/business-evaluators'
import { createRunContext, createStepExecutionContext } from '@/harness/run-context'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import type { ResumeAnalysis } from '@/types'

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
})
