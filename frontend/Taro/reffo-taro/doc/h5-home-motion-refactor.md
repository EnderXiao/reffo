# H5 首页动画重构方案

## 背景

首页 H5 版本当前把业务视图、卡片堆交互、轨道滚动、FLIP 动画、拖拽视觉变量和时序常量集中在 `src/pages/index/PageView.h5.tsx`。页面文件承担了过多动画细节，导致业务逻辑和 motion 行为互相耦合，后续调整首页布局或复用卡片堆时成本较高。

Native 端暂不继续开发，本次只处理 H5。

## 目标

- 页面层只负责首页业务布局和业务事件传递。
- 卡片堆 H5 动画在 `HomeCardDeck` 组件边界内管理。
- 可测试、可复用的 motion 数学规则抽成纯函数。
- 不引入全局大型 `AnimationManager`，避免让单个对象理解所有首页 DOM 结构。
- 保持现有视觉和交互行为不变。

## 边界设计

### 页面层

`src/pages/index/PageView.h5.tsx` 只保留：

- Header、Hero、进度文案、Footer 的组合。
- 业务 props 传递。
- `HomeCardDeck` 组件调用。

### 组件层

`src/components/business/HomeCardDeck/index.h5.tsx` 负责：

- H5 卡片堆渲染。
- 卡片排序、recycling、tail enter 状态。
- 轨道 wheel/touch 滚动。
- 拖拽事件生命周期。
- 调用 motion hook 输出交互状态。

### Motion Hook

`src/components/business/HomeCardDeck/useHomeCardDeckMotion.h5.ts` 负责：

- 拖拽 ref 和状态机。
- 首次交互通知。
- FLIP 快照和 Web Animations 播放。
- 定时器和动画清理。
- CSS custom properties 写入。

### Motion 纯函数

`src/components/business/HomeCardDeck/motion.h5.ts` 负责：

- H5 motion 常量。
- clamp、modulo、interpolate。
- 卡片响应式 scale 计算。
- 拖拽 pose、纹理偏移、内容偏移、高光和阴影参数。
- 是否触发卡片切换的判断。

## 为什么不做全局 AnimationManager

全局大型 `AnimationManager` 的优点是入口集中，页面短期会非常干净。但首页卡片堆动画不是通用的淡入淡出，而是依赖卡片 DOM、`data-home-card-id`、CSS 变量、FLIP 快照、轨道高度和业务回调时机的交互系统。如果放进全局 manager，耦合只是从页面转移到 manager，长期会变成难测试、难局部修改的上帝对象。

本次采用组件域内 motion controller：页面不接触动画细节，但动画仍留在拥有 DOM 结构的业务组件边界内。

## Todo

- [x] 新增本方案文档。
- [x] 将 H5 `HomeCardDeck` 从页面文件迁移到 `components/business/HomeCardDeck/index.h5.tsx`。
- [x] 将 H5 motion 常量和纯计算抽到 `motion.h5.ts`。
- [x] 将拖拽、FLIP、CSS 变量写入和清理逻辑抽到 `useHomeCardDeckMotion.h5.ts`。
- [x] 更新 `PageView.h5.tsx`，只保留业务布局和组件调用。
- [x] 跑 H5 构建或最小可用验证。

## 验证记录

- 已运行 `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && corepack pnpm@10.33.2 build:h5`。
- 构建通过。
- 仍存在既有 Browserslist 数据过期、`webpackExports`、bundle size 超限警告，本次未处理。
- 已运行 `corepack pnpm@10.33.2 exec tsc --noEmit` 并聚焦检查本次新增/迁移文件，相关文件无新增类型错误。
- 全量 `tsc --noEmit` 仍失败在项目既有测试 mock、DOM lib 和工具示例类型问题上，本次未处理。

## 验收标准

- `PageView.h5.tsx` 不再包含卡片堆拖拽、FLIP、轨道滚动等动画细节。
- 卡片堆 H5 交互行为保持：拖拽、释放回弹、切换、尾卡淡入、轨道滚动。
- 构建或测试通过；若环境阻塞，需要记录原因。
