# Taro 前端重构 TODO

范围：`frontend/Taro/reffo-taro`。

目标：项目聚焦 H5，降低页面、状态、路由、动画和请求层耦合，提高组件复用度、测试稳定性和后续迭代效率。

状态约定：

- `[ ]` 未开始
- `[-]` 进行中、部分完成或存在已知阻塞
- `[x]` 已完成并通过对应验证

## 已完成记录

### P0：平台与构建边界

- [x] 删除 `android/`、`ios/` 和 RN 构建脚本。
- [x] 删除页面级 RN 实现、`.native.ts`、`.native.tsx` 和对应 RN 样式。
- [x] 移除 RN/Expo 构建链、RN preset、RN runner 和 Android/iOS 脚本。
- [x] `tsconfig.json` 改为普通 strict TypeScript 配置，不再继承 RN 配置。
- [x] 保留必要 H5 mock/alias，保证现有共享组件可以继续构建。
- [x] 页面入口显式使用 H5 实现，避免平台文件解析结果不透明。

### P0：状态管理

- [x] 新增 `src/store/resumeWorkspaceStore.ts`。
- [x] 统一维护源简历、岗位描述、分析、匹配、优化简历、面试建议、生成状态和错误。
- [x] `resumeStore`、`jdStore` 改为 workspace Store 兼容映射，降低一次性迁移风险。
- [x] 创建页关键写入路径已迁移到 workspace Store。
- [x] 结果页加载历史结果和最新会话时同步 workspace Store。
- [x] Zustand 使用选择性订阅，避免页面订阅整个 Store。

### P0：认证生命周期

- [x] 新增 `src/store/sessionManager.ts`。
- [x] 认证 Store 不再直接依赖并清理所有业务 Store。
- [x] 登出时通过 session manager 统一清理内存状态和持久化用户数据。
- [x] 修复密码更新流程重复调用 API 问题。

### P0：公共路由与单页状态路由

- [x] 新增 `src/shared/routing/routePaths.ts`，集中维护页面路径。
- [x] 新增 `routeParams.ts`，统一参数编码和字符串、布尔值、数字读取。
- [x] 新增 `usePageRoute.ts`，统一读取 Taro 路由参数。
- [x] 新增 `useRouteTransition.ts`，统一 `navigate`、`replace`、`back`、`reset`。
- [x] 新增 `usePageStateRoute.ts`，统一单页 discriminated state 切换和 View Transition。
- [x] 首页、创建页、结果页、完成页、认证页、个人资料页已接入公共路由 Hook。
- [x] 结果页完成跳转、编辑跳转、返回首页跳转已去除直接拼接路径。
- [x] 移除 `useRouteTransition` 与 `navigation` adapter 的双重 View Transition 包装，修复登录跳转被中断及超时问题。

### P0：公共动画生命周期

- [x] 新增 `src/shared/motion/useManagedTimers.ts`，统一 timeout/interval 清理。
- [x] 新增 `useAnimationLifecycle.ts`，统一 requestAnimationFrame 生命周期和卸载清理。
- [x] 新增 `viewTransition.ts`，统一 View Transition 和 fallback 行为。
- [x] Landing 分析/结果切换已迁移到公共 View Transition。
- [x] 删除重复的 Landing 页面 View Transition 实现。
- [x] 路由动画公共层只处理页面切换，不吞并业务特有卡片 FLIP、删除动画和结果回流动画。
- [x] 公共 View Transition 统一消费 `ready`、`updateCallbackDone`、`finished` 拒绝；视觉动画失败降级，不再污染业务路由 Promise。

### P1：HTTP 与冗余封装

- [x] 请求配置、响应、错误响应字段由 `any` 收紧为 `unknown`。
- [x] 删除明显的 request method 类型强转。
- [x] 移除 `TaroRequestAdapter` 与 `ApiClient` 重复的底层请求/响应日志。
- [x] 保留 `ApiClient` 作为业务请求入口，避免破坏现有 service API。
- [x] 删除未被生产代码引用的 `src/utils/navigation.example.ts`。
- [x] `NavigationError.details` 改为 `unknown`。

## 当前待办

### P0：状态迁移收口

- [x] 将所有业务页面从 `resumeStore`、`jdStore` 兼容映射迁移到 `resumeWorkspaceStore`。
- [x] 首页、创建页、结果页已改为通过 workspace selector/action 访问业务状态，移除页面级 workspace `getState()` 读取。
- [x] 删除创建页和结果页中剩余的旧 workspace 兼容读取，页面读取使用 selector，非 React 回调使用 workspace command。
- [x] 明确 workspace Store 状态机：`idle`、`analyzing`、`matching`、`optimizing`、`interviewing`、`completed`、`failed`。
- [x] 删除旧 Store 状态源，页面只保留表单、动画和展示所需的短生命周期 local state。
- [x] 为 workspace Store 补充状态迁移、重置、并发请求失效和取消请求测试。
- [x] 完成兼容层下线评估并删除 `resumeStore/jdStore`、对应测试与过期文档。

### P0：请求层收敛

- [x] 保留 `ApiClient` 对外 API，降低 `TaroRequestAdapter` 为内部 transport。
- [x] 将请求发送、错误归一化、重试拆为职责清晰的内部函数或模块。
- [x] 删除 adapter 对外暴露而业务不需要的 interceptor 扩展面，除非确有平台适配场景。
- [x] 统一 HTTP 错误、业务错误、取消请求和超时错误语义。
- [x] 为 GET/POST/上传/取消/重试分别补最小契约测试。
- [x] 检查 `src/services/README.md`，删除与当前实现不一致的旧 API 示例。

### P0：路由复用落地

- [x] 将 `src/utils/navigation.ts` 限定为 Taro transport 和兼容逻辑，业务页面不直接依赖其细节。
- [x] 完成 Landing、首页、创建、结果、完成、认证、个人资料页面的路径常量迁移。
- [x] 统一页面参数类型，避免页面内重复解析 `router.params`。
- [x] 为 `useRouteTransition` 增加错误回退、重复点击、页面栈过深和 H5 深链接测试。
- [x] 清理生产代码中剩余的硬编码 `/pages/...` 路径。

### P0：动画复用与边界

- [x] 将创建页生成态切换中的通用 View Transition 调用迁移到 `runViewTransition`。
- [ ] 将可复用的 timeout/RAF 清理迁移到 `useAnimationLifecycle`，优先处理创建页、结果页和 Landing 页。
- [x] 保留业务专属动画在业务组件内：HomeCardDeck FLIP、结果页卡片回流、删除简历破裂动画不做万能配置化。
- [ ] 将 `navigation-transition.ts` 拆分为：路由 CSS/transition、业务卡片回流、transition suppression 三个边界。
- [x] 统一 `prefers-reduced-motion`、H5 fallback 和 transition cleanup 行为。
- [ ] 增加动画卸载、快速重复操作、异常导航和 reduced-motion 测试。

### P1：RN/Expo 残留清理

- [-] 盘点仍导入 `react-native`、`react-native-svg`、`expo-*` 的生产文件。
- [ ] 判断每个残留文件是 H5 必需、无引用旧代码，还是应改为 H5 实现。
- [ ] 删除无生产入口引用的旧 RN 组件和样式。
- [ ] 为仍使用的共享组件补 `.h5.tsx` 实现或平台适配层。
- [x] 删除 H5 aliases/mocks 中不再需要的模块。
- [-] 最终从 `package.json` 移除不再使用的 RN/Expo 依赖，并同步 lockfile；当前 package.json 已无直接依赖，lockfile 仍保留传递依赖。

### P1：组件复用治理

- [-] 按职责划分 `common`、`business`、页面私有 `components`，禁止跨页面复制同类组件。
- [-] 抽取稳定的展示组件和交互模型，不抽取只复用一次的业务 JSX。
- [x] 为上传区、岗位描述输入、生成阶段、页面头部、反馈操作建立明确 props 契约。
- [ ] 统一 loading、empty、error、disabled、success 状态展示。
- [ ] 检查组件是否同时承担数据请求、状态编排、动画和展示；超出职责时拆分 model/view。
- [ ] 删除只转发 props、没有业务价值的中间组件和重复样式包装。

### P1：测试和质量门禁

- [x] 更新 `src/pages/create/__tests__/index.test.tsx`，匹配当前 H5 单页流程、文案和 test id；补充 Taro/DOM 输入事件兼容、上传状态、分析态和取消生成断言。
- [x] 补公共路由参数、`useRouteTransition`、`usePageStateRoute` 测试。
- [x] 补 workspace Store 与 session manager 集成测试。
- [x] 修复全量 Jest 中剩余旧页面契约失败，目标为全绿。
- [x] 建立 H5 构建、Jest、`git diff --check` 的最小 CI 门禁。
- [x] 单独记录全量 `tsc` 遗留类型问题，区分平台边界问题和本次改动回归。

### P1：构建与性能

- [x] 生成 H5 bundle 分析报告，确认大体积来源。
- [ ] 评估 Three.js、RN/Expo mock、SVG 和页面级依赖的拆分收益。
- [ ] 对 Landing、首页、创建、结果页面做按路由懒加载评估。
- [ ] 记录 393px、430px、桌面宽屏首屏加载和关键交互耗时。
- [ ] 处理 bundle size warning；Browserslist 和 `webpackExports` 作为独立维护项处理。

## 推荐执行顺序

1. 完成 workspace Store 迁移，消除双写和多处状态源。
2. 收敛 HTTP transport，补错误和取消请求契约。
3. 完成路由路径、参数和页面栈行为迁移。
4. 迁移高频动画生命周期，拆分 `navigation-transition.ts`。
5. 清理 RN/Expo 残留和 H5 mock。
6. 更新创建页测试，补公共层测试，恢复全量 Jest 绿灯。
7. 进行 bundle 分析和路由级性能优化。

## 验证基线

当前已验证：

- `corepack pnpm@10.33.2 build:h5` 成功。
- API、request、首页、Landing、认证 Store、路由动画关键测试通过。
- `git diff --check` 通过。

当前已知缺口：

- 创建页测试已更新并通过：23 个测试全部通过。
- 全量 TypeScript 检查仍有历史平台类型边界错误，需后续单独治理。
- `pnpm-lock.yaml` 尚未同步，之前受 pnpm store 权限和 registry 网络限制影响。
- 共享组件仍依赖部分 H5 mock，RN/Expo 依赖尚未完全移除。

## 完成标准

- [x] 生产代码只有一个业务 workspace 状态源。
- [x] 页面不直接拼接路由路径，不直接处理底层请求细节。
- [x] 通用路由、页面状态路由、计时器、RAF、View Transition 均有公共入口。
- [x] 业务专属动画保持业务边界，不被过度抽象。
- [x] H5 构建无本次改动引入的错误。
- [x] Jest 全量通过，关键页面拥有状态、路由、异常和卸载测试。
- [-] RN/Expo 残留有明确清理结果，依赖和 lockfile 一致；仍有共享代码导入 RN/Expo 兼容层，lockfile 传递依赖未清理。
- [-] 文档、脚本、测试和目录结构反映 H5-only 架构；旧模板 README 与部分 RN 命名仍待清理。
