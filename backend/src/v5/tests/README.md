# V5 测试

P01 r19：`temporal-risk.test.ts` 覆盖时间风险完整句引用、独立职责/末句状态隔离（包括误标已批准）、否定/条件/撤回/指代反例、容量与引用约束、逐字和数字保留、JSON/重复校验。6 类中英文材料经合并、选材、WritingPlan 和本地编译验证职责可用、风险句不可用；P01/P01R 紧凑传输均走实际 stage adapter 的模拟 Provider。旧无引用响应不自动清除风险，已批准不升级为已任职；合成测试与真实旧响应回放都不等于新模型质量通过。

P01 r17 回归：`extraction-retention.test.ts` 使用脱敏构造材料验证前后值、子集总量、自述和断行指标在代码路径保留原文/限定，不自动升级为事实冲突；真实风险仍受约束。新增原始覆盖与代码补记分项计数，验证隐私投影；`workflow.test.ts` 覆盖 P01/P01R 观察事件。Provider 测试验证 P01 独立思考配置、JD/Writer 不受影响、空输出不发生思考重试。Prompt 断言和模拟响应不能证明模型一定遵循 r17；新版本仍须另行授权真实测试。

本目录集中 V5 单元测试、工作流测试、Plugin Registry 测试和测试 fixture。生产代码不放在此目录。

通用化回归：`source-continuation.test.ts` 验证有原文证明的排版续接及反例、序列化和缓存依赖；`evidence-flow.test.ts` 验证离线 OR/AND 选材观察、缺失阶段、局部源单元与隐私；`writer-generalization.test.ts` 验证不同工作类型的合成表达和 Writer 软篇幅契约。它们不是实际模型输出质量或真实招聘评审记录。

`generic-evidence-selection.test.ts` 覆盖跨职业源动作经实际本地计划、WritingPlan 与编译器到达正文，以及标题/技能/否定/风险反例；`targeting.test.ts` 验证结果/交付物替换不得删除已覆盖核心任务的唯一证据。`writing-editorial.test.ts` 另检查材料丰富度、核心任务优先级、共享篇幅上限、未选材料隔离、中英文单位及 legacy 不变；这些软建议不增加模型调用或质量阻断条件。

评测运行器回归至少覆盖：runner v10 协议、默认 P06D 组件集合、逐片源内容预算及最大可能修复预留、旧 runner run 的 resume/source-run 拒绝、P01 v2 完整缓存与独立 partial-v1 分片缓存、旧 v1 默认忽略、Provider 预留/结算、失败即停，以及清理错误不能覆盖原始 workflow/provider 错误。分片检查点须覆盖乱序写入合并、跨实例恢复、0600 权限、篡改拒绝、失败后只调用缺失分片，全部缓存索引齐全仍需全量合并校验。P01 诊断须覆盖 Schema/domain 分层、固定代码/路径大类投影、未知代码折叠和 PII canary 不落盘。

P01 回归还必须覆盖全部 primary 完成后再修复、乱序响应不影响源顺序、4 次可恢复修复、超过半数失败时零 P01R 熔断、单次修复失败停止后续调用、截断零修复、scope 锚点完整性、advisory/raw/storage 三层阈值、raw schema 允许代码消重、多个 shard 的 storage headroom 只按显式服务端数量加和、模型伪造 `cNN_` 前缀不能放宽门禁、只合并 overlap 而不跨语义 gap、模型顺序不影响事实与派生引用、重复 ID fail closed、server scope 优先和输出绝对硬上限。Schema 提示精简须证明本地 Zod 不变且引用完整。交付门禁测试必须证明 deliverable 不携带任何未解决最终问题，同时允许记录已拒绝候选的诊断计数。

紧凑 P01 传输回归还覆盖真实 stage adapter 的 P01/P01R 双路径、原文派生字段的代码恢复、重复/未知 block 拒绝、修复草稿不能冒充 canonical source、风险状态仅降级以及无日期项目的源锚点结构恢复。P06D 回归覆盖同 scope 的必选证据机械补齐、原文内部标点、跨范围拒绝和否定词不可改变。P12 回归覆盖评语条数/长度硬上限，超限输出不得通过语义归一化被静默截断。

`quality-regressions.test.ts` 另外覆盖：职位名不能计为业绩、完整动作不能因栏目标签被过滤、源限定状态不被提升、编辑指令与明确歧义不参与选材、续行闭合与否定词不可丢失、无 Markdown 项目卡片和统计周期的边界、岗位主题选材、摘要单源约束、指标断句、复合成果识别、已选经历的真实成果遗漏，以及不得误删含实质事实的重复时间线。真实数据仅存于本地 `.artifacts/`，单测使用脱敏构造数据。

运行：

```bash
cd backend
bun test ./src/v5/tests
```
