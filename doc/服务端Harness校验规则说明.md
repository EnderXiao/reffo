# 服务端 Harness 校验规则说明

本文档沉淀当前服务端 MVP Harness 在 `analyze`、`match`、`generate`、`interview` 四个入口中的校验规则。代码来源主要是：

- `backend/src/routes/mvp.ts`
- `backend/src/harness/json-output.ts`
- `backend/src/schemas/resume-analysis.ts`
- `backend/src/schemas/match-analysis.ts`
- `backend/src/schemas/interview-suggestions.ts`
- `backend/src/harness/evaluators/business-evaluators.ts`
- `backend/src/harness/evaluators/markdown-resume-evaluator.ts`

## 通用校验机制

| 校验层级 | 触发位置 | 校验内容 | 失败行为 | 中文解释 |
| --- | --- | --- | --- | --- |
| 请求体验证 | Elysia route `body` schema | 只校验路由显式声明的输入字段，例如字符串最小长度；部分复杂对象使用 `t.Any`，不会做结构校验 | 请求无法通过路由处理或进入后续逻辑时报错 | 这是 API 入参的第一层基础校验，当前主要防止明显空文本进入流程。 |
| JSON 解析校验 | `parseJsonOutput` | 对 LLM 返回内容执行 `JSON.parse` | 默认触发 1 次 JSON 修复；修复后仍失败则 step 失败 | 保证模型输出首先是合法 JSON。 |
| 结构校验 | `parseJsonOutput` + schema validator | 使用对应 schema 判断 JSON 字段结构、类型、枚举值和取值范围 | 默认触发 1 次结构修复；修复后仍失败则 step 失败 | 保证模型输出符合后端可消费的数据结构。 |
| 业务校验 | `assertBusinessEvaluation` 或质量门禁 | 执行业务 evaluator，产生 `error`、`warning`、`info` 等问题 | 只要存在 `error`，`passed=false` 并阻断；`warning` 只记录和扣分 | 业务校验用于检查输出是否满足产品质量要求。 |
| 评分规则 | evaluator 统一规则 | `score = max(0, 100 - error 数量 * 30 - warning 数量 * 10)` | 分数不直接阻断，是否阻断看是否存在 `error` | 当前分数主要用于观测质量，不是独立阈值。 |

## analyze 校验规则

入口：`POST /api/v1/mvp/analyze`

Step：`analyze_resume`

### 请求体验证

| 字段 | 校验类型 | 校验条件 | 中文解释 |
| --- | --- | --- | --- |
| `resume_markdown` | 请求体字段 | 必须是字符串，最小长度 10 | 输入的 Markdown 简历不能太短，避免明显无效的简历文本进入分析流程。 |

### 结构校验

结构校验对象：`ResumeAnalysis`

| 字段 | 校验条件 | 默认/归一化规则 | 中文解释 |
| --- | --- | --- | --- |
| `quality_score` | 必须可转为数字，范围 0-100 | 缺失时默认 0 | 简历质量评分必须是百分制分数。 |
| `strengths` | 字符串数组 | 缺失时默认空数组；字符串可按换行、分号、顿号拆分 | 简历优势列表，用于展示候选人亮点。 |
| `weaknesses` | 字符串数组 | 缺失时默认空数组；字符串可按换行、分号、顿号拆分 | 简历问题列表，用于说明当前简历不足。 |
| `suggestions` | 字符串数组 | 缺失时默认空数组；字符串可按换行、分号、顿号拆分 | 简历优化建议列表。 |
| `capability_summary` | 字符串 | 缺失、`null`、`undefined` 会归一化为空字符串 | 候选人核心能力和职业定位总结。 |
| `structured_resume` | 必须符合结构化简历 schema | 必须存在 | 分析后提取出的结构化简历，是后续匹配和生成的核心输入。 |
| `structured_resume.personal_info.name` | 字符串 | 缺失时默认空字符串 | 候选人姓名。 |
| `structured_resume.personal_info.contact` | 字符串 | 缺失时默认空字符串 | 候选人联系方式总字段。 |
| `structured_resume.personal_info.email` | 字符串 | 缺失时默认空字符串 | 候选人邮箱。 |
| `structured_resume.personal_info.phone` | 字符串 | 缺失时默认空字符串 | 候选人手机号。 |
| `structured_resume.personal_info.location` | 字符串 | 缺失时默认空字符串 | 候选人所在地。 |
| `structured_resume.personal_info.current_position` | 字符串 | 缺失时默认空字符串 | 候选人当前职位。 |
| `structured_resume.education` | 数组 | 非数组会包装为数组；空值归一化为空数组 | 教育经历列表。 |
| `structured_resume.education[].school` | 字符串 | 缺失时默认空字符串 | 学校名称。 |
| `structured_resume.education[].major` | 字符串 | 缺失时默认空字符串 | 专业名称。 |
| `structured_resume.education[].degree` | 字符串 | 缺失时默认空字符串 | 学历或学位。 |
| `structured_resume.education[].time_range` | 字符串 | 缺失时默认空字符串 | 教育经历时间范围。 |
| `structured_resume.education[].achievements` | 字符串数组 | 缺失时默认空数组 | 教育阶段成果、荣誉或成绩。 |
| `structured_resume.experience` | 数组 | 非数组会包装为数组；空值归一化为空数组 | 工作经历列表。 |
| `structured_resume.experience[].company` | 字符串 | 缺失时默认空字符串 | 公司名称。 |
| `structured_resume.experience[].position` | 字符串 | 缺失时默认空字符串 | 职位名称。 |
| `structured_resume.experience[].time_range` | 字符串 | 可从 `duration`、`time` 归一化；缺失时默认空字符串 | 工作经历时间范围。 |
| `structured_resume.experience[].responsibilities` | 字符串数组 | 可从 `duties`、`description` 归一化；缺失时默认空数组 | 工作职责。 |
| `structured_resume.experience[].achievements` | 字符串数组 | 可从 `results` 归一化；缺失时默认空数组 | 工作成果。 |
| `structured_resume.projects` | 数组 | 缺失时默认空数组；非数组会包装为数组 | 项目经历列表。 |
| `structured_resume.projects[].name` | 字符串 | 缺失时默认空字符串 | 项目名称。 |
| `structured_resume.projects[].role` | 字符串 | 缺失时默认空字符串 | 项目角色。 |
| `structured_resume.projects[].tech_stack` | 字符串数组 | 可从 `technologies`、`skills` 归一化；缺失时默认空数组 | 项目技术栈。 |
| `structured_resume.projects[].description` | 字符串 | 缺失时默认空字符串 | 项目描述。 |
| `structured_resume.projects[].achievements` | 字符串数组 | 可从 `results` 归一化；缺失时默认空数组 | 项目成果。 |
| `structured_resume.skills.hard_skills` | 字符串数组 | 可从 `technical_skills`、`skills` 归一化；缺失时默认空数组 | 硬技能列表，例如编程语言、工具、平台和专业能力。 |
| `structured_resume.skills.soft_skills` | 字符串数组 | 可从 `soft` 归一化；缺失时默认空数组 | 软技能列表，例如沟通、协作、项目管理。 |

### 业务校验

业务校验器：`resume-analysis-business-rules`

| 字段/条件 | 严重级别 | 问题码 | 校验条件 | 中文解释 |
| --- | --- | --- | --- | --- |
| `capability_summary` | error | `MISSING_CAPABILITY_SUMMARY` | 必须是非空字符串 | 简历分析必须总结候选人的核心能力，否则后续推荐和生成缺少判断依据。 |
| `strengths` | warning | `MISSING_ANALYSIS_STRENGTHS` | 建议为非空数组 | 优势列表缺失不会阻断，但会降低分析结果可用性。 |
| `suggestions` | warning | `MISSING_ANALYSIS_SUGGESTIONS` | 建议为非空数组 | 优化建议缺失不会阻断，但会影响后续解释和用户感知。 |
| `structured_resume.personal_info.name` | error | `MISSING_PERSON_NAME` | 必须是非空字符串 | 结构化简历必须保留候选人姓名。 |
| `structured_resume.experience` | error | `MISSING_SOURCE_EXPERIENCE` | 必须是非空数组 | 缺少工作经历会导致匹配和生成阶段无法判断候选人经验。 |
| `structured_resume.skills.hard_skills` | error | `MISSING_HARD_SKILLS` | 必须是非空数组 | 缺少硬技能会导致岗位匹配和技能章节生成不可靠。 |

## match 校验规则

入口：`POST /api/v1/mvp/match`

Steps：`parse_jd`、`match_resume_to_jd`

### 请求体验证

| 字段 | 校验类型 | 校验条件 | 中文解释 |
| --- | --- | --- | --- |
| `structured_resume` | 请求体字段 | `t.Any`，不做结构校验 | 当前入口信任调用方传入的结构化简历，真正的结构有效性不在本入口校验。 |
| `jd_text` | 请求体字段 | 必须是字符串，最小长度 10 | JD 文本不能太短，避免无效岗位描述进入解析和匹配流程。 |

### `parse_jd` 结构校验

结构校验对象：`JDStructure`

| 字段 | 校验条件 | 默认/归一化规则 | 中文解释 |
| --- | --- | --- | --- |
| `basic_info` | 必须是对象 | 允许额外字段 | JD 基础信息。 |
| `basic_info.title` | 必须是字符串 | 无默认值 | 岗位标题，是后续匹配和展示的必需信息。 |
| `basic_info.company` | 可选字符串 | 无默认值 | 公司名称。 |
| `basic_info.location` | 可选字符串 | 无默认值 | 工作地点。 |
| `hard_requirements` | 必须是对象 | 允许额外字段 | JD 硬性要求集合。 |
| `hard_requirements.education` | 可选字符串 | 无默认值 | 学历要求。 |
| `hard_requirements.experience_years` | 可选字符串 | 无默认值 | 工作年限要求。 |
| `hard_requirements.required_skills` | 必须是字符串数组 | 无默认值 | 必备技能列表。 |
| `responsibilities` | 必须是字符串数组 | 无默认值 | 岗位职责列表。 |
| `tasks` | 必须是字符串数组 | 无默认值 | 具体任务列表。 |
| `soft_skills` | 必须是字符串数组 | 无默认值 | 软技能要求列表。 |
| `nice_to_have` | 必须是字符串数组 | 无默认值 | 加分项列表。 |

### `match_resume_to_jd` 结构校验

结构校验对象：`MatchAnalysis`

| 字段 | 校验条件 | 默认/归一化规则 | 中文解释 |
| --- | --- | --- | --- |
| `match_score` | 必须可转为数字，范围 0-100 | 无默认值 | 候选人与岗位的综合匹配分。 |
| `hard_requirements_match` | 必须是 boolean record | 缺失时默认空对象；字符串 `true`、`yes`、`是`、`匹配`、`满足` 会转为 `true`；字符串 `false`、`no`、`否`、`不匹配`、`不满足` 会转为 `false` | 逐项记录硬性要求是否满足。 |
| `skill_match` | 必须是对象 | 允许额外字段 | 技能匹配结果集合。 |
| `skill_match.matched` | 必须是字符串数组 | 缺失时默认空数组 | 已匹配的技能。 |
| `skill_match.missing` | 必须是字符串数组 | 缺失时默认空数组 | 缺失或不足的技能。 |
| `experience_match` | 必须是字符串 | 无默认值 | 工作经验与 JD 的匹配说明。 |
| `soft_skills_match` | 字符串 | 缺失时默认空字符串 | 软技能或文化匹配说明。 |
| `strengths` | 字符串数组 | 缺失时默认空数组 | 候选人与岗位匹配的优势点。 |
| `weaknesses` | 字符串数组 | 缺失时默认空数组；如果数组项是对象，会优先取 `weakness`、`description`、`content` 转成字符串 | 候选人与岗位之间的差距或弱点。 |
| `weakness_details` | 对象数组 | 缺失时默认空数组 | 每条弱点对应的证据标注。 |
| `weakness_details[].weakness` | 必须是字符串 | 无默认值 | 弱点描述，应与 `weaknesses` 中的弱点对应。 |
| `weakness_details[].evidence_type` | 必须是枚举值：`direct_missing`、`implicit_evidence`、`wording_gap` | 无默认值 | 弱点证据类型，用于区分真实缺失、间接证据和表达差距。 |
| `weakness_details[].evidence` | 字符串 | 缺失时默认空字符串 | 判断该弱点的依据。 |
| `weakness_details[].suggestion` | 字符串 | 缺失时默认空字符串 | 针对该弱点的改写或优化建议。 |
| `jd_structure` | 可选 JD 结构对象 | `MatchingAgent` 最终会用解析出的 JD 覆盖/补充该字段 | 匹配结果关联的结构化岗位信息。 |

### 业务校验

业务校验器：`match-analysis-business-rules`

| 字段/条件 | 严重级别 | 问题码 | 校验条件 | 中文解释 |
| --- | --- | --- | --- | --- |
| `match_score` | error | `MATCH_SCORE_OUT_OF_RANGE` | 必须在 0-100 之间 | 匹配分必须是合法百分制分数。 |
| `experience_match` | error | `MISSING_EXPERIENCE_MATCH` | 必须是非空字符串 | 匹配分析必须说明工作经验如何匹配 JD。 |
| `strengths` | warning | `MISSING_MATCH_STRENGTHS` | 建议为非空数组 | 缺少优势点不会阻断，但会影响结果解释和前端展示。 |
| `weaknesses` 与 `weakness_details` 数量 | error | `MISSING_WEAKNESS_EVIDENCE_TYPE` | 当 `weaknesses` 非空时，`weakness_details.length` 必须等于 `weaknesses.length` | 每条弱点都必须有对应的证据类型标注，避免只给结论不给依据。 |
| `weakness_details[].evidence_type` | error | `INVALID_WEAKNESS_EVIDENCE_TYPE` | 必须是 `direct_missing`、`implicit_evidence`、`wording_gap` 之一 | 弱点分类必须落在约定枚举内，便于后续生成时区分“真实缺失”和“表达不足”。 |
| `weakness_details[].weakness`、`evidence`、`suggestion` | warning | `INCOMPLETE_WEAKNESS_EVIDENCE_DETAIL` | 建议都为非空字符串 | 弱点证据详情应包含弱点描述、判断依据和改写建议；缺失不阻断，但会降低可解释性。 |
| `skill_match.required_skill_checks` | warning | `JD_REQUIRED_SKILLS_NOT_CHECKED` | 当 JD 中有必备技能时，逐项检查可能不完整 | 作为匹配评分、优化建议和面试问题的质量信号，不阻断匹配流程。 |
| `jd_structure.basic_info.title` | error | `MISSING_JD_TITLE` | 必须存在且非空 | 匹配结果必须带有岗位标题，方便展示和后续生成。 |

## generate 校验规则

入口：`POST /api/v1/mvp/generate`

Steps：`validate_source_resume_for_generation`、`generate_resume`、`validate_resume`、必要时 `revise_resume`

### 请求体验证

| 字段 | 校验类型 | 校验条件 | 中文解释 |
| --- | --- | --- | --- |
| `structured_resume` | 请求体字段 | `t.Any`，不做结构校验 | 当前入口信任调用方传入的结构化简历。 |
| `matching` | 请求体字段 | `t.Any`，不做结构校验 | 当前入口信任调用方传入的匹配分析结果；代码会直接读取 `matching.jd_structure`。 |

### 结构校验

| 对象/输出 | 校验条件 | 中文解释 |
| --- | --- | --- |
| `generate_resume` 输出 | 无 JSON schema 结构校验，返回值按 Markdown 字符串处理 | 生成阶段输出不是 JSON，而是一份优化后的 Markdown 简历，因此后续通过 Markdown 质量门禁校验内容。 |
| `matching.jd_structure` | 当前入口没有显式 schema 校验 | 如果调用方传入的 `matching` 缺少 `jd_structure`，生成逻辑可能在 agent prompt 组装或运行时出错。 |

### 业务前置校验

业务校验器：`source-resume-generation-precheck`

| 字段/条件 | 严重级别 | 问题码 | 校验条件 | 中文解释 |
| --- | --- | --- | --- | --- |
| `structured_resume.experience` | error | `MISSING_SOURCE_EXPERIENCE` | 必须是非空数组 | 生成优化简历前必须有源工作经历，否则容易生成空泛或失真的经历内容。 |
| `structured_resume.skills.hard_skills` | error | `MISSING_SOURCE_HARD_SKILLS` | 必须是非空数组 | 生成优化简历前必须有源硬技能，否则技能章节无法可靠生成。 |

### Markdown 质量门禁

业务校验器：`markdown-resume-rules`

| 字段/条件 | 严重级别 | 问题码 | 校验条件 | 中文解释 |
| --- | --- | --- | --- | --- |
| 优化简历全文长度 | error | `RESUME_TOO_SHORT` | `trim()` 后长度必须不少于 200 字符 | 简历太短通常表示模型没有生成完整简历。 |
| 经历章节 | error | `MISSING_EXPERIENCE_SECTION` | 必须匹配任一关键词：`工作经历`、`工作经验`、`职业经历`、`项目经历`、`项目经验`、`实习经历`、`实习经验`、`实践经历`、`实践经验` | 优化简历必须包含经历相关章节。 |
| 技能章节 | error | `MISSING_SKILL_SECTION` | 必须匹配任一关键词：`技能清单`、`专业技能`、`技能` | 优化简历必须包含技能相关章节。 |
| 占位符文本 | error | `PLACEHOLDER_TEXT_FOUND` | 不得包含 `XXX`、`公司名称`、`职位名称`、`项目名称`、`学校名称` | 输出不能残留模板占位符。 |
| 源公司名称引用 | warning | `SOURCE_COMPANY_NOT_REFERENCED` | 当源简历有公司名称时，优化简历建议至少包含其中一个公司名称 | 缺少源公司名称可能表示工作经历被丢失或改写过度。 |
| 源硬技能引用 | warning | `SOURCE_SKILLS_NOT_REFERENCED` | 当源简历有硬技能时，优化简历建议至少包含其中一个硬技能 | 缺少源硬技能可能表示技能清单不完整或与源简历脱节。 |

### 修订规则

| 条件 | 行为 | 中文解释 |
| --- | --- | --- |
| `validate_resume` 没有 error | 接受当前 Markdown 简历 | warning 不阻断生成结果返回。 |
| `validate_resume` 存在 error | 触发 `revise_resume` | 基于质量门禁问题让修订 agent 改写输出。 |
| 修订次数 | 最多 2 次 | 初次生成后最多再修订 2 轮；仍未通过则返回生成失败。 |

## interview 校验规则

入口：`POST /api/v1/mvp/interview`

Step：`generate_interview_advice`

### 请求体验证

| 字段 | 校验类型 | 校验条件 | 中文解释 |
| --- | --- | --- | --- |
| `analysis` | 请求体字段 | `t.Any`，不做结构校验 | 当前入口信任调用方传入的简历分析结果。 |
| `matching` | 请求体字段 | `t.Any`，不做结构校验 | 当前入口信任调用方传入的岗位匹配分析结果。 |
| `optimized_resume` | 请求体字段 | 必须是字符串，最小长度 10 | 优化后的 Markdown 简历不能太短，否则无法生成有效面试建议。 |

### 结构校验

结构校验对象：`InterviewSuggestions`

| 字段 | 校验条件 | 默认/归一化规则 | 中文解释 |
| --- | --- | --- | --- |
| `questions` | 必须是字符串数组 | 无默认值 | 高概率面试问题列表。 |
| `story_recommendations` | 必须是对象数组 | 无默认值 | 推荐准备的项目或经历故事列表。 |
| `story_recommendations[].title` | 必须是字符串 | 无默认值 | 故事或项目标题。 |
| `story_recommendations[].background` | 必须是字符串 | 无默认值 | 建议如何介绍项目背景和个人职责。 |
| `story_recommendations[].result` | 必须是字符串 | 无默认值 | 建议强调的结果、指标或影响。 |
| `story_recommendations[].storytelling_approach` | 必须是 2-3 条非空字符串 | 缺失时默认空数组，业务校验阻断 | 针对当前故事和目标岗位生成的讲述顺序、强调重点及缺口应对思路。 |
| `follow_up_questions` | 字符串数组 | 缺失时默认空数组 | 候选人可反问面试官的问题列表。 |

### 业务校验

业务校验器：`interview-suggestions-business-rules`

| 字段/条件 | 严重级别 | 问题码 | 校验条件 | 中文解释 |
| --- | --- | --- | --- | --- |
| `questions` | warning | `INSUFFICIENT_INTERVIEW_QUESTIONS` | 数量建议不少于 3 个 | 面试问题少于 3 个不会阻断，但覆盖面偏弱。 |
| `story_recommendations` | error | `MISSING_STORY_RECOMMENDATIONS` | 必须是非空数组 | 面试建议必须包含故事或项目准备建议，否则缺少核心准备材料。 |
| `follow_up_questions` | warning | `MISSING_FOLLOW_UP_QUESTIONS` | 建议为非空数组 | 反问问题缺失不会阻断，但会降低面试准备完整度。 |
| `story_recommendations[].title`、`background`、`result`、`storytelling_approach` | error | `INCOMPLETE_STORY_RECOMMENDATION` | 每条故事建议都必须有非空标题、背景、结果和讲述思路 | 故事建议必须完整，方便候选人按岗位要求组织真实经历。 |

## TODO：业务校验失败后的 LLM Recovery 策略

当前实现中，业务校验失败后的行为并不统一：

- JSON 解析失败或结构校验失败时，会默认请求 LLM 修复 1 次，但 prompt 明确要求只修复 JSON 格式或字段结构，不重新推理业务内容。
- `generate` 的 Markdown 质量门禁失败时，会请求 LLM 执行 `revise_resume`，最多修订 2 次。
- `analyze`、`match`、`interview` 的业务校验出现 `error` 时，目前会直接抛错并返回失败，不会继续请求 LLM 挖掘隐含信息或补全业务输出。

后续可以补充一层 `business recovery policy`，按问题类型决定是否继续请求 LLM，而不是所有业务 error 都直接失败或全部交给 LLM 自动补。

### Recovery 策略分层

| 策略 | 适用问题 | 推荐行为 | 中文解释 |
| --- | --- | --- | --- |
| `repair_business_output` | 输出字段缺失、解释不完整、证据标注不完整，但所需事实已经在当前输入或当前输出中 | 使用原始输入、当前输出和 evaluator issues 重新请求 LLM 修复业务输出 | 这类问题通常是模型漏写、漏解释或结构化不完整，适合让 LLM 基于已有事实补全表达。 |
| `reextract_from_source` | 源简历结构化字段缺失，但字段可能隐含在原始简历文本里 | 使用原始简历文本重新请求 LLM 抽取，并要求只引用原文、无法确认则留空 | 这类问题需要重新抽取事实，必须严格限制不能编造。 |
| `fail_with_missing_input` | 源文本确实缺少关键事实，或继续推理会产生较高幻觉风险 | 直接返回失败，并提示用户补充输入 | 这类问题不应由 LLM 硬补，否则会污染简历事实。 |

### 推荐优先级

| 入口 | 当前业务 error 类型 | 推荐策略 | 中文解释 |
| --- | --- | --- | --- |
| `match` | `MISSING_EXPERIENCE_MATCH` | `repair_business_output` | 经验匹配说明可以基于结构化简历和 JD 重新生成。 |
| `match` | `MISSING_WEAKNESS_EVIDENCE_TYPE` | `repair_business_output` | 弱点证据类型缺失属于解释不完整，适合让 LLM 补齐证据分类。 |
| `match` | `INVALID_WEAKNESS_EVIDENCE_TYPE` | `repair_business_output` | 证据类型不合法可以让 LLM 映射到允许的三类枚举。 |
| `match` | `JD_REQUIRED_SKILLS_NOT_CHECKED` | 不恢复 | 作为质量警告保留，供评分、优化建议和面试问题使用；不因中英文表达差异阻断流程。 |
| `interview` | `MISSING_STORY_RECOMMENDATIONS` | `repair_business_output` | 故事建议可以基于优化简历重新生成，风险相对可控。 |
| `interview` | `INCOMPLETE_STORY_RECOMMENDATION` | `repair_business_output` | 标题、背景、结果或讲述思路缺失属于建议内容不完整，适合修复输出。 |
| `analyze` | `MISSING_HARD_SKILLS` | `reextract_from_source` | 技能可能隐含在项目和经历描述中，适合基于原文重新抽取，但不能编造。 |
| `analyze` | `MISSING_PERSON_NAME` | `reextract_from_source` 或 `fail_with_missing_input` | 如果原文包含姓名但模型漏抽，可重抽；如果原文确实没有，应失败并提示补充。 |
| `analyze` | `MISSING_SOURCE_EXPERIENCE` | `reextract_from_source` 或 `fail_with_missing_input` | 如果原文存在经历但模型漏抽，可重抽；如果候选人确实没有经历，不能硬造。 |
| `generate` | `MISSING_SOURCE_EXPERIENCE` | `fail_with_missing_input`，必要时回到 `analyze` 重抽 | 生成阶段不应该凭空补源工作经历。 |
| `generate` | `MISSING_SOURCE_HARD_SKILLS` | `fail_with_missing_input`，必要时回到 `analyze` 重抽 | 生成阶段不应该凭空补源硬技能。 |
| `generate` | `RESUME_TOO_SHORT`、`MISSING_EXPERIENCE_SECTION`、`MISSING_SKILL_SECTION`、`PLACEHOLDER_TEXT_FOUND` | 已有 `revise_resume`，可继续沿用 | 这类问题是生成结果质量问题，不是源事实缺失，当前修订机制合理。 |

### 实施建议

| 阶段 | 建议范围 | 目标 | 中文解释 |
| --- | --- | --- | --- |
| 第一阶段 | 只给 `match` 和 `interview` 增加 `repair_business_output` | 优先修复低幻觉风险、高收益的问题 | 这两个入口的业务 error 多数是输出解释不完整，适合先做业务修复闭环。 |
| 第二阶段 | 给 `analyze` 增加 `reextract_from_source` | 支持从原始简历中重新抽取漏掉的姓名、经历、技能 | 需要 prompt 强约束“只基于原文、无法确认就留空”，并最好记录引用依据。 |
| 第三阶段 | 统一沉淀 `business recovery policy` 配置 | 按 issue code 映射 recovery 行为、最大尝试次数和失败提示 | 避免在各 route 中散落 if/else，也方便后续调整策略。 |

### Prompt 约束建议

| 场景 | Prompt 约束 | 中文解释 |
| --- | --- | --- |
| `repair_business_output` | 只允许基于原始输入和当前输出修复 evaluator issues，不允许新增输入中不存在的事实 | 防止业务修复阶段借机编造经历、技能或项目。 |
| `reextract_from_source` | 只从原始简历文本中抽取；每个新增字段必须能在原文找到依据；无法确认时留空并说明缺失 | 防止把推断当事实写入结构化简历。 |
| `fail_with_missing_input` | 返回明确错误码和中文提示，指导用户补充缺失信息 | 让用户知道是输入材料不足，而不是系统失败。 |
