# V5 工作流默认化与插件化 Tracker

## Header

- Task: V5-only、Workflow Plugin 化、Prompt 外置化
- Workspace: `/Users/mi/code/reffo`
- Mode: `human-gated`
- Validation stack: Backend TypeScript + Bun test
- Regression executor: 仓库原生命令；当前单元不影响 UI 或真实设备
- Reviewer mode: `user`
- Current branch: `private/v5-llm-flow-hsl`

## Problem

- User-reported issue: 完整流程只保留 V5；V5 Workflow 需要拆成主流程和即插即用 Plugin；Prompt 需要独立文件维护。
- Root cause summary: 完整流程存在 V4/V5 版本分支；V5 编排集中于单个 `workflow.ts`；Prompt 正文内联在 TypeScript。
- Constraints: 保持旧 MVP 步骤字段兼容；V5 已知无效输出不得作为成功结果；当前分支只做测试，暂不提交、不合入 `main`；每完成一项更新根目录 `docs` TODO。
- Out-of-scope items: 当前 U1 不做 Plugin 拆分、Prompt 迁移、真实 Provider 批量评测。

## Solution

- Chosen approach: 分四个单元推进。U1 先把完整流程收敛为 V5-only；U2 再引入 Plugin contract；U3 外置 Prompt；U4 全量验证和文档收口。
- Rejected options: 一次性重写 V5；风险面过大，难以区分默认切换、fallback、Plugin 和 Prompt 迁移回归。
- Why this boundary is minimal: U1 删除完整流程的版本选择和 V4 编排，不触碰 V5 内部算法或独立单步接口。

## Units

| Unit | Goal | Scope | Validation | CR | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | 完整流程收敛为 V5-only | env、workflow 入口、类型、测试、文档 | 17 tests + tsc | user passed | 不提交 | cr_passed |
| U2.1 | Plugin contract + registry | V5 plugin types/registry/tests | 102 V5 tests + tsc | user passed | 不提交 | cr_passed |
| U2.2 | 内置阶段 Plugin 迁移 | V5 workflow/built-ins | 102 V5 tests + tsc | user passed | 不提交 | cr_passed |
| U3 | Prompt Markdown/JSON registry | V5 prompts/compiler | 102 V5 tests + tsc | user passed | 不提交 | cr_passed |
| U4 | 全量回归与文档收口 | backend/docs | 182 tests + tsc + diff check | user passed | 不提交 | cr_passed |
| U5 | V5 目录结构重组 | main/plugins/prompts/tests | 182 tests + tsc + diff check | awaiting user | 不提交 | awaiting_cr |
| U6 | README 与插件清单同步 | backend/README、README、docs | tsc + full tests | awaiting user | 不提交 | awaiting_cr |

## Unit Logs

### U1

- Objective: 完整流程固定只走 V5；删除 V4 fallback、shadow、版本选择和旧完整编排。
- Files: `backend/src/config/env.ts`、`backend/src/types/index.ts`、`backend/src/v5/workflow.ts`、`backend/src/workflows/resume-optimization-workflow.ts`、对应测试、路由说明、环境示例和 V5 文档。
- Code changes: `ResumeOptimizationWorkflow` 收缩为 V5 入口；路由移除版本字段；配置移除 V4/shadow；响应版本固定为 `5.0.0`；V5 错误继续携带 run ID。
- Regression added or updated: 新增 V5-only 委托和阻断错误透传测试；修复既有 Bun matcher TypeScript 阻断。
- Regression executor: 仓库原生命令。
- Validation commands: `bun test ./src/workflows/resume-optimization-workflow.test.ts`、`bun test ./src/v5/workflow.test.ts`、`bunx tsc --noEmit`。
- Validation artifacts: `bunx tsc --noEmit` 通过；定向 17 tests 通过、0 失败。
- CR findings: 用户要求移除 V4 fallback，只保留 V5；已修复并重新回归，等待确认。
- Resolution: 待定。
- Commit message: 当前分支只测试，不提交。
- Commit: 不提交。
- Remaining follow-up: U2、U3、U4。

### U2.1

- Objective: 建立类型化 Plugin contract、生命周期、上下文、manifest、错误映射和可替换注册表，不迁移现有 V5 阶段业务。
- Files: `backend/src/v5/plugins/contract.ts`、`backend/src/v5/plugins/registry.ts`、`backend/src/v5/plugins/registry.test.ts`。
- Code changes: 定义十类插件阶段与五个生命周期钩子；提供共享状态、Provider、配置、预算、取消信号和 Plugin manifest 上下文；注册表支持注册、显式替换、按阶段查询、依赖/循环检查、可选插件禁用、生命周期执行、超时、取消、partial 和 API/Agent state 错误映射。
- Regression added or updated: 9 个注册表单测，覆盖生命周期、manifest、重复注册与替换、缺失/循环/未完成依赖、禁用规则、可选与必选失败、错误映射、超时和父级取消。
- Regression executor: 仓库原生命令。
- Validation commands: `bun test ./src/v5/plugins/registry.test.ts`、`bun test ./src/v5`、`bunx tsc --noEmit`。
- Validation artifacts: Plugin 定向 9 tests 通过；V5 全量 102 tests 通过；TypeScript 检查通过。
- CR findings: 自检修复了泛型回调逆变问题；注册表内部使用边界擦除闭包，避免把宽泛 `any` 扩散到 Plugin 接口。补充父级取消竞争、`onError` 二次失败包装和失败 manifest 记录。
- Resolution: 用户确认继续，CR 通过。
- Commit message: 当前分支只测试，不提交。
- Commit: 不提交。
- Remaining follow-up: 用户 CR 通过后进入 U2.2 内置阶段 Plugin 迁移。

## Remaining Items

- Remaining functional units: U5 等待 CR；真实 Provider/黄金集发布验证仍属后续运维清单。

### U3

- Objective: 将 V5 Prompt 正文迁移到 Markdown，使用 manifest registry 加载、校验、hash 并写入编译 manifest。
- Files: `backend/src/v5/prompts/`、`backend/src/v5/prompts.ts`、`backend/src/v5/prompt-compiler.ts`、`backend/src/v5/types.ts`、`backend/src/v5/prompt-schema.test.ts`。
- Code changes: 新增 core/output 与 P01-P12（含修复 Prompt）Markdown；新增 `manifest.json` 维护组件版本；Prompt registry fail closed 校验 manifest、版本和文件；编译器记录 Prompt 文件相对路径和 SHA-256；保留动态 envelope 与严格 Schema。
- Validation commands: `bun test ./src/v5/prompt-schema.test.ts`、`bun test ./src/v5`、`bunx tsc --noEmit`。
- Validation artifacts: Prompt 定向 2 tests 通过；V5 全量 102 tests 通过；TypeScript 检查通过。
- Resolution: 用户确认继续，CR 通过；当前分支不提交、不合入 `main`。

### U4

- Objective: 完成全量测试、文档收口和测试分支发布边界确认。
- Files: V5 TODO、升级清单、V5 README、Prompt manifest/registry、Plugin workflow 及 tracker。
- Validation commands: `bun test ./src`、`bunx tsc --noEmit`、`git diff --check`。
- Validation artifacts: 182 tests 通过，0 失败；TypeScript 检查通过；diff check 通过。
- Remaining release evidence: 真实 Provider 双传输、100+ 黄金集、30+ 对抗集、P95/成本、internal beta 和 limited test 未执行，保留在发布前清单。
- Resolution: 等待用户 CR；当前分支不提交、不合入 `main`。

### U6

- Objective: 按当前目录结构更新后端 README、项目 README，并列出 V5 内置插件职责。
- Files: `backend/README.md`、`README.md`、`docs/v5-工作流默认化与插件化-TODO.md`、本 tracker。
- Code changes: README 增加 `v5/main`、`plugins`、`prompts`、`tests` 结构；补充 11 个内置插件和可替换/禁用规则；修正根目录 `docs` 路径；同步 V5 流程说明。
- Validation commands: `bun test ./src`、`bunx tsc --noEmit`、`git diff --check`。
- Validation artifacts: 182 tests 通过；TypeScript 检查通过；diff check 通过。
- Resolution: 等待用户 CR；当前分支不提交、不合入 `main`。

### U5

- Objective: 重新组织 V5 目录，明确主流程、插件、Prompt 和测试边界。
- Code changes: 主流程及兼容转换移入 `v5/main/`；全部 V5 测试和 fixture 移入 `v5/tests/`；更新 import、测试命令和文档入口；新增目录 README。
- Validation commands: `bun test ./src/v5/tests`、`bunx tsc --noEmit`、`git diff --check`。
- Validation artifacts: 102 V5 tests 通过；完整 182 tests 通过；TypeScript 检查通过；diff check 通过。
- Resolution: 等待用户 CR；当前分支不提交、不合入 `main`。
- Cleanup-only units: 暂无。
- Open risks: fallback 会增加失败请求延迟和模型成本；需区分显式 V5 是否允许 fallback；响应元数据必须不破坏旧客户端。

## Final Summary

- Functional commits: 暂无。
- Cleanup commits: 暂无。
- Final validation: `bun test ./src` 182 通过；`bunx tsc --noEmit` 通过；`git diff --check` 通过。
- Deferred items: U5/U6 等待用户 CR；真实 Provider、黄金集/对抗集、P95/成本和发布门槛验证仍待测试分支执行。
