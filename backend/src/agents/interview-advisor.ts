import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, renderPromptVariantInstruction, resolvePromptVariant } from '@/harness/prompt-variant'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isInterviewSuggestions } from '@/schemas/interview-suggestions'
import type { AgentExecutionOptions } from '@/agents/types'
import type { InterviewSuggestions, MatchAnalysis, ResumeAnalysis } from '@/types'

/**
 * Interview Advisor Agent
 * 基于岗位分析、匹配分析和优化后的简历生成面试建议。
 */
export class InterviewAdvisorAgent {
  private readonly provider: LlmProvider

  constructor(provider: LlmProvider = fallbackLlmProvider) {
    this.provider = provider
  }

  async advise(
    analysis: ResumeAnalysis,
    matching: MatchAnalysis,
    optimizedResume: string,
    options: AgentExecutionOptions = {}
  ): Promise<InterviewSuggestions> {
    const promptVariant = resolvePromptVariant(options.promptVariant)
    const variantInstruction = renderPromptVariantInstruction(promptVariant)
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

${variantInstruction}

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
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        responseFormat: 'json_object',
        temperature: 0.4,
        promptVersion: getPromptVersion('interview-advisor', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      return await parseJsonOutput({
        content: response.content,
        validator: isInterviewSuggestions,
        outputName: 'InterviewSuggestions',
        eventBus: options.eventBus,
        stepContext: options.stepContext,
        repair: async ({ content, errorMessage, outputName }) => {
          const repairResponse = await this.provider.complete({
            messages: [
              {
                role: 'user',
                content: `请只修复下面 ${outputName} 的 JSON 格式或字段结构，不要重新推理业务内容。\n错误：${errorMessage}\n原始输出：\n${content}`,
              },
            ],
            responseFormat: 'json_object',
            temperature: 0,
            promptVersion: getPromptVersion('interview-advisor.repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })
    } catch (error) {
      console.error('Interview advice generation failed:', error)
      throw new Error(`面试建议生成失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
