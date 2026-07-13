import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import { buildResumeGenerationMessages } from '@/prompts/prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import type { AgentExecutionOptions } from '@/agents/types'
import type { ResumeStructure, JDStructure, MatchAnalysis } from '@/types'

/**
 * Resume Generator Agent
 * 负责根据匹配分析结果重新编排和优化简历，输出 Markdown 格式
 */
export class ResumeGeneratorAgent {
  private readonly provider: LlmProvider

  constructor(provider: LlmProvider = fallbackLlmProvider) {
    this.provider = provider
  }

  /**
   * 生成优化后的简历
   * @param sourceResume 原始结构化简历
   * @param jd 目标岗位结构化数据
   * @param matchAnalysis 匹配分析结果
   * @returns Markdown 格式的优化简历
   */
  async generate(
    sourceResume: ResumeStructure,
    jd: JDStructure,
    matchAnalysis: MatchAnalysis,
    options: AgentExecutionOptions = {}
  ): Promise<string> {
    const promptVariant = resolvePromptVariant(options.promptVariant)

    try {
      const response = await this.provider.complete({
        messages: buildResumeGenerationMessages(sourceResume, jd, matchAnalysis),
        temperature: 0.35,
        promptVersion: getPromptVersion('resume-generator', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      return response.content.trim()
    } catch (error) {
      console.error('Resume generation failed:', error)
      throw new Error(`简历生成失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
