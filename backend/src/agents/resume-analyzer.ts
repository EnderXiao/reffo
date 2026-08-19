import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import type { EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'
import {
  buildJsonRepairMessages,
  buildResumeAnalysisBusinessRepairMessages,
  buildResumeAnalysisMessages,
} from '@/prompts/prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isResumeAnalysis, parseResumeAnalysis } from '@/schemas/resume-analysis'
import type { AgentExecutionOptions } from '@/agents/types'
import type { ResumeAnalysis } from '@/types'

/**
 * Resume Analyzer Agent
 * 负责分析 Markdown 格式的简历，提取结构化信息并提供优化建议
 */
export class ResumeAnalyzerAgent {
  private readonly provider: LlmProvider

  constructor(provider: LlmProvider = fallbackLlmProvider) {
    this.provider = provider
  }

  /**
   * 分析简历
   * @param resumeMarkdown Markdown 格式的简历内容
   * @returns 简历分析结果
   */
  async analyze(resumeMarkdown: string, options: AgentExecutionOptions = {}): Promise<ResumeAnalysis> {
    const promptVariant = resolvePromptVariant(options.promptVariant)

    try {
      const response = await this.provider.complete({
        messages: buildResumeAnalysisMessages(resumeMarkdown),
        responseFormat: 'json_object',
        temperature: 0.2,
        promptVersion: getPromptVersion('resume-analyzer', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      const parsedOutput = await parseJsonOutput({
        content: response.content,
        validator: isResumeAnalysis,
        outputName: 'ResumeAnalysis',
        eventBus: options.eventBus,
        stepContext: options.stepContext,
        repair: async ({ content, errorMessage, outputName }) => {
          const repairResponse = await this.provider.complete({
            messages: buildJsonRepairMessages({ outputName, errorMessage, content }),
            responseFormat: 'json_object',
            temperature: 0,
            promptVersion: getPromptVersion('resume-analyzer.repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })

      return parseResumeAnalysis(parsedOutput)
    } catch (error) {
      console.error('Resume analysis failed:', error)
      throw new Error(`简历分析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  async repairBusinessOutput(
    resumeMarkdown: string,
    currentOutput: ResumeAnalysis,
    evaluation: EvaluationResult,
    options: AgentExecutionOptions = {}
  ): Promise<ResumeAnalysis> {
    const promptVariant = resolvePromptVariant(options.promptVariant)

    try {
      const response = await this.provider.complete({
        messages: buildResumeAnalysisBusinessRepairMessages({
          resumeMarkdown,
          currentOutput,
          evaluation,
        }),
        responseFormat: 'json_object',
        temperature: 0,
        promptVersion: getPromptVersion('resume-analyzer.business-repair', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      const parsedOutput = await parseJsonOutput({
        content: response.content,
        validator: isResumeAnalysis,
        outputName: 'ResumeAnalysis',
        eventBus: options.eventBus,
        stepContext: options.stepContext,
        repair: async ({ content, errorMessage, outputName }) => {
          const repairResponse = await this.provider.complete({
            messages: buildJsonRepairMessages({ outputName, errorMessage, content }),
            responseFormat: 'json_object',
            temperature: 0,
            promptVersion: getPromptVersion('resume-analyzer.business-repair.json-repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })

      return parseResumeAnalysis(parsedOutput)
    } catch (error) {
      console.error('Resume analysis business repair failed:', error)
      throw new Error(`简历分析业务修复失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
