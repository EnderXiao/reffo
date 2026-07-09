# 服务端 Agent Harness 后续能力 TODO

本文承接 `服务端AgentHarness前三阶段TODO.md` 中保留的后续项，目标是在不新增数据库表、不引入跨请求持久化 replay 的前提下，把 provider transient 和 JSON repair 两类恢复路径补成可执行的单次 run 内自愈能力。

## 总体原则

- 仍以一次 run 的运行时 Harness 为边界，不把完整输入、prompt 或隐私内容落库。
- 所有恢复路径必须有明确预算：最大 attempt 次数、step timeout、workflow timeout。
- 恢复事件只记录摘要、错误码、模型、次数和动作，不记录完整简历/JD/LLM 原文。
- API 响应继续保持兼容，除已有可选字段外不强制前端改造。

## TODO List

### Provider transient / fallback model

- [x] 为 `FallbackLlmProvider` 增加 transient 错误识别：网络失败、429、408、409、5xx、timeout 等。
- [x] 对 transient 错误执行同模型有限重试，默认最多 2 次 provider attempt。
- [x] 对非 transient 或同模型重试耗尽的错误继续走现有 fallback model 逻辑。
- [x] 在 provider retry / fallback 前后发布 `recovery.planned`、`recovery.started`、`recovery.succeeded`、`recovery.failed` 事件。
- [x] provider retry 事件 payload 只记录 `action`、`model`、`attempts`、`maxAttempts`、`errorCode`、`reason` 等摘要。
- [x] 增加 fake provider 单测，覆盖 transient 第一次失败、第二次成功。

### JSON repair loop

- [x] 在 `parseJsonOutput` 的现有 repair 钩子周围补 recovery 事件。
- [x] JSON parse / schema validation 失败时发布 `repair_json` 的 planned/started 事件。
- [x] repair 成功并通过校验后发布 `recovery.succeeded`。
- [x] repair 超过 `maxRepairAttempts` 或 repair LLM 调用失败时发布 `recovery.failed`。
- [x] 事件 payload 不包含 raw JSON，只记录 `outputName`、`errorCode`、`attempts`、`maxAttempts`。
- [x] 增加单测覆盖 repair 成功、repair 耗尽失败两条路径。

### 文档和验收

- [x] 更新 `服务端AgentHarness前三阶段TODO.md` 中 provider transient / JSON repair 保留项状态。
- [x] 运行 `tsc --noEmit` 和 `bun run test:unit`。
- [x] 验证现有 `/process` 响应字段兼容，不新增必填字段。

## 当前实现状态

- Provider transient retry 落在 `backend/src/providers/fallback-provider.ts`，同模型默认最多 2 次 attempt，失败后继续沿用 fallback model。
- JSON repair recovery 事件落在 `backend/src/harness/json-output.ts`，复用现有 `repair` 钩子并补充 planned/started/succeeded/failed 事件。
- Provider 和 JSON repair 事件均只记录摘要，不记录 raw prompt、raw JSON、简历或 JD 原文。
- 已新增 `backend/src/providers/fallback-provider.test.ts` 和 `backend/src/harness/json-output.test.ts` 覆盖核心路径。

## 验收口径

- provider 第一次 transient 失败时，不立即让 step 失败，而是在预算内重试。
- provider retry 成功时，step 对调用方仍表现为成功，同时事件流包含 recovery 过程。
- JSON 输出首次解析/校验失败时，能够调用 repair prompt 修复，并在修复成功后继续主流程。
- JSON repair 耗尽后仍返回原始错误，不吞错、不伪装成功。
- 所有新增 loop 都有最大次数限制，并受原 step timeout / workflow timeout 约束。
