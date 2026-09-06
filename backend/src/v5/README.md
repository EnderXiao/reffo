# Reffo v5.0.0 Production Adaptive Agent

## r2 岗位定向升级（非生产显式选项）

2026-09-06：新增 `--artifact-mode writer_v1 --job-targeted`，在同一次 P02 中形成岗位成功画像、P03 中建立胜任映射，代码按核心任务选材，再单次 Writer 成文；不增加六维 Agent 或 P08/P09 循环，不改变公共响应和简历栏目。`APP_ENV=prod` 禁止启用此实验路径，默认路径未切换。

P02/P03 新契约、`targeting/`、`writing/` 和 `acceptance/` 的当前进度、真实调用预算及未完成验收项见 [r2 执行记录](../../docs/v5-r2-execution-status.md)。P12 已升级为原始 JD 辅助审计及程序摘录校验；下文历史版本和默认 DSL 描述不代表新 Writer 已通过质量验收。离线发布记录可用 `bun run scripts/assess-v5-release.ts --help` 聚合，不启动 API，也不自动发布。

## 代码结构

```text
v5/
├── main/       # 主流程编排与旧响应兼容转换
├── plugins/    # Plugin contract、registry
├── prompts/    # Prompt Markdown 与 manifest.json
├── tests/      # 全部 V5 测试与 fixture
└── 其他模块    # 领域模型、校验器、Provider runtime 支撑
```

主流程调整改 `main/workflow.ts`；当前内置阶段以闭包形式在主流程中注册，`plugins/` 提供 contract 和 registry。后续新增或替换阶段可通过 `pluginOverrides` 接入；测试统一放 `tests/`。需要进一步独立维护插件实现时，再将闭包迁移到 `plugins/` 子目录。

本目录是 `POST /api/v1/mvp/process` 固定使用的 V5 实现，不是示例或旁路 Prompt。当前发布标签固定为 `preproduction_candidate`；在真实黄金集和对抗集指标达到门槛前，禁止标记为 `production_reliable`。

## 正式链路

```text
canonical source
  -> deterministic resume scope plan + zero-provider preflight
  -> P01 bounded shards + validated shard checkpoints
  -> all-primary barrier + code-ordered P01R queue + ordered merge
  -> P02 only after P01 succeeds
  -> V01/V02 quote, span, coverage and injection gates
  -> P03 evidence-to-requirement match
  -> V03 + service-side match score
  -> deterministic adaptive policy (+ P04 only on real ambiguity)
  -> deterministic code-built P05-shaped evidence selection plan
  -> relaxed local V05 plan gate
  -> deterministic Composition Blueprint + zero-provider feasibility preflight
  -> one P06D controlled-DSL call
  -> server-side DSL materialization and deterministic artifact compilation
  -> relaxed local artifact validation
  -> deterministic source-preserving renderer for internal diagnostics when a schema/DSL/composition error remains
  -> local product delivery decision
      -> deliver: return immediately; interview provenance = deferred
      -> block/internal_only: return without interview; provenance = skipped_by_gate
  -> legacy-compatible MVP response; provenance and quality gates stay internal
```

输出 Schema 和 Markdown/JSON 框架保持不变，但线上放行不再由 Agent Judge 决定。代码硬门禁检查空输出、非法或未映射证据、代码无法从引用原文证明的新增语义、数字与限定词变化、跨 scope 串写、归因/阶段/因果升级、身份与时间线结构错误、隐私和内部信息泄漏等确定性风险。计划证据未全部使用、正文未达到质量 target、长度偏短等质量目标保留为 warning；有可用业务证据时仍必须达到 `targetBusinessBulletMin` 代码底线。只有无产品质量 advisory warning 的模型或模型修复产物才会标记为 `deliver`；服务端可确定性校正的元数据 warning 不单独阻断。质量待审稿标记为 `block`，确定性安全渲染稿标记为 `internal_only`，两者均不对用户交付、不进入 P12 盲评。正式 `/process` 对任何交付结果都不调用 P10/P10R；Provider 可重试异常返回 503，不可重试的请求失败或输出截断返回 502，内部编排异常返回 500，三者均不伪装成安全回退成功。

每个完整流程终态都会生成不含原始简历、JD、Markdown、证据 ID 或校验消息的 `deliveryDiagnostics`。诊断把事实安全与产品质量拆成两条独立轨道，分别记录最终候选问题和被丢弃草稿问题，并以分子/分母记录计划证据、稳定核心和主岗位需求覆盖；分母为 0 时保持 `0/0`，由报表显示为 N/A，不伪装为 100%。

Prompt 由 `prompts/manifest.json` 和 P01-P12 Markdown 文件维护。`prompts.ts` registry 校验版本和文件，编译 manifest 记录相对路径及 SHA-256；缺失或非法 Prompt 直接 fail closed。

招聘质量标准见 [招聘质量标准与提示词修订](../../docs/v5-recruiter-quality-standard.md)。P03 r7 / P03R r6 强调岗位问题、具体贡献和稀疏材料利用；P06D r6 在原 DSL 契约内改善主题分配；P12 r6 区分成品指控、源证据和岗位缺口。它们不代表已开放自由写作或已通过新的真实质量验收；P12 的候选摘录要求目前是提示词指导，不是程序级引用校验。

P09、P10/P10R、P11 Prompt 与 Schema 仅为离线、历史兼容或未来可信上下文按需能力保留，不进入生产生成链路；当前阶段不新增 V5 公共按需 P10 接口。P12 只用于离线匿名 A/B；`runDoubleOrderBlindAb` 会依次执行 A/B 和 B/A 并把标签归一化，第一序失败时不会继续发送第二序。P12 只接收事实核验所需的紧凑证据、时间线、岗位需求和候选正文，不重复发送抽取过程账本；候选和证据使用同一套身份脱敏规则，有合法时间线证据的 scope 即使日期不完整也会保留。跨字段门禁和胜者由代码单向归一化，原始/归一化摘要及安全变更清单随 A/B 结果持久化。P12 的评分只作为评估记录，不反向阻断已经通过本地代码门禁的候选。

## 事实与证据边界

P01/P01R r14 使用源 block 标注传输协议：模型每个 block 最多返回一份分类、归属与风险标注，不再重复输出原文、规范化文本、偏移和数字索引。`resume-extraction-transport.ts` 仅从服务端 canonical source 恢复四个派生字段，再进入原有内部 Schema 与事实校验；未知或重复 block、模型夹带派生字段仍拒绝。它不是 quote 校验失败后扩大引用范围的兜底，也不为模型漏掉的 block 创建事实。风险与状态矛盾时只允许代码降级。无日期项目仅在可信 scope、完整原文标题锚点及业务证据满足结构条件时补结构容器，不补公司、日期或成果。

P06D 漏选计划要求的正文证据时，代码可在同 scope、同 section、同 kind 且明确允许引用该证据的槽位内补 `emit_atom`；跨范围歧义仍拒绝，不新增模型调用或自由文本。原文自身含分号时先验证完整逐字拼接，避免把原文标点误判为非法分段。这个机制只能保证选定计划的机械完整性，不能证明选材优质、正文流畅或 JD 高价值证据召回充分。

- `canonical-source.ts` 对 CRLF/NFC 做唯一规范化，保留每个非空 block 的稳定 ID、绝对 span、hash 和输入风险标记。
- `chunked-resume-extraction.ts` 在任何模型调用前确定经历 scope、时间线锚点和 block 归属。父时间线下没有独立日期、实体或结构边界的子节继承同一 scope；长经历只拆传输 shard，不改变语义 scope。每个 block 的唯一归属、序号、锚点完整性和 shard 上下文都由本地预检证明，Provider 完成先后不会改变合并顺序。分片协议 `deterministic-scope-plan-v8` 将 1–3 条/block 的 advisory 密度、允许代码消重的 raw 上限和归一化后的 storage 上限分离；每 shard 的 4 条 storage headroom 在完整文档中可加和。可信 shard 数只来自编排器或缓存描述符，模型返回的 `factLocalId` 前缀不能改变门禁。15,500 Token、24 blocks 和 1,000 字符是每 shard 的代码容量边界。
- `evidence.ts` 把模型提取候选转成不可变 EvidenceAtom/RequirementAtom；quote、span、数字、单位、限定词、scope、覆盖率与 Prompt 注入风险由服务端验证。同一 block 的逐字 overlap-connected 候选由代码按原文连续区间合并并重排所有引用，不跨语义 gap；完整 span 候选的业务类型优先保留，status/attribution/risk 只允许保持或变得更保守。局部密度只告警，重复 ID、坏 quote/span 与 transport/storage 越界仍阻断；未经显式服务端元数据的候选一律按单 shard 校验。
- `evidence-routing.ts` 将证据确定性分为业务锚点、补充证据、物理换行碎片和纯元数据；只有可独立成句的安全业务证据进入 P03、计划和产能计算。`composition/evidence-assembly.ts` 仅对同 scope、连续 block、无风险且满足完整闭包的成员做服务端组合，不把碎片交给模型自由拼接。
- 原始简历是候选人事实唯一来源。JD、外部语境、旧输出、验证建议和 Prompt 都不能成为候选人事实源。
- 详细地址、证件、未授权邮箱/手机号/URL、内部证据 ID 和审计话术不能进入用户可见简历。
- 模型只提供 `scoreInputs`；最终匹配分由 `match-score.ts` 按版本化公式计算，并标记 `based_on_current_material`。

## 自适应策略

### 质量修复边界

- `evidence-routing-v2` 在选材前区分真实动作、职位/领域元数据、编辑审计说明和断句。“关键动作”栏目标签不再排除完整行动；完整 `source_qualified` 行动可保留原有限定参与选材，显式冲突、待确认和未来计划仍不作为确定性成果。不会提升 EvidenceAtom 的状态。
- `planning-quality.ts` 用岗位标题的区别性词语及 JD 证据相关性辅助排序，不改变 P03 的匹配状态；项目不再仅因可用 atom 更多而挤掉更相关的项目。重复时间线只在日期、角色和可证明的组织名称对应且该条没有实质业务正文时省略，不跨工作合并证据。同公司不同任职时期、有未选业务事实的经历必须保留。
- 高价值覆盖检查已选经历中的完整可用事实，并兼容一条证据包含交付物和可量化结果；不为满足全简历单一模型标签而强塞未选项目。活动数量不单独视为业务影响；此检查不改变原始标签、状态或匹配事实。
- `composition/source-display.ts` 只清理有限栏目标签和明确的尾部编辑指令，原始证据不变，输出仍须由完整源文本或确定性展示投影证明。参与程度、数字限定、未上线等事实边界不能删除。
- 续行仅在同文档、同 scope、连续 block、精确相邻 span、无风险且数量/指标或“的”字边界可证明时组成最多 3 个片段的展示单元；规划只计完整单元，编译器保留全部引用。无法证明的断句不单独充数。
- 摘要 slot 仅允许一个源单元且固定其 scope，避免摘要可选范围与跨经历校验冲突；正文覆盖独立计数。
- 分片 scope 协议升级为 `deterministic-scope-plan-v9`：项目卡片丢失 Markdown 标记时，结合标题和邻近的项目正文标签划界；日期说明、论文页数及指标统计周期不形成新经历。相邻组织/职责说明与职位日期共同构成一个锚点。原始 block 不改写。

这些确定性质量修复不等于黄金集验收完成，也不将 P12 重新接入生产阻断或修复循环。真实非生产质量结论以冻结产物、双顺序评估及逐项复核为准。

`adaptive-policy.ts` 只使用证据分布、timeline kinds、需求匹配和输出语言，不使用年龄、性别、姓名、学校/公司名气或从日期推算的年限。策略版本固定记录在每次 Prompt manifest 中。

- sparse -> `preserve_sparse`
- standard -> `balanced_targeted`
- rich -> `selective_rich`

职业阶段、证据形态、岗位距离、章节顺序、摘要策略、正文最小值/质量目标/上限、项目上限和长度预算均由服务端决定。最小值是代码阻断底线；质量 target 用于选材和告警，不再要求模型精确凑数。服务端按岗位匹配、高价值结果/交付物、数字证据、职业时间线和 scope 多样性确定性选材，不再按证据输入顺序机械截取。只有低置信且存在两个实质不同的合法候选策略时调用 P04；生产链路的 P05 计划已完全改为本地确定性代码，不调用 P05/P05R 模型。

## 配置和兼容

`POST /api/v1/mvp/process` 固定执行 V5，不再提供 V4、shadow 或请求级版本选择。`output_language` 只影响 V5；兼容字段 `enable_llm_judge` 被忽略，不会增加外部 Judge 调用。响应保持既有顶层结构：`run_id`、`workflow_status`、`agent_version`、`agent_state`、`release_status`、`used_safe_fallback`、`step1_analysis`、`step2_matching`、`step3_optimized_resume`、`step4_interview_suggestions`；其中当前 `/process` 的 `step4_interview_suggestions` 为空，历史 `generated` 结果仍可转换，历史 `failed_optional` 仍可读取。更详细的门禁、回退和 provenance 只保留在内部 V5 结果与运行记录中。现有单步 `/analyze`、`/match`、`/generate`、`/interview` 仍是独立旧接口，不参与完整流程编排。

Harness SQLite 初始化会以可重复的 additive migration 增加 Agent state、release status、safe fallback 和 Prompt manifest 列，并把 harness schema version 更新为 2。没有破坏性迁移。

其他配置：

- `V5_QUALITY_JUDGE_ENABLED=false`：兼容配置；正式 `/process` 始终使用本地代码门禁，不读取该值触发外部 Judge。
- `V5_CONTEXT_WINDOW_TOKENS=64000`：保守上下文预算。证据不会被静默截断；预算不足时进入 `blocked_input_validation`。
- `V5_STRUCTURED_OUTPUT_MODE=auto`：OpenAI 官方端点使用原生 JSON Schema；DeepSeek 等兼容端点使用 JSON Object 传输，但仍由服务端同一严格 Zod Schema 拒绝未知字段和不合法结构。

## 调用量、延迟与成本

无修复、单 P01 分片且质量放行的 v5 默认正式链路基线为 4 次调用：P01、P02、P03、P06D。为避免源简历抽取失败后仍支付 JD 调用，P02 只在 P01 完整通过后启动。P01 默认以 24 个 block 为打包目标；语义 scope 与传输 shard 分离，超长经历保持同一服务端 scope，每个 shard 只重复最小时间线锚点上下文。每个 chunk 带服务端序号，代码等待全部已启动调用收敛后按原始序号归并，缺号或重复号直接拒绝，因此 Provider 返回先后不会改变证据顺序。低置信策略至多增加 P04 一次，P02/P03 各至多一次结构修复；P06D 只调用一次，Schema、DSL 或 Composition 错误直接进入仅供内部诊断的确定性 source-preserving renderer，不调用 P08，Provider 失败则直接向外失败。`composition_v1` 与 `legacy` 仍作为 kill switch，其中只有 `legacy` 可能走 P06/P08。正式链路不调用 P05/P05R、P07、P09、P10/P10R、P11，也不会因质量 warning 触发重写。

nonprod runner 当前协议为 `reffo-v5-nonprod-blind-eval-runner-v10`，固定 `dsl_v1`、P06D 单次、artifact repair 为 0、interview deferred。除 P01 外，generation-only 最坏为 6 次 / 31,560 输出 Token；full 加双顺序 P12 后为 8 次 / 43,560 输出 Token。P01 先以并发 2 完成全部 primary，再按源顺序处理修复队列；每 shard 至多一次 P01R，总上限为 `ceil(shardCount × 50%)`。初始额度为 `ceil(shardCount × 20%)`，成功修复逐次解锁后续额度；修复失败立即停止。若队列总量已超过硬上限，直接在任何 P01R 外呼前停止，保留已验证 primary 检查点。

P01/P01R 输出额度均按原始 shard 计算，为 14,400–15,500 Token；修复草稿及错误消息不能放大额度。上下文不足时调用前阻断。写入 Prompt 的 Schema 删除确证未被引用的重复根定义，本地 Zod 不变；P01 示例 Schema 从 18,472 缩至 9,524 字符。冻结 case3 仍为 14 shards，冷缓存 generation-only 预检为 27 次 / 335,148 输出 Token，处于 28 次 / 350,000 的原有预算内。冷缓存 full 上界为 29 次，超过调用预算，应先完成 generation-only，再独立 judge-only；不提高硬预算。

nonprod runner 会把通过完整源文档校验的 P01 候选以 0600 权限持久化到本地 `.artifacts/v5-resume-extraction-cache/`。完整缓存仍为 v2，新增独立 `trusted-resume-extraction-partial-cache-v1` 分片检查点：每个 shard 通过 Schema、单片归属与事实校验后即可保存，失败草稿不进入缓存。逐片落盘按 descriptor 串行、文件锁保护、合并已存在进度后原子替换；写盘异常保留内存结果并在失败清理中再次尝试。恢复只调用缺失 shard，最终仍必须按全部服务端索引排序、合并并通过完整文档校验，分片齐全不等于整份已通过。预算按可信已验证索引扣除，并为剩余 shard 中额度最大的可能修复预留成本。

缓存键绑定简历内容、分块计划、P01/P01R Prompt、Schema、Validator、Workflow、实现和 Provider 配置。完整缓存命中优先于部分缓存；任何精确命中检查点的完整性错误均阻断。旧 v1 完整缓存默认忽略，不扫描、不自动提升；新 Prompt/提取代码使旧候选失效。缓存不接受 HTTP 请求注入，也不纳入提交。额外 `p01-validation-diagnostics.json` 只记录分片序号、Schema/业务/修复门禁层、固定错误码类别与计数，不存正文、引用、ID 或校验消息。

相比旧 V4 完整流程，V5 基线调用和 EvidenceAtom、claim map、完整修复上下文 Token 均有增加。实际 Token、P95 延迟和费用必须用测试分支 nonprod manifest 计算，不得用静态估算替代发布数据。

## 测试分支验收

推荐顺序：

1. 测试分支 nonprod：至少 100 份跨行业真实黄金集、30 份对抗输入，采集事实事故、空 scope、stable core/primary coverage、内部安全回退、repair、Token 和 P95。
2. internal beta：人工逐份查看 claim/evidence 审计和可投递结果。
3. limited test：按测试用户或流量白名单验证；P12 继续用于双顺序盲评。
4. 只有零阻断事实事故、无空工作/项目结构、关键覆盖率不回归、成本延迟在预算内，才提升发布标签。

当前版本只在测试分支验证，暂不合入 `main`。若 provider 不支持原生严格 JSON Schema，不能绕过服务端 Zod 和门禁，应先在 nonprod 更换或校准 provider。

## 验证

```bash
bunx tsc --noEmit
bun test ./src/v5
bun test ./src
```

当前自动测试覆盖严格 Schema、Prompt 编译与 manifest、canonical span、数字限定词、注入风险、服务端评分、自适应模式、严格/宽松两档本地代码门禁、安全回退、兼容响应和双顺序 A/B。真实模型/provider 兼容性、100+ 黄金集、30+ 对抗集、P95 和成本仍属于发布前真实数据校准项。
