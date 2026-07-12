import { describe, expect, test } from 'bun:test'
import { inferResumeNameFromMarkdown, ResumeAnalyzerAgent } from '@/agents/resume-analyzer'
import type { LlmProvider } from '@/providers/llm-provider'

describe('ResumeAnalyzerAgent name recovery', () => {
  test('extracts a person name from the first Markdown heading', () => {
    expect(inferResumeNameFromMarkdown('# 张三\n\n## 工作经历')).toBe('张三')
    expect(inferResumeNameFromMarkdown('# Jane Doe | Product Manager')).toBe('Jane Doe')
    expect(inferResumeNameFromMarkdown('# 个人简历\n\n正文')).toBe('')
    expect(inferResumeNameFromMarkdown('# 产品经理\n\n正文')).toBe('')
  })

  test('restores a heading name when the model leaves personal_info.name empty', async () => {
    const provider: LlmProvider = {
      complete: async () => ({
        provider: 'fake',
        model: 'fake-model',
        latencyMs: 1,
        content: JSON.stringify({
          quality_score: 70,
          strengths: ['用户调研'],
          weaknesses: ['成果证据较少'],
          suggestions: ['重排已有证据'],
          capability_summary: '具备产品工作经验。',
          structured_resume: {
            personal_info: { name: '', current_position: '产品经理' },
            education: [],
            experience: [{
              company: '示例公司',
              position: '产品经理',
              time_range: '2023-至今',
              responsibilities: ['负责用户调研'],
              achievements: [],
            }],
            projects: [],
            skills: { hard_skills: ['用户调研'], soft_skills: [] },
          },
        }),
      }),
    }

    const result = await new ResumeAnalyzerAgent(provider).analyze(
      '# 测试用户\n\n## 工作经历\n\n负责用户调研'
    )

    expect(result.structured_resume.personal_info.name).toBe('测试用户')
  })
})
