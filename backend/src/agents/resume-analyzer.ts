import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, renderPromptVariantInstruction, resolvePromptVariant } from '@/harness/prompt-variant'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import { isResumeAnalysis } from '@/schemas/resume-analysis'
import type { AgentExecutionOptions } from '@/agents/types'
import type { ResumeAnalysis, ResumeStructure } from '@/types'

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
    const variantInstruction = renderPromptVariantInstruction(promptVariant)
    const prompt = `你是一位资深的人力资源专家和简历顾问。请对以下 Markdown 格式的简历进行全面分析。

简历内容：
\`\`\`markdown
${resumeMarkdown}
\`\`\`

${variantInstruction}

请完成以下任务并以 JSON 格式返回结果：

1. **结构化提取** (structured_resume)：
   - personal_info: 个人信息（姓名、联系方式、当前职位等）
   - education: 教育背景数组（学校、专业、学历、时间、成就）
   - experience: 工作经历数组（公司、职位、时间、职责、成就）
   - projects: 项目经验数组（可选，项目名称、角色、技术栈、描述、成果）
   - skills: 技能列表（hard_skills: 硬技能数组, soft_skills: 软技能数组）

2. **质量评分** (quality_score)：
   - 0-100 分，综合评估简历的完整性、清晰度、专业性

3. **优势分析** (strengths)：
   - 列出 3-5 个简历的亮点（例如：量化成果、技术深度、项目经验等）

4. **问题诊断** (weaknesses)：
   - 列出 3-5 个需要改进的问题（例如：缺乏量化数据、描述模糊、格式不统一等）

5. **优化建议** (suggestions)：
   - 提供 3-5 条具体的优化建议

6. **能力模型总结** (capability_summary)：
   - 用 2-3 句话概括候选人的核心能力和职业定位

**重要提示**：
- 必须严格按照 JSON 格式返回
- 所有信息必须基于简历内容，不得杜撰
- 如果某些信息缺失，对应字段可为空数组或空字符串
- 输出的 JSON 必须是有效的、可直接解析的

返回格式示例：
{
  "quality_score": 75,
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"],
  "capability_summary": "能力总结...",
  "structured_resume": {
    "personal_info": { ... },
    "education": [ ... ],
    "experience": [ ... ],
    "projects": [ ... ],
    "skills": { ... }
  }
}`

    try {
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        responseFormat: 'json_object',
        temperature: 0.3,
        promptVersion: getPromptVersion('resume-analyzer', promptVariant),
        eventBus: options.eventBus,
        stepContext: options.stepContext,
      })

      return await parseJsonOutput({
        content: response.content,
        validator: isResumeAnalysis,
        outputName: 'ResumeAnalysis',
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
            promptVersion: getPromptVersion('resume-analyzer.repair', promptVariant),
            eventBus: options.eventBus,
            stepContext: options.stepContext,
          })

          return repairResponse.content
        },
      })
    } catch (error) {
      console.error('Resume analysis failed:', error)
      throw new Error(`简历分析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
