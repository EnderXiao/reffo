import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, renderPromptVariantInstruction, resolvePromptVariant } from '@/harness/prompt-variant'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isJDStructure } from '@/schemas/match-analysis'
import type { AgentExecutionOptions } from '@/agents/types'
import type { JDStructure } from '@/types'

export class JDParserAgent {
  private readonly provider: LlmProvider

  constructor(provider: LlmProvider = fallbackLlmProvider) {
    this.provider = provider
  }

  async parse(jdText: string, options: AgentExecutionOptions = {}): Promise<JDStructure> {
    const promptVariant = resolvePromptVariant(options.promptVariant)
    const variantInstruction = renderPromptVariantInstruction(promptVariant)
    const prompt = `你是一位资深招聘需求分析专家。请把下面 JD 解析为结构化 JSON。

${variantInstruction}

目标岗位描述（JD）：
\`\`\`
${jdText}
\`\`\`

请严格返回 JSON，字段如下：
{
  "basic_info": { "title": "职位名称", "company": "公司", "location": "地点" },
  "hard_requirements": { "education": "学历", "experience_years": "工作年限", "required_skills": ["必备技能"] },
  "responsibilities": ["岗位职责"],
  "tasks": ["具体任务"],
  "soft_skills": ["软技能要求"],
  "nice_to_have": ["加分项"]
}

要求：
- 只返回 JSON，不要包含解释。
- 不明确的信息使用空字符串或空数组，不要过度推断。`

    try {
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        responseFormat: 'json_object',
        temperature: 0.2,
        promptVersion: getPromptVersion('jd-parser', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      return await parseJsonOutput({
        content: response.content,
        validator: isJDStructure,
        outputName: 'JDStructure',
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
            promptVersion: getPromptVersion('jd-parser.repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })
    } catch (error) {
      console.error('JD parse failed:', error)
      throw new Error(`JD 解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
