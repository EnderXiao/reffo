import { describe, expect, test } from 'bun:test'
import {
  V44_PROMPT_AB_JUDGE_VERSION,
  buildV44PromptABJudgeMessages,
} from '@/prompts/v44-one-job-one-resume-evaluation-prompts'

function promptText(messages: Array<{ content: string }>) {
  return messages.map(message => message.content).join('\n')
}

describe('v4.4 one-job-one-resume offline evaluation prompt', () => {
  test('keeps A/B identity blind and applies absolute quality gates', () => {
    expect(V44_PROMPT_AB_JUDGE_VERSION).toBe('4.4.5-ab-blind-quality-gates')
    const prompt = promptText(buildV44PromptABJudgeMessages({
      sourceResume: '源简历',
      jobDescription: '目标 JD',
      candidateA: '匿名简历 A',
      candidateB: '匿名简历 B',
    }))

    expect(prompt).toContain('candidate_A')
    expect(prompt).toContain('candidate_B')
    expect(prompt).toContain('absolute_gate')
    expect(prompt).toContain('empty_work_entries')
    expect(prompt).toContain('total_score 必须严格等于七项分数之和')
    expect(prompt).toContain('不以 bullet 零复用为目标')
    expect(prompt).toContain('一份失败而另一份通过时，失败者不得获胜')
    expect(prompt).not.toContain('A 是旧版')
    expect(prompt).not.toContain('B 是候选版')
    expect(prompt).not.toContain('独立简历质量委员会')
  })
})
