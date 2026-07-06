import OpenAI from 'openai'
import { env } from '@/config/env'
import type { InterviewSuggestions, MatchAnalysis, ResumeAnalysis } from '@/types'

/**
 * Interview Advisor Agent
 * 基于岗位分析、匹配分析和优化后的简历生成面试建议。
 */
export class InterviewAdvisorAgent {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  }

  async advise(
    analysis: ResumeAnalysis,
    matching: MatchAnalysis,
    optimizedResume: string
  ): Promise<InterviewSuggestions> {
    const prompt = `你是一位资深面试教练。请基于候选人的简历分析、岗位匹配分析和已经优化后的简历，生成针对目标岗位的面试建议。

简历分析：
\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`

岗位匹配分析：
\`\`\`json
${JSON.stringify(matching, null, 2)}
\`\`\`

优化后的简历：
\`\`\`markdown
${optimizedResume}
\`\`\`

请严格返回 JSON，字段如下：
{
  "questions": ["高概率面试问题1", "高概率面试问题2", "高概率面试问题3"],
  "story_recommendations": [
    {
      "title": "推荐准备的项目或经历标题",
      "background": "应该如何介绍背景和职责",
      "result": "应该强调的结果、指标或影响"
    }
  ]
}

要求：
- 问题必须贴合目标岗位和简历中的真实经历。
- 故事推荐必须依赖优化后的简历内容，不要凭空编造项目。
- 输出只包含 JSON，不要包含解释。`

    try {
      const response = await this.client.chat.completions.create({
        model: env.AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('AI 返回内容为空')
      }

      return JSON.parse(content) as InterviewSuggestions
    } catch (error) {
      console.error('Interview advice generation failed:', error)
      throw new Error(`面试建议生成失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
