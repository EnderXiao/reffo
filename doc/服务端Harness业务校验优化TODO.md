# 服务端 Harness 业务校验优化 TODO

本文承接 `doc/服务端Harness校验规则说明.md`，只沉淀待 review 的优化项，暂不代表已经实现。

## 背景判断

当前 Harness 的 JSON 解析、schema 校验、provider transient retry 和 JSON repair 已经比较完整；主要问题集中在业务校验层：

- 部分业务 error 过早阻断用户流程，实际可以通过 LLM 基于已有输入补全解释或修复结构。
- 部分问题属于源简历/JD 抽取遗漏，应回到原文重抽，而不是在后续阶段直接失败。
- 部分问题确实是输入材料缺失，不能交给 LLM 硬补，否则会引入事实幻觉。
- 当前 `analyze`、`match`、`interview` 的业务 error 都是直接失败，缺少类似 `generate` 阶段 `revise_resume` 的业务 recovery 闭环。

## TODO List

| ID | 状态 | 优先级 | 待办 | 建议策略 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| HBR-1 | done | P0 | 定义统一 `business recovery policy` 配置 | 配置化 | 已新增 `backend/src/harness/business-recovery.ts`，按 stepName + issue code 映射 repair 行为、最大尝试次数和 recovery 事件。 |
| HBR-2 | done | P0 | 为 `match` 增加业务输出修复闭环 | `repair_business_output` | `MISSING_EXPERIENCE_MATCH`、`MISSING_WEAKNESS_EVIDENCE_TYPE`、`INVALID_WEAKNESS_EVIDENCE_TYPE`、`JD_REQUIRED_SKILLS_NOT_CHECKED` 可触发最多 1 次修复；修复后重新跑 schema 和业务 evaluator。 |
| HBR-3 | done | P0 | 调整 `match` 必备技能覆盖校验的严格度 | 降误报 + repair | 已支持复合技能拆分和双向包含匹配；仍完全未覆盖 JD 必备技能时先 repair 一次，repair 后仍未覆盖才失败。 |
| HBR-4 | done | P0 | 将 `match` 弱点证据数量不一致从直接失败改为可修复问题 | `repair_business_output` | `weaknesses` 与 `weakness_details` 数量不一致时，LLM 只补齐证据类型、依据和建议，不新增输入中不存在的事实。 |
| HBR-5 | done | P1 | 将 `match` 缺少 `strengths` 保持 warning，不进入阻断路径 | 保持 warning | `MISSING_MATCH_STRENGTHS` 保持 warning，只记录观测，不影响主流程。 |
| HBR-6 | done | P0 | 为 `interview` 增加业务输出修复闭环 | `repair_business_output` | `MISSING_STORY_RECOMMENDATIONS`、`INCOMPLETE_STORY_RECOMMENDATION` 可触发最多 1 次修复；修复输入包含分析、匹配、优化简历和 evaluator issues。 |
| HBR-7 | done | P1 | 调整 `interview` 故事建议校验的阻断边界 | repair 后失败 | 初次缺 story 不直接返回失败；修复后仍没有可用 story 才失败。`questions`、`follow_up_questions` 数量不足继续只作为 warning。 |
| HBR-8 | done | P1 | 为 `analyze` 增加源简历重抽能力 | `reextract_from_source` | `MISSING_PERSON_NAME`、`MISSING_SOURCE_EXPERIENCE`、`MISSING_HARD_SKILLS` 可在保留原文的单次 run 内触发重抽；重抽 prompt 强制“只引用原文，无法确认留空”。 |
| HBR-9 | done | P1 | 明确 `analyze` 输入缺失时的失败提示 | `fail_with_missing_input` | 重抽后仍缺姓名、经历或硬技能时，抛出 `BusinessEvaluationError`，API `details.issues` 返回 issue code、path 和中文提示。 |
| HBR-10 | done | P1 | 保持 `generate` 源事实前置校验严格 | `fail_with_missing_input` | `MISSING_SOURCE_EXPERIENCE`、`MISSING_SOURCE_HARD_SKILLS` 继续由生成前置校验阻断，不在生成阶段硬补。 |
| HBR-11 | done | P1 | 继续沿用 `generate` Markdown 修订机制 | 已有 `revise_resume` | `RESUME_TOO_SHORT`、`MISSING_EXPERIENCE_SECTION`、`MISSING_SKILL_SECTION`、`PLACEHOLDER_TEXT_FOUND` 继续最多修订 2 次；修订事件沿用统一 `recovery.*` 命名。 |
| HBR-12 | done | P1 | 增加业务 recovery 事件 | 观测增强 | 已发布 `recovery.planned`、`recovery.started`、`recovery.succeeded`、`recovery.failed`；payload 只记录 action、issue code、attempt、maxAttempts、stepName，不记录完整简历/JD/LLM 原文。 |
| HBR-13 | done | P1 | 增加业务失败样本回流规则 | 回归数据集 | `runHarnessedRequest` 失败和完整 workflow partial/failed 会自动幂等写入 failure sample，reason 包含 stepName、issue code 或 recoverable error 摘要。 |
| HBR-14 | done | P2 | 为业务校验补充更细的 severity 分层 | error/warning 调整 | 解释不完整、数量不足、建议缺失保持 warning 或 repairable error；只有事实缺失、无法安全修复、生成结果不可用才阻断。 |
| HBR-15 | done | P2 | 为前端展示补充 recoverable error 语义 | API 兼容增强 | 业务校验失败响应会返回可选 `details.issues` 和 `details.recoverable_errors`，前端可区分输入材料不足和系统失败。 |

## 建议实施顺序

### 第一阶段：先救主流程

- [x] HBR-1：定义 `business recovery policy` 配置骨架。
- [x] HBR-2：先给 `match` 接入 `repair_business_output`。
- [x] HBR-3：修正必备技能覆盖校验，降低复合技能和同义技能误报。
- [x] HBR-4：弱点证据类型缺失先修复，不直接失败。
- [x] HBR-6：给 `interview` 接入 `repair_business_output`。

验收口径：常见 JD 匹配和面试建议生成不因“解释字段漏写”直接失败；所有修复最多 1 次，有事件记录。

### 第二阶段：处理源事实抽取遗漏

- [x] HBR-8：为 `analyze` 增加从原始简历重抽姓名、经历、硬技能。
- [x] HBR-9：重抽后仍缺失时给出用户可理解的补输入提示。
- [x] HBR-10：保持生成阶段不硬补源事实。

验收口径：源简历原文存在的信息被漏抽时可以自愈；原文确实没有的信息不会被 LLM 编造。

### 第三阶段：统一观测和产品体验

- [x] HBR-11：把 generate 修订事件纳入统一 recovery 观测。
- [x] HBR-12：补齐业务 recovery 事件。
- [x] HBR-13：失败样本自动回流。
- [x] HBR-14：统一 severity 分层。
- [x] HBR-15：补充前端可展示的 recoverable error 语义。

验收口径：业务失败能被复盘、能进入回归集，前端能区分“系统失败”和“输入材料不足”。

## 关键约束

- 所有 recovery 都必须有最大次数限制，默认最多 1 次业务修复。
- recovery prompt 只能基于原始输入、当前输出和 evaluator issues 修复，不能新增输入里不存在的事实。
- `reextract_from_source` 必须能回到原始简历文本；如果当前接口没有原文，就不能假装重抽。
- 运行时 Harness 仍不落完整简历、JD、prompt 或 LLM 原文；只记录摘要、digest、issue code 和 recovery 事件。
- `warning` 不阻断主流程，但必须能被记录和回放，方便后续调优。
