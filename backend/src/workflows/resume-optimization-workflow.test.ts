import { describe, expect, spyOn, test } from 'bun:test'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import type { MvpProcessResponse } from '@/types'
import { V5ResumeOptimizationWorkflow, V5WorkflowBlockedError } from '@/v5/main/workflow'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { ResumeQuotaError } from '@/services/resume-quota'
import { ResumeOptimizationWorkflow } from '@/workflows/resume-optimization-workflow'

const v5Response: MvpProcessResponse = {
  run_id: 'v5-run',
  workflow_status: 'succeeded',
  agent_version: '5.0.0',
  step1_analysis: {
    quality_score: 80,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    capability_summary: '后端研发能力',
    structured_resume: {
      personal_info: { name: '张三' },
      education: [],
      experience: [],
      projects: [],
      skills: { hard_skills: [] },
    },
  },
  step2_matching: {
    match_score: 80,
    hard_requirements_match: {},
    skill_match: { matched: [], missing: [] },
    experience_match: '当前材料匹配',
    soft_skills_match: '当前材料匹配',
    strengths: [],
    weaknesses: [],
    jd_structure: {
      basic_info: { title: '后端工程师' },
      hard_requirements: { required_skills: [] },
      responsibilities: [],
      tasks: [],
      soft_skills: [],
      nice_to_have: [],
    },
  },
  step3_optimized_resume: '# 张三',
}

describe('ResumeOptimizationWorkflow v5-only entry', () => {
  test('forwards the analysis callback and output language to the real V5 adapter', async () => {
    let charged = 0
    const run = spyOn(V5ResumeOptimizationWorkflow.prototype, 'run').mockImplementation(async input => {
      expect(input.outputLanguage).toBe('en-US')
      expect(input.enableQualityJudge).toBe(false)
      await input.onAnalysisSucceeded?.()
      return createV5ResultFixture()
    })
    try {
      const workflow = new ResumeOptimizationWorkflow(new FakeHarnessEventBus(), { enableDefaultSubscribers: false })
      await workflow.run({ resume_markdown: 'source', jd_text: 'job', output_language: 'en-US', onAnalysisSucceeded: () => { charged += 1 } })
      expect(charged).toBe(1)
    } finally {
      run.mockRestore()
    }
  })

  test('preserves a quota error even when V5 normalizes callback failures', async () => {
    const quotaError = new ResumeQuotaError(3, 3)
    const run = spyOn(V5ResumeOptimizationWorkflow.prototype, 'run').mockImplementation(async input => {
      try {
        await input.onAnalysisSucceeded?.()
      } catch {
        throw new V5WorkflowBlockedError({ code: 'V5_INTERNAL_WORKFLOW_FAILURE', state: 'workflow_failure', message: 'normalized failure' })
      }
      return createV5ResultFixture()
    })
    try {
      const workflow = new ResumeOptimizationWorkflow(new FakeHarnessEventBus(), { enableDefaultSubscribers: false })
      await expect(workflow.run({ resume_markdown: 'source', jd_text: 'job', onAnalysisSucceeded: async () => { throw quotaError } })).rejects.toBe(quotaError)
    } finally {
      run.mockRestore()
    }
  })

  test('always delegates the complete process to v5', async () => {
    let receivedInput: unknown
    const workflow = new ResumeOptimizationWorkflow(
      new FakeHarnessEventBus(),
      {
        enableDefaultSubscribers: false,
        v5Runner: async input => {
          receivedInput = input
          return v5Response
        },
      }
    )

    const input = {
      resume_markdown: 'source resume markdown',
      jd_text: 'target jd text',
      output_language: 'zh-CN',
      enable_llm_judge: true,
    }
    const result = await workflow.run(input)

    expect(receivedInput).toEqual(input)
    expect(result).toEqual(v5Response)
    expect(result.agent_version).toBe('5.0.0')
  })

  test('preserves a v5 blocked error without running another workflow', async () => {
    const error = new V5WorkflowBlockedError({
      code: 'V5_BLOCKING_FACT_JUDGE_FAILED',
      state: 'blocked_fact_validation',
      message: 'fact gate failed',
    })
    const workflow = new ResumeOptimizationWorkflow(
      new FakeHarnessEventBus(),
      {
        enableDefaultSubscribers: false,
        v5Runner: async () => { throw error },
      }
    )

    await expect(workflow.run({
      resume_markdown: 'source resume markdown',
      jd_text: 'target jd text',
    })).rejects.toBe(error)
  })
})
