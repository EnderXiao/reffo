# V5 单步接口适配 TODO

目标：保持前端现有 `/analyze`、`/match`、`/generate`、`/interview` 请求和响应契约不变，由服务端统一切换到 V5 能力。`/process` 仅作为多步统一测试与回归入口，前端不调用。

## 执行清单

- [x] 1. 梳理 V5 阶段输入输出与现有单步接口契约，确定适配边界和投影规则。
- [x] 2. 抽取 V5 简历分析适配器：复用 canonical source、P01/P01R、事实校验，输出兼容 `ResumeAnalysis`。
- [x] 3. 抽取 V5 JD 分析与岗位匹配适配器：复用 P02/P03、需求和证据校验，输出兼容 `MatchAnalysis`。
- [x] 4. 抽取 V5 简历生成适配器：复用确定性计划、R5 经历 Writer、编译和交付门禁，输出兼容生成结果。
- [x] 5. 定义面试建议的 V5 单步边界；若不属于 V5 正式链路，保留兼容能力并明确标识。
- [x] 6. 将 `/analyze`、`/match`、`/generate`、`/interview` 路由接入适配器，移除旧 Agent 直连。
- [x] 7. 统一 Harness workflow/stage/prompt 版本来源，禁止路由散落版本字符串。
- [x] 8. 补充适配器、路由、错误恢复和响应兼容单测。
- [x] 9. 使用真实单步串行流程回归，确认前端无需改动；更新接口文档。
- [x] 10. 清理确认不再使用的 V4 单步 Prompt、Agent、配置和测试。

## 记录

- 2026-09-09：按用户确认完成第 10 项。删除 24 个 V4 Agent、Prompt、版本选择器、旧 LLM Judge、离线模拟及测试文件，移除模拟命令和无消费者的 Jina 网络研究配置。需求分析测试改为 V5 P01→P02→P03 调用与兼容投影验证；保留公共 API 类型及 Harness 历史记录读取能力，历史 V4 实现由 `main` 保留。验证：`tsc --noEmit`、后端 982 项单测、`git diff --check` 通过，`backend/src` 与 `backend/scripts` 无旧 Agent/Prompt 导入及 V4.2/V4.4 版本选择引用。
- 2026-09-09：建立清单。当前 `/process` 已固定使用 V5；单步接口仍由旧 Agent 实现。
- 2026-09-09：完成第 2–9 项。单步适配器、服务端检查点、V5 版本元数据、兼容响应、路由和单测已完成；真实串行 analyze→match→generate→interview 回归全部返回 200。第 10 项仅保留离线兼容 Agent、Prompt 与历史测试，待后续确认后清理。
- 2026-09-09：完成第 1 项。V5 当前公开 `extractResume` 与完整 `run`；单步适配需要新增阶段服务和旧响应投影，不能直接复用完整 `run` 冒充单步。
- 2026-09-09：新增 `backend/src/v5/stage-runtime.ts`，统一封装 V5 run context、Plugin Registry、manifest、超时和 provider 上下文；主流程尚未迁移，后续适配器将基于该运行时接入。
