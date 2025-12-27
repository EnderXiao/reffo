import OpenAI from 'openai'
import { env } from '@/config/env'
import type { MatchAnalysis, ResumeStructure, JDStructure } from '@/types'

/**
 * Matching Agent
 * 负责解析 JD 并分析简历与岗位的匹配度
 */
export class MatchingAgent {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  }

  /**
   * 分析简历与 JD 的匹配度
   * @param resume 结构化简历数据
   * @param jdText JD 文本内容
   * @returns 匹配分析结果
   */
  async match(resume: ResumeStructure, jdText: string): Promise<MatchAnalysis> {
    const prompt = `你是一位资深的招聘匹配专家。请分析候选人简历与目标岗位的匹配情况。

候选人简历（结构化数据）：
\`\`\`json
${JSON.stringify(resume, null, 2)}
\`\`\`

目标岗位描述（JD）：
\`\`\`
${jdText}
\`\`\`

请完成以下任务并以 JSON 格式返回结果：

1. **JD 结构化解析** (jd_structure)：
   - basic_info: 岗位基本信息（title: 职位名称, company: 公司, location: 地点）
   - hard_requirements: 硬性要求（education: 学历, experience_years: 工作年限, required_skills: 必备技能数组）
   - responsibilities: 岗位职责数组
   - tasks: 具体任务数组
   - soft_skills: 软技能要求数组
   - nice_to_have: 加分项数组

2. **匹配度评分** (match_score)：
   - 0-100 分，综合评估候选人与岗位的匹配程度

3. **硬性要求匹配** (hard_requirements_match)：
   - 对象格式：{ "学历": true/false, "工作年限": true/false, "技能1": true/false, ... }
   - 逐项分析候选人是否满足硬性要求

4. **技能匹配分析** (skill_match)：
   - matched: 候选人已具备的匹配技能数组
   - missing: 候选人缺失的关键技能数组

5. **经验匹配度** (experience_match)：
   - 用 1-2 句话描述候选人的工作经验与岗位要求的匹配情况

6. **软技能匹配度** (soft_skills_match)：
   - 用 1-2 句话描述候选人的软技能与岗位文化的匹配情况

7. **优势点** (strengths)：
   - 列出 3-5 个候选人的突出优势（体现与岗位的强匹配点）

8. **劣势点** (weaknesses)：
   - 列出 2-3 个候选人需要改进的地方（体现与岗位的差距）

**重要提示**：
- 必须严格按照 JSON 格式返回
- 评估必须客观、准确，基于事实
- 如果 JD 中某些信息不明确，可以合理推断但不要过度解读

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
  "jd_structure": {
    "basic_info": { ... },
    "hard_requirements": { ... },
    "responsibilities": [ ... ],
    "tasks": [ ... ],
    "soft_skills": [ ... ],
    "nice_to_have": [ ... ]
  }
}`

    try {
      const response = await this.client.chat.completions.create({
        model: env.AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('AI 返回内容为空')
      }

      const result = JSON.parse(content) as MatchAnalysis
      return result
    } catch (error) {
      console.error('Matching analysis failed:', error)
      throw new Error(`匹配分析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
