import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import { buildJsonRepairMessages, buildResumeAnalysisMessages } from '@/prompts/final-prompts'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isResumeAnalysis, parseResumeAnalysis } from '@/schemas/resume-analysis'
import type { AgentExecutionOptions } from '@/agents/types'
import type { ResumeAnalysis } from '@/types'

const GENERIC_RESUME_HEADINGS = new Set([
  'resume',
  'cv',
  '个人简历',
  '求职简历',
  '简历',
  '个人履历',
])
const ROLE_HEADING_PATTERN = /(经理|工程师|设计师|总监|专员|顾问|主管|实习生|教师|医生|律师|会计|研究员|分析师|运营)$/

export function inferResumeNameFromMarkdown(markdown: string) {
  const heading = markdown
    .split(/\r?\n/)
    .map(line => line.match(/^#\s+(.+?)\s*$/)?.[1]?.trim())
    .find(Boolean)

  if (!heading) {
    return ''
  }

  const normalizedHeading = heading
    .replace(/[*_`]/g, '')
    .replace(/^姓名[：:]\s*/, '')
    .trim()
  const candidate = normalizedHeading.split(/\s+[|｜·—-]\s+|[|｜]/)[0]?.trim() ?? ''

  if (
    !candidate ||
    candidate.length > 40 ||
    GENERIC_RESUME_HEADINGS.has(candidate.toLowerCase()) ||
    ROLE_HEADING_PATTERN.test(candidate)
  ) {
    return ''
  }

  return candidate
}

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

      const analysis = parseResumeAnalysis(parsedOutput)
      if (analysis.structured_resume.personal_info.name.trim()) {
        return analysis
      }

      const inferredName = inferResumeNameFromMarkdown(resumeMarkdown)
      if (!inferredName) {
        return analysis
      }

      return {
        ...analysis,
        structured_resume: {
          ...analysis.structured_resume,
          personal_info: {
            ...analysis.structured_resume.personal_info,
            name: inferredName,
          },
        },
      }
    } catch (error) {
      console.error('Resume analysis failed:', error)
      throw new Error(`简历分析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
