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
| U1 | 实现按 issue 选择的 scoped/patch ContextBuilder | `backend/src/v5/plugins/context-builder.ts`、测试 | `bun test ./src/v5/tests/v6-foundation.test.ts`、`bunx tsc --noEmit`、`git diff --check` | user | - | regression_passed |
| U2 | 定义 RepairPatch Schema 和安全合并器 | `backend/src/v5/plugins/patch-merger.ts`、测试 | `bun test ./src/v5/tests/v6-foundation.test.ts`、`bun test ./src/v5`、`bunx tsc --noEmit`、`git diff --check` | user | - | regression_passed |
| U3 | 将 P08/P08R 接入 Patch 修复与统一 issue 分类 | workflow、prompt compiler、P08R prompt、patch merger、测试 | `bun test ./src/v5`、`bunx tsc --noEmit`、`git diff --check` | user | `0775d2c` | committed |
| U4 | 修正确定性选材，保留项目和关键教育信息 | `backend/src/v5/validators.ts`、测试 | `bun test ./src/v5/tests/policy-score-validator.test.ts`、`bun test ./src/v5/tests/workflow.test.ts`、`bunx tsc --noEmit`、`git diff --check` | user | - | regression_passed |
| U5 | 统一 Provider 物理 attempt 预算和 fallback 计费 | providers、call policy、Harness | provider/预算单测、类型检查 | user | `1a24fe8` | committed |
| U6 | P01 幂等重传和 Chunk 插件边界 | `chunked-resume-extraction.ts`、workflow、测试 | chunk/workflow 单测、类型检查 | user | `80cb15d` | committed |
| U7 | 指标汇总、黄金集和发布门禁 | Harness、脚本、文档 | 离线评估 + canary | user | - | proposed |

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
- Commit message: `perf: 将V6业务修复收敛为Patch`
- Commit: `0775d2c`
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
- Commit message: `perf: 收敛V6物理模型调用`
- Commit: `1a24fe8`
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
- Commit message: `fix: 增加P01分块幂等重传`
- Commit: `80cb15d`
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
- Commit message: pending
- Commit: pending
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
- Commit message: pending
- Commit: pending
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
- Commit message: pending
- Commit: pending
- Remaining follow-up: U7 指标汇总、黄金集和发布门禁。

## Remaining Items

- Remaining functional units: U7
- Cleanup-only units: none
- Open risks: 当前生产默认仍为 `full`；U1 完成前不切换默认模式。

## Final Summary

- Functional commits: pending
- Cleanup commits: none
- Final validation: pending
- Deferred items: pending
