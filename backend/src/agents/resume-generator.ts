import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import {
  buildV44AggressiveGenerationMessages,
  buildV44FinalAuditMessages,
  buildV44ResumePlanMessages,
} from '@/prompts/v44-one-job-one-resume-prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { ChatMessage, LlmProvider } from '@/providers/llm-provider'
import type { AgentExecutionOptions } from '@/agents/types'
import type { ResumeStructure, JDStructure, MatchAnalysis } from '@/types'
import {
  buildIdentityTimeline,
  buildSourceProfile,
  compactResumePlanForAudit,
  exceedsResumePlanBudget,
  getResumeBudgetStats,
  getResumePlanBudget,
  parseJsonObject,
  postProcessV44Resume,
  sanitizeResumePlan,
  stripMarkdownFence,
} from '@/agents/resume-generator-v44-support'

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
      const rawPlan = await this.completePlan(
        buildV44ResumePlanMessages({
          sourceResume,
          jobDescription: jd,
          matchAnalysis,
          sourceProfile: buildSourceProfile(sourceResume, matchAnalysis),
        }),
        promptVariant,
        options
      )
      const resumePlan = sanitizeResumePlan(rawPlan, sourceResume)
      const identityTimeline = buildIdentityTimeline(sourceResume)

      const draftResponse = await this.provider.complete({
        messages: buildV44AggressiveGenerationMessages({ identityTimeline, resumePlan }),
        temperature: 0.25,
        promptVersion: getPromptVersion('resume-generator.draft', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })
      const draftResume = stripMarkdownFence(draftResponse.content)
      const auditPlan = compactResumePlanForAudit(resumePlan)
      const auditResponse = await this.provider.complete({
        messages: buildV44FinalAuditMessages({
          identityTimeline,
          resumePlan: auditPlan,
          draftResume,
        }),
        temperature: 0.05,
        promptVersion: getPromptVersion('resume-generator.final-audit', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })
      let optimizedResume = stripMarkdownFence(auditResponse.content)

      if (exceedsResumePlanBudget(optimizedResume, resumePlan)) {
        const stats = getResumeBudgetStats(optimizedResume)
        const budget = getResumePlanBudget(resumePlan)
        const repairMessages = buildV44FinalAuditMessages({
          identityTimeline,
          resumePlan: auditPlan,
          draftResume: optimizedResume,
        })
        repairMessages.push({
          role: 'user',
          content: `当前草稿实测为 ${stats.bullets} 条列表项、${stats.projects} 个项目、${stats.chars} 个字符；硬上限为 ${budget.bullets} 条、${budget.projects} 个、${budget.chars} 字符。必须实际删除到三项都达标，只能返回压缩后的 Markdown。`,
        })
        const repairResponse = await this.provider.complete({
          messages: repairMessages,
          temperature: 0,
          promptVersion: getPromptVersion('resume-generator.budget-repair', promptVariant),
          eventBus: options.eventBus,
          stepContext: options.stepContext,
        })
        optimizedResume = stripMarkdownFence(repairResponse.content)
      }

      return postProcessV44Resume(optimizedResume, sourceResume)
    } catch (error) {
      console.error('Resume generation failed:', error)
      throw new Error(`简历生成失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  private async completePlan(
    messages: ChatMessage[],
    promptVariant: ReturnType<typeof resolvePromptVariant>,
    options: AgentExecutionOptions
  ) {
    const response = await this.provider.complete({
      messages,
      temperature: 0.05,
      responseFormat: 'json_object',
      promptVersion: getPromptVersion('resume-generator.plan', promptVariant),
      eventBus: options.eventBus,
      stepContext: options.stepContext,
    })

    try {
      return parseJsonObject(response.content)
    } catch (error) {
      const repairResponse = await this.provider.complete({
        messages: [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: `上次输出无法解析：${error instanceof Error ? error.message : String(error)}。禁止重新选材，只把已有内容修成符合既定结构的 JSON。`,
          },
        ],
        temperature: 0,
        responseFormat: 'json_object',
        promptVersion: getPromptVersion('resume-generator.plan-json-repair', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })
      return parseJsonObject(repairResponse.content)
    }
  }
}
