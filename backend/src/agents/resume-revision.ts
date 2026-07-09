import { getPromptVersion, renderPromptVariantInstruction, resolvePromptVariant } from '@/harness/prompt-variant'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import type { AgentExecutionOptions } from '@/agents/types'
import type { EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'
import type { ResumeStructure, JDStructure, MatchAnalysis } from '@/types'

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
    const variantInstruction = renderPromptVariantInstruction(promptVariant)
    const prompt = `你是一位负责简历质量修复的 Agent。请基于源简历事实、目标岗位、匹配分析和质量门禁问题，修订上一版优化简历。

源简历（结构化数据）：
\`\`\`json
${JSON.stringify(sourceResume, null, 2)}
\`\`\`

目标岗位（结构化数据）：
\`\`\`json
${JSON.stringify(jd, null, 2)}
\`\`\`

匹配分析结果：
\`\`\`json
${JSON.stringify(matchAnalysis, null, 2)}
\`\`\`

上一版优化简历：
\`\`\`markdown
${previousResume}
\`\`\`

质量门禁评估结果：
\`\`\`json
${JSON.stringify(evaluation, null, 2)}
\`\`\`

${variantInstruction}

请按以下规则修订：

1. 只修复质量门禁指出的问题，例如内容过短、缺少工作经历章节、缺少技能章节、包含模板占位文本。
2. 只能使用源简历已有事实，不要编造公司、职位、项目、学校、时间、成果或量化指标。
3. 保留上一版中已经正确且与 JD 匹配的内容，只做必要补充、删改和格式修复。
4. 移除所有模板占位文本，例如 XXX、公司名称、职位名称、项目名称、学校名称。
5. 如果缺少章节，请基于源简历事实补齐工作经历、项目经验、教育背景或技能清单。
6. 保持 Markdown 简历结构清晰，适合直接投递。

输出要求：
- 只输出修订后的完整 Markdown 简历文本
- 不要输出解释、修订说明、JSON 或代码块
- 不要用代码块包裹 Markdown 简历

现在请输出修订后的完整简历：`

    try {
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        promptVersion: getPromptVersion('resume-revision', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      return response.content.trim()
    } catch (error) {
      console.error('Resume revision failed:', error)
      throw new Error(`简历修订失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
