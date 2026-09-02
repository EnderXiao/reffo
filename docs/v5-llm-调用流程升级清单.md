# V5 LLM 调用流程升级项目与清单

> 对比基线：`main` 分支 `7e519f85522f44818dccdb425d8f4341ccba79a3`。
>
> 当前代码分支：`private/v5-llm-flow-hsl`。本文只记录代码中已实现或明确声明的行为；真实模型效果、成本和延迟仍需独立验收。

## 1. 结论摘要

V5 把 `main` 中“多个 Agent 顺序调用、JSON 解析、简历文本质量校验、失败后返回 partial”的链路，升级为“证据抽取、原子需求匹配、自适应策略、计划、结构化简历 Artifact、确定性门禁、事实 Judge、面试准备”的受控工作流。

V5 当前发布标签仍是 `preproduction_candidate`，完整流程固定只执行 V5，不再提供 V4 fallback、shadow 或请求级版本切换。当前改动只在测试分支验证，暂不合入 `main`。

## 2. `main` 基线流程

`main` 的完整流程为：

1. `analyze_resume`：调用 `ResumeAnalyzerAgent`，输出结构化简历。
2. `parse_jd`：调用 `JDParserAgent`，输出 JD 结构。
3. `match_resume_to_jd`：调用 `MatchingAgent`，输出匹配分析。
4. `generate_resume`：调用 `ResumeGeneratorAgent`，输出 Markdown 简历。
5. `validate_resume`：服务端执行 Markdown 质量评估。
6. 质量不通过时，最多两次 `ResumeRevisionAgent` 修订并重新校验。
7. `generate_interview_advice`：调用 `InterviewAdvisorAgent`，输出面试建议。

基线特点：

- 简历分析、JD 解析、匹配、生成使用自由文本 Prompt 加 `json_object`，再由 Agent 层解析和旧 Schema 校验。
- 评分主要来自模型输出；服务端没有 V5 的 EvidenceAtom、RequirementAtom、claim map 和版本化评分公式。
- 生成质量门禁失败后可返回 `workflow_status: partial` 和当前简历。
- LLM Judge 是可选异步任务，不阻塞主流程，也不承担事实放行职责。
- Provider 通过 OpenAI SDK 调用，未传 V5 的结构化 Schema、Prompt manifest、最大输出 Token 和显式 `maxRetries: 0`。

## 3. V5 正式调用时序

```text
规范化源简历/JD
  -> P01 源简历证据抽取（可分块、并发） + P02 JD 原子需求抽取（并行）
  -> V01/V02 quote、span、覆盖率、注入风险和 Schema 门禁
  -> P03 证据与需求匹配
  -> V03 门禁 + 服务端匹配分计算
  -> 服务端自适应策略
  -> 低置信且存在实质歧义时 P04 策略裁决
  -> P05 ResumePlan + V05 计划门禁
  -> P06 生成 GeneratedResumeArtifact
  -> 确定性 Artifact 门禁；必要时 P08 修复，Artifact 修复总数最多 2 次
  -> P07 独立终审
  -> 再次确定性 Artifact 门禁和最多 2 次 P08 修复
  -> P09 阻断式语义事实 Judge；必要时 P08 修复后重审
  -> P10 InterviewPreparation（失败不阻断已通过事实门禁的简历）
  -> 可选 P11 质量 Judge（非阻断）
  -> 转换为旧 MVP 响应结构
```

V5 正常基线为 8 次模型调用：`P01、P02、P03、P05、P06、P07、P09、P10`。P01/P02 并行，关键路径约 7 个串行阶段。P04、P11、各阶段专用修复和 P08 会按条件增加调用。P12 只用于离线双顺序 A/B，不进入正式生成放行。

## 4. 相对 `main` 的升级项目

### 4.1 工作流和路由

- `ResumeOptimizationWorkflow` 收敛为轻量 V5-only 入口，不再包含 V4 完整编排。
- `/api/v1/mvp/process` 只保留 V5 `output_language` 和可选 P11 开关，不再提供版本选择。
- V5 失败按状态返回：Provider 失败为 `503`；输入、事实或结构门禁失败为 `422`。
- V5 返回旧字段 `step1_analysis`、`step2_matching`、`step3_optimized_resume`、`step4_interview_suggestions`，并增加 `agent_version`、`agent_state`、`release_status`、`used_safe_fallback`。
- 单步 `/analyze`、`/match`、`/generate`、`/interview` 是独立旧接口，不参与完整流程编排。

### 4.2 输入规范化和证据链

- `canonical-source.ts` 统一 CRLF/NFC，给非空 block 分配稳定 ID、绝对 span、hash 和输入风险标记。
- P01 将源简历转换为 `EvidenceAtom`，保留逐字引用、span、数字、单位、限定词、归因级别、scope 和风险标记。
- P02 将 JD 转换为 `RequirementAtom`、逻辑组、核心结果、显式公司/地点语境和不确定项。
- 原始简历是候选人事实唯一来源；JD、外部语境、旧输出、验证建议和 Prompt 不能升级为候选人事实。
- 长简历支持按逻辑 scope 分块抽取、并发执行、合并校验；同一源简历可通过受信 P01 缓存跨 JD 复用。

### 4.3 Prompt、Schema 和 Provider

- 每个 V5 阶段有独立 Prompt ID/版本：`P01` 到 `P12`，修复阶段使用 `P01R/P02R/P03R/P05R/P10R` 和 P08。
- Prompt 正文位于 `backend/src/v5/prompts/*.md`，版本由 `prompts/manifest.json` 管理；registry 缺文件或非法版本时 fail closed。
- `prompt-compiler.ts` 从 registry 生成 system/user messages、严格 Zod Schema、温度、输出 Token 上限和 Prompt manifest。
- Manifest 固定记录工作流版本、Prompt 版本、Prompt 文件相对路径与 hash、编译 hash、Schema/Validator/策略/评分版本、输入文档 ID 和修复次数。
- Provider 支持原生 JSON Schema；OpenAI 兼容但不支持原生 Schema 的端点使用 `json_object`，服务端仍执行同一严格 Zod 校验。
- Provider 请求增加 `max_tokens`、AbortSignal 合并、请求/响应审计摘要、Prompt manifest 和 token/延迟记录；SDK 内部重试显式关闭为 `maxRetries: 0`。
- Fallback Provider 对可重试错误按模型和次数重试；取消信号不重试，并记录 recovery 事件。

### 4.4 策略、生成和质量门禁

- P03 只输出匹配所需的 `scoreInputs`；最终匹配分由 `match-score.ts` 的版本化公式计算。
- 服务端依据证据丰富度、时间线、需求匹配和输出语言选择 `preserve_sparse`、`balanced_targeted` 或 `selective_rich`。
- 只有低置信且存在两个实质不同候选时才调用 P04；非法选择回退保守策略。
- P05 先生成 ResumePlan，明确 stable core、primary requirements、scope 处理方式、章节顺序和字数/条目预算。
- P06/P07/P08 输出完整 `GeneratedResumeArtifact` 和 claim map，而不是只返回 Markdown。
- 确定性 Validator 检查证据引用、scope、数字和限定词、章节/条目预算、隐私、Prompt 注入污染、计划白名单和投递结构。
- Artifact 失败最多两次 P08 修复；仍失败时使用 source-preserving 安全回退。
- P09 是阻断式语义事实门禁，检查语义升级、错误归因、因果、范围迁移和 JD/上下文污染；阻断错误未修复则 API 失败。
- P10 只基于已通过事实门禁的 Artifact 和证据生成面试准备；P11 质量 Judge 可选且非阻断。

### 4.5 可观测性和数据迁移

- V5 Workflow 通过 Plugin Registry 编排阶段；插件支持依赖、替换、可选禁用、超时、取消、partial 和错误映射，Plugin manifest 写入 workflow 成功事件。
- Harness 记录 workflow、step、attempt、provider 请求/响应、Prompt manifest、输入/输出摘要、token、延迟、修复和状态变化。
- SQLite Harness Schema 以 additive migration 增加 Agent state、release status、safe fallback 和 Prompt manifest 字段，无破坏性迁移。
- 当前改动只在测试分支验证，暂不提交、不合入 `main`。
- V5 固定返回 `release_status: preproduction_candidate`，在黄金集、对抗集和线上指标达标前不能标记为 `production_reliable`。

## 5. 升级实施清单

### 已完成（代码已具备）

- [x] 完整流程收敛为 V5-only，移除路由级版本选择和 shadow 模式。
- [x] canonical source、P01/P02 抽取、EvidenceAtom/RequirementAtom。
- [x] P03 匹配、自适应策略、P04 条件裁决、P05 计划。
- [x] P06/P07 Artifact 生成与 P08 有界修复。
- [x] 严格 Zod Schema、结构/事实/隐私/注入/预算 Validator。
- [x] P09 阻断事实 Judge、P10 面试准备、P11 非阻断质量 Judge、P12 离线 A/B。
- [x] Provider fallback、取消传播、显式 SDK 重试策略、token/延迟/manifest 审计事件。
- [x] 安全回退和失败关闭：生成与回退均不通过时不返回已知无效 `partial` 简历。
- [x] 旧 MVP 步骤响应兼容转换。
- [x] V5 单元测试、工作流测试、Schema/Validator/Provider/兼容性测试。

### 发布前必须完成（当前未完成或需新证据）

- [x] 运行 `bunx tsc --noEmit`。（2026-09-01）
- [x] 运行 `bun test ./src/v5/tests`。（2026-09-01）
- [x] 运行 `bun test ./src`。（2026-09-01）
- [ ] 使用真实 Provider 完成端到端兼容性验证，覆盖原生 JSON Schema 和 `json_object` 两种传输。
- [ ] 测试分支 nonprod 至少覆盖 100 份跨行业黄金集和 30 份对抗输入。
- [ ] 统计事实事故、空 scope、stable core/primary coverage、安全回退率、修复率、P95 延迟、输入/输出 Token 和成本。
- [ ] 完成 internal beta：逐份人工检查 claim/evidence 审计和可投递结果。
- [ ] 完成 limited test，并使用 P12 双顺序盲评。
- [ ] 确认 Provider、模型、数据保留/训练、删除和生产合同信息，更新合规文档。
- [ ] 只有零阻断事实事故、无空工作/项目结构、关键覆盖率不回归且成本/延迟达标后，才提升发布状态。

## 6. 测试分支运维清单

- [ ] 启用 V5 前确认 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`AI_MODEL` 和 `AI_FALLBACK_MODELS`。
- [ ] 设置并记录 `V5_QUALITY_JUDGE_ENABLED`、`V5_CONTEXT_WINDOW_TOKENS`、`V5_STRUCTURED_OUTPUT_MODE`。
- [ ] 生产切换前确认 `APP_ENV`、Supabase、认证和 Harness 数据库配置。
- [ ] 监控 `V5_OUTPUT_TRUNCATED`、Schema 失败、P08 修复耗尽、P09 阻断、Provider 503 和安全回退状态。
- [ ] 发现事实事故、成本/延迟超预算或 Provider 不兼容时停止测试，不降低 V5 门禁。
- [ ] 保留 Harness 新字段和失败样本，供 V5 离线修复；不要直接删除审计数据。

## 7. 关键代码入口

- 主流程：`backend/src/v5/main/workflow.ts`
- 阶段调用和严格输出：`backend/src/v5/stage-runner.ts`
- Prompt 编译：`backend/src/v5/prompt-compiler.ts`、`backend/src/v5/prompts.ts`
- Schema：`backend/src/v5/schemas.ts`
- 证据与抽取：`backend/src/v5/canonical-source.ts`、`backend/src/v5/evidence.ts`
- 策略和评分：`backend/src/v5/adaptive-policy.ts`、`backend/src/v5/match-score.ts`
- 门禁和回退：`backend/src/v5/validators.ts`、`backend/src/v5/safe-renderer.ts`
- Provider：`backend/src/providers/deepseek-provider.ts`、`backend/src/providers/fallback-provider.ts`
- V5 入口和兼容响应：`backend/src/workflows/resume-optimization-workflow.ts`、`backend/src/v5/main/compatibility.ts`
- 发布说明：`backend/src/v5/README.md`
- 真实评测纪律：`backend/docs/v5-live-evaluation-runbook.md`

## 8. V5 目录结构

```text
backend/src/v5/
├── main/       # 主流程编排、兼容响应
├── plugins/    # Plugin contract、registry
├── prompts/    # Prompt Markdown、manifest.json
├── tests/      # V5 全部测试与 fixture
└── *.ts        # 领域与 runtime 支撑模块
```

测试统一运行 `bun test ./src/v5/tests`；主流程入口为 `main/workflow.ts`。
