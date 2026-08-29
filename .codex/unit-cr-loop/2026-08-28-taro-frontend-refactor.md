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
| U3 | 收敛 HTTP transport 和错误语义 | API、transport、service 测试与文档 | request/API Jest、H5 build | 通过 | `18099f8` | committed |
| U4 | 完成路由常量、参数和页面栈迁移 | routing、页面、导航兼容层 | routing/Page Jest、H5 build | 待用户 CR | 未提交 | regression_passed |
| U5 | 收口公共 View Transition 合约并迁移创建页生成态 | shared motion、创建页生成态 | motion/Create Jest、H5 build、git diff check | 待用户 CR | 未提交 | regression_passed |
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
- Remaining follow-up: U3-U10。

## Remaining Items

- Remaining functional units: U5-U10。
- Cleanup-only units: Watchman、Playwright 截图、dist 等本地产物仅报告，不纳入提交。
- Open risks: 工作区已有 Profile/配额未提交改动；TypeScript 当前存在大量历史 H5/RN 类型边界错误；性能单元可能需要浏览器服务和 bundle analyzer 配置。

## Final Summary

- Functional commits: `40ea00d`、`f0026a2`、`18099f8`。
- Cleanup commits: 无。
- Final validation: U4 回归通过，待用户 CR；U5-U10 待执行。
- Deferred items: 无。

### U2

- Objective: 将 workspace Store 收口为带请求失效保护的生成状态机，并删除旧 `resumeStore`/`jdStore` 状态源。
- Files: `src/store/resumeWorkspaceStore.ts`、`src/pages/create/usePageModel.ts`、`src/pages/result/usePageModel.ts`、相关测试、Store 文档和导出。
- Code changes: 增加 `generationRunId`、阶段顺序校验、完成/失败/取消/重置命令；创建页和结果页接入分析、匹配、优化、面试状态；页面卸载和导航取消执行中的请求；删除旧 Store、测试和过期 setup 文档。
- Regression added or updated: workspace Store 状态迁移/并发失效/取消测试；结果页继续生成完成、失败、卸载取消测试；创建页补充分析态、匹配态和取消断言；认证 Store 改用 workspace Store。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`（40 suites、510 tests passed）；`corepack pnpm@10.33.2 build:h5`（passed）；相关范围 TypeScript 检查无新增错误；`git diff --check`（passed）。
- Validation artifacts: 无。
- CR findings: 用户确认继续。
- Resolution: U2 CR 通过。
- Commit message: `refactor: 收口 workspace Store 状态机`
- Commit: `f0026a2`。

### U3

- Objective: 收敛 API client 与 Taro transport 职责，统一 HTTP、业务、网络、超时和取消错误语义。
- Files: `src/utils/httpTransport.ts`、`src/services/api.ts`、`src/utils/retry.ts`、对应测试和 `src/services/README.md`。
- Code changes: 移除 transport 拦截器扩展；ApiClient 统一负责 base URL、认证头、业务响应解析、日志和重试；transport 增加 AbortSignal 取消和底层错误归一化；默认重试识别 `RequestError` 的网络/超时错误且不重试取消；文档同步当前边界。
- Regression added or updated: 删除拦截器契约测试，增加取消请求测试；补 API 默认网络重试测试；HTTP 业务错误映射保持兼容。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest src/utils/__tests__/request.test.ts src/services/__tests__/api.test.ts src/utils/__tests__/retry.test.ts --runInBand --no-watchman`（70 tests passed）；`corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`（40 suites、509 tests passed）；`corepack pnpm@10.33.2 build:h5`（passed）；`git diff --check`（passed）；全量 TypeScript 仅保留既有平台/测试类型错误。
- Validation artifacts: 无。
- CR findings: 自查未发现功能问题；待用户 CR。
- Resolution: U3 CR 通过。
- Commit message: `refactor: 收敛 API transport 与错误语义`
- Commit: `18099f8`。

### U4

- Objective: 页面路由统一使用公共路径、参数解析和页面栈迁移，避免页面继续依赖硬编码路径或直接读取 `useRouter`。
- Files: `src/shared/routing/`、`src/app.ts`、`src/components/AppPageShell/index.tsx`、`src/components/ErrorBoundary/index.tsx`、`src/pages/auth/index.tsx`、`src/pages/create/usePageModel.ts`、`src/pages/result/usePageModel.ts`、`src/pages/complete/usePageModel.ts`、`src/services/auth.ts`、`src/utils/navigation.ts` 及路由测试。
- Code changes: 新增 `usePageRoute`、路由参数读写和 `useRouteTransition` 测试；页面参数读取迁移到统一 hook；Landing 启动守卫、错误边界、OAuth 回调、返回首页和认证返回统一使用 `routePaths`/导航封装；结果页 effect 改为依赖稳定 `resultId`，防止路由对象重建触发重复加载和重复生成。
- Regression added or updated: `routeParams.test.ts`、`useRouteTransition.test.ts`；结果页测试 mock 和异步生成断言同步更新。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest src/shared/routing src/utils/__tests__/navigation.test.ts src/utils/__tests__/navigation-transition.test.ts src/pages/create/__tests__/index.test.tsx src/pages/auth/__tests__/index.test.tsx src/pages/result/__tests__/usePageModel.test.tsx src/pages/result/__tests__/interviewReferences.test.ts src/pages/index/__tests__/index.test.tsx src/pages/index/__tests__/usePageModel.test.tsx --runInBand --no-watchman`（10 suites、114 tests passed）；`corepack pnpm@10.33.2 build:h5`（成功，保留既有 bundle/Browserslist 警告）；`git diff --check`（通过）。
- Validation artifacts: 无。
- CR findings: 初次定向测试发现查询编码断言错误、`reLaunch` 第二参数断言缺失，以及结果页依赖整个路由对象导致重复请求；已修复并重新验证。
- Resolution: U4 CR 通过。
- Commit message: `refactor: 收口页面路由与参数依赖`
- Commit: `6d3c30f`。

### U5

- Objective: 将创建页生成态的通用 View Transition 接入公共入口，并统一 reduced-motion、同步异常和过渡标记清理。
- Files: `src/shared/motion/viewTransition.ts`、`src/shared/motion/__tests__/viewTransition.test.ts`、`src/pages/create/PageView.h5.tsx`。
- Code changes: `runViewTransition` 在无 API 或 reduced-motion 时直接更新；同步启动异常回退更新；无论过渡 promise 成功或拒绝均清理 `data-reffo-view-transition`；创建页生成态切换移除直接 `startViewTransition` 调用，改走公共入口。删除卡片破裂等业务专属动画保持在页面组件内。
- Regression added or updated: 覆盖无 API fallback、ready/update/finished 拒绝、reduced-motion、同步启动异常四类公共契约。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest src/shared/motion/__tests__/viewTransition.test.ts src/pages/create/__tests__/index.test.tsx --runInBand --no-watchman`（2 suites、27 tests passed）；`corepack pnpm@10.33.2 build:h5`（成功，保留既有 bundle/Browserslist 警告）；`git diff --check`（通过）。
- Validation artifacts: 无。
- CR findings: 自查未发现功能问题；业务专属删除/卡片动画未抽离。
- Resolution: 待用户 CR。
- Commit message: `refactor: 收口公共 View Transition 生命周期`
- Commit: 未提交。
