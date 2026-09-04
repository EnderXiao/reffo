# V6 提示词与 LLM 调用降本 TODO

状态：`in_progress`

目标：在保持事实安全、可审计和可投递结果的前提下，减少 LLM 调用次数、上下文重复和无效修复；完成可复用的上下文组装、LLM 调用封装，以及 P01 分 chunk 的稳定排序与失败重传。

V6 设计约束：**优先复用现有 V5 Plugin Registry/Plugin Contract**。主流程只负责编排、依赖、预算和结果汇总；Prompt、上下文、门禁、重试、排序等能力均通过可插拔插件提供，允许按部署环境替换、禁用或新增能力。

## 总体原则

- [ ] 默认一次调用完成一个阶段；门禁优先使用服务端确定性校验。
- [ ] 修复只发送失败字段、相关记录和最小证据窗口；禁止默认复制完整阶段输入和完整旧输出。
- [ ] 能由代码修复的 span、ID、排序、计数、去重、scoreInputs、格式问题，不调用 LLM。
- [x] LLM 修复输出优先采用 patch；服务端合并 patch 后重新校验。（2026-09-04；P08R 已接入业务门禁修复）
- [x] 低成本与严格审查配置设置全局调用、修复调用和 Token 预算；工作流 deadline 限制墙钟时间；调用前超预算明确失败。（2026-09-04）
- [x] 所有请求继续记录 prompt 版本、上下文模式、修复范围、Token、延迟、重试原因和最终结果。（2026-09-04）

## T0. V6 基线与目标（先完成）

- [ ] 从 Harness 汇总 V5 各阶段调用次数、修复率、输入/输出 Token、P95 延迟和费用。
- [ ] 按阶段区分“业务 LLM 调用”和“确定性门禁”，明确每次额外调用的触发条件。
- [ ] 建立 V6 预算目标：单次主流程最大 LLM 调用数、最大修复调用数、Token 上限、P95 和单次成本。
- [ ] 定义结果降级策略：局部修复失败时，优先保留已验证结果；禁止为修复非关键问题重跑整条链路。
- [ ] 选取真实简历/JD 黄金集、长简历、分 chunk、结构化输出截断和 Provider 超时样本作为回归基线。

## T1. 抽离可复用的 LLM 调用基础设施

- [ ] 抽象统一 `runStructuredStage`：Prompt 编译、Schema、Provider 调用、AbortSignal、超时、Token/延迟记录、解析和错误映射只实现一次。
- [x] 抽象统一 `ContextBuilder`：输入文档、证据、旧输出、问题列表、白名单和字段选择按阶段声明，不在 workflow 中重复拼装。（2026-09-04；首轮 `buildRepairContext`）
- [ ] 上下文构建支持 `full`、`scoped`、`patch` 三种模式，默认 `scoped` 或 `patch`。
- [x] P01 使用稳定 digest 的进程内可信缓存；同一简历切换 JD 时复用已验证提取结果。（2026-09-04）
- [ ] 统一结构化输出清理、截断检测、JSON 解析和 Schema 校验；`finish_reason=length` 不进入无效修复循环。
- [ ] 统一 Provider 重试策略：取消不重试；网络/限流按预算进行有限重试；避免 SDK 重试与业务重试叠加。
- [x] V6 调用策略限制 fallback 模型和同模型物理重试为单次，并在结果/Harness 中记录 `physicalAttempts`。（2026-09-04）
- [x] 增加可替换调用预算器：并发调用先预留额度，响应后以实际 Token 结算；低成本配置限制 8 次调用、1 次修复和 120,000 Token。（2026-09-04）

## T1.1 基于现有 Plugin Framework 重构

- [ ] 保持 `V5WorkflowPlugin`、`V5WorkflowPluginContext`、`V5WorkflowPluginRegistry` 作为 V6 扩展边界，不在主流程新增阶段专用分支。
- [ ] 将 ContextBuilder、结构化 LLM Runner、确定性 Validator、Patch Merger、Chunk Merger、Retry Policy 分别定义为独立插件或插件能力。
- [ ] 为插件声明输入/输出类型、阶段、依赖、是否可选、超时、Token/调用预算和 failure mapping。
- [ ] 通过 `register/replace/disable/enable` 支持能力插拔；必选安全门禁禁止被误禁用，可选 P10/P11 等允许关闭或异步化。
- [ ] 插件之间只通过共享上下文中的版本化 Artifact/证据目录传递数据；禁止跨插件直接读取未声明的内部状态。
- [ ] 为每次插件替换记录 plugin ID、版本、依赖、启用状态和配置 digest，写入 Harness manifest。
- [x] 设计 V6 低成本插件组合、严格审查插件组合；同一主流程可按配置切换，不复制 workflow。（2026-09-04）
- [ ] 为插件增加 contract tests：依赖顺序、替换、禁用、超时、取消、预算耗尽、部分成功和错误映射。
- [ ] 内置阶段先保持兼容适配器，逐步把 `workflow.ts` 中现有闭包迁移到 `backend/src/v5/plugins/`，避免一次性重写。

## T2. 重构修复机制，减少 P01R/P02R/P03R/P05R/P10R

- [ ] 将“字段级确定性问题”从修复 Prompt 中移出：quote/span、sourceBlockId、scope、重复项、派生计数和排序由服务端修复。
- [ ] 定义统一 `ValidationIssue` 分类：`deterministic_fix`、`local_llm_fix`、`global_llm_fix`、`blocking`。
- [ ] `deterministic_fix` 不触发 LLM；仅 `local_llm_fix` 才允许一次局部修复调用。
- [x] 设计统一 Patch Schema：包含操作路径、原值摘要、替换值、关联证据 ID 和操作原因；禁止返回无关完整对象。（2026-09-04；`RepairPatch` + `mergeRepairPatch`）
- [x] 修复上下文只包含失败路径、相关 source block/EvidenceAtom/RequirementAtom、必要父级结构和 validator 规则。（2026-09-04；scoped/patch ContextBuilder）
- [x] 修复后由服务端合并、全量校验；禁止“修复失败后再次自动调用同一修复器”。（2026-09-04；默认修复策略单次调用）
- [ ] 对不可安全修复的问题直接降级或阻断，不以重复 LLM 调用换取通过率。
- [ ] P10/P10R 改为可选异步任务；主简历结果不等待面试建议修复。
- [ ] P08 统一纳入同一修复预算，避免 P06/P07/P09 之间重复修复同一 Artifact。

## T3. P01 分 chunk 稳定性

- [ ] 为每个 chunk 生成稳定排序键：`documentId`、`chunkIndex`、源 block 起止序号、scope ID。
- [ ] Prompt 中明确要求返回 `chunkIndex` 和目标 block ID；服务端不信任 LLM 返回数组顺序。
- [x] 合并前按 canonical source block 顺序排序；按 `sourceBlockId` 去重，保留稳定事实顺序。（2026-09-04；首轮实现）
- [ ] 合并 `timelineCandidates`、`sectionCandidates`、`unmappedFragments` 时使用确定性排序规则，不按 Promise 完成顺序合并。
- [x] `Promise.all` 返回结果先绑定 chunk 元数据，再进入排序/合并；禁止直接按完成顺序追加。（2026-09-04）
- [x] 每个 chunk 记录请求、响应、校验状态和重传次数；失败只重传失败 chunk。（2026-09-04；Harness recovery 事件）
- [x] 增加 chunk 级有限重传：网络/超时按策略最多重传 1 次；Schema/业务错误不重复调用。（2026-09-04）
- [x] 重传使用相同 chunk digest 和幂等键，避免重复计费和重复合并。（2026-09-04；`resumeExtractionChunkIdempotencyKey`，合并前按 key 去重）
- [ ] chunk 重传达到上限后，保留其他已验证 chunk，按策略安全回退或明确阻断。
- [x] 增加分 chunk 乱序响应和稳定合并测试。（2026-09-04）
- [ ] 评估减少 chunk 上下文：完整经历只作为只读上下文按需发送，不复制到每个 shard 的输出上下文。
- [ ] 将 Chunk Planner、Chunk Scheduler、Chunk Retry、Chunk Merger 拆为可替换插件；主流程只消费有序合并结果。
- [ ] 允许后续替换 chunk 策略：按 block、按 scope、按 Token 预算或单请求全文；插件输出统一 `chunkIndex/sourceOrder`。

## T4. 各阶段 V6 Prompt 设计

### P01/P01R：源简历证据

- [ ] P01 输出严格绑定目标 chunk，不输出非目标 block。
- [ ] P01R 改为“问题 block + 原文窗口 + 当前候选片段”的局部修复 Prompt。
- [x] 数字、span、scope、覆盖率和风险状态优先由确定性校验和修复器处理。（2026-09-04；风险事实自动排除，真实样本不再触发 P01R）
- [ ] 评估是否取消 P01R：无法局部安全修复时直接标记 excluded/unmapped，不再重生整份候选。

### P02/P02R：JD 需求

- [ ] P02R 只发送失败 requirement、对应 JD block 和逻辑组邻居。
- [ ] basicInfo、quote/span、覆盖率、逻辑组配对优先确定性修复。
- [ ] 普通单 block requirement 不因局部 quote 错误而重传完整 JD。

### P03/P03R：匹配

- [ ] requirementId 唯一性、evidenceId 合法性、scoreInputs 由服务端计算。
- [ ] P03R 只发送失败 requirementMatches/gaps 及相关 EvidenceAtom，不发送完整证据目录。
- [ ] 匹配状态冲突优先采用确定性收敛规则；仅语义判断无法确定时才调用局部 LLM。

### P05/P05R：选材计划

- [x] scope 分组、证据归属、bulletBudget、上下限和 policy 约束由服务端计算；确定性计划同时保留合法技能与教育信息。（2026-09-04）
- [ ] P05R 只发送非法 scopePlan、受影响证据和对应策略约束。
- [x] 能生成合法计划时使用确定性计划构建器，不为计划格式错误调用 P05R。（2026-09-04；默认 `RepairPolicy` 优先确定性回退）

### P10/P10R：面试准备

- [x] P10 默认关闭且可由严格审查配置同步启用，不阻塞低成本简历主链路。（2026-09-04）
- [ ] P10R 只修复缺失引用、无效 ID 和结构字段；不重发完整 Artifact 和全部 RequirementAtom。
- [ ] 面试建议失败只记录 partial，不触发主流程重跑。

## T5. 流程编排与调用次数收敛

- [x] 将 V6 低成本主路径收敛为 P01、P02、P03、确定性 P05、P06、P09；P04/P10/P11 按条件或配置执行，P07 可由严格审查配置恢复。（2026-09-04）
- [x] 低成本配置中每阶段最多一次初始 LLM 调用、全流程最多一次修复调用，并禁止 P09 回跳 P08。（2026-09-04）
- [ ] 同一阶段多个问题合并为一次局部修复请求，禁止“一条 issue 一次 LLM”。
- [x] 低成本配置下 P09 失败不回到 P08；直接使用服务端安全回退，并最多对回退结果复核一次。（2026-09-04）
- [x] 每个 Run 创建独立 LLM 调用预算，限制并发预留后的调用数、修复数和 Token；工作流 deadline 继续限制剩余时间。（2026-09-04）
- [x] 把“可选质量/面试输出”从主结果成功条件中剥离。（2026-09-04）
- [x] Harness Provider 事件增加 `callReason`、`contextMode`、`repairScope`、`retryIndex`、`budgetRemaining` 字段，并记录业务校验失败和修复决策。（2026-09-04）
- [x] 将调用收敛策略实现为可替换 `V6LlmCallPolicy`，低成本与严格审查配置使用独立预算，测试可注入离线策略。（2026-09-04）
- [ ] 将修复策略实现为可替换 `RepairPolicyPlugin`，支持“确定性优先”“局部 LLM”“直接安全回退”三种组合。
- [ ] 主流程不感知具体 Prompt ID；由 Prompt Plugin 根据阶段、版本和输入能力解析实际 Prompt/Schema。
- [ ] 插件返回统一 `succeeded/partial/skipped/failed` 结果；可选插件失败不得触发主流程重跑。

## T6. 验证与发布门禁

- [ ] 单测覆盖 ContextBuilder、Patch 合并、预算器、幂等重传和 chunk 排序。（预算器、ContextBuilder、chunk 排序已覆盖；Patch 合并和幂等键待完成）
- [ ] 工作流测试覆盖首调用通过、局部修复通过、确定性修复、修复耗尽、安全回退和 Provider 超时。
- [ ] 黄金集对比 V5：事实事故率、关键覆盖率、成功率、LLM 调用数、输入/输出 Token、P95 和单次成本。
- [ ] 长简历专项验证：多 chunk、同 scope 多 shard、乱序响应、部分失败、重传后合并。
- [ ] 设定 V6 发布门槛：成本和 P95 达标、无新增阻断事实事故、无 chunk 乱序/丢块/重复块。
- [ ] 更新 `backend/src/v5` 迁移说明、Prompt manifest、Harness 字段文档和根目录 README。
- [ ] V6 仅在 nonprod canary 验证通过后切换默认版本；保留 V5 回滚开关和失败样本审计。

## 建议验收指标

- [x] 正常请求 LLM 调用数较 V5 降低 30% 以上。（单真实样本由 12 次降至 6 次，待黄金集复核）
- [ ] 触发修复的请求，修复输入 Token 较 V5 降低 50% 以上。
- [ ] P01 分 chunk 合并结果 100% 按源 block 顺序稳定复现。
- [ ] 网络/超时失败只重传失败 chunk，不能重复执行已成功 chunk。
- [ ] 面试建议、质量审查失败不影响已通过事实门禁的主简历结果。

## 关键代码入口

- V5 主流程：`backend/src/v5/main/workflow.ts`
- Prompt 编译：`backend/src/v5/prompt-compiler.ts`、`backend/src/v5/prompts.ts`
- 阶段调用：`backend/src/v5/stage-runner.ts`
- P01 分 chunk：`backend/src/v5/chunked-resume-extraction.ts`
- 门禁与确定性修复：`backend/src/v5/validators.ts`、`backend/src/v5/safe-renderer.ts`
- Harness 事件：`backend/src/harness/`
