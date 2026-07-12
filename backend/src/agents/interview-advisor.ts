import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import { buildInterviewAdviceMessages, buildJsonRepairMessages } from '@/prompts/final-prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isInterviewSuggestions, parseInterviewSuggestions } from '@/schemas/interview-suggestions'
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

    try {
      const response = await this.provider.complete({
        messages: buildInterviewAdviceMessages(analysis, matching, optimizedResume),
        responseFormat: 'json_object',
        temperature: 0.3,
        promptVersion: getPromptVersion('interview-advisor', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      const parsedOutput = await parseJsonOutput({
        content: response.content,
        validator: isInterviewSuggestions,
        outputName: 'InterviewSuggestions',
        eventBus: options.eventBus,
        stepContext: options.stepContext,
        repair: async ({ content, errorMessage, outputName }) => {
          const repairResponse = await this.provider.complete({
            messages: buildJsonRepairMessages({ outputName, errorMessage, content }),
            responseFormat: 'json_object',
            temperature: 0,
            promptVersion: getPromptVersion('interview-advisor.repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })

      return parseInterviewSuggestions(parsedOutput)
    } catch (error) {
      console.error('Interview advice generation failed:', error)
      throw new Error(`面试建议生成失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
