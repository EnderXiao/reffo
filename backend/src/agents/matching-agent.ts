import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import { buildJsonRepairMessages, buildMatchingMessages } from '@/prompts/prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isMatchAnalysisOutput, matchAnalysisOutputSchema } from '@/schemas/match-analysis'
import type { AgentExecutionOptions } from '@/agents/types'
import type { MatchAnalysis, ResumeStructure, JDStructure } from '@/types'

/**
 * Matching Agent
 * 负责解析 JD 并分析简历与岗位的匹配度
 */
export class MatchingAgent {
  private readonly provider: LlmProvider

  constructor(provider: LlmProvider = fallbackLlmProvider) {
    this.provider = provider
  }

  /**
   * 分析简历与 JD 的匹配度
   * @param resume 结构化简历数据
   * @param jd 结构化 JD 数据
   * @returns 匹配分析结果
   */
  async match(
    resume: ResumeStructure,
    jd: JDStructure,
    options: AgentExecutionOptions = {}
  ): Promise<MatchAnalysis> {
    const promptVariant = resolvePromptVariant(options.promptVariant)

    try {
      const response = await this.provider.complete({
        messages: buildMatchingMessages(resume, jd),
        responseFormat: 'json_object',
        temperature: 0.25,
        promptVersion: getPromptVersion('matching', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      const parsedOutput = await parseJsonOutput({
        content: response.content,
        validator: isMatchAnalysisOutput,
        outputName: 'MatchAnalysis',
        eventBus: options.eventBus,
        stepContext: options.stepContext,
        repair: async ({ content, errorMessage, outputName }) => {
          const repairResponse = await this.provider.complete({
            messages: buildJsonRepairMessages({ outputName, errorMessage, content }),
            responseFormat: 'json_object',
            temperature: 0,
            promptVersion: getPromptVersion('matching.repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })

      const normalizedOutput = matchAnalysisOutputSchema.parse(parsedOutput)

      return {
        ...normalizedOutput,
        jd_structure: jd,
      }
    } catch (error) {
      console.error('Matching analysis failed:', error)
      throw new Error(`匹配分析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
