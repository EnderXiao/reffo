# Taro H5 前端重构收口追踪

## Header

- Task: 完成 `doc/Taro前端重构TODO.md` 剩余重构任务
- Workspace: `/Users/mi/code/reffo`
- Mode: `human-gated`
- Validation stack: Taro Jest、H5 build、TypeScript、git diff check；视觉单元补 Playwright
- Regression executor: 纯代码单元使用仓库原生命令；视觉交互单元使用 Playwright
- Reviewer mode: `user`
- Current branch: `private/reffo-xgy`

## Problem

- User-reported issue: 当前前端重构尚未收口，需要继续完成后续任务；缺少外部配置时向用户说明。
- Root cause summary: workspace Store 仍保留旧兼容入口，路由和动画存在硬编码及边界混杂，HTTP transport、RN/Expo 残留、组件职责、测试和构建性能尚未系统收口。
- Constraints: 聚焦 Taro H5；保留现有业务行为；不回滚用户未提交改动；不提交 `.artifacts/`、`dist/`、截图、Watchman 文件；缺少外部配置或权限时停止对应单元并说明。
- Out-of-scope items: 后端 Profile/配额功能、Render 控制台、生产迁移、RN/小程序真机回归。

## Solution

- Chosen approach: 按状态源、请求、路由、动画、平台残留、组件、质量门禁、性能八个边界逐单元收口；每单元补最小测试并执行目标验证。
- Rejected options: 一次性删除全部兼容代码；跨模块大规模格式化；用 H5 build 掩盖 TypeScript 错误；将业务专属动画做万能抽象。
- Why this boundary is minimal: 每个单元只改变一个架构边界，可独立验证和回滚，不混入 Profile/配额未提交功能。

## Units

| Unit | Goal | Scope | Validation | CR | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | 移除 Landing 对旧 resume Store 和硬编码首页路由依赖 | Landing 页面及测试 | Landing Jest、H5 build | 通过 | `40ea00d` | committed |
| U2 | 收口 workspace Store 状态机与兼容层 | Store、创建页、结果页、测试 | Store/Page Jest、全量 Jest、H5 build、git diff check | 待用户 CR | 未提交 | regression_passed |
| U3 | 收敛 HTTP transport 和错误语义 | API、transport、service 测试与文档 | request/API Jest、H5 build | 待执行 | 未提交 | proposed |
| U4 | 完成路由常量、参数和页面栈迁移 | routing、页面、导航兼容层 | routing/Page Jest、H5 build | 待执行 | 未提交 | proposed |
| U5 | 收口动画生命周期和边界 | shared motion、页面动画、navigation transition | motion/Page Jest、Playwright、H5 build | 待执行 | 未提交 | proposed |
| U6 | 清理 RN/Expo 残留和 H5 mock | components、utils、config、package、lockfile | Jest、TypeScript、H5 build | 待执行 | 未提交 | proposed |
| U7 | 治理组件职责和公共状态展示 | common/business/page components | 组件 Jest、Playwright、H5 build | 待执行 | 未提交 | proposed |
| U8 | 恢复质量门禁并治理 TypeScript 遗留 | tests、CI、TypeScript | 全量 Jest、TypeScript、H5 build、diff check | 待执行 | 未提交 | proposed |
| U9 | 完成 bundle 分析和性能收口 | build config、route loading、文档 | bundle 报告、Playwright、H5 build | 待执行 | 未提交 | proposed |
| U10 | 总回归和 TODO 收口 | 全部相关文件 | 全量验证 | 待执行 | 未提交 | proposed |

## Unit Logs

### U1

- Objective: Landing 只通过 workspace action 写源简历，并使用公共路由常量返回首页。
- Files: `src/pages/landing/index.tsx`、`src/pages/landing/__tests__/index.test.tsx`
- Code changes: Landing 上传和删除改用 `resumeWorkspaceActions.setSourceResume`；首页跳转改用 `routePaths.home`；删除旧 Store 和页面级路径常量依赖。
- Regression added or updated: Landing 测试改为 mock workspace command，并使用公共路径常量断言首页跳转。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest src/pages/landing/__tests__/index.test.tsx src/store/__tests__/resumeWorkspaceStore.test.ts --runInBand --no-watchman`，Landing 14 tests passed；仓库暂无 `resumeWorkspaceStore.test.ts`，Jest 匹配 Landing suite；`corepack pnpm@10.33.2 build:h5` 成功；`git diff --check` 通过。
- Validation artifacts: 无。
- CR findings: 自查无功能问题；用户确认继续 U2。
- Resolution: U1 CR 通过。
- Commit message: `refactor: 收口 Landing 状态与路由依赖`
- Commit: `40ea00d`。
- Remaining follow-up: U2-U10。

## Remaining Items

- Remaining functional units: U2-U10。
- Cleanup-only units: Watchman、Playwright 截图、dist 等本地产物仅报告，不纳入提交。
- Open risks: 工作区已有 Profile/配额未提交改动；TypeScript 当前存在大量历史 H5/RN 类型边界错误；性能单元可能需要浏览器服务和 bundle analyzer 配置。

## Final Summary

- Functional commits: 无。
- Cleanup commits: 无。
- Final validation: 待执行。
- Deferred items: 无。

### U2

- Objective: 将 workspace Store 收口为带请求失效保护的生成状态机，并删除旧 `resumeStore`/`jdStore` 状态源。
- Files: `src/store/resumeWorkspaceStore.ts`、`src/pages/create/usePageModel.ts`、`src/pages/result/usePageModel.ts`、相关测试、Store 文档和导出。
- Code changes: 增加 `generationRunId`、阶段顺序校验、完成/失败/取消/重置命令；创建页和结果页接入分析、匹配、优化、面试状态；页面卸载和导航取消执行中的请求；删除旧 Store、测试和过期 setup 文档。
- Regression added or updated: workspace Store 状态迁移/并发失效/取消测试；结果页继续生成完成、失败、卸载取消测试；创建页补充分析态、匹配态和取消断言；认证 Store 改用 workspace Store。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`（40 suites、510 tests passed）；`corepack pnpm@10.33.2 build:h5`（passed）；相关范围 TypeScript 检查无新增错误；`git diff --check`（passed）。
- Validation artifacts: 无。
- CR findings: 自查未发现功能问题；待用户 CR。
- Resolution: 待用户确认。
- Commit message: `refactor: 收口 workspace Store 状态机`
- Commit: 未提交。
