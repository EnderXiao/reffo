# V5 主流程

- `workflow.ts`：V5-only 主编排器。负责阶段顺序、Plugin 调度、预算、状态迁移、安全回退和最终结果。
- `compatibility.ts`：V5 结果转换为旧 MVP 响应结构。

主流程不承载阶段 Prompt。当前内置插件的注册闭包位于 `workflow.ts`，通用 contract/registry 位于 `../plugins/`；后续可按插件职责继续拆出独立实现文件。
