import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import { buildJdParsingMessages, buildJsonRepairMessages } from '@/prompts/prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isJDStructure, jdStructureSchema } from '@/schemas/match-analysis'
import type { AgentExecutionOptions } from '@/agents/types'
import type { JDStructure } from '@/types'

export class JDParserAgent {
  private readonly provider: LlmProvider

  constructor(provider: LlmProvider = fallbackLlmProvider) {
    this.provider = provider
  }

  async parse(jdText: string, options: AgentExecutionOptions = {}): Promise<JDStructure> {
    const promptVariant = resolvePromptVariant(options.promptVariant)

    try {
      const response = await this.provider.complete({
        messages: buildJdParsingMessages(jdText),
        responseFormat: 'json_object',
        temperature: 0.2,
        promptVersion: getPromptVersion('jd-parser', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      const parsedOutput = await parseJsonOutput({
        content: response.content,
        validator: isJDStructure,
        outputName: 'JDStructure',
        eventBus: options.eventBus,
        stepContext: options.stepContext,
        repair: async ({ content, errorMessage, outputName }) => {
          const repairResponse = await this.provider.complete({
            messages: buildJsonRepairMessages({ outputName, errorMessage, content }),
            responseFormat: 'json_object',
            temperature: 0,
            promptVersion: getPromptVersion('jd-parser.repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })

      return jdStructureSchema.parse(parsedOutput) as JDStructure
    } catch (error) {
      console.error('JD parse failed:', error)
      throw new Error(`JD 解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
