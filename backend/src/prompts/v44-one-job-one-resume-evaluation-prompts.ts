import type { ChatMessage } from '@/providers/llm-provider'

export const V44_PROMPT_AB_JUDGE_VERSION = '4.4.5-ab-blind-quality-gates'

function textData(label: string, value: string) {
  return `<${label}>\n${value}\n</${label}>`
}

export interface V44PromptABJudgeInput {
  sourceResume: string
  jobDescription: string
  candidateA: string
  candidateB: string
}

export function buildV44PromptABJudgeMessages(input: V44PromptABJudgeInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是离线提示词 A/B 评测员，不参与 Reffo 的正式简历生成流程。你不知道 A、B 来自哪个提示词版本，也不得猜测版本身份。先分别判断每份简历能否安全投递，再比较哪份更接近“一岗一简历”。候选人原始能力不足不是提示词缺陷；你只评价输出如何忠实、充分且有针对性地选择和表达已有证据。只输出 JSON。`,
    },
    {
      role: 'user',
      content: `请对两份匿名候选简历进行独立盲评。\n\n${textData('source_resume', input.sourceResume)}\n\n${textData('job_description', input.jobDescription)}\n\n${textData('candidate_A', input.candidateA)}\n\n${textData('candidate_B', input.candidateB)}

输出结构：
{
  "evaluations": [
    {
      "candidate_id": "A|B",
      "total_score": 0,
      "factual_fidelity": 0,
      "job_specificity": 0,
      "evidence_selection": 0,
      "result_density": 0,
      "career_coherence": 0,
      "conciseness_readability": 0,
      "deliverability": 0,
      "absolute_gate": "pass|fail",
      "unsupported_claims": [],
      "attribution_errors": [],
      "empty_work_entries": [],
      "empty_project_entries": [],
      "missing_high_value_evidence": [],
      "irrelevant_or_overexpanded_content": [],
      "internal_audit_leaks": [],
      "strengths": [],
      "weaknesses": []
    }
  ],
  "winner": "A|B|tie",
  "confidence": "high|medium|low",
  "reason": ""
}

评分权重：事实忠实 20、岗位专属性 20、证据选材 15、结果密度 10、职业连贯性 10、简洁可读 15、可投递性 10，总分 100。total_score 必须严格等于七项分数之和。

判断规则：
1. 先做绝对质量门禁，再比较 A/B。出现空工作、空项目、明显过度裁剪、关键资历不可判断或基本不可投递时，不得仅凭更短、更聚焦或与另一版差异更大判为胜者。
2. 岗位专属性检查顶部价值主张、核心项目和主要 bullet 是否直接回应 JD 的前三项结果，而不只是替换关键词。
3. 证据选材奖励保留高价值职业锚点并合理压缩弱相关、重复事实；若删去能证明核心资历或岗位胜任力的证据，造成覆盖下降、时间线断裂或结果密度下降，必须扣分。
4. 相近岗位复用真实核心证据是合理的。“一岗一简历”看定制价值主线、证据优先级、项目组合和篇幅分配，不以 bullet 零复用为目标。
5. 事实忠实严查新增数字、日期推算年限、JD 技能泄漏、因果升级、参与升级为主导，以及团队结果变个人结果。
6. 任一新增硬事实或虚构技能：absolute_gate=fail，factual_fidelity 不得高于 8/20，total_score 不得高于 59。
7. 任一明显归因升级：factual_fidelity 不得高于 12/20，total_score 不得高于 69。
8. 任一空工作或空项目：absolute_gate=fail，deliverability 不得高于 3/10；不得通过其他维度高分抵消。
9. 出现“个人材料自述、需确认、待核验、PRD 记录”等内部审计信息：absolute_gate=fail，deliverability 不得高于 2/10。
10. 简历过长、工作与项目重复、保留大量弱相关内容时，应扣 evidence_selection 和 conciseness_readability；过短、删除关键证明或只剩标题时，应扣 evidence_selection、result_density、career_coherence 和 deliverability。
11. 不因候选人缺少 JD 硬技能而惩罚输出；诚实呈现可迁移证据优于虚假匹配。但若源简历已有相关证据却被漏掉，应作为提示词输出缺陷扣分。
12. 只有两份都通过 absolute_gate 时，才优先比较总分；一份失败而另一份通过时，失败者不得获胜；两份都失败且没有明显质量差时判 tie。
13. A/B 身份未知。不得猜测哪个是旧版或新候选版，也不得因写作风格推断版本后给予偏好。
14. 只输出 JSON，不要解释或使用代码块。`,
    },
  ]
}
