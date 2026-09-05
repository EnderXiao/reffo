# Tracker

- Task: V6 后续优化：降低修复上下文、调用成本和异常退出率
- Workspace: `/Users/mi/code/reffo`
- Mode: `human-gated`
- Validation stack: `cd backend && bun test ./src/v5 && bunx tsc --noEmit && git diff --check`
- Regression executor: repo-native backend tests；最终再跑一次本地真实 `/api/v1/mvp/process`
- Reviewer mode: `user`
- Current branch: `private/v6-prompt-hsl`

## Problem

- User-reported issue: V6 修复调用仍复制过多上下文，P08 输入 Token 高；确定性选材可能遗漏项目；需要继续插件化和可观测性优化。
- Root cause summary: `ContextBuilder` 的 `scoped` 与 `full` 当前等价；P08 使用完整 Artifact 修复；Patch Schema 和服务端 Patch 合并器尚未落地；计划预算优先满足下限，未固定项目槽位。
- Constraints: 保持事实安全、严格 Schema、Harness 可审计；不在 `main` 修改；不重复调用真实 API 做纯代码验证。
- Out-of-scope items: 本轮不重写全部 V5 workflow，不修改前端，不把 P09 变成业务改写器。

## Solution

- Chosen approach: 分单元落地。先实现最小上下文选择器和 contract tests，再接入 Patch Schema/合并器，随后修正选材、物理调用预算、P01 幂等和发布门禁。
- Rejected options: 直接把默认模式改成 `patch`；当前 Patch 合并契约未完成，可能造成修复字段丢失或误放行。
- Why this boundary is minimal: U1 只改变上下文构建输出和测试，不改变生产 workflow 调用次数；风险可通过单元测试隔离。

## Units

| Unit | Goal | Scope | Validation | CR | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | 实现按 issue 选择的 scoped/patch ContextBuilder | `backend/src/v5/plugins/context-builder.ts`、测试 | `bun test ./src/v5/tests/v6-foundation.test.ts`、`bunx tsc --noEmit`、`git diff --check` | user | `d79fc64` | committed |
| U2 | 定义 RepairPatch Schema 和安全合并器 | `backend/src/v5/plugins/patch-merger.ts`、测试 | `bun test ./src/v5/tests/v6-foundation.test.ts`、`bun test ./src/v5`、`bunx tsc --noEmit`、`git diff --check` | user | `1c47494` | committed |
| U3 | 将 P08/P08R 接入 Patch 修复与统一 issue 分类 | workflow、prompt compiler、P08R prompt、patch merger、测试 | `bun test ./src/v5`、`bunx tsc --noEmit`、`git diff --check` | user | `0775d2c` | committed |
| U4 | 修正确定性选材，保留项目和关键教育信息 | `backend/src/v5/validators.ts`、测试 | `bun test ./src/v5/tests/policy-score-validator.test.ts`、`bun test ./src/v5/tests/workflow.test.ts`、`bunx tsc --noEmit`、`git diff --check` | user | `cdc160e` | committed |
| U5 | 统一 Provider 物理 attempt 预算和 fallback 计费 | providers、call policy、Harness | provider/预算单测、类型检查 | user | `1a24fe8` | committed |
| U6 | P01 幂等重传和 Chunk 插件边界 | `chunked-resume-extraction.ts`、workflow、测试 | chunk/workflow 单测、类型检查 | user | `80cb15d` | committed |
| U7 | 指标汇总、黄金集和发布门禁 | Harness、脚本、文档 | `bun test ./src/repositories/harness-metrics.test.ts`、全量 V5、类型检查、diff 检查 | user | `1c41286` | committed |
| U8 | Harness SQLite 单写队列与事务持久化 | `backend/src/harness/subscribers/persistence-subscriber.ts`、写队列、测试 | `bun test ./src/harness/subscribers/write-queue.test.ts`、全量 backend、类型检查、diff 检查 | user | `0c12924` | committed |
| U9 | Harness 数据库健康检查与运行库隔离 | `backend/src/repositories/database.ts`、`backend/src/routes/mvp.ts`、`.gitignore` | 健康接口、全量 backend、类型检查、diff 检查 | user | `958f2b3` | committed |
| U10 | 多进程访问隔离与 Harness 备份工具 | `backend/src/repositories/database.ts`、维护脚本、Git 索引 | 并发进程验证、维护脚本 check/backup、全量 backend、类型检查、diff 检查 | user | `44a057a` | committed |
| U11 | Prompt manifest 字段摘要与 Token 观测 | `backend/src/v5/prompt-compiler.ts`、Provider contract、Prompt 测试、V6 TODO | Prompt manifest 单测、全量 backend、类型检查、diff 检查 | user | `888783c` | committed |
| U12 | Dashboard 汇总 Prompt 输入摘要 | `backend/src/repositories/harness-metrics.ts`、Harness metrics 测试 | 指标单测、全量 backend、类型检查、diff 检查 | user | `5535760` | committed |
| U13 | Harness 失败恢复建议 | `backend/src/harness/recovery-advice.ts`、`run-step.ts`、测试、V6 TODO | 恢复建议单测、全量 backend、类型检查、diff 检查 | user | `8c695a6` | committed |
| U14 | API 错误响应携带恢复建议 | `backend/src/routes/mvp.ts`、V6 TODO | 路由鉴权测试、恢复建议测试、全量 backend、类型检查、diff 检查 | user | `4e2184b` | committed |
| U15 | Dashboard 汇总恢复建议命中 | `backend/src/repositories/harness-metrics.ts`、Harness metrics 测试 | 指标单测、全量 backend、类型检查、diff 检查 | user | `10b7ecd` | committed |
| U16 | P01 Chunk 故障注入与完整性门禁 | `backend/src/v5/chunked-resume-extraction.ts`、workflow、测试、V6 TODO | Chunk/workflow/budget 测试、全量 backend、类型检查、diff 检查 | user | in_progress | in_progress |

## Unit Logs

### U1

- Objective: `scoped` 只返回失败路径相关的最小结构；`patch` 只返回 Patch 所需当前字段和校验问题；保留 `full` 显式兼容模式。
- Files: `backend/src/v5/plugins/context-builder.ts`、`backend/src/v5/tests/context-builder.test.ts`
- Code changes: `scoped` 按 issue.outputPath 选择当前输出字段；按 evidence/requirement/claim ID 选择关联记录；`patch` 额外输出 patchHints；`full` 保持兼容。
- Regression added or updated: 扩展 `v6-foundation.test.ts`，覆盖 scoped 不复制无关 envelope、patch 最小字段和关联记录。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/v5/tests/v6-foundation.test.ts`（4 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: `refactor: 实现V6局部修复上下文`
- Commit: `d79fc64`
- Remaining follow-up: U2 负责 Patch Schema 和合并；U3 再接入生产 P08。

### U2

- Objective: 定义版本化 RepairPatch，并在服务端执行授权路径、原值摘要、重复操作和 Schema 安全校验。
- Files: `backend/src/v5/plugins/patch-merger.ts`、`backend/src/v5/tests/v6-foundation.test.ts`
- Code changes: 支持 `replace/remove` 操作；只允许调用方声明的精确 path；校验原值 digest；拒绝越权、过期、重复 operationId/path；使用 immutable clone 合并。
- Regression added or updated: 覆盖合法 Patch、越权路径、原值摘要不匹配、重复操作。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/v5/tests/v6-foundation.test.ts`（6 pass）；`bun test ./src/v5`（160 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: `feat: 增加V6安全修复补丁合并器`
- Commit: `1c47494`
- Remaining follow-up: U3 将 P08/P08R 接入 Patch 输出和服务端合并；当前生产流程尚未改变。

### U3

- Objective: 业务门禁修复改走 P08R Patch；P06/P07 结构化输出异常继续保留 P08 全量兼容修复。
- Files: `backend/src/v5/main/workflow.ts`、`backend/src/v5/prompt-compiler.ts`、`backend/src/v5/prompts.ts`、`backend/src/v5/prompts/P08R.md`、`backend/src/v5/prompts/manifest.json`、`backend/src/v5/schemas.ts`、`backend/src/v5/plugins/patch-merger.ts`、测试。
- Code changes: 增加 P08R Patch Schema 和 Prompt；P08 repair 使用 issue outputPath 作为授权范围，Patch 合并后执行完整 Artifact 门禁；越权或合并失败保留原 Artifact，后续走安全回退。
- Regression added or updated: RoutingProvider 支持 P08R；修复路径断言 patch 上下文和安全回退。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/v5`（160 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: `perf: 将V6业务修复收敛为Patch`
- Commit: `0775d2c`
- Remaining follow-up: 当前只在业务修复路径使用 P08R；P06/P07 解析失败仍走 P08 全量兼容路径。

### U4

- Objective: 确定性计划满足业务下限后，保留合法项目/研究槽位，并优先保留一条教育证据，减少成功结果内容过短或项目缺失。
- Files: `backend/src/v5/validators.ts`、`backend/src/v5/tests/policy-score-validator.test.ts`、`backend/src/v5/tests/workflow.test.ts`
- Code changes: 计划先选择一个合法 project/research 证据，再补一条 education 证据，之后选择技能和其他辅助证据；不突破总列表项与项目硬上限。
- Regression added or updated: 新增项目槽位测试；保留原有技能/教育和安全回退测试。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/v5/tests/policy-score-validator.test.ts`（33 pass）；`bun test ./src/v5/tests/workflow.test.ts`（15 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: `perf: 保留V6关键项目和教育证据`
- Commit: `cdc160e`
- Remaining follow-up: U5 统一 Provider 物理 attempt 预算；当前真实 API 尚未重新验证项目保留效果。

### U5

- Objective: 限制 V6 隐藏 fallback 模型调用，并记录实际物理 attempt 数。
- Files: `backend/src/providers/llm-provider.ts`、`fallback-provider.ts`、`deepseek-provider.ts`、`v5/plugins/llm-call-policy.ts`、相关测试。
- Code changes: `FallbackLlmProvider` 支持 `maxProviderModels`；V6 policy 强制单模型、单次物理尝试；Provider 结果和预算快照记录 `physicalAttempts/physicalCalls`。
- Regression added or updated: fallback 模型上限、预算物理调用和 DeepSeek Harness 事件测试。
- Regression executor: repo-native backend unit test
- Validation commands: provider/policy 单测（10 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: `perf: 收敛V6物理模型调用`
- Commit: `1a24fe8`
- Remaining follow-up: U6 实现 P01 幂等重传和 Chunk 插件边界。

### U6

- Objective: 为 P01 chunk 生成稳定幂等键，重传事件携带幂等键，合并前按幂等键去重，避免重复合并。
- Files: `backend/src/v5/chunked-resume-extraction.ts`、`backend/src/v5/main/workflow.ts`、chunk/workflow 测试。
- Code changes: 新增 `resumeExtractionChunkIdempotencyKey`；失败 chunk recovery payload 记录 key；批次结果按 key 去重后再按 canonical 顺序合并。
- Regression added or updated: 新增 canonical chunk metadata 稳定 key 测试，覆盖 retry documentId 变化仍保持相同 key。
- Regression executor: repo-native backend unit test
- Validation commands: chunk/workflow 单测（28 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: `fix: 增加P01分块幂等重传`
- Commit: `80cb15d`
- Remaining follow-up: U7 指标汇总、黄金集和发布门禁。

### U7

- Objective: 汇总 Harness run/step/attempt/event 指标，区分业务调用、语义门禁、确定性门禁和修复调用，并提供 P95、物理 attempt、成本估算及 V6 发布门禁。
- Files: `backend/src/repositories/harness-metrics.ts`、`backend/src/repositories/harness-run-repository.ts`、`backend/src/repositories/harness-metrics.test.ts`、`doc/V6后续优化TODO.md`
- Code changes: 新增纯函数指标聚合器；dashboard 返回兼容旧字段的 `metrics` 和 `releaseGate`；按阶段汇总 P01/P08/P09 等步骤；发布门禁检查最多 8 次逻辑调用、最多 1 次修复、Token 上限、事实安全和 chunk 完整性。
- Regression added or updated: 覆盖语义/确定性门禁分类、物理 attempt、Token/成本、阶段 P95 和超预算/安全事故拒绝。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/repositories/harness-metrics.test.ts`（2 pass）；`bun test ./src/v5`（162 pass）；`bun test`（243 pass）；`bunx tsc --noEmit`；`git diff --check`
- Real regression: `POST /api/v1/mvp/process` 使用 PDF `/Users/mi/Downloads/肖淦匀-58同城-前端开发.pdf` 文本和 JD 图片 `/Users/mi/Downloads/字节前端工程师.jpg` 人工转写，Run `7e2091ee-cde3-46b1-9030-5d1c9898d6d8` 成功；7 次逻辑调用、7 次物理 attempt、82,825 Token、1 次 P08R、1 次 P09、`succeeded_with_safe_fallback`。
- Validation artifacts: 临时请求/响应位于 `/tmp/reffo-pdf/`，未纳入版本库
- CR findings: pending user review
- Resolution: pending
- Commit message: `feat: 增加V6 Harness指标与发布门禁`
- Commit: `1c41286`
- Remaining follow-up: 黄金集、故障注入和多样本真实 canary 属发布前回归，不在本单元扩展生产 workflow。

### U8

- Objective: 消除多个请求/订阅器并发写 Harness SQLite 时的连接重置竞态，保证事件和状态原子落库。
- Files: `backend/src/harness/subscribers/persistence-subscriber.ts`、`backend/src/harness/subscribers/write-queue.ts`、测试。
- Code changes: 所有 PersistenceSubscriber 共享模块级串行写队列；`harness_events` 与对应状态更新放入同一 transaction；失败后只在当前队列任务内重建连接并重试一次，避免任意订阅器直接打断其他写入。
- Regression added or updated: 覆盖跨订阅器写入顺序和失败后队列释放。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/harness/subscribers/write-queue.test.ts`（2 pass）；`bun test`（245 pass）；`bunx tsc --noEmit`；`git diff --check`
- Concurrency regression: 8 个 `PersistenceSubscriber` 并发提交 200 个 workflow 事件到临时 SQLite，`PRAGMA integrity_check=ok`，事件/运行记录均为 200 条。
- Validation artifacts: 临时数据库位于 `/tmp/reffo-persistence.sqlite*`，未纳入版本库
- CR findings: pending user review
- Resolution: pending
- Commit message: `fix: 串行化Harness SQLite持久化`
- Commit: `0c12924`
- Remaining follow-up: 多进程访问隔离、数据库健康检查和运行库脱离 Git 跟踪可作为后续运维单元。

### U9

- Objective: 暴露 Harness SQLite 完整性状态，避免损坏时误报服务完全健康；运行库默认不再产生新的 Git 跟踪文件。
- Files: `backend/src/repositories/database.ts`、`backend/src/routes/mvp.ts`、`.gitignore`。
- Code changes: 新增只读 `getHarnessDatabaseHealth()`，健康接口返回 `dependencies.harnessDatabase`；增加 `*.sqlite` 忽略规则；不自动删除或重建数据库。
- Regression added or updated: 健康检查走真实 SQLite `PRAGMA integrity_check`；全量路由和后端测试覆盖。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/routes/mvp-auth.test.ts ./src/repositories/harness-metrics.test.ts`（4 pass）；`bun test`（245 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: `fix: 增加Harness数据库健康检查`
- Commit: `958f2b3`
- Remaining follow-up: 将已跟踪的历史 `backend/data/harness.sqlite` 从 Git 索引移除；补多进程访问隔离策略。

### U10

- Objective: 阻止多个 Bun 进程同时打开同一 Harness SQLite，提供安全的离线完整性检查和备份路径，并移除运行库的 Git 跟踪。
- Files: `backend/src/repositories/database.ts`、`backend/scripts/harness-database-maintenance.ts`、`.gitignore`、`backend/data/harness.sqlite`（移除索引）。
- Code changes: 增加 `${HARNESS_DATABASE_PATH}.lock` 进程锁，支持存活 PID 检查和陈旧锁回收；第二进程返回 `HARNESS_DATABASE_IN_USE`；新增 maintenance `check`/`backup`，备份使用 `VACUUM INTO`；运行库从 Git 索引移除但保留本地文件。
- Regression added or updated: 第二进程竞争验证返回降级而非打开数据库；临时数据库 check、backup、备份再 check 全部通过。
- Regression executor: repo-native backend unit test and local process regression
- Validation commands: 目标测试（6 pass）；`bun test`（245 pass）；`bunx tsc --noEmit`；`git diff --check`；第二进程竞争返回 `HARNESS_DATABASE_IN_USE`；维护脚本 `check`/`backup` 及备份完整性检查通过。
- Validation artifacts: 临时数据库位于 `/tmp/reffo-*`，未纳入版本库
- CR findings: pending user review
- Resolution: pending
- Commit message: `fix: 隔离Harness多进程访问并增加备份工具`
- Commit: `44a057a`
- Remaining follow-up: 检查线上多实例部署是否为每实例独立 Harness 路径；必要时迁移到共享服务数据库。

### U11

- Objective: 在不记录简历、JD 或 Prompt 原文的前提下，为每次 V5 调用保留可审计的输入字段摘要和字符/Token 计数。
- Files: `backend/src/v5/prompt-compiler.ts`、`backend/src/providers/llm-provider.ts`、`backend/src/v5/tests/prompt-schema.test.ts`、`doc/V6后续优化TODO.md`。
- Code changes: 编译 manifest 增加 `inputSummary`，记录 envelope 字节数、Top-level 字段名、消息数量、每条消息字符数和估算输入 Token；DeepSeek Harness 事件沿用 manifest 传递摘要，不携带原文。
- Regression added or updated: 每个 P01-P12 组件均断言摘要字段稳定、消息计数正确、估算 Token 与编译结果一致。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/v5/tests/prompt-schema.test.ts`（16 pass）；`bun test`（245 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: 摘要字段仅包含结构元数据，不记录原文；通过 Prompt contract、全量 backend 和类型检查。
- Commit message: `feat: 增加Prompt输入摘要观测`
- Commit: `888783c`
- Remaining follow-up: 将摘要接入 dashboard 聚合，增加上下文超限和预算耗尽错误码恢复建议。

### U12

- Objective: 将 Prompt manifest 输入摘要汇总到 Harness dashboard，支持按组件比较 envelope 大小、估算 Token 与消息字符量。
- Files: `backend/src/repositories/harness-metrics.ts`、`backend/src/repositories/harness-metrics.test.ts`。
- Code changes: `aggregateHarnessMetrics` 新增 `promptInputSummary`，按调用总量和组件维度汇总 envelope 字节数、估算输入 Token、消息字符数；只读取事件中的结构元数据，不解析原文。
- Regression added or updated: 指标测试覆盖 P08/P09 组件汇总、总量和排序。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/repositories/harness-metrics.test.ts`（2 pass）；`bun test`（245 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: dashboard 可按组件比较结构化输入大小和估算 Token，不保存输入原文。
- Commit message: `feat: 汇总Prompt输入指标`
- Commit: `5535760`
- Remaining follow-up: 增加预算耗尽、上下文超限、Provider 超时和安全回退的统一恢复建议。

### U13

- Objective: 为预算耗尽、上下文超限、输出截断、超时、事实安全阻断和 chunk 完整性失败提供统一可读恢复建议，避免失败后盲目再次调用 LLM。
- Files: `backend/src/harness/recovery-advice.ts`、`backend/src/harness/run-step.ts`、`backend/src/harness/recovery-advice.test.ts`、`doc/V6后续优化TODO.md`。
- Code changes: 新增错误码到恢复动作的纯函数映射；step/attempt 失败事件和 `StepRunSnapshot` 携带 `recoveryAdvice`，明确是否可重试及是否应缩小上下文、检查 chunk 或保留源事实。
- Regression added or updated: 覆盖预算/上下文失败的非 LLM 处理、超时单次重试边界和未知错误可观测兜底。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/harness/recovery-advice.test.ts ./src/harness/json-output.test.ts ./src/harness/runtime-state.test.ts`（6 pass）；`bun test`（247 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: 失败事件统一携带可读动作和 retryable 标记；未匹配错误走 Harness 事件检查兜底。
- Commit message: `feat: 增加Harness失败恢复建议`
- Commit: `8c695a6`
- Remaining follow-up: 将恢复建议接入 dashboard/API 错误响应，并为真实 canary 汇总恢复动作命中率。

### U14

- Objective: 将统一恢复建议暴露到 MVP API 错误响应，调用方无需读取 Harness 事件即可决定是否重试或缩小输入。
- Files: `backend/src/routes/mvp.ts`。
- Code changes: `buildErrorPayload` 提取底层错误码，保留既有业务详情并追加 `error_code` 与 `recovery_advice`；未知错误继续返回安全兜底动作。
- Regression added or updated: 路由鉴权、恢复建议和全量 backend 测试通过。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/routes/mvp-auth.test.ts ./src/harness/recovery-advice.test.ts`（4 pass）；`bun test`（247 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: API 错误详情保留原有业务字段，并统一追加底层 `error_code` 和 `recovery_advice`。
- Commit message: `feat: 暴露API失败恢复建议`
- Commit: `4e2184b`
- Remaining follow-up: 为真实 canary 汇总恢复动作命中率，并推进黄金集/故障注入回归。

### U15

- Objective: 在 Harness dashboard 汇总失败恢复建议命中量、可重试量、恢复动作和错误码分布。
- Files: `backend/src/repositories/harness-metrics.ts`、`backend/src/repositories/harness-metrics.test.ts`。
- Code changes: `HarnessMetrics` 增加 `recoveryAdvice`；只按 `step.failed` 统计，避免 attempt/step 双重计数；输出按 action 和 errorCode 分组结果。
- Regression added or updated: 指标测试覆盖超时恢复建议命中、可重试计数和动作/错误码分组。
- Regression executor: repo-native backend unit test
- Validation commands: `bun test ./src/repositories/harness-metrics.test.ts`（2 pass）；`bun test`（247 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: dashboard 只统计 step 级失败，避免 attempt/step 双重计数。
- Commit message: `feat: 汇总失败恢复建议指标`
- Commit: `10b7ecd`
- Remaining follow-up: 黄金集、故障注入、多样本真实 canary 和多实例部署验证。

### U16

- Objective: 验证 P01 随机乱序、重复重传和部分响应故障，确保进入候选结果合并前完成确定性去重、排序与缺块检查。
- Files: `backend/src/v5/chunked-resume-extraction.ts`、`backend/src/v5/main/workflow.ts`、`backend/src/v5/tests/chunked-resume-extraction.test.ts`、`doc/V6后续优化TODO.md`。
- Code changes: 新增 `orderUniqueResumeExtractionChunkResults` 和 `P01_CHUNK_INTEGRITY_FAILED`；按幂等键保留最新重传结果，按 canonical 元数据排序，并对预期 chunk 集合执行缺失/越界检查；workflow 合并前强制调用。
- Regression added or updated: 20 组乱序响应、重复重传覆盖、部分 chunk 缺失阻断；既有共享预算与 journal/SQLite 恢复测试共同覆盖故障注入清单。
- Regression executor: repo-native backend unit test
- Validation commands: chunk/workflow/budget 测试（42 pass）；`bun test`（249 pass）；`bunx tsc --noEmit`；`git diff --check`
- Validation artifacts: 无临时产物
- CR findings: pending user review
- Resolution: pending
- Commit message: pending
- Commit: pending
- Remaining follow-up: 黄金集、多样本真实 canary 和多实例部署验证。

## Remaining Items

- Remaining functional units: U16
- Cleanup-only units: none
- Open risks: U16 尚未提交；线上多实例若需要共享 Harness 查询，当前进程锁会拒绝共享路径，应改用独立路径或外部数据库。黄金集和多样本 canary 尚未执行。

## Final Summary

- Functional commits: U1-U15 已完成；U16 进行中
- Cleanup commits: none
- Final validation: `bun test`（243 pass）；`bun test ./src/v5`（162 pass）；`bunx tsc --noEmit`；`git diff --check`；真实主流程成功
- Deferred items: 黄金集、故障注入和多样本真实 canary 属后续发布前任务。
