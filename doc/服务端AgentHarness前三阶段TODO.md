# 服务端 Agent Harness 前三阶段 TODO

本文是 `服务端AgentHarness工程演进方案.md` 的落地执行清单。目标是一次性完成前三个阶段：运行时 Harness 骨架、`revise_resume` 自愈闭环、稳定性与测试。

## 总体原则

- 先做运行时 Harness，不依赖新增数据库表。
- 先把“成功返回 / 失败抛错”改造成可分类、可决策的 `Attempt Result`。
- 再把 `validate_resume` 失败接入 `quality_gate_failed → revise_output`。
- 所有 loop 必须有次数、token 或 timeout 预算，避免无限修复。
- API 响应保持兼容，新增字段必须可选。

## 阶段一：Harness 运行时骨架

- [x] 新增 `HarnessAttemptResult`、`HarnessAttemptError`、`HarnessResultClassification`、`HarnessDecision` 类型。
- [x] 新增 `RunRuntimeState`，集中记录 `steps`、`attempts`、`evaluations`、`recoverySummary`、`latestOutputs`。
- [x] 改造 `validate_resume`，不要校验失败后直接 `throw`，而是产出 `quality_gate_failed` attempt result。
- [x] 增加分类函数：把 provider error、JSON parse、schema validation、quality gate 映射为 classification。
- [x] 增加 decision 函数：把 classification 映射为 `accept`、`repair_json`、`revise_output`、`return_partial`、`fail`。

## 阶段二：`revise_resume` 自愈闭环

- [x] 新增 `ResumeRevisionAgent`，输入源简历、JD、匹配结果、上一版简历、evaluation issues，输出修订后 Markdown。
- [x] 新增 `revise_resume` step，记录 attempt、provider usage、错误和修订摘要。
- [x] 在 `ResumeOptimizationWorkflow` 中接入 loop：`generate_resume → validate_resume → revise_resume → validate_resume`，最多 2 次。
- [x] 增加 `recovery_summary` 到 `MvpProcessResponse`，记录触发 step、action、issueCodes、结果、attempts。
- [x] 确保修订成功后 `step3_optimized_resume` 返回最终修订版，而不是原始生成版。
- [x] 修订失败或二次校验仍失败时返回 `partial`，保留当前最佳简历和失败原因。

## 阶段三：稳定性与测试

- [x] 为 quality revise 设置最多 2 次 revision 和 workflow timeout 上限。
- [x] 为 provider transient / JSON repair 接入可执行重试或 repair loop，并设置对应 attempt 上限。
- [x] 增加 fake agent 测试，覆盖 `quality_gate_failed → revise_output → accept`。
- [x] 增加测试覆盖修订超过次数后返回 `partial`。
- [x] 增加测试覆盖 JSON parse / schema validation 映射为 `repair_json` 决策。
- [x] 增加测试覆盖 `generate_interview_advice` 失败仍可 recoverable partial。
- [x] 运行后端相关测试或最小验证命令，确认 `/process` 响应兼容。

## 当前实现状态

- 运行态骨架落在 `backend/src/harness/runtime-state.ts`，目前是单次 run 内存态，不新增数据库表。
- 自愈闭环落在 `backend/src/workflows/resume-optimization-workflow.ts`，质量门禁失败会按决策触发 `revise_resume`，最多修订 2 次。
- 修订 Agent 落在 `backend/src/agents/resume-revision.ts`，prompt 明确只基于源简历事实修复 evaluator issues。
- 响应兼容保持不变，仅新增可选 `recovery_summary` 字段；事件新增 `recovery.planned/started/succeeded/failed`。
- 已新增 `bun run test:unit`，覆盖运行态决策和 workflow 自愈/partial/recoverable 分支。
- 后续保留项已继续落地：provider transient retry 和 JSON repair recovery 详见 `服务端AgentHarness后续能力TODO.md`。

## 推荐实施顺序

1. 先加类型和 runtime state，不改行为。
2. 再把 `validate_resume` 改成 attempt result + decision。
3. 新增 `ResumeRevisionAgent`。
4. 接入最多 2 次 revision loop。
5. 补 `recovery_summary` 和测试。
6. 最后跑验证并修文档里的实现状态。

## 验收口径

- `validate_resume` 发现占位符、缺章节、内容过短时，不再直接终止，而是触发 `revise_resume`。
- 修订成功后最终响应返回修订后的 `step3_optimized_resume`。
- 修订超过上限仍失败时返回 `partial`，并在 `recovery_summary` / `recoverable_errors` 中说明原因。
- 不新增数据库表也能完成一次 run 内的诊断、修复和再校验。
- 原有 `/api/v1/mvp/process` 调用方不需要改动即可继续使用。
