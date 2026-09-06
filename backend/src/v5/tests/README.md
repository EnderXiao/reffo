# V5 测试

本目录集中 V5 单元测试、工作流测试、Plugin Registry 测试和测试 fixture。生产代码不放在此目录。

评测运行器回归至少覆盖：runner v10 协议、默认 P06D 组件集合、逐片源内容预算及最大可能修复预留、旧 runner run 的 resume/source-run 拒绝、P01 v2 完整缓存与独立 partial-v1 分片缓存、旧 v1 默认忽略、Provider 预留/结算、失败即停，以及清理错误不能覆盖原始 workflow/provider 错误。分片检查点须覆盖乱序写入合并、跨实例恢复、0600 权限、篡改拒绝、失败后只调用缺失分片，全部缓存索引齐全仍需全量合并校验。P01 诊断须覆盖 Schema/domain 分层、固定代码/路径大类投影、未知代码折叠和 PII canary 不落盘。

P01 回归还必须覆盖全部 primary 完成后再修复、乱序响应不影响源顺序、4 次可恢复修复、超过半数失败时零 P01R 熔断、单次修复失败停止后续调用、截断零修复、scope 锚点完整性、advisory/raw/storage 三层阈值、raw schema 允许代码消重、多个 shard 的 storage headroom 只按显式服务端数量加和、模型伪造 `cNN_` 前缀不能放宽门禁、只合并 overlap 而不跨语义 gap、模型顺序不影响事实与派生引用、重复 ID fail closed、server scope 优先和输出绝对硬上限。Schema 提示精简须证明本地 Zod 不变且引用完整。交付门禁测试必须证明 deliverable 不携带任何未解决最终问题，同时允许记录已拒绝候选的诊断计数。

紧凑 P01 传输回归还覆盖真实 stage adapter 的 P01/P01R 双路径、原文派生字段的代码恢复、重复/未知 block 拒绝、修复草稿不能冒充 canonical source、风险状态仅降级以及无日期项目的源锚点结构恢复。P06D 回归覆盖同 scope 的必选证据机械补齐、原文内部标点、跨范围拒绝和否定词不可改变。P12 回归覆盖评语条数/长度硬上限，超限输出不得通过语义归一化被静默截断。

`quality-regressions.test.ts` 另外覆盖：职位名不能计为业绩、完整动作不能因栏目标签被过滤、源限定状态不被提升、编辑指令与明确歧义不参与选材、续行闭合与否定词不可丢失、无 Markdown 项目卡片和统计周期的边界、岗位主题选材、摘要单源约束、指标断句、复合成果识别、已选经历的真实成果遗漏，以及不得误删含实质事实的重复时间线。真实数据仅存于本地 `.artifacts/`，单测使用脱敏构造数据。

运行：

```bash
cd backend
bun test ./src/v5/tests
```
