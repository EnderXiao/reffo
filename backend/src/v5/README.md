# Reffo v5.0.0 Production Adaptive Agent

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
  -> P01/P02 parallel extraction
  -> V01/V02 quote, span, coverage and injection gates
  -> P03 evidence-to-requirement match
  -> V03 + service-side match score
  -> deterministic adaptive policy (+ P04 only on real ambiguity)
  -> P05 evidence selection plan
  -> V05 plan gate
  -> P06 draft -> deterministic V06
  -> P07 final edit -> deterministic V06
  -> P08 bounded repair, at most two artifact repairs
  -> source-preserving fallback when needed
  -> blocking P09 semantic fact judge
  -> P10 interview preparation
  -> optional non-blocking P11 quality judge
  -> legacy-compatible MVP response
```

只有同时通过严格输出 Schema、确定性事实/结构门禁和 P09 语义事实门禁的简历才会返回。正常生成和安全回退都失败时，API 返回 422 和明确失败代码，不再把已知无效简历作为 `partial` 成功结果返回。

Prompt 由 `prompts/manifest.json` 和 P01-P12 Markdown 文件维护。`prompts.ts` registry 校验版本和文件，编译 manifest 记录相对路径及 SHA-256；缺失或非法 Prompt 直接 fail closed。

P12 只用于离线匿名 A/B；`runDoubleOrderBlindAb` 会同时执行 A/B 和 B/A，并把标签归一化后检查顺序一致性。P11/P12 不参与正式事实放行。

## 事实与证据边界

- `canonical-source.ts` 对 CRLF/NFC 做唯一规范化，保留每个非空 block 的稳定 ID、绝对 span、hash 和输入风险标记。
- `evidence.ts` 把模型提取候选转成不可变 EvidenceAtom/RequirementAtom；quote、span、数字、单位、限定词、scope、覆盖率与 Prompt 注入风险由服务端验证。
- 原始简历是候选人事实唯一来源。JD、外部语境、旧输出、验证建议和 Prompt 都不能成为候选人事实源。
- 详细地址、证件、未授权邮箱/手机号/URL、内部证据 ID 和审计话术不能进入用户可见简历。
- 模型只提供 `scoreInputs`；最终匹配分由 `match-score.ts` 按版本化公式计算，并标记 `based_on_current_material`。

## 自适应策略

`adaptive-policy.ts` 只使用证据分布、timeline kinds、需求匹配和输出语言，不使用年龄、性别、姓名、学校/公司名气或从日期推算的年限。策略版本固定记录在每次 Prompt manifest 中。

- sparse -> `preserve_sparse`
- standard -> `balanced_targeted`
- rich -> `selective_rich`

职业阶段、证据形态、岗位距离、章节顺序、摘要策略、正文下限/上限、项目上限和长度预算均由服务端决定。只有低置信且存在两个实质不同的合法候选策略时调用 P04；非法选择会回退到保守候选。

## 配置和兼容

`POST /api/v1/mvp/process` 固定执行 V5，不再提供 V4、shadow 或请求级版本选择。`output_language` 只影响 V5。响应继续保留 `step1_analysis`、`step2_matching`、`step3_optimized_resume`、`step4_interview_suggestions`；新增 `agent_version`、`agent_state`、`release_status`、`used_safe_fallback` 均为可选兼容字段。现有单步 `/analyze`、`/match`、`/generate`、`/interview` 仍是独立旧接口，不参与完整流程编排。

Harness SQLite 初始化会以可重复的 additive migration 增加 Agent state、release status、safe fallback 和 Prompt manifest 列，并把 harness schema version 更新为 2。没有破坏性迁移。

其他配置：

- `V5_QUALITY_JUDGE_ENABLED=false`：是否运行可选 P11。
- `V5_CONTEXT_WINDOW_TOKENS=64000`：保守上下文预算。证据不会被静默截断；预算不足时进入 `blocked_input_validation`。
- `V5_STRUCTURED_OUTPUT_MODE=auto`：OpenAI 官方端点使用原生 JSON Schema；DeepSeek 等兼容端点使用 JSON Object 传输，但仍由服务端同一严格 Zod Schema 拒绝未知字段和不合法结构。

## 调用量、延迟与成本

无修复的 v5 基线为 8 次调用：P01、P02、P03、P05、P06、P07、P09、P10。P01/P02 并行，因此关键路径约为 7 个串行阶段。低置信策略增加 P04 一次；启用质量审查增加 P11 一次；各结构化提取/匹配/计划/面试最多增加一次专用修复，Artifact 修复总预算最多两次。安全回退后仍需一次 P09。

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

当前自动测试覆盖严格 Schema、Prompt 编译与 manifest、canonical span、数字限定词、注入风险、服务端评分、自适应模式、计划/Artifact 门禁、安全回退、阻断式 Judge、兼容响应和双顺序 A/B。真实模型/provider 兼容性、100+ 黄金集、30+ 对抗集、P95 和成本仍属于发布前真实数据校准项。
