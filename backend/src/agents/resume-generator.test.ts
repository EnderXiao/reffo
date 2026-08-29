import { describe, expect, test } from 'bun:test'
import { ResumeGeneratorAgent } from '@/agents/resume-generator'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import type { JDStructure, MatchAnalysis, ResumeStructure } from '@/types'

class SequenceProvider implements LlmProvider {
  readonly inputs: ChatCompletionInput[] = []

  constructor(private readonly outputs: string[]) {}

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    this.inputs.push(input)
    const content = this.outputs.shift()
    if (!content) throw new Error('缺少测试输出')
    return { provider: 'test', model: 'test', content, latencyMs: 1 }
  }
}

const sourceResume: ResumeStructure = {
  personal_info: { name: '张三' },
  education: [],
  experience: [{
    company: '示例公司',
    position: '产品经理',
    time_range: '2023-至今',
    responsibilities: ['负责用户研究'],
    achievements: ['核心转化率提升约11%'],
  }],
  projects: [],
  skills: { hard_skills: ['用户研究'] },
}

const jd: JDStructure = {
  basic_info: { title: '产品经理' },
  hard_requirements: { required_skills: ['用户研究'] },
  responsibilities: ['负责用户研究'],
  tasks: [],
  soft_skills: [],
  nice_to_have: [],
}

const matching: MatchAnalysis = {
  match_score: 85,
  hard_requirements_match: { 用户研究: true },
  skill_match: { matched: ['用户研究'], missing: [] },
  experience_match: '直接匹配',
  soft_skills_match: '',
  strengths: ['用户研究'],
  weaknesses: [],
  jd_structure: jd,
}

describe('ResumeGeneratorAgent v4.4 production pipeline', () => {
  test('runs planning, drafting, final audit, and deterministic gates', async () => {
    const plan = JSON.stringify({
      target_value_proposition: '用户研究产品经理',
      jd_core_priorities: [{ id: 'J1', priority: 1, outcome: '用户研究', source: 'explicit_jd' }],
      evidence_pillars: [{
        title: '增长证据',
        selected_evidence: [{
          source_path: 'experience[0].achievements[0]',
          source_quote: '模型错误原文',
          safe_usage: '模型错误表述',
          verification_status: 'verified',
        }],
      }],
      experience_plan: [{
        source_path: 'experience[0]',
        treatment: 'expand',
        bullet_budget: 2,
        selected_evidence_paths: ['experience[0].achievements[0]'],
      }],
      project_plan: [],
      skills_to_feature: [{ skill: '用户研究', source_path: 'skills.hard_skills[0]' }],
      forbidden_claims: [],
      content_budget: {
        mode: 'preserve_compact',
        max_total_bullets: 10,
        max_project_count: 1,
        max_markdown_chars: 900,
      },
    })
    const draft = '# 张三\n\n## 工作经历\n\n- 核心转化率提升约11%'
    const audited = '# 张三\n\n## 工作经历\n\n- 核心转化率提升约11%\n- 目标提升至99.5%\n\n## 专业技能\n\n- 用户研究'
    const provider = new SequenceProvider([plan, draft, audited])

    const result = await new ResumeGeneratorAgent(provider).generate(sourceResume, jd, matching)

    expect(provider.inputs).toHaveLength(3)
    expect(provider.inputs[0].responseFormat).toBe('json_object')
    expect(provider.inputs[0].promptVersion).toContain('resume-generator.plan.one-job-v4.4')
    expect(provider.inputs[1].promptVersion).toContain('resume-generator.draft.one-job-v4.4')
    expect(provider.inputs[2].promptVersion).toContain('resume-generator.final-audit.one-job-v4.4')
    expect(result).toContain('核心转化率提升约11%')
    expect(result).not.toContain('99.5%')
  })
})
