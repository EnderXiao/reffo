import { describe, expect, test } from 'bun:test'
import {
  V42_RESULT_BASELINE_VERSION,
  V43_RESULT_PROMPT_VERSION,
  buildV42ResultBaselineMessages,
  buildV43BlindJudgeMessages,
  buildV43ResultGenerationMessages,
} from '@/prompts/v43-result-prompts'

const input = {
  sourceResume: { experience: [] },
  jobDescription: { responsibilities: [] },
  matchAnalysis: { positioning_strategy: '' },
}

function promptText(messages: Array<{ content: string }>) {
  return messages.map((message) => message.content).join('\n')
}

describe('v4.3 result-density prompt experiment', () => {
  test('keeps baseline and candidate versions independently identifiable', () => {
    expect(V42_RESULT_BASELINE_VERSION).toBe('4.2.1-result-baseline')
    expect(V43_RESULT_PROMPT_VERSION).toBe('4.3.0-result-density-candidate')
  })

  test('adds an evidence hierarchy without forcing fabricated outcomes', () => {
    const baseline = promptText(buildV42ResultBaselineMessages(input))
    const optimized = promptText(buildV43ResultGenerationMessages(input))

    expect(baseline).toContain('行动 + 对象/场景 + 已知结果')
    expect(baseline).not.toContain('L4 业务结果')
    expect(optimized).toContain('L4 业务结果')
    expect(optimized).toContain('L1 交付物/里程碑')
    expect(optimized).toContain('团队结果与个人贡献分离')
    expect(optimized).toContain('结果证据不足时宁可简洁、诚实')
    expect(optimized).toContain('不得把推导出的数字或业务影响直接写入简历')
  })

  test('blind judge measures result density and attribution safety', () => {
    const prompt = promptText(buildV43BlindJudgeMessages({
      sourceResume: '源简历',
      jobDescription: '目标 JD',
      candidateX: '候选 X',
      candidateY: '候选 Y',
    }))

    expect(prompt).toContain('result_density')
    expect(prompt).toContain('task_list_control')
    expect(prompt).toContain('outcome_relevance')
    expect(prompt).toContain('attribution_accuracy')
    expect(prompt).toContain('total_score<=49')
    expect(prompt).toContain('L1 交付物是合法结果')
  })
})
