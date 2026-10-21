# V5 主流程

- `workflow.ts`：V5-only 主编排器。负责阶段顺序、Plugin 调度、单工作流超时/修复上限、状态迁移、内部安全回退和最终结果。
- `compatibility.ts`：V5 结果转换为旧 MVP 响应结构。

主流程不承载阶段 Prompt。当前内置插件的注册闭包位于 `workflow.ts`，通用 contract/registry 位于 `../plugins/`；后续可按插件职责继续拆出独立实现文件。

nonprod 真实评测的物理调用、输入/输出 Token、单案例及全局墙钟预算由 `../evaluation-runner-support.ts` 和 `../evaluation-budget.ts` 负责，不由工作流局部预算替代。
