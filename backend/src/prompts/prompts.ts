import type { EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'
import type { ChatMessage } from '@/providers/llm-provider'
import {
  PROMPT_VARIANT,
  PROMPT_VERSION,
  SHARED_FACT_SAFETY_CONTRACT,
} from '@/prompts/prompt-foundation'
import type {
  JDStructure,
  InterviewSuggestions,
  MatchAnalysis,
  ResumeAnalysis,
  ResumeStructure,
} from '@/types'

export { PROMPT_VERSION, PROMPT_VARIANT }

const FACT_SAFETY_CONTRACT = SHARED_FACT_SAFETY_CONTRACT

const CONTEXT_REASONING_CONTRACT = `
公司与工作地上下文规则：
1. 先使用 JD 明示的公司业务、客户、阶段、协作方式、语言和地点信息。
2. 可基于公司名称、业务描述和工作地形成谨慎的“上下文假设”，用于判断人才偏好、业务语境和面试验证方向；假设必须附依据与置信度。
3. 上下文假设不能改写成公司事实、岗位硬要求或候选人事实；不能用于虚构内部文化、团队现状、融资状态、当前战略或地域政策。
4. 明示 JD 要求优先于上下文假设；上下文只用于同等证据下的排序、表达侧重和待确认问题，不能制造一票否决项。
5. 依据不足时输出空数组和 unknown，不为“信息完整”而猜测。
6. 地名本身不能推出城市层级、人才供给、行业生态、工作节奏、成本、文化或协作方式；只有 JD 中与地点直接关联的业务/客户/协作信号才能形成岗位影响。
`.trim()

function jsonData(label: string, value: unknown) {
  return `<${label}>\n${JSON.stringify(value, null, 2)}\n</${label}>`
}

function textData(label: string, value: string) {
  return `<${label}>\n${value}\n</${label}>`
}

export function buildResumeAnalysisMessages(resumeMarkdown: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是证据优先的资深简历分析师。你的任务是完整提取候选人事实、评估原始简历质量，并为后续岗位定制建立可靠事实底座。\n\n${FACT_SAFETY_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请分析以下源简历。先在内部逐条核对事实，再只返回一个可解析的 JSON 对象。\n\n${textData('source_resume', resumeMarkdown)}

输出结构必须为：
{
  "quality_score": 0,
  "strengths": [],
  "weaknesses": [],
  "suggestions": [],
  "capability_summary": "",
  "structured_resume": {
    "personal_info": {
      "name": "",
      "contact": "",
      "email": "",
      "phone": "",
      "location": "",
      "current_position": ""
    },
    "education": [
      { "school": "", "major": "", "degree": "", "time_range": "", "achievements": [] }
    ],
    "experience": [
      { "company": "", "position": "", "time_range": "", "responsibilities": [], "achievements": [] }
    ],
    "projects": [
      { "name": "", "role": "", "tech_stack": [], "description": "", "achievements": [] }
    ],
    "skills": { "hard_skills": [], "soft_skills": [] }
  }
}

执行标准：
- 结构化提取尽量保留原文的专有名词、时间、数字和强弱程度；不要把多段不同经历合并成一段。
- 数字、单位、归属、时间与“约/近/超过/至少/最多/不足/逾”等限定词必须作为一个不可拆分的事实原子保留；不得改写精度、上下限方向或阈值。
- 不得根据任职起止日期自行计算“X 年经验”；只有源简历明示的任职年限才可作为候选人事实。
- 由你结合源简历语义判断姓名与当前职位，不依赖任何预设职业或岗位词表。一级标题若能明确识别为自然人姓名，应写入 personal_info.name；通用简历标题、职业/岗位名称均不得作为姓名。无法可靠区分时将 name 留空，不得猜测。
- responsibilities 只放职责/行动，achievements 只放源文明确表达的成果；不能把职责自动改判为成果。
- hard_skills 只收录源文明确出现或由具体工作对象直接证明的技能；soft_skills 不从空泛自我评价中扩写。
- quality_score 使用同一标尺：信息完整性 25、事实证据与成果 25、表达清晰度 20、结构一致性 15、岗位材料可用性 15。缺失不等于能力不足。
- “至今/现在/Present”是有效的开放结束时间，不得诊断为缺少结束时间。
- strengths、weaknesses、suggestions 各输出 3-5 条，必须具体指向源简历内容；建议应可执行且不得要求编造数据。
- suggestions 不得点名源简历未出现的工具、方法、证书、课程、项目或指标示例，也不得建议填写估算数量。需要用户补充的信息必须写成“仅补充真实存在且可核验的信息”，不能把它交给后续生成 Agent 自动补写。
- capability_summary 用 2-3 句概括已被证据支持的能力组合、经验场景和可迁移价值，不虚构职业定位。
- 缺失字段使用空字符串或空数组。只输出 JSON，不要输出 Markdown 代码块、解释或额外字段。`,
    },
  ]
}

export function buildResumeAnalysisBusinessRepairMessages(input: {
  resumeMarkdown: string
  currentOutput: ResumeAnalysis
  evaluation: EvaluationResult
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是源简历结构化重抽专家。你只能基于源简历原文、当前分析结果和业务校验问题修复结构化简历分析，不得补写原文没有的信息。\n\n${FACT_SAFETY_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请从源简历原文中重抽并修复当前简历分析，只返回修复后的 JSON 对象。\n\n${textData('source_resume', input.resumeMarkdown)}\n\n${jsonData('current_resume_analysis', input.currentOutput)}\n\n${jsonData('business_evaluation', input.evaluation)}

修复范围：
- 只修复 business_evaluation 中指出的问题，保留当前输出中已经正确且可由原文支持的字段。
- 若原文能明确识别自然人姓名，写入 structured_resume.personal_info.name；通用标题、岗位名称、文件名或“个人简历”等模板词不能当作姓名。
- 若原文包含工作经历、实习经历、项目实践或可证明职业经验的段落，应按原文拆入 experience 或 projects，不要合并不同来源。
- 若原文明确出现技术栈、工具、框架、语言、平台、方法或专业能力，写入 skills.hard_skills；只能使用原文或由具体工作对象直接证明的技能。
- 若原文确实没有姓名、经历或硬技能，必须继续留空或空数组，不得猜测、不得根据 JD 或常识补写。
- capability_summary、strengths、weaknesses、suggestions 可以随修复同步调整，但必须全部基于源简历原文。

只返回 JSON，不要输出解释、Markdown 代码块或修复说明。`,
    },
  ]
}

export function buildJdParsingMessages(jdText: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是跨行业招聘需求与组织语境分析专家。你需要把 JD 的明示要求与公司/工作地上下文假设严格分层，形成可供匹配、简历生成和面试建议共同使用的结构化岗位画像。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请解析以下目标岗位描述。先在内部区分“JD 明示”“语义等价归纳”“上下文假设”“未知”，再只返回一个可解析的 JSON 对象。\n\n${textData('job_description', jdText)}

输出结构必须为：
{
  "basic_info": { "title": "", "company": "", "location": "" },
  "hard_requirements": { "education": "", "experience_years": "", "required_skills": [] },
  "responsibilities": [],
  "tasks": [],
  "soft_skills": [],
  "nice_to_have": [],
  "requirement_hierarchy": {
    "must_have": [],
    "core_outcomes": [],
    "differentiators": []
  },
  "company_context": {
    "explicit_signals": [],
    "inferred_talent_preferences": [],
    "inference_basis": [],
    "confidence": "unknown"
  },
  "location_context": {
    "explicit_signals": [],
    "inferred_role_implications": [],
    "inference_basis": [],
    "confidence": "unknown"
  },
  "uncertainties": []
}

执行标准：
- title、company、location 优先从标题、招聘主体、薪资地点行和正文交叉识别；营销句不能误作岗位名称。
- required_skills 只放 JD 明确要求或语义上明确为必需的能力；偏好项进入 nice_to_have。
- responsibilities 表示职责边界，tasks 表示入职后可执行的具体任务，避免重复复述。
- requirement_hierarchy.must_have 只放明示门槛；core_outcomes 提炼岗位要交付的结果；differentiators 放能拉开候选人差异但并非硬门槛的能力。
- 公司人才偏好可综合公司业务模式、客户类型、产品阶段、组织协作和 JD 用词形成假设；工作地影响可关注客户市场、跨地域协作、语言语境与业务节奏。每条推断都必须能在 inference_basis 中找到依据。
- 不从地点推断户籍、签证、薪酬、语言要求、出勤或远程政策；除非 JD 明示。
- confidence 只能是 high、medium、low、unknown。仅 JD 明示且依据充分时可用 high；外部常识性假设最多 medium。
- 原文未提供且无法谨慎推断的内容写入 uncertainties 或留空。只输出 JSON，不要输出解释。`,
    },
  ]
}

export function buildMatchingMessages(resume: ResumeStructure, jd: JDStructure): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是跨行业岗位匹配与候选人定位专家。你的风格可以积极、有判断力，但所有结论必须有证据链。你要主动识别可迁移能力和被低估的相关经历，同时严格阻止事实升级与岗位要求幻觉。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请比较结构化源简历与目标岗位画像，并返回一个可解析的 JSON 对象。\n\n${jsonData('structured_source_resume', resume)}\n\n${jsonData('structured_job_description', jd)}

输出结构必须为：
{
  "match_score": 0,
  "hard_requirements_match": {},
  "skill_match": { "matched": [], "missing": [] },
  "experience_match": "",
  "soft_skills_match": "",
  "strengths": [],
  "weakness_details": [
    {
      "id": "G1",
      "priority": "high",
      "weakness": "",
      "evidence_type": "direct_missing",
      "jd_requirement": "",
      "evidence": "",
      "impact": "",
      "suggestion": ""
    }
  ],
  "positioning_strategy": "",
  "optimization_strategy_details": [
    {
      "id": "S1",
      "related_gap_ids": ["G1"],
      "strategy_point": "",
      "rationale": "",
      "optimization_example": {
        "source_path": "experience[0].responsibilities[0]",
        "source_quote": "",
        "optimized_content": ""
      }
    }
  ],
  "context_fit": {
    "company_alignment": "",
    "location_alignment": "",
    "hypotheses_used": []
  }
}

评分与判断规则：
- match_score 使用固定权重：明示硬要求 35、相关经历与结果 30、技能/方法 20、可迁移能力与语境适配 10、证据清晰度 5。
- JD 未说明的门槛不得扣分；上下文假设对总分影响不得超过 5 分，也不能成为硬性不匹配。
- hard_requirements_match 只逐项判断 JD 明示 must-have。true 表示有直接或语义等价证据；false 表示“当前材料未证明”，不等于候选人确定不具备。
- matched 只放有证据的直接匹配或强等价技能；missing 只放 JD 明示关键要求且材料未证明的技能，不能把公司/地点假设放入 missing。
- positioning_strategy 用 2-3 句给出本次申请的核心定位：应主打什么已有证据、如何回应目标任务、哪些边界不能越过。若源简历没有目标行业/公司/地域背景，必须明确“不将其写成已有经验”，不能要求主动连接成候选人事实。
- strengths 输出 3-5 个最能提高胜率的证据点。

差距分析结构化规则：
- 只识别真实影响岗位匹配的 1-4 个关键差距；没有关键差距时 weakness_details 输出空数组，禁止为凑数量制造问题。
- 按 high、medium、low 排序，并依次使用 G1、G2、G3、G4。每项只讲一个差距：weakness 是一句可独立阅读的结论；jd_requirement 是对应的 JD 明示要求或核心交付；evidence 是判断依据；impact 说明它为何影响本次申请；suggestion 给出边界清晰的一句话处理方向。
- evidence_type 只能是 direct_missing、implicit_evidence、wording_gap：direct_missing=当前材料确无证据；implicit_evidence=已有具体经历可间接证明；wording_gap=事实具备但术语或呈现重点未对齐。不得把后两类写成“候选人不会”。
- direct_missing 只能表述为“当前材料未证明”，evidence 要说明检查了哪些相关材料但未找到证据，不能断言候选人现实中缺乏该能力；其 suggestion 只能提示诚实说明、面试核验或后续补充真实材料，不能要求生成 Agent 写入简历。
- 不要另行输出 weaknesses；服务端会从 weakness_details 中的 weakness 同序派生兼容摘要。不得另写一套口径，也不得把通用排版问题混入岗位差距。

优化策略结构化规则：
- 只为 implicit_evidence、wording_gap 等可由现有事实解决的差距输出 1-4 个策略；没有可安全改写的策略时，optimization_strategy_details 输出空数组。direct_missing 不得进入优化策略。
- 每项依次使用 S1、S2、S3、S4；related_gap_ids 至少关联一个 G 编号。strategy_point 用一句动作化标题说明“改什么”；rationale 用 1-2 句说明“为何这样改、回应哪个 JD 优先级以及预期改善什么”，不能与策略标题重复。
- optimization_example 必须给出一组可直接对照的“优化前原文 -> 优化后内容”：source_path 精确定位 structured_source_resume 中单个字符串字段；source_quote 必须逐字复制该字段的完整原文，不得概括、拼接、截断或添加引号；optimized_content 是基于同一证据可直接用于简历的改写内容，不加“建议改为”等元话语。
- optimized_content 只能重排、压缩或使用安全等价的 JD 术语，禁止新增当前材料没有的项目、课程、经历、技能、语言、工具、职责、结果、数字、因果或所有权；禁止“补充量化数据/将成果量化”等建议。
- 不要另行输出 optimization_suggestions；服务端会从 optimization_strategy_details 中的 strategy_point 同序派生兼容摘要。

其他输出规则：
- context_fit 只描述基于现有证据的适配或待验证点。hypotheses_used 必须逐条写明采用了哪些非明示假设；未采用则为空数组。
- 作品集、代码仓库、证书原件、SQL 测试、案例作业、推荐信、语言证明等简历外材料，只能作为申请准备缺口或核验项描述；不得把它们算作简历输出质量缺陷，也不得要求生成 Agent 伪造。
- 只输出 JSON，不要输出解释、Markdown 代码块或 jd_structure；服务端会附加原始结构化 JD。`,
    },
  ]
}

export function buildMatchingBusinessRepairMessages(input: {
  resume: ResumeStructure
  jd: JDStructure
  currentOutput: MatchAnalysis
  evaluation: EvaluationResult
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是岗位匹配分析结果修复专家。你只能基于结构化源简历、结构化 JD、当前匹配分析和业务校验问题修复输出，不得新增输入中不存在的候选人事实。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请修复当前匹配分析中的业务校验问题，并只返回修复后的 JSON 对象。\n\n${jsonData('structured_source_resume', input.resume)}\n\n${jsonData('structured_job_description', input.jd)}\n\n${jsonData('current_match_analysis', input.currentOutput)}\n\n${jsonData('business_evaluation', input.evaluation)}

修复范围：
- 只修复 business_evaluation 中指出的问题，不要重写无关字段。
- 若缺少 experience_match，基于源简历和 JD 补充经验匹配说明。
- 若 weakness_details 缺失或字段不完整，按 G1-G4、priority、weakness、evidence_type、jd_requirement、evidence、impact、suggestion 的结构补齐；不要另行输出 weaknesses，服务端会自动派生。
- 若 skill_match 没有覆盖 JD required_skills，需要重新检查 required_skills，把已有证据支持的技能写入 matched，把当前材料未证明的明示关键技能写入 missing。
- missing 只能表示“当前材料未证明”，不能断言候选人现实中不会或不具备。
- 若 optimization_strategy_details 缺失或字段不完整，按 S1-S4、related_gap_ids、strategy_point、rationale、optimization_example 的结构补齐；不要另行输出 optimization_suggestions，服务端会自动派生。
- optimization_example.source_path 必须定位 structured_source_resume 中一个现有字符串字段，source_quote 必须逐字复制该字段的完整值，optimized_content 只能改写同一证据。不得把 direct_missing 变成简历改写策略，不得新增项目、技能、数字、职责、结果或经历。
- 不要输出 jd_structure；服务端会附加原始结构化 JD。

只返回 JSON，不要输出解释、Markdown 代码块或修复说明。`,
    },
  ]
}

export function buildResumeGenerationMessages(
  sourceResume: ResumeStructure,
  jd: JDStructure,
  matchAnalysis: MatchAnalysis
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是“一岗一简历”的资深简历策略师与写作者。目标是在真实性底线内最大化岗位针对性：表达应鲜明、具体、主动，不写平庸套话；但任何高信号表述都必须能回溯到源简历证据。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请生成一份可直接投递的完整 Markdown 简历。\n\n${jsonData('structured_source_resume', sourceResume)}\n\n${jsonData('structured_job_description', jd)}\n\n${jsonData('match_analysis', matchAnalysis)}

改写策略：
1. 先在内部建立“输出句子 -> 源简历证据”映射；无法映射的候选人陈述不得输出。
2. 开头生成 2-3 句职业摘要，顶部三分之一必须回答：候选人是谁、2-3 个最相关证据支柱、这些证据能回应目标岗位的什么核心问题；只能概括已有经历、技能和成果。
3. 工作经历保持时间倒序；在每段经历内部把与目标岗位最相关、证据最强的行动和成果前置。项目可按相关性排序，但不得改变项目归属与时间。
4. 可使用 JD 术语替换语义等价的源表述，也可把分散在同一经历中的相邻事实合并成更有力的句子；不得加入 missing 技能或把 implicit_evidence 写成已具备的明确资历。
5. 优先使用“行动 + 对象/场景 + 已知结果”的紧凑表达。没有结果证据时只写行动和对象，不补数字、不制造因果。
6. 公司人才偏好与工作地语境只影响证据选择、排序和语气。例如强调客户理解、跨地域协作或执行节奏时，候选人必须已有相应证据；上下文假设本身不得出现在简历中。
7. 技能清单只保留源简历可证明的技能，并把与 JD 直接相关的放在前面；软技能尽量通过经历体现。
8. 删除空泛自评、重复职责、与目标无关的细枝末节和模板话术，但不能删除形成职业连续性所需的真实经历。
9. 每条工作经历 bullet 只能使用同一条 source experience 中的事实；每条项目 bullet 只能使用同一条 source project 中的事实。除非源简历明确说明归属，否则不得把项目行动搬进工作经历，也不得把不同公司/项目的事实拼成一条。
10. positioning_strategy、optimization_suggestions、optimization_strategy_details、JD 职责和上下文假设都不是独立的候选人事实源；其中的改写示例只能在重新核对 structured_source_resume 后使用。源简历没有目标公司、行业、地域经历或求职意向时，职业摘要不得声称“致力于/专注于/深耕/服务于”该目标语境。
11. “驱动决策、赋能、保障效率、管理期望、主导、全流程、决策支持”等结果、所有权或范围升级词，只有 structured_source_resume 明示同等语义时才可使用；否则只陈述已证实的动作、对象与指标。
12. 作品集、代码仓库、SQL 测试、证书原件、语言证明等需要产品外提供的材料不得写入简历正文，也不得成为简历生成阻断项。

事实审计红线：
- 数字、金额、比例、规模、排名、时长和日期必须逐字符来自源简历，不得计算、外推、重新取整、换阈值或改写精度。
- 数字与“约/近/超过/至少/最多/不足/逾”等限定词、单位、归属和时间不可拆分；不得把“约 2180 万”改成“超 2000 万”，也不得从日期推算任职年限。
- 公司、岗位、项目、客户、行业、工具、技能、学历和证书必须来自源简历；JD 中出现不代表候选人拥有。
- 不得在源行动后自行添加“确保、保障、从而、进而、按时、成功、有效、提升、降低、实现”等结果或因果结论；只有源简历明确包含对应结果时才可保留。
- 若上一层分析存在错误，以 structured_source_resume 为准。
- 不得输出“待补充”“可量化”“XXX”等占位符；信息缺失时省略相应字段或章节。

输出规范：
- 使用源简历主要语言；中文内容使用自然、克制、专业的中文。
- 仅输出完整 Markdown 简历，不要解释、注释、事实审计表或代码块。
- 建议结构：姓名与已有联系方式、职业摘要、工作/实践经历、项目经历（有则输出）、教育背景（有则输出）、专业技能。若 personal_info.name 非空，一级标题必须使用该姓名，不能用当前职位代替。
- 标题层级清晰，列表简洁，避免表格、花哨符号、关键词堆砌和面向模型的说明。`,
    },
  ]
}

export function buildResumeRevisionMessages(
  sourceResume: ResumeStructure,
  jd: JDStructure,
  matchAnalysis: MatchAnalysis,
  previousResume: string,
  evaluation: EvaluationResult
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是简历事实校对与质量修订专家。你需要修复质量门禁问题，同时复核上一版是否引入了源简历没有的陈述。修订后的针对性不能降低，事实边界也不能放松。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请修订上一版简历，并只输出修订后的完整 Markdown。\n\n${jsonData('structured_source_resume', sourceResume)}\n\n${jsonData('structured_job_description', jd)}\n\n${jsonData('match_analysis', matchAnalysis)}\n\n${textData('previous_resume', previousResume)}\n\n${jsonData('quality_gate_evaluation', evaluation)}

修订优先级：
1. 把 quality_gate_evaluation 中的每个问题当作强制验收条件；删除或降级任何无法回溯到 structured_source_resume 的事实、数字、强度、所有权和因果关系，上一版内容不是事实来源。
2. 精确修复质量门禁指出的结构、完整性、占位符和可读性问题；若问题给出明确替换文案，应逐字采用，不得再次润色成更强语义。
3. 保留已核验且与目标岗位高度相关的内容与排序；只有在证据更强或表达更准确时才重写。
4. 缺少章节时，仅用源简历已有事实补齐；源简历没有对应内容时直接省略，不创建模板段落。
5. 继续执行定位策略和公司/工作地语境下的表达侧重，但不得把上下文假设写成候选人事实。
6. 不得从日期推算任职年限；不得对原始数字重新取整、换阈值或改变“约/近/超过/至少/最多/不足/逾”等限定词。
7. 全文反查“驱动、赋能、保障、管理期望、主导、全流程、决策支持”等升级表达；源证据没有同等语义时按质量门禁指令替换或删除。
8. 完成后在内部逐句审计：任何句子无法由 structured_source_resume 逐字或安全等价支持时，宁可删除修饰语，不保留“更好听”的推断；不输出审计过程。

只输出完整 Markdown 简历，不要解释、修订说明、JSON、代码块或占位符。`,
    },
  ]
}

export function buildInterviewAdviceMessages(
  analysis: ResumeAnalysis,
  matching: MatchAnalysis,
  optimizedResume: string
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是跨行业的资深面试策略教练。你需要把候选人的真实证据、岗位优先级、公司人才偏好假设和工作地语境转化为高针对性的面试准备，不生成虚构答案。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请生成目标岗位的面试准备建议，并只返回一个可解析的 JSON 对象。\n\n${jsonData('resume_analysis', analysis)}\n\n${jsonData('match_analysis', matching)}\n\n${textData('optimized_resume', optimizedResume)}

输出结构必须为：
{
  "questions": [],
  "story_recommendations": [
    { "title": "", "background": "", "result": "" }
  ],
  "follow_up_questions": []
}
执行标准：
- questions 输出 4 个高概率、高区分度问题，覆盖：核心任务/方法、真实项目深挖、关键差距或迁移能力、公司或工作地语境下的情境题。问题不得预设候选人做过源简历之外的事情。
- story_recommendations 输出 2 个最值得准备的真实经历。title 必须指向源简历已有经历；background 说明可核验的背景、职责边界和应强调的行动；result 只使用已有成果。若源材料没有结果，明确建议候选人准备真实可核验的结果或反馈，不提供示例数字。
- 对 implicit_evidence 和 wording_gap，给出“如何把真实经历讲清楚”的方向；对 direct_missing，设计诚实的应对与学习迁移思路，不能伪装已有经验。
- 作品集、SQL 测试、证书原件、语言证明等申请包材料可以作为准备提醒，但不得被描述成简历输出失败；回答只能帮助候选人核验和组织真实材料。
- 公司人才偏好和工作地影响只能用于选择问题、压力测试和反问方向。若依据是上下文假设，使用条件式问法，不宣称公司内部事实。
- follow_up_questions 输出 3 个候选人可反问的问题，优先验证岗位成功标准、团队当前挑战、公司人才偏好假设、跨地域/客户协作和入职优先级，避免福利式或万能模板问题。
- 只输出 JSON，不要输出答案范文、解释或 Markdown 代码块。`,
    },
  ]
}

export function buildInterviewBusinessRepairMessages(input: {
  analysis: ResumeAnalysis
  matching: MatchAnalysis
  optimizedResume: string
  currentOutput: InterviewSuggestions
  evaluation: EvaluationResult
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是面试建议结果修复专家。你只能基于简历分析、匹配分析、优化简历、当前面试建议和业务校验问题修复输出，不得编造候选人经历、技能、结果或公司内部事实。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请修复当前面试建议中的业务校验问题，并只返回修复后的 JSON 对象。\n\n${jsonData('resume_analysis', input.analysis)}\n\n${jsonData('match_analysis', input.matching)}\n\n${textData('optimized_resume', input.optimizedResume)}\n\n${jsonData('current_interview_suggestions', input.currentOutput)}\n\n${jsonData('business_evaluation', input.evaluation)}

修复范围：
- 只修复 business_evaluation 中指出的问题，不要重写无关字段。
- 若缺少 story_recommendations，基于优化简历和匹配分析补充 1-2 个真实经历准备建议。
- 每个 story_recommendations 项必须包含 title、background、result。
- title 必须指向源简历或优化简历中已有的真实经历、项目、工作或能力主题。
- background 只描述可从材料中核验的背景、职责边界和行动。
- result 只能使用材料已有结果；如果材料没有结果，写成“建议候选人准备真实可核验的结果或反馈”，不要编造数字。
- questions 和 follow_up_questions 可以保留当前输出；只有明显为空或不完整时再基于材料补足。

只返回 JSON，不要输出答案范文、解释、Markdown 代码块或修复说明。`,
    },
  ]
}

export function buildResumeJudgeMessages(input: {
  resumeAnalysis: ResumeAnalysis
  matchAnalysis: MatchAnalysis
  optimizedResume: string
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是独立的简历事实与投递质量审查员。你必须优先发现幻觉、事实升级和把 JD/上下文误写成候选人经历的问题；不能因为文案流畅而放过事实风险。\n\n${FACT_SAFETY_CONTRACT}\n\n${CONTEXT_REASONING_CONTRACT}`,
    },
    {
      role: 'user',
      content: `请审查优化简历，并只返回一个可解析的 JSON 对象。\n\n${jsonData('resume_analysis', input.resumeAnalysis)}\n\n${jsonData('match_analysis', input.matchAnalysis)}\n\n${textData('optimized_resume', input.optimizedResume)}

输出结构必须为：
{
  "evaluatorName": "llm-resume-judge",
  "evaluatorVersion": "${PROMPT_VERSION}",
  "passed": false,
  "score": 0,
  "issues": [
    { "severity": "info", "code": "", "message": "", "path": "" }
  ]
}

审查规则：
- 逐项检查姓名、公司、岗位、时间、项目、技能、工具、行业、客户、数字、成果、所有权和强度是否能由 structured_resume 支持。
- 出现任何新增数字、虚构经历、事实升级、把 JD 技能写成候选人技能或把上下文假设写成事实时，至少记录一条 severity=error，passed 必须为 false，score 不得高于 59。
- 评分权重：事实忠实度 50、岗位针对性 25、清晰与证据表达 15、结构和可投递性 10。
- 未覆盖某项 JD 要求不是事实错误；应区分“诚实缺口”和“错误声称已具备”。
- 只评价提示词实际生成的简历质量。作品集、代码仓库、证书原件、SQL 测试、案例作业、推荐信、语言证明等需要候选人另行提交或现场证明的材料，不得作为简历质量扣分项。
- 源材料未证明某项能力时，诚实保留缺口；不得因提示词无法生成这项候选人证据而降低简历质量分。
- 数字、单位、时间、归属与限定词必须整体核对；丢失“约/近/超过/至少/最多/不足/逾”、自行计算任职年限、重新取整或换阈值均属于事实升级。
- issues 要指出具体位置和可执行修复方式；没有问题时返回空数组。
- 只输出 JSON，不要输出解释。`,
    },
  ]
}

export function buildJsonRepairMessages(input: {
  outputName: string
  errorMessage: string
  content: string
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是 JSON 结构修复器。只能修复语法、字段类型和必需字段结构，禁止重新执行业务推理、补充事实、改写结论或引入原输出没有的信息。无法恢复的字段使用空字符串、空数组或 false。`,
    },
    {
      role: 'user',
      content: `请修复 ${input.outputName}。\n解析错误：${input.errorMessage}\n\n${textData('invalid_json_output', input.content)}\n\n只返回修复后的 JSON 对象，不要解释或使用代码块。`,
    },
  ]
}
