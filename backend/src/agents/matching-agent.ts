import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, renderPromptVariantInstruction, resolvePromptVariant } from '@/harness/prompt-variant'
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
    const variantInstruction = renderPromptVariantInstruction(promptVariant)
    const prompt = `你是一位资深的招聘匹配专家。请基于结构化简历和结构化 JD 分析候选人与岗位的匹配情况。

${variantInstruction}

候选人简历（结构化数据）：
\`\`\`json
${JSON.stringify(resume, null, 2)}
\`\`\`

目标岗位（结构化数据）：
\`\`\`json
${JSON.stringify(jd, null, 2)}
\`\`\`

请完成以下任务并以 JSON 格式返回结果：

1. **匹配度评分** (match_score)：
   - 0-100 分，综合评估候选人与岗位的匹配程度

2. **硬性要求匹配** (hard_requirements_match)：
   - 对象格式：{ "学历": true/false, "工作年限": true/false, "技能1": true/false, ... }
   - 逐项分析候选人是否满足硬性要求

3. **技能匹配分析** (skill_match)：
   - matched: 候选人已具备的匹配技能数组
   - missing: 候选人缺失的关键技能数组

4. **经验匹配度** (experience_match)：
   - 用 1-2 句话描述候选人的工作经验与岗位要求的匹配情况

5. **软技能匹配度** (soft_skills_match)：
   - 用 1-2 句话描述候选人的软技能与岗位文化的匹配情况

6. **优势点** (strengths)：
   - 列出 3-5 个候选人的突出优势（体现与岗位的强匹配点）

7. **劣势点** (weaknesses)：
   - 列出 2-3 个候选人需要改进的地方（体现与岗位的差距）
   - 保持为字符串数组，便于前端直接展示

8. **劣势证据标注** (weakness_details)：
   - 必须与 weaknesses 一一对应，每条弱点都要标注证据类型
   - evidence_type 只能取以下三类之一：
     - direct_missing：源简历中确实没有相关经历或技能证据
     - implicit_evidence：源简历项目/经历能间接证明，但没有显式写清楚 JD 需要的能力
     - wording_gap：能力可能具备，只是表达不够贴近 JD 关键词或业务场景
   - evidence 写明判断依据，必须引用源简历或 JD 中可见的信息，不要凭空推断
   - suggestion 给出改写方向，优先建议显式化表达，不要把 implicit_evidence 误判成 direct_missing

**重要提示**：
- 必须严格按照 JSON 格式返回
- 评估必须客观、准确，基于事实
- 如果 JD 中某些信息不明确，可以合理推断但不要过度解读
- 判断弱点时要区分“真的没有”和“有间接证据但表达不够明确”。例如候选人有多个 Web 项目经验，但没有直接写“工程化/性能优化/组件化”，应优先标为 implicit_evidence 或 wording_gap，而不是 direct_missing

返回格式示例：
{
  "match_score": 85,
  "hard_requirements_match": {
    "学历要求": true,
    "工作年限": true,
    "Java": true,
    "Spring": false
  },
  "skill_match": {
    "matched": ["Java", "Python", "MySQL"],
    "missing": ["Spring Cloud", "Kubernetes"]
  },
  "experience_match": "候选人具备5年后端开发经验，与岗位要求的3-5年经验高度匹配...",
  "soft_skills_match": "候选人展现出良好的团队协作和问题解决能力...",
  "strengths": ["优势1", "优势2", "优势3"],
  "weaknesses": ["劣势1", "劣势2"],
  "weakness_details": [
    {
      "weakness": "劣势1",
      "evidence_type": "implicit_evidence",
      "evidence": "源简历有相关项目经验，但没有直接使用 JD 中的关键词描述该能力",
      "suggestion": "在项目经历中补充该能力的使用场景和结果"
    },
    {
      "weakness": "劣势2",
      "evidence_type": "wording_gap",
      "evidence": "源简历体现了相近能力，但表达与 JD 术语不一致",
      "suggestion": "将相近表述改写为 JD 关键词，并保留事实边界"
    }
  ],
  "jd_structure": ${JSON.stringify(jd, null, 2)}
}`

    try {
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        responseFormat: 'json_object',
        temperature: 0.3,
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
            messages: [
              {
                role: 'user',
                content: `请只修复下面 ${outputName} 的 JSON 格式或字段结构，不要重新推理业务内容。\n错误：${errorMessage}\n原始输出：\n${content}`,
              },
            ],
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
