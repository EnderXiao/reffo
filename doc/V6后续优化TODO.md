# V6 后续优化 TODO

状态：`in_progress`

目标：在不降低事实安全和可投递性的前提下，继续降低 V6 的 LLM 调用次数、输入上下文、异常退出率和端到端延迟。所有能力优先落在现有 Plugin Registry/Plugin Contract，可通过插件替换、禁用或新增，不复制主流程。

## 当前真实基线

样本：指定简历 PDF，JD 使用本地 `字节前端工程师.jpg` 的落盘文本。

- Run ID：`29fbbce1-f167-426c-805b-381eb29a2f5f`
- 结果：成功，52.62 秒，7 次 LLM 调用，82,021 Token
- P01：2 次，23,632 Token，最长单次 23.538 秒
- P03：1 次，14,047 Token，14.090 秒
- P08：1 次，18,894 Token；输入 17,442 Token
- P08 使用 `contextMode=full`，`repairScope=[]`，仍未实现真正局部修复
- 生成结果通过门禁，但内容偏短，项目经历未保留

## P0：先解决成本和稳定性

### 1. 实现真正的 scoped/patch 修复上下文

- [ ] 为每类 `ValidationIssue` 声明 `outputPath`、关联 evidence、source block、父级路径和最小必需字段。
- [ ] `ContextBuilder` 按 issue 生成最小上下文窗口；默认不复制完整原始 envelope、完整旧 Artifact 和完整证据目录。
- [ ] `full` 仅允许严格审查配置或显式调试开关；低成本配置默认 `patch`。
- [ ] P08/P08R 只发送失败 claim、相关证据、计划白名单、必要父级结构和 validator 约束。
- [ ] P01R/P02R/P03R/P05R/P10R 复用同一 ContextBuilder，不在 workflow 中拼装专用上下文。
- [ ] 增加上下文 digest、输入 Token 估算和实际 Token 对比，验证修复输入 Token 较 V5 降低 50% 以上。

### 2. 引入统一 Patch Schema 和服务端合并器

- [ ] 定义版本化 `RepairPatch`：操作路径、原值摘要、替换值、关联 evidence ID、source block ID、操作原因和安全级别。
- [ ] Patch 只能修改声明路径；禁止返回无关完整对象、未声明 evidence 或新事实。
- [ ] 服务端先合并 Patch，再执行全量 Schema、事实、引用、预算和渲染校验。
- [ ] Patch 合并失败直接安全回退或阻断，不再次调用同一修复器。
- [ ] 为数组排序、去重、ID 重映射、span 校正、计数和 scoreInputs 提供确定性 Patch，不调用 LLM。
- [ ] 增加 Patch 合并冲突、越权路径、旧值摘要不匹配和重复应用测试。

### 3. 收敛 P08 触发条件

- [ ] 将 Artifact 门禁问题分类为 `deterministic_fix`、`local_llm_fix`、`blocking`。
- [ ] 代码可修复的问题不得进入 P08；多个同阶段问题合并为一次 Patch 请求。
- [ ] P08 最多一次，修复后只允许一次服务端全量校验。
- [ ] P09 只做语义事实判断，不回写或重跑 P08；低成本配置禁止 `P09 -> P08`。
- [ ] P08/P09 的共享修复预算由同一 `V6LlmCallPolicy` 控制，并记录触发 issue 和预算消耗。

### 4. 修复确定性选材导致的内容缺失

- [ ] 计划构建器在满足业务 bullet 下限后，至少保留一个合法项目/研究 scope（受 `hardProjectMax` 和总预算约束）。
- [ ] 预算分配固定保留教育、技能、核心工作和项目的最小槽位；不足时按策略明确降级原因。
- [ ] 生成前计算 `plannedContentEvidenceIds` 覆盖率；低于阈值时不进入 LLM 草稿，直接调整计划。
- [ ] 生成后检查每个高价值 scope 是否有正文或明确 timeline line，避免成功结果只剩少量实习条目。
- [ ] 增加长简历、多项目、多教育经历、技能过多和稀疏证据样本测试。

## P1：降低调用次数和单次延迟

### 5. P01 分块策略优化

- [ ] 小型简历走单请求；仅在预计输出或输入超过阈值时启用分 chunk。
- [ ] Chunk 输出必须返回 `chunkIndex`、目标 block ID、源序号和 chunk digest；服务端只按 canonical 顺序合并。
- [ ] 重传使用 `runId + documentDigest + chunkDigest` 幂等键；相同键不得重复合并。
- [ ] 只重传失败 chunk；成功 chunk 结果进入可信缓存，不因后续 chunk 失败而重跑。
- [ ] 单个 chunk 超过预算时自动缩小上下文或安全阻断，并保留其他已验证 chunk。
- [ ] 将 Chunk Planner、Scheduler、Retry、Merger 实现为可插拔插件。

### 6. Provider 重试和 fallback 统一计费

- [ ] 明确“逻辑调用”和“物理 provider attempt”两套计数，Harness 分别记录。
- [ ] 统一关闭 SDK 隐式重试；网络/限流重试只能由预算策略批准。
- [ ] fallback model、同模型重试和业务重试共享同一物理调用预算，禁止预算外隐藏调用。
- [ ] 记录每次物理 attempt 的模型、耗时、错误类型、是否计费和最终归属阶段。
- [ ] 增加超时、429、5xx、fallback、AbortSignal 和并发预算耗尽测试。

### 7. Prompt 输入输出瘦身

- [ ] P02 只携带 JD 原文 block 和必要逻辑邻居，避免重复发送无关上下文。
- [ ] P03 只携带有效 EvidenceAtom、RequirementAtom 和必要匹配候选；服务端计算唯一 ID、状态冲突和 scoreInputs。
- [ ] P06 按计划白名单携带证据，不发送未选证据和完整历史输出。
- [ ] P09 只携带可渲染 claim、对应 evidence 和计划，不携带无关原始文档。
- [ ] 各阶段按结构复杂度动态设置 `maxOutputTokens`，避免过大输出上限造成等待和预算误估。
- [ ] Prompt 编译器输出稳定 manifest，支持输入字段裁剪前后 Token 对比。

## P2：完善插件化边界

- [ ] 保持 `V5WorkflowPlugin`、`V5WorkflowPluginContext`、`V5WorkflowPluginRegistry` 作为 V6 扩展边界。
- [ ] 将 ContextBuilder、Structured Runner、Validator、RepairPolicy、PatchMerger、ChunkMerger、RetryPolicy 定义为独立插件能力。
- [ ] 插件声明输入/输出 Artifact 类型、阶段、依赖、超时、预算和 failure mapping。
- [ ] 必选事实安全门禁不可禁用；P10/P11、质量审查和面试建议可禁用或异步化。
- [ ] 插件只能读取共享上下文中声明的版本化 Artifact，不直接读取其他插件内部状态。
- [ ] 插件替换、禁用、降级、超时和取消均写入 Harness manifest。
- [ ] 为 Registry 增加 contract tests：依赖顺序、替换、禁用、部分成功、错误映射和预算耗尽。
- [ ] 逐步把 workflow 中阶段闭包迁移到 `backend/src/v5/plugins/`，保持兼容适配器。

## P3：可观测性和故障定位

- [ ] Provider 事件同时记录调用前预算和调用后预算，避免 `budgetRemaining` 语义歧义。
- [ ] 每个阶段记录输入/输出 Token、延迟、上下文模式、修复范围、重试次数、物理 attempt 数和成本估算。
- [ ] 增加 run 级汇总：业务 LLM 调用、语义门禁调用、确定性门禁、修复调用分别统计。
- [ ] 增加 P01 chunk、P08 repair、P09 judge 的阶段耗时和 Token 分布查询。
- [ ] 保留 prompt digest 和字段摘要，不记录完整简历、JD、API Key 或完整隐私内容。
- [ ] 为预算耗尽、上下文超限、Provider 超时和安全回退生成可读错误码及恢复建议。

## P4：回归和发布门禁

- [ ] 建立 V5/V6 黄金集：普通简历、长简历、多 chunk、稀疏证据、结构化截断、网络超时和历史失败样本。
- [ ] 每次变更对比成功率、事实事故率、关键 JD 覆盖率、项目保留率、LLM 调用数、Token、P95 和成本。
- [ ] 增加随机乱序响应、部分 chunk 失败、重复重传、并发预算竞争和进程重启恢复测试。
- [ ] 增加 P01/P02/P03/P05/P06/P08/P09 的离线 Prompt contract tests，禁止依赖真实 API 才能验证结构约束。
- [ ] 发布前要求：无新增阻断事实事故、chunk 无乱序/丢块/重复、低成本主链路最多 8 次调用、修复最多 1 次。
- [ ] 真实 API canary 通过后再切换默认版本；保留 V5 回滚开关和失败样本审计。

## 建议实施顺序

1. scoped/patch ContextBuilder + Patch Schema + P08 局部修复。
2. 确定性选材保留项目和关键教育信息。
3. Provider 物理 attempt 预算和 fallback 计费统一。
4. P01 幂等重传和 Chunk 插件化。
5. Harness 指标、黄金集、故障注入和 canary 门禁。

## 验收目标

- 正常请求相较 V5：LLM 调用数降低 50% 以上，输入 Token 降低 50% 以上。
- 低成本配置：最多 8 次逻辑调用、最多 1 次修复、总 Token 不超过 120,000。
- P08：默认 patch/scoped，上下文不包含完整旧 Artifact；`repairScope` 非空且可审计。
- P01：合并结果按 canonical source block 顺序 100% 稳定；成功 chunk 不重复调用。
- 端到端：黄金集成功率、事实安全、项目保留率和 P95 均不劣于 V5；失败可定位、可回放、可回滚。
