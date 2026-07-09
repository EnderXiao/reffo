# Reffo Taro RN 设置指南

当前目录已经收敛为 React Native 优先的 Taro 项目，目标是先稳定支持 Android 与 iOS 双端运行。

## 环境要求

```bash
# Node
nvm use 22

# 安装依赖
pnpm install
```

- Android: 本地 JDK 需使用 Java 17，且 Android SDK 路径已配置。
- RN 相关脚本会优先切到本机可用的 Node 22；若未安装，可通过 `REFFO_NODE22_BIN` 指定 Node 22 的 `bin` 目录。
- `pnpm android` 会优先尝试使用本机可用的 Java 17。
- iOS: 需要已安装 Xcode、CocoaPods，并执行过 `pnpm podInstall`。

## 启动方式

RN 开发依赖两条进程同时运行：

```bash
# 终端 1: Taro RN 构建监听
pnpm dev:rn

# 终端 2: Metro
pnpm start
```

然后在第三个终端启动目标平台：

```bash
# iOS
pnpm ios

# Android
pnpm android
```

说明：

- Metro 端口统一使用 `8083`。
- `pnpm ios` 与 `pnpm android` 都应连接到同一个 `pnpm start` 进程。
- `pnpm ios` 与 `pnpm android` 均使用 `--no-packager`，不会再额外尝试拉起新的 Metro 窗口。
- 如果遇到 Android 启动了但代码没有更新，先确认没有残留的 `android/app/src/main/assets/index.android.bundle` 预构建产物。

## 当前目录约定

页面目录统一采用同一模式：

```text
src/pages/<page>/
  index.tsx
  PageView.tsx
  usePageModel.ts
  styles.ts
  index.config.ts
```

组件目录遵循以下规则：

- RN-only 组件默认使用普通 `index.tsx`
- 不再新增 `.rn.tsx`
- 只有将来确实需要重新支持多平台分发时，才引入 `.native.tsx`

## 关键目录

```text
src/
  components/
    AppPageShell/
    Button/
    business/
      HomeCardDeck/
      ResultDisplay/
  pages/
    index/
    create/
    result/
  store/
  services/
  utils/
```

## 开发建议

- 页面逻辑尽量放在 `usePageModel.ts`，避免整页组件同时堆状态、视图和样式。
- `styles.ts` 统一使用 React Native `StyleSheet`，减少 RN 页面继续混入旧的 Web SCSS 实现。
- 新增组件前优先确认是否能复用 `AppPageShell`、`Button`、`ResultDisplay` 等已有 RN 组件。
