import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import { buildResumeRevisionMessages } from '@/prompts/prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import type { AgentExecutionOptions } from '@/agents/types'
import type { EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'
import type { ResumeStructure, JDStructure, MatchAnalysis } from '@/types'
import { postProcessV44Resume } from '@/agents/resume-generator-v44-support'

/**
 * Resume Revision Agent
 * 负责基于 Harness 质量门禁问题修订上一版 Markdown 简历
 */
export class ResumeRevisionAgent {
  private readonly provider: LlmProvider

  constructor(provider: LlmProvider = fallbackLlmProvider) {
    this.provider = provider
  }

  async revise(
    sourceResume: ResumeStructure,
    jd: JDStructure,
    matchAnalysis: MatchAnalysis,
    previousResume: string,
    evaluation: EvaluationResult,
    options: AgentExecutionOptions = {}
  ): Promise<string> {
    const promptVariant = resolvePromptVariant(options.promptVariant)

    try {
      const response = await this.provider.complete({
        messages: buildResumeRevisionMessages(
          sourceResume,
          jd,
          matchAnalysis,
          previousResume,
          evaluation
        ),
        temperature: 0.2,
        promptVersion: getPromptVersion('resume-revision', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      return postProcessV44Resume(response.content, sourceResume)
    } catch (error) {
      console.error('Resume revision failed:', error)
      throw new Error(`简历修订失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
