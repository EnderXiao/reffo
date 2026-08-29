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
| U2 | 收口 workspace Store 状态机与兼容层 | Store、创建页、结果页、测试 | Store/Page Jest、全量 Jest、H5 build、git diff check | 通过 | `f0026a2` | committed |
| U3 | 收敛 HTTP transport 和错误语义 | API、transport、service 测试与文档 | request/API Jest、H5 build | 通过 | `18099f8` | committed |
| U4 | 完成路由常量、参数和页面栈迁移 | routing、页面、导航兼容层 | routing/Page Jest、H5 build | 通过 | `6d3c30f` | committed |
| U5 | 收口公共 View Transition 合约并迁移创建页生成态 | shared motion、创建页生成态 | motion/Create Jest、H5 build、git diff check | 通过 | `6d904be` | committed |
| U6 | 清理无引用的 RN/Expo H5 alias 与 mock | config、H5 mock | Jest、H5 build、git diff check | 通过 | `cbfa13c` | committed |
| U7 | 治理组件职责和公共状态展示 | common/business/page components | 组件 Jest、H5 build | 通过 | `6f994f5` | committed |
| U8 | 恢复质量门禁并治理 TypeScript 遗留 | tests、CI、TypeScript | 全量 Jest、H5 build、diff check | 通过 | `528af3e` | committed |
| U9 | 完成 bundle 分析和性能收口 | build config、route loading、文档 | bundle 报告、H5 build | 通过 | `d5ae481` | committed |
| U10 | 总回归和 TODO 收口 | 全部相关文件 | 全量验证 | 通过 | `9ab65d2` | committed |

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
- Remaining follow-up: 无；延期项见 Final Summary。

## Remaining Items

- Remaining functional units: 无；U1-U10 均已完成并通过对应回归。
- Cleanup-only units: Watchman、Playwright 截图、dist 等本地产物仅报告，不纳入提交。
- Open risks: 工作区已有 Profile/配额未提交改动；TypeScript 当前存在 327 条历史 H5/RN 类型边界错误；RN/Expo 传递依赖、动画生命周期迁移和 393/430/桌面性能指标仍是明确延期项。

## Final Summary

- Functional commits: `40ea00d`、`f0026a2`、`18099f8`、`6d3c30f`、`6d904be`、`cbfa13c`、`6f994f5`、`528af3e`、`d5ae481`。
- Cleanup commits: 无。
- Final validation: 全量 Jest 44 suites/520 tests、H5 build、bundle 分析脚本和 `git diff --check` 均通过。
- Deferred items: RN/Expo 深层依赖清理、剩余动画生命周期迁移、路由级性能指标与 bundle warning 治理。

### U2

- Objective: 将 workspace Store 收口为带请求失效保护的生成状态机，并删除旧 `resumeStore`/`jdStore` 状态源。
- Files: `src/store/resumeWorkspaceStore.ts`、`src/pages/create/usePageModel.ts`、`src/pages/result/usePageModel.ts`、相关测试、Store 文档和导出。
- Code changes: 增加 `generationRunId`、阶段顺序校验、完成/失败/取消/重置命令；创建页和结果页接入分析、匹配、优化、面试状态；页面卸载和导航取消执行中的请求；删除旧 Store、测试和过期 setup 文档。
- Regression added or updated: workspace Store 状态迁移/并发失效/取消测试；结果页继续生成完成、失败、卸载取消测试；创建页补充分析态、匹配态和取消断言；认证 Store 改用 workspace Store。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`（40 suites、510 tests passed）；`corepack pnpm@10.33.2 build:h5`（passed）；相关范围 TypeScript 检查无新增错误；`git diff --check`（passed）。
- Validation artifacts: 无。
- CR findings: 无阻塞问题；用户确认继续。
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
- CR findings: 自查未发现功能问题；用户确认继续。
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
- Resolution: U5 CR 通过。
- Commit message: `refactor: 收口公共 View Transition 生命周期`
- Commit: `6d904be`。

### U6

- Objective: 删除无生产引用的 RN/Expo H5 alias 与 Jest/H5 mock，减少无效平台兼容层。
- Files: `config/index.ts`、`jest.config.js`、`src/__mocks__/h5/expo-blur.js`、`src/__mocks__/h5/react-native-gesture-handler.js`、`src/__mocks__/react-native-gesture-handler.tsx`。
- Code changes: 删除 `react-native-gesture-handler`、`expo-blur` H5 webpack alias；删除对应 H5 mock；删除 Jest 中无引用的 gesture-handler mapping。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`（43 suites、517 tests passed）；`corepack pnpm@10.33.2 build:h5`（成功，保留既有 bundle/Browserslist/webpackExports 警告）；`git diff --check`（通过）。
- Validation artifacts: 无。
- CR findings: 自查未发现功能问题；仅删除已确认无生产引用的 alias/mock。
- Resolution: U6 CR 通过。
- Commit message: `refactor: 清理无引用的 RN Expo H5 兼容层`
- Commit: `cbfa13c`。

### U7

- Objective: 将跨页复用的生成态展示组件移出 create 页面私有目录，建立独立 props 契约并分离页面状态构造逻辑。
- Files: `src/components/business/GenerationStageH5/`、`src/pages/create/utils/generationState.ts`、create/landing-analysis 页面入口及组件测试。
- Code changes: 生成态视图只接收展示状态和交互回调；`buildPendingGenerationState` 保留在 create 页面工具层；landing-analysis 与 create 统一从 business 组件导入。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest src/components/business/GenerationStageH5/__tests__/index.test.tsx src/pages/create/__tests__/index.test.tsx --runInBand --no-watchman`（2 suites、26 tests passed）；`corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`（44 suites、521 tests passed）；`corepack pnpm@10.33.2 build:h5`（成功，保留既有 bundle/Browserslist/webpackExports 警告）；`git diff --check`（通过）。
- Validation artifacts: 无。
- CR findings: 自查未发现功能问题；用户已确认继续。
- Resolution: U7 CR 通过。
- Commit message: `refactor: 收口跨页生成态组件职责`
- Commit: `6f994f5`。

### U8

- Objective: 建立 Taro H5 最小 CI 质量门禁，并把当前 TypeScript 遗留错误单独记录，避免质量状态和历史债务混淆。
- Files: `.github/workflows/taro-quality.yml`、`doc/Taro前端TypeScript遗留.md`。
- Code changes: PR/手动触发时安装锁定 pnpm 依赖，执行全量 Jest、H5 build 和 `git diff --check`；记录 `tsc --noEmit` 当前 327 条错误及分类，暂不将历史类型债务接入阻断门禁。
- Regression executor: GitHub Actions 配置静态检查 + 仓库原生命令。
- Validation commands: 本地全量 Jest（44 suites、521 tests passed）、H5 build（成功，保留既有 bundle/Browserslist/webpackExports 警告）、`git diff --check`（通过）；`tsc --noEmit --pretty false` 仅用于债务基线记录（327 条历史错误）。
- Validation artifacts: 无。
- CR findings: 自查未发现门禁配置问题；用户确认继续。
- Resolution: U8 CR 通过。
- Commit message: `chore: 建立 Taro H5 质量门禁并记录类型债务`
- Commit: `528af3e`。

### U9

- Objective: 提供无需额外依赖的 H5 bundle 分析入口，确认大体积资产并沉淀当前拆包基线。
- Files: `frontend/Taro/reffo-taro/tools/analyze-h5-bundle.mjs`。
- Code changes: 递归扫描 `dist` 的 JS/CSS 资产，按体积排序输出最大文件、总量和入口文件；支持 `--json` 供 CI 或后续性能脚本消费。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 build:h5`（成功，保留既有 bundle/Browserslist/webpackExports 警告）；`node tools/analyze-h5-bundle.mjs dist`（输出 8.7 MiB、32 个 JS/CSS 资产，`app.*` 入口 359.2 KiB）；`node tools/analyze-h5-bundle.mjs dist --json`（成功）；`git diff --check`（通过）。
- Validation artifacts: 终端报告，不提交 `dist` 或分析产物。
- CR findings: 自查未发现功能问题；工具只读构建目录，不改变构建产物。
- Resolution: U9 CR 通过。
- Commit message: `perf: 增加 H5 bundle 分析基线工具`
- Commit: `d5ae481`。

### U10

- Objective: 汇总已完成重构单元，更新 TODO 完成状态，并执行最终 H5 回归。
- Files: `doc/Taro前端重构TODO.md`、本 tracker。
- Code changes: 将 U1-U9 已验证事项标记为完成；未完成项保留明确状态，包括 RN/Expo 深层依赖、动画生命周期迁移、TypeScript 债务和性能优化。
- Regression executor: 仓库原生命令。
- Validation commands: `corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`（44 suites、520 tests passed）；`corepack pnpm@10.33.2 build:h5`（成功，保留既有 bundle/Browserslist/webpackExports 警告）；`node tools/analyze-h5-bundle.mjs dist`（成功，8.7 MiB、32 个 JS/CSS 资产，`app.*` 359.2 KiB）；`git diff --check`（通过）。
- Validation artifacts: 无；不提交 `dist`、截图、Watchman 文件。
- CR findings: 自查未发现本次重构回归；TODO 保留未完成项，未将 RN/Expo 深层依赖、动画迁移和性能指标标记为完成。
- Resolution: U10 CR 通过。
- Commit message: `docs: 收口 Taro 前端重构 TODO 与回归记录`
- Commit: `9ab65d2`。
