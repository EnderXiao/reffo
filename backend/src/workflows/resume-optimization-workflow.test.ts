import { describe, expect, test } from 'bun:test'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import type { MvpProcessResponse } from '@/types'
import { V5WorkflowBlockedError } from '@/v5/main/workflow'
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
