# Store 架构

业务状态使用 Zustand，并按领域拆分：

- `resumeWorkspaceStore.ts`：源简历、JD、分析、匹配、优化结果、面试建议和生成状态机。
- `historyStore.ts`：生成历史列表和当前历史。
- `sourceResumeStore.ts`：服务端最新源简历摘要。
- `authStore.ts`：认证会话和用户资料。
- `landingFlowStore.ts`：Landing 引导流程临时选择。
- `sessionManager.ts`：登录会话结束时统一清理业务内存和用户持久化数据。

## Workspace 使用规则

组件读取状态时使用选择性订阅：

```tsx
const sourceResume = useResumeWorkspaceStore(state => state.sourceResume)
const generationStatus = useResumeWorkspaceStore(state => state.generationStatus)
```

页面模型或非 React 回调执行命令时使用 `resumeWorkspaceActions`：

```ts
resumeWorkspaceActions.setSourceResume(markdown)
const runId = resumeWorkspaceActions.startGeneration('analyzing')
resumeWorkspaceActions.transitionGeneration(runId, 'matching')
```

生成状态只能按以下顺序迁移：

```text
idle -> analyzing -> matching -> optimizing -> interviewing -> completed
```

任一执行中阶段可以失败进入 `failed`，或取消并回到 `idle`。每次开始、取消或重置都会更新 `generationRunId`，晚到请求不能覆盖新请求状态。

## 边界

- 页面不得重新维护分析、匹配或生成错误的第二份业务状态。
- 页面展示所需的短生命周期动画和表单状态继续使用 React state。
- API 调用放在 `src/services/`，Store 不直接拼接请求参数。
- 登出清理由 `sessionManager` 注册的 reset handler 统一执行。
- 已删除 `resumeStore`、`jdStore` 兼容层；新代码不得恢复这些入口。
