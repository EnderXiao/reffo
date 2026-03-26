# Taro RN 真机调试记录

更新时间：2026-03-09  
范围：`/Users/mi/code/reffo/frontend/Taro/reffo-taro` 编译为 React Native 并在 Android 真机验证

## 1. 本轮结论

- Android Debug 包已成功安装到真机。
- 设备当前可通过 `adb` 正常连接，包名为 `com.tarodemo`。
- 旧的 Metro 进程会触发首个红屏：`@/store/historyStore` 别名解析失败。
- 重启 Metro 后，该别名红屏消失，说明 `metro.config.js` 的别名修复已生效。
- 目前新的主阻塞不是原生安装，而是 **Metro/Babel 产物不一致**：
  - JS bundle 头部是开发模式：`__DEV__=true`
  - 但 `react-refresh/runtime.js` 在 bundle 内被静态编译成了生产分支：
    `if (true) require('./cjs/react-refresh-runtime.production.min.js')`
- 真机现象已经从“红屏模块找不到”变成“空白页 + JS 运行时报错”。

## 2. 已验证环境

- 仓库根目录：`/Users/mi/code/reffo`
- Taro RN 项目：`/Users/mi/code/reffo/frontend/Taro/reffo-taro`
- Android 设备：`LC550L000721`
- App 包名：`com.tarodemo`
- Node：使用 `nvm use 22`
- Java：使用 JDK 17
- Metro 端口：`8081`
- `adb reverse tcp:8081 tcp:8081` 已验证可用

## 3. 本轮执行结果

### 3.1 安装结果

以下安装命令已成功：

```bash
cd /Users/mi/code/reffo/frontend/Taro/reffo-taro/android
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew app:installDebug -PreactNativeDevServerPort=8081 --console=plain
```

成功结果：

- `:app:installDebug`
- `Installed on 1 device.`
- `BUILD SUCCESSFUL`

### 3.2 首次真机现象

首次打开 App 时，真机出现红屏：

- `development server returned response error code: 500`
- `Unable to resolve module @/store/historyStore`
- 报错来源页：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/pages/result/index.tsx`

这一问题不是最新代码本身失效，而是 **旧 Metro 进程仍在服务旧配置**。确认方式：

- `8081` 上运行的进程确实是该项目的 `react-native start`
- Metro 进程已运行约 11 小时
- 重启 Metro 后，这个红屏不再出现

### 3.3 当前真机现象

重启 Metro 后，App 不再红屏模块缺失，但首屏变为空白页。

真机 JS 日志：

```text
Error: React Refresh runtime should not be included in the production bundle.
TypeError: Cannot read property 'render' of undefined
```

对应的 `adb logcat` 过滤结果中可稳定复现：

- `ReactNativeJS: Error: React Refresh runtime should not be included in the production bundle.`
- `ReactNativeJS: TypeError: Cannot read property 'render' of undefined`

## 4. 关键证据

### 4.1 Metro 返回的 bundle 头部是开发模式

访问：

```text
http://127.0.0.1:8081/index.bundle?platform=android&dev=true&lazy=true&minify=false&app=com.tarodemo&modulesOnly=false&runModule=true
```

bundle 头部显示：

```js
__DEV__=true
process.env.NODE_ENV="development"
```

### 4.2 但 `react-refresh/runtime.js` 被编译成生产分支

同一个 dev bundle 内实际内容显示：

```js
if (true) {
  module.exports = require('./cjs/react-refresh-runtime.production.min.js');
} else {
  module.exports = require('./cjs/react-refresh-runtime.development.js');
}
```

这说明当前问题不是设备、安装、端口转发或首屏页面路由本身，而是：

- **Metro 生成的是 dev bundle**
- 但其中部分依赖被按 **production** 条件静态折叠了
- 最终导致 React Refresh runtime 与 RN dev runtime 不一致，直接把首屏打成空白页

## 5. 已尝试但未解决的动作

以下动作都已尝试，问题仍然存在：

1. 重启 Metro
2. 明确设置 `NODE_ENV=development`
3. 明确设置 `BABEL_ENV=development NODE_ENV=development`
4. 使用 `--reset-cache` 重启 Metro
5. 将 `babel.config.js` 切回 Taro 官方 preset：

```js
module.exports = {
  presets: [['taro', { framework: 'react', ts: true }]],
};
```

说明当前阻塞点更可能在：

- Metro + Babel + Taro RN transformer 的组合链路
- 或某个依赖在当前配置下被错误地静态替换了 `process.env.NODE_ENV`

## 6. 当前代码侧状态

本轮确认到的关键文件：

- `frontend/Taro/reffo-taro/metro.config.js`
  - 自定义了 `@/` -> `src` 别名解析
- `frontend/Taro/reffo-taro/src/pages/result/index.tsx`
  - 首次红屏来源页，依赖 `@/store/historyStore`
- `frontend/Taro/reffo-taro/babel.config.js`
  - 当前已恢复为：

```js
module.exports = {
  presets: [['taro', { framework: 'react', ts: true }]],
};
```

## 7. 当前判断

截至 2026-03-09，本项目 Taro -> RN 链路的状态可以明确分成两段：

1. **原生安装链路已打通**
   - Gradle 安装成功
   - App 可以真机启动
   - `adb` 调试链路可用

2. **JS 运行态仍未打通**
   - 旧 Metro 会导致 `@/` 别名红屏
   - 新 Metro 下别名问题已消失
   - 当前卡在 `react-refresh/runtime` 被错误折叠为 production 分支

## 8. 下一步建议

建议下一轮直接聚焦下面三项，不再重复安装链路：

1. 对比 Taro RN 官方模板的 `babel.config.js`、`metro.config.js`、启动方式
2. 排查是谁把 `react-refresh/runtime.js` 折叠成了 `if (true)`
   - 优先看 Metro transformer / Babel preset / RN supporter
3. 如果官方链路短期难以对齐，可临时验证：
   - 绕过 `react-refresh/runtime`
   - 或用最小化模板先跑出一个正常首页，再逐步回灌现有业务代码

## 9. 常用复现命令

### 安装 Debug 包

```bash
cd /Users/mi/code/reffo/frontend/Taro/reffo-taro/android
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew app:installDebug -PreactNativeDevServerPort=8081 --console=plain
```

### 启动 Metro

```bash
cd /Users/mi/code/reffo/frontend/Taro/reffo-taro
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
pnpm start
```

### 端口映射

```bash
adb reverse tcp:8081 tcp:8081
```

### 启动 App

```bash
adb shell am start -n com.tarodemo/.MainActivity
```

### 抓 JS 相关日志

```bash
adb logcat -c
adb shell am force-stop com.tarodemo
adb shell am start -n com.tarodemo/.MainActivity
sleep 8
adb logcat -d | rg 'ReactNativeJS|ReactNative|TypeError|ReferenceError|Error:'
```

## 10. 2026-03-09 二次验证结果

### 10.1 白屏问题已解除

本轮在以下两处做了修复后，真机白屏已消失：

- `frontend/Taro/reffo-taro/config/index.ts`
  - 改为使用 Taro 传入的 `mode` 判定开发/生产配置
  - 显式注入 `env.NODE_ENV`
- `frontend/Taro/reffo-taro/metro.transformer.js`
  - 新增本地 Metro transformer
  - 在每次转译前把 `process.env.NODE_ENV` 强制同步为 `options.dev ? 'development' : 'production'`
- `frontend/Taro/reffo-taro/metro.config.js`
  - 改为使用本地 `metro.transformer.js`

### 10.2 修复后的 bundle 证据

修复后，dev bundle 中的关键分支已恢复正常：

```js
if (false) {
  module.exports = require('./cjs/react-refresh-runtime.production.min.js');
} else {
  module.exports = require('./cjs/react-refresh-runtime.development.js');
}
```

同时，应用源码里的开发环境判断也恢复正常，例如：

```js
true && error
```

说明当前 Metro worker 已不再把开发态错误地当成生产态。

### 10.3 真机复测结果

真机重新启动后，`adb logcat` 中不再出现以下白屏阶段的错误：

- `React Refresh runtime should not be included in the production bundle`
- `TypeError: Cannot read property 'render' of undefined`

本轮启动日志关键结果：

- `ReactNativeJS: Running "taroDemo" with {"rootTag":11}`
- 未出现新的 `AndroidRuntime` / `FATAL EXCEPTION` 崩溃

### 10.4 当前状态

截至 2026-03-09 当前轮次：

- **白屏根因已修复**
- App 已能在真机打开首页
- 但首页仍存在明显样式问题：
  - 文字对比度偏低
  - 布局接近“基础可见”，尚未达到设计稿状态

因此，当前阶段的问题已经从“运行不起来”切换为“RN 样式兼容与页面还原问题”。

## 11. 2026-03-09 RN 样式兼容推进

### 11.1 首页已切换为 RN 专用实现

为避免继续依赖 `className -> CSS Module -> RN Style` 这一条不稳定链路，本轮将首页和按钮改成了 **RN 平台专用组件文件**：

- `frontend/Taro/reffo-taro/src/pages/index/index.rn.tsx`
- `frontend/Taro/reffo-taro/src/components/Button/index.rn.tsx`

处理思路：

- RN 端直接使用 `style` / `StyleSheet.create`
- 不再依赖首页原来的复杂 SCSS 动画、伪类、`gap`、`transition` 等 Web 风格写法
- 按钮文本改为显式 `Text` 渲染，避免 RN 下文本继承和容器渲染异常

### 11.2 首页真机效果

截至本轮真机验证：

- 首页不再是“近似无样式文本流”
- 顶部按钮、Logo、标语卡片、空状态、主 CTA 按钮都已正常显示
- `adb logcat` 中没有新增 RN / JS 崩溃

也就是说，**首页 RN 样式兼容已经基本可用**。

### 11.3 创建页链路已补 RN 专版

本轮还补了创建页相关的 RN 专版组件：

- `frontend/Taro/reffo-taro/src/pages/create/index.rn.tsx`
- `frontend/Taro/reffo-taro/src/components/business/ResumeUploader/index.rn.tsx`
- `frontend/Taro/reffo-taro/src/components/business/JDInput/index.rn.tsx`

这些文件已经进入 Metro bundle，可确认 RN 路由侧会加载专版实现。

### 11.4 当前剩余事项

由于当前设备限制，`adb shell input tap` 无法注入点击事件，因此本轮**无法直接自动点进创建页做真机截图验证**。

不过从代码和 bundle 状态看：

- 首页：**已真机验证通过**
- 创建页：**RN 专版已接入 bundle，待手动进入页面验证**
- 结果页及更深层业务组件：**仍建议继续按页面逐步替换为 RN 专版**

## 12. Figma 对齐基准（2026-03-09）

### 12.1 设计稿链接

当前用于 RN 页面还原的设计稿：

- `https://www.figma.com/design/BCIZ4lycFqzTNkGBpc4aXc/Reffo-Project?node-id=124-151&t=6HbEJAnX2OWO1gXB-4`

本轮已通过 Playwright 打开并确认：

- 左侧是首页卡片预览态
- 右侧是创建流程的起始页

### 12.2 首页已按设计稿继续收口

在拿到 Figma 之后，首页 RN 专版继续做了第二轮收口：

- 空状态不再显示大段“开始创建...”文案
- 改为接近设计稿的 **卡片预览堆叠**
- CTA 按钮、顶部胶囊按钮、Logo、标题、策略说明卡片都重新贴近设计稿布局

当前首页真机状态：

- 已明显接近设计稿的视觉结构
- 仍属于“工程近似还原”，不是逐像素复刻

### 12.3 下一步建议

后续继续按设计稿推进时，建议顺序：

1. 创建页
2. 结果页
3. 业务组件（上传器、JD 输入器、结果展示）

这样可以尽快把主流程页面都切换到 RN 专版实现。

## 13. 2026-03-09 自定义导航栏与首页对齐复查

### 13.1 全局替换系统导航栏

本轮已将 Taro 页面配置统一切到自定义导航：

- `frontend/Taro/reffo-taro/src/app.config.ts`
- `frontend/Taro/reffo-taro/src/pages/index/index.config.ts`
- `frontend/Taro/reffo-taro/src/pages/create/index.config.ts`
- `frontend/Taro/reffo-taro/src/pages/result/index.config.ts`

关键处理：

- 全局设置 `navigationStyle: 'custom'`
- 新增公共页面壳层：`frontend/Taro/reffo-taro/src/components/AppPageShell/index.rn.tsx`
- 同时补了 `index.native.tsx`，因为 Metro 对普通组件路径解析优先识别 `.native.tsx` / `.android.tsx`，不会把 `.rn.tsx` 当成通用组件后缀

这样现在：

- 系统原生导航栏已隐藏
- RN 页面统一通过共享壳层接入顶部区域
- 创建页、结果页都已接入同一套自定义导航模式

### 13.2 首页 RN 还原继续收口

首页 `frontend/Taro/reffo-taro/src/pages/index/index.rn.tsx` 本轮继续按 Figma 做了结构级调整：

- 顶部胶囊按钮改为左侧固定宽度 pill
- 右上角补为 GitHub 风格入口按钮
- Logo、标题、策略文案改成更贴近设计稿的层级和字重
- 移除策略白卡，改为“标签 + 粗体文案”结构
- 空状态卡片改为更接近设计稿的多卡片堆叠
- 主卡底部改成整块黑色评分区，而不是左下角小评分块
- CTA 宽度与位置重新压缩，避免被卡片挤出视口

### 13.3 结果页补了 RN 专版

为了让“全局自定义导航”在当前 APP 主流程里真正生效，本轮还补了：

- `frontend/Taro/reffo-taro/src/pages/result/index.rn.tsx`
- `frontend/Taro/reffo-taro/src/components/business/ResultDisplay/index.rn.tsx`
- `frontend/Taro/reffo-taro/src/components/business/ResultDisplay/index.native.tsx`

这样结果页在 RN 端不再完全依赖原来的 Web/CSS Module 结果展示实现。

### 13.4 真机验证产物

本轮关键产物目录：

- 初版首页对比：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-103902`
- 收口后首页截图：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-104432/device.png`
- 收口后首页对比报告：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-104432/report.html`

最新真机截图已确认：

- 首页不再白屏
- 系统导航栏已被替换
- 顶部区域、标题、策略文案、卡片堆叠、CTA 已能稳定渲染

### 13.5 当前仍可继续优化的点

对照 Figma，仍有一些剩余偏差：

- 真机顶部仍有系统级“触控轨迹/指针位置”调试叠层，会影响截图洁净度
- 首页卡片层叠角度、背卡材质与设计稿还有差异
- CTA 与底部说明文案距离视口底边仍略紧
- Logo 图形目前还是工程化近似，不是设计稿原图形

### 13.6 环境备注

本机当前直接执行 `react-native run-android` 会被 `JAVA_HOME` 卡住：

- Android Gradle Plugin 要求 Java 17
- 当前环境是 Java 11

但这次修改主要是 JS / Taro RN 视图层，因此在已有安装包的前提下，**不影响继续通过 Metro + adb 真机调试页面**。

### 13.7 首页 logo 已替换为 Figma 原始资源

本轮进一步把首页顶部的工程化占位 logo 替换成了 Figma 导出的真实 logo 资源：

- Figma logo 节点：`124:258`
- 导出资源路径：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/assets/branding/reffo-logo.png`

首页实现改动：

- `frontend/Taro/reffo-taro/src/pages/index/index.rn.tsx`
  - 由“蓝底 R + reffo 文本”改为直接渲染设计稿 logo 图片
  - 再次压缩了卡片区高度和底部 CTA 区域留白

### 13.8 最新首页真机基线

最新首页真机截图：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-105253/device.png`

最新首页 Figma 对比报告：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-105253/report.html`

当前状态：

- 首页 logo 已与 Figma 资源一致
- CTA 已完整进入视口
- 卡片高度和纵向节奏比上一版更接近设计稿

### 13.9 首页像素级交互补强（2026-03-09）

本轮按首页观感问题继续处理了三项：

1. logo 白底问题
2. 卡片左右滑动切牌与循环切换
3. 右侧公司名首字母索引与拖动切换

#### 13.9.1 logo 已处理为透明底

之前从 Figma 导出的 logo 资源本身带白底像素，本轮对其做了透明化处理：

- 资源路径：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/assets/branding/reffo-logo.png`
- 首页渲染位置：`frontend/Taro/reffo-taro/src/pages/index/index.rn.tsx`

当前真机截图中，logo 已能融入首页浅灰背景，不再出现明显白底块。

#### 13.9.2 新增 RN 卡片栈交互

新增组件：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`
- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.tsx`

实现能力：

- 首页卡片支持左右滑动切换
- 支持循环轮播（最后一张后回到第一张）
- 切牌时顶部卡片会带位移和旋转动画
- 背景卡片会维持栈式视觉层次

#### 13.9.3 新增右侧首字母索引

首页右侧新增竖向索引栏：

- 支持点按切换
- 支持按住并上下拖动切换
- 当前选中字母会有高亮指示器动画
- 卡片切换时首页“当前简历 x/n 项”会同步更新

#### 13.9.4 真机验证结果

最新首页真机截图：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-110806/device.png`

最新首页 Figma 对比报告：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-110806/report.html`

当前可确认：

- logo 透明底已生效
- 右侧索引静态布局已生效
- 首页卡片栈静态层级已生效
- 运行时没有新的 RN / JS 崩溃

#### 13.9.5 设备限制

当前这台小米设备仍禁止 adb 注入触摸事件：

- `adb shell input tap` / `swipe` 都会报 `INJECT_EVENTS permission`

因此本轮虽然已经把“切牌动效”和“索引拖动切换”写入代码，但**无法通过 adb 自动完成手势回归**，后续需要：

- 直接真机手动滑动验证，或
- 换一台允许 adb 注入触摸事件的测试机

### 13.10 首页像素收口（第二轮）

本轮继续针对首页做了更贴近设计稿的细调：

- CTA 改为更接近设计稿的窄按钮比例
- 右侧首字母索引从“白色气泡指示”改为更轻的细线 + 刻度样式
- 首页进度文案恢复为更接近设计稿的 `1/10` 起始表现
- 去掉了卡片下方额外的交互提示文案，减少对底部布局的干扰

最新真机截图：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-111316/device.png`

最新本地对比报告：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-111316/report.html`

备注：

- 本次重新走 Figma API 时遇到 `429 Rate limit exceeded`
- 因此报告使用上一轮已缓存的 `design.png` 重新生成，不影响本地比对结果

### 13.11 首页交互状态机与索引跟手修正

针对上一轮遗留问题，本轮继续处理：

- 切牌时前卡不再简单飞出屏幕
- 引入了“前卡进入后栈、后卡前推、第五张补位”的卡片状态机
- 右侧索引的指示线在拖动时改为实时跟随手指位置
- 右侧索引的字母/横线布局重新统一到了固定宽度和同一条参考线

核心实现位置：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮最新真机截图：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-112519/device.png`

本轮最新本地对比报告：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/index-empty-state/20260309-112519/report.html`

说明：

- 由于设备仍禁止 adb 注入滑动事件，因此“循环切牌”和“索引拖动”仍需手动真机触发验证
- 但从代码层面，上一轮“仅第一张卡有处理”的实现已经替换为更完整的状态机切换逻辑

## 14. 2026-03-09 Metro 端口切换到 8083

本轮已把 RN 调试端口从 `8081` 切到 `8083`，避免与其他本地服务冲突。

涉及修改：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/package.json`
- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/android/gradle.properties`
- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/android/app/build.gradle`
- `/Users/mi/code/reffo/.codex/skills/reffo-taro-rn-android-compare/scripts/run_rn_android.sh`

当前运行方式应改为：

- Metro：`pnpm start`
- Android 安装/运行：`pnpm android`
- 端口反向代理：`adb reverse tcp:8083 tcp:8083`

说明：

- `package.json` 的 `start` / `android` 脚本已默认带 `8083`
- Android 侧 `react_native_dev_server_port` 和 `react_native_inspector_proxy_port` 也已改为 `8083`
- 若手机里已安装的是旧的 debug 包，重新安装后才会完全切到新的默认端口

## 15. 2026-03-09 首页滑动卡顿优化与设备手势限制结论

本轮针对首页卡片切换“发卡顿”的问题继续收口，重点做了两件事：

- 把卡片栈过渡从 `left/top` 动画改成了 `transform + opacity`
- 把关键动画统一切到 `useNativeDriver: true`

核心修改位置：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮实现细节：

- 卡片深度布局仍沿用原有堆叠参数，但实际过渡改为 `translateX / translateY / rotate / scale`
- 顶部卡片拖拽态新增轻微抬起与缩放反馈，减轻“生硬平移”感
- 切牌判定阈值从较重的手势要求下调，当前更容易触发左右切换
- 卡片回弹、索引指示线、切牌过渡都已切到原生驱动路径
- `useMemo` 相关的依赖告警已同步收口

本地校验：

- 已执行：`npx eslint frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx --ext .tsx`
- 结果：通过（无 error / warning）

端口与进程现状：

- 旧的 Reffo Metro（`8081`）已停止，当前 `8081` 已释放
- 当前 `8083` 仍被另一个项目占用：`/Users/mi/code/taro-mirn/asp-service-yrn`
- 因此 Reffo 若要真正运行在 `8083`，需要先停掉该进程，再在 `frontend/Taro/reffo-taro` 下重新执行 `pnpm start`
- 当前本机 `java -version` 仍是 `11.0.28`，若要重新 build/install Android debug 包让默认端口彻底生效，还需要先切到 JDK 17

真机手势限制结论：

- 当前这台小米/HyperOS 设备仍禁止 `adb shell input swipe/tap`
- 报错本质是 Android 的 `INJECT_EVENTS` 权限受限，不是页面代码本身禁止滑动
- 优先建议在开发者选项中打开“USB 调试（安全设置）”后重新插拔设备再试
- 若系统仍拦截，当前可用的替代验证方式是：真机手动滑动、点击右侧字母索引切换、或引入 `scrcpy` / `Maestro` / `Appium` 等外部工具

关于视频：

- 当前环境不适合像人工一样直接逐帧“看视频”
- 但可以处理录屏：把 mp4/gif 抽成关键帧后做逐帧比对与问题标注
- 如果后续需要，我可以直接接你的录屏文件，帮你抽帧并定位哪一帧开始出现错位/卡顿

## 16. 2026-03-09 首页滑动手感第二轮收口

本轮重点不再只是“动画参数微调”，而是把首页顶部卡片的手势链路切到了更接近原生的实现。

涉及修改：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`
- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/app.ts`

本轮核心调整：

- 顶部卡片从 `PanResponder` 改为 `react-native-gesture-handler` 的 `PanGestureHandler`
- 应用根节点增加 `GestureHandlerRootView`，确保原生手势链路可用
- 卡片拖拽过程改为由 `translationX` 直接驱动 `Animated.Value`，减少 JS 参与拖拽跟手
- 切牌时记录手指松开瞬间的 `releaseOffsetX`，过渡动画从“当前拖拽位置”接续，而不是先回正再切换
- 后方卡片栈在拖拽过程中增加前推预览，切牌前就能看到后卡轻微抬升，手感更接近设计稿预期
- 原先切换完成后的 `pulseDeck` 已去掉，避免新顶卡在切牌结束后再出现一次额外的横向归位感

本轮预期改善：

- 左右拖拽时跟手更紧，不容易出现“拖得动但松手顿一下”的感觉
- 触发切牌后，首卡过渡更连续，不会明显先吸回初始位再播放入栈动画
- 后续卡片在手势期间会参与反馈，整体更像一整个卡片栈而不是单张卡片

本地校验：

- 已执行：`npx eslint src/components/business/HomeCardDeck/index.native.tsx src/app.ts --ext .tsx,.ts`
- 结果：通过

说明：

- 由于当前真机仍禁止 adb 注入滑动，本轮无法自动化复验真实手感
- 下一步建议直接在真机上手动左右慢拖、快速甩动各试一轮，再反馈“跟手 / 释放 / 入栈”三个阶段里哪一段仍不自然

## 17. 2026-03-09 设备 adb swipe 恢复与卡片栈第三轮修正

设备侧：

- 在打开“小米/HyperOS 开发者选项 -> USB 调试（安全设置）”后，本机已可正常执行 `adb shell input swipe`
- 已在设备 `LC550L000721` 上重新验证，并对 `com.tarodemo/.MainActivity` 做了实际滑动注入

本轮继续修正的首页问题：

- 解决前卡回到底部时仍短暂压在栈顶的问题：切牌阶段的层级改为按 `toDepth` 排序与赋值
- 解决“像是刷新第一张卡片内容”的观感：切牌阶段前卡不再继续保持首卡视觉优先级，而是立即切换为 stack 样式；第二张卡按目标深度前推为首卡
- 解决深层卡片黑底无样式的问题：首页卡片改为从预设主题池里按 `id` 稳定选取样式，包含 `primaryColor / stackColor / texture`，分配后会保持不变

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`
- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/pages/index/index.rn.tsx`

说明：

- 当前已经可以继续通过 adb 做滑动验证；后续若你给我一个固定页面状态，我可以直接用 adb 反复触发滑动并配合截图做回归

## 18. 2026-03-09 首页启动失败根因与修复

本轮用户本地在 `frontend/Taro/reffo-taro` 执行 `pnpm dev:rn` 并选择 Android 后，首页启动报错，根因有两类：

- `PanGestureHandler` 参数组合非法：同时使用了 `minDist` 与 `failOffsetY`
- `@ant-design/react-native` 的 `Portal.Host` 在当前 RN 版本下调用了 `TopViewEventEmitter.removeListener`，而运行时对象没有该方法

已修复：

- 删除首页卡片顶层 `PanGestureHandler` 的 `minDist`，仅保留 `activeOffsetX` 与 `failOffsetY`
- 在 `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/app.ts` 增加 `DeviceEventEmitter.removeListener` 兼容 shim，保证旧调用链能正常卸载监听

涉及位置：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`
- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/app.ts`

本地校验：

- 已执行：`npx eslint src/app.ts src/components/business/HomeCardDeck/index.native.tsx --ext .ts,.tsx`
- 结果：通过

## 19. 2026-03-09 使用 8083 运行并实测首页滑卡

本轮已把 Reffo Taro RN 的运行端口切到 `8083`，并完成真机实测。

本轮补充项：

- `frontend/Taro/reffo-taro/package.json` 的 `dev:rn` 已显式追加 `--port 8083`
- `frontend/Taro/reffo-taro/config/index.ts` 已补充 `rn.port = 8083`（但实际让 Taro runner 生效的是 CLI `--port 8083`）
- 真机已配置端口转发：`tcp:8081 -> tcp:8083`、`tcp:8082 -> tcp:8083`、`tcp:8083 -> tcp:8083`

运行结果：

- `pnpm dev:rn` 已成功在 `8083` 启动 Metro
- 重新打开 `com.tarodemo/.MainActivity` 后，Metro 成功完成 `./index.js` bundle
- 通过 adb 在卡片中段执行横向滑动，首页卡片已确认能实际切换

本轮截图样本：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083/before-precise.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083/after-precise-1.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083/after-precise-2.png`

观察到的结果：

- 连续两次左滑后，卡片内容确实从“华为”切到“小米”，再切到“携程”
- 卡片主题样式在切换后保持稳定，不再出现深层卡片纯黑无纹理的情况
- 当前仍有一个额外现象：顶部“当前简历 x/10 项”的数字并非按连续顺序变化，样本中出现了 `6/10 -> 5/10 -> 2/10`，说明进度文案与视觉卡片顺序之间还存在映射偏差

说明：

- 这次已经验证“端口 8083 可运行 + adb 可自动滑动 + 卡片可切换”三件事都成立
- 但“滑动动效是否足够丝滑”仍然更适合结合录屏或人工观感继续做最后一轮收口

## 20. 2026-03-09 首页滑卡改为更接近小红书式“实体交接”

本轮目标：不是“刷新第一张卡片内容”，而是让第二张卡真实前顶为第一张，被滑走的首卡尽快让出层级并回到底部卡栈。

参考：

- 小红书参考链接已读，页面标题为“这个跟手滑动让选择更真实 - 小红书”
- 目标动效特征总结为：首卡真实离场、第二张卡放大接管、后栈 4~5 张卡持续存活、拖动时后栈同步前推

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮核心修改：

- `VISIBLE_CARDS` 从 `4` 提到 `5`，让后栈参与感更强
- `renderModels` 的 `key` 改为按卡片实体稳定生成：`card-${id}`，避免切牌时被 React 当成“卸载后重建”
- 顶卡左滑时改成 `0 -> 5` 的后移映射；第二张改成 `1 -> 0` 前顶；第五张由 `5 -> 4` 补入尾部
- 所有卡片统一保留 `PanGestureHandler` 外层，仅通过 `enabled` 控制顶卡手势，避免首卡在不同状态下切换根节点类型
- 切牌过渡从 `timing + bezier` 改为 `spring`，让卡片交接更接近参考视频的 handoff 节奏
- 顶卡离场动画增加“两段式轨迹”：先沿用户甩出的方向继续外抛，再落回尾栈
- 第二张卡（以及后栈前推卡）增加 overshoot，形成“放大接管”感，而不是瞬间刷新内容
- 深层卡的 `opacity / dim / text opacity` 全面调亮，后栈不再像黑色占位片
- 卡片底色改为按目标深度决定：`depth <= 1` 使用 `primaryColor`，其余用 `stackColor`，让即将接管的第二张卡更像真实前景卡

真机验证：

- 端口继续使用 `8083`
- 设备：`LC550L000721`
- 清空日志并重新启动 `com.tarodemo/.MainActivity` 后，当前会话日志只看到 `Running "taroDemo"`，未复现新的红屏报错
- 重新截图并连续两次 adb 左滑后，首页卡片已稳定从：
  - 小米 -> 携程 -> 滴滴
- 本轮截图样本：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round2/before.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round2/after-1.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round2/after-2.png`

当前观察结果：

- 静态结果上，第二张卡已经按真实卡片顺序接管为第一张，而不是刷新首卡内容
- 后栈现在是持续存在的彩色实体卡片，不再出现纯黑深层占位
- 旧首卡回到底栈的层级问题已通过 `toDepth` 主导排序显著缓解
- 动效是否完全达到参考视频那种“极致丝滑”还需要录屏逐帧继续收口，但当前结构已从“内容替换”切到“实体交接”模型

遗留项：

- 右侧索引条的几何对齐和拖动跟手还可以继续收口
- 顶部“当前简历 x/10 项”的进度映射问题本轮未处理
- 如果下一轮要继续对齐参考视频，建议直接基于这版做录屏抽帧，对比“首卡离场前 120~180ms”的层级与位移节奏

## 21. 2026-03-09 首页滑卡第四轮：去掉右滑回退，压缩尾栈残影

本轮针对两个明确问题继续收口：

1. 被划走的首卡在回收到卡片栈末尾时停留过久，过渡中会短暂出现 6 张卡片
2. 右滑会触发逆向检索，与左滑的正向循环逻辑不一致

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮核心调整：

- 将 `depth 5` 从“可见尾栈卡”改成真正的隐藏层：`opacity = 0`，文本透明度也归零
- 顶卡离场动画从原先会落在可见尾栈，改为更快地 `shrink + fade out`，避免尾部多停一张卡
- 切牌完成时长从上一轮的 `spring` 改回固定时长 `timing`，解决过渡尾部拖太长导致第六张卡残留几秒的问题
- `resolveSwipeDirection` 改为无论左滑还是右滑，只要达到阈值都返回同一个“前进一步”的结果
- `renderModels` 删除逆向分支，首页卡片只按正向顺序循环，不再支持右滑回退到上一张

真机验证：

- 设备：`LC550L000721`
- 端口：`8083`
- 本轮启动后日志仅看到 `Running "taroDemo"` 与 gesture handler 初始化信息，未出现新的 JS 报错

本轮截图样本：

- 顺序验证：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round3/before2.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round3/after-left2.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round3/after-right2.png`
- 过渡中间帧：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round3/mid-60ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round3/mid-200ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round3/mid-450ms.png`

本轮观察结果：

- 左滑：`2/10` 的紫卡前进到 `3/10` 的蓝卡
- 随后右滑：继续前进到 `4/10` 的橙卡，而不是回退到上一张
- 过渡 60ms 截图中，旧首卡已被甩向左侧并开始离场，不再以“第六张尾栈卡”的方式长时间停留在右后方
- 200ms 与 450ms 截图里，页面已稳定回到 5 张可见卡片，没有再看到明显的第六张尾栈残影

说明：

- 这一轮已经把“右滑回退”彻底改成了“右滑同样前进”
- “尾栈第六张停留过久”的主要问题也已经显著缓解；如果下一轮还要继续抠得更像参考视频，可以继续收“离场卡片缩小曲线”和“二号卡前顶的加速度”

## 22. 2026-03-09 首页滑卡第五轮：补 3D 跟手透视，并继续压离场曲线

本轮新增目标：

- 当用户拖动卡片但未触发切换时，首卡要出现更明显的透视 / 3D 跟手效果
- 被划走卡片回收到尾栈前，要更早缩小并更早淡出，继续贴近参考链接的视觉节奏

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮核心修改：

- 新增 `CARD_DRAG_PERSPECTIVE`，在顶卡拖拽、后栈前推和首卡离场时统一引入透视参数
- 顶卡 `buildDraggableCardStyle` 中加入更明确的 `rotateY + rotateX + scale`，让拖动过程从“平面平移”变成“卡面倾斜跟手”
- 顶卡内部再加入一层内容视差：纹理、正文和底部得分面板在拖拽时做轻微不同步位移，让 3D 跟手更明显
- 后栈预览卡 `buildPreviewCardStyle` 也加入轻量 `rotateY`，让顶卡拖动时后栈有更立体的联动感
- 顶卡离场动画中加入 `rotateY`，同时继续提前 `opacity` 与 `scale` 的衰减，让旧首卡在动画前 1/3 内就更明显缩小并隐去
- 进一步加大离场卡首段外抛位移，减少它还以接近首卡尺寸停留在视口边缘的时间

真机验证：

- 设备：`LC550L000721`
- 端口：`8083`
- 本轮重启后日志仍只看到 `Running "taroDemo"` 与 gesture handler 初始化信息，未出现新的 JS 报错

本轮截图样本：

- 切牌离场关键帧：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round4/swipe-80ms-v2.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round4/swipe-220ms-v2.png`
- 非切牌拖拽尝试样本：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round4/before-drag3.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round4/drag-mid3.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round4/drag-end3.png`

本轮观察结果：

- `swipe-80ms-v2` 中，旧首卡已经比上一轮更早缩小、淡出，并带一点透视倾斜后离场
- `swipe-220ms-v2` 中，页面已稳定回到新首卡 + 后栈的正常结构，没有明显尾部残留
- 代码层面，未切牌拖拽已经加入 `perspective / rotateY / rotateX / scale` 组合
- 但对“未切牌中间态”的自动化验证仍不理想：
  - `adb shell input swipe` 即使极小位移也容易被系统识别成一次完整 swipe
  - `adb shell input motionevent DOWN/MOVE/UP` 虽然设备支持，但没有稳定反映到当前 RN 手势链路的中间画面里
- 因此这项 3D 跟手效果更适合直接手工真机观察，自动截图目前更适合验证“切牌离场”而不是“未切牌停留”

说明：

- 这一轮已经把 3D 跟手透视补进实现里，也继续把离场卡往“小红书式缩小消失”方向推进了一步
- 如果下一轮继续收，我建议先做两个细节之一：
  - 首卡拖拽时的内容层视差（文字与底部得分面板和卡面做轻微不同步位移）
  - 二号卡前顶接管时的加速度和 overshoot 节奏

## 23. 2026-03-09 8083 真机恢复 + 首页竖拖激活 + 二号卡接管继续收口

本轮先处理运行环境，再继续首页卡片栈收口。

### 23.1 红屏根因确认

现象：

- 真机打开首页时出现红屏：`Loading JS failed: 717:138: Invalid expression encountered`
- 红屏提示里的 buffer size 约为 `2345636`

排查结果：

- 设备实际吃到的不是当前 `8083` Metro 的 debug bundle，而是 APK 内打包的本地 bundle：
  - `/Users/mi/code/reffo/frontend/Taro/reffo-taro/android/app/src/main/assets/index.android.bundle`
- 这份本地 bundle 体积约 `2.2M`，与当前 Metro 提供的 debug bundle（约 `9.9M`）明显不同
- 因此之前真机上看到的“竖拖没有 3D 效果”，有一部分其实是因为设备没有跑到最新的首页卡片代码

本轮环境修复动作：

- 使用 `Node 22.19.0` 重启 `pnpm dev:rn`
- 通过交互式 TTY 保活 Metro，避免后台无终端时 `TerminalReporter` 因 `process.stdin.setRawMode` 失败而退出
- 使用 `JDK 17` 重新执行：
  - `pnpm exec react-native run-android --deviceId LC550L000721 --port 8083 --no-packager`
- 重新安装 debug 包后，真机已正常连接到 `8083`

环境验证：

- Metro 状态：`http://127.0.0.1:8083/status -> packager-status:running`
- 真机恢复截图：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round5-retry/after-reinstall.png`

### 23.2 首页卡片栈本轮代码调整

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

核心修改：

- 将顶卡手势激活条件从同时依赖 `activeOffsetX / activeOffsetY` 改为单一 `minDist={4}`
  - 目的：允许“横向或纵向任一方向”都能激活顶卡拖拽，不再要求两个方向同时满足阈值
- 继续加大顶卡竖向 3D 跟手幅度：
  - 更大的 `translateY`
  - 更大的 `rotateX`
  - 更明显的竖向缩放回弹
- 顶卡内容视差继续增强：
  - 纹理层、正文层、底部分数层在 `dragY` 下的位移进一步拉开
- 后栈预览卡继续强化：
  - depth 1 卡在拖拽中更早抬升、更早放大
  - 竖向拖拽时也加入轻量纵向位移 / 缩放联动
- `fromDepth === 1 -> toDepth === 0` 的接管动画继续提前：
  - 更早前冲
  - 更高的放大峰值
  - 更明显的前顶 overshoot 再回落

### 23.3 真机中途截帧

本轮用于验证的截图：

- 竖拖 / 横拖中途帧（第一轮修复后）：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round5-retry/mid-gesture-round2/vertical-mid.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round5-retry/mid-gesture-round2/horizontal-mid.png`
- 真机重装并重新拉起后的首页：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round5-retry/after-reinstall.png`

观察结果：

- 横向中途帧里，顶卡位移、旋转以及二号卡抬升仍然清晰可见
- 竖向链路此前确实没有被稳定激活，切到 `minDist={4}` 后，逻辑上已经从“X/Y 双门槛”改成“任一方向激活”
- 自动化中途截图对“纵向 3D 透视”仍然不如横向那么直观，原因是：
  - 竖向透视本质更依赖人眼对卡面俯仰的连续感知
  - 单帧截图能看到位置变化，但对 3D 倾角的体感不如真机连贯拖动明显
- 二号卡的接管节奏本轮继续向“更早抬头、更早成为主视觉”推进，但还可以再收一轮

### 23.4 当前结论

- 8083 真机环境已经恢复可用，首页不再红屏
- 本轮真正修掉了一个关键前提问题：之前真机并没有稳定跑在最新 Metro debug bundle 上
- 首页卡片栈的竖拖激活逻辑已经改成更符合预期的“任一方向激活”模型
- 二号卡前顶接管的 overshoot 也继续增强了一档

### 23.5 下一轮建议

建议继续只盯首页，优先再做两件事：

1. 继续收竖拖体感
   - 重点看真机手指上下拖动时，首卡俯仰是否还需要更夸张一点
   - 如果用户肉眼仍觉得不明显，可再加大 `rotateX / 内容视差 / 顶卡阴影层次`
2. 继续收二号卡接管节奏
   - 优先看“首卡离手后 80~180ms”区间
   - 目标是让二号卡更早成为主视觉，而不是等首卡几乎完全退场后才接上

## 24. 2026-03-09 首页滑卡第六轮：修预览卡延迟缩小，并继续压 release 卡顿

本轮继续只聚焦首页卡片栈，目标有两个：

1. 修复切换结束后，除首卡外的后栈卡片过一会儿会再缩小一档的问题
2. 继续压缩“松手后切换动画”的明显卡顿，重点处理 release 第一帧的姿态跳变

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

### 24.1 根因与修复：后栈卡片延迟缩小

根因：

- 预览卡 idle 样式里曾经叠了两层 `scale`
- 切换动画结束时卡片先落到 `to.scale`
- 随后退出 transition，再切回 idle 预览样式时又变成另一套更小的等效缩放值
- 用户肉眼看到的就是“切换结束后正常停住，过一小会儿后栈又突然缩小”

修复：

- 将预览卡缩放改成单一 `scale` 曲线，不再叠乘两层缩放
- 这样 transition 终点与 idle 终态一致，后栈不会再发生二次缩小跳变

真机稳定帧：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round6/after-450ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round6/after-1500ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round6/after-2500ms.png`

观察结果：

- 这三张图里，后栈尺寸保持一致，没有再出现“450ms 正常，1~2 秒后又缩小一档”的现象

### 24.2 本轮继续优化：release 姿态连续性

本轮在“卡片松手进入切换”的交界处继续做了一轮优化：

- 新增 release pose 计算：
  - 顶卡会根据 `releaseOffsetX / releaseOffsetY` 计算松手瞬间的真实 `left / top / rotate / rotateX / rotateY / scale`
  - 后栈卡也会基于同样的 release 偏移计算当前瞬时姿态
- `buildAnimatedCardStyle` 不再从静态 `DEPTH_LAYOUTS` 直接起跳，而是从 release pose 起跳
- 这样能减少“松手那一刻先 snap 一下，再开始切换动画”的割裂感

相关实现位置：

- release pose 计算：
  - `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`
    - `interpolateNumber`
    - `previewDepthMotion`
    - `getPreviewPose`
    - `getDraggablePose`
- 切换动画接入 release pose：
  - `buildAnimatedCardStyle`
- 手势释放时把 `translationY` 也带进 transition：
  - `startTransition(direction, translationX, translationY)`

### 24.3 本轮继续优化：减少切换收尾重渲染抖动

本轮还做了两项收尾优化：

- 使用 `unstable_batchedUpdates` 将切换完成时的 `commitIndex + setTransition(null)` 合并提交
- 将父层 `onCardChange` 从“切换完成回调里立即同步触发”改成“首页完成一帧渲染后再通知父层”
  - 目的：避免在 transition 刚结束时，首页整页内容与卡片栈一起同步重渲染，造成肉眼可见顿挫

### 24.4 真机关键帧验证

设备：

- `LC550L000721`

端口：

- `8083`

本轮关键帧样本：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round7/commit-check-v2/before.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round7/commit-check-v2/060ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round7/commit-check-v2/180ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round7/commit-check-v2/360ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round7/commit-check-v2/1160ms.png`

观察结果：

- `060ms`：旧首卡已开始离场，二号卡开始接管主视觉，release 第一帧比之前更连贯
- `180ms`：二号卡已成为主卡，结构稳定，没有明显看到“先卡一下再切过去”的跳闪
- `360ms` 与 `1160ms`：卡栈稳定停在新主卡状态，没有再回弹回上一张，也没有后栈延迟缩小

### 24.5 当前结论

- “后栈延迟缩小”这一问题已经修到根上
- “切换结束明显卡顿”本轮通过 release pose 连续化、批量状态提交、延后一帧通知父层，继续压缩了一轮
- 从当前关键帧看，release 过渡已经比上一版连贯不少

### 24.6 下一轮建议

下一轮仍建议只盯首页，并继续做两件事：

1. 收 `60~180ms` 区间
   - 重点看旧首卡离场加速度是否还可以更自然
   - 重点看二号卡是否还能再早一点成为主视觉
2. 收二号卡接管后的 settle
   - 让 `180~320ms` 的 settle 更柔和一点，减少“已经接管但仍有轻微机械感”的观感

## 25. 2026-03-09 首页滑卡第七轮：二号卡更早接管，settle 更柔

本轮继续只盯首页卡片栈，目标是把 `60~180ms` 的二号卡接管再收一轮：

- 让旧首卡更快退出主视觉
- 让二号卡更早接管，但接管后的 settle 不要过于机械

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮主要调整：

- 新增 `SWIPE_TRANSITION_DURATION = 300`
- 将整体切换 easing 从更硬的强 ease-out，调成更均衡的 `bezier(0.18, 0.88, 0.24, 1)`
- 旧首卡离场：
  - 更早淡出
  - 更早缩小
  - 更早拉开横向位移
- 二号卡接管：
  - 峰值前顶更早出现
  - overshoot 幅度略收一点
  - settle 区间更柔和，减少“顶上来之后再机械回摆”的感觉

真机验证设备：

- `LC550L000721`
- `8083`

说明：

- 本轮 adb 自动化中，使用更靠近卡片中心的 swipe 起点更容易稳定触发切牌
- 稳定触发的一组关键帧如下：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round8/commit-check-center/060ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round8/commit-check-center/180ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round8/commit-check-center/360ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round8/commit-check-center/1160ms.png`

本轮观察结果：

- `060ms`：旧首卡已经开始退出主视觉，但不会像前几版那样显得突兀
- `180ms`：二号卡已稳定接管为第一张，整体更干净
- `360ms` 与 `1160ms`：新首卡停稳，后栈尺寸稳定，settle 比上一轮更柔和

当前结论：

- 这轮属于“继续像小红书靠拢”的微调，不是结构性重写
- 当前卡片切换在真机上已经明显比前几轮顺，尤其是 release 后的前 200ms

下一轮建议：

- 如果继续抠，我建议开始从“离场卡的投影 / 阴影层次”入手
- 或者反过来收“二号卡成为主卡后的压手感”，让它落稳时更有重量感

## 26. 2026-03-09 首页滑卡第八轮：补地面阴影，强化压手感

本轮继续只做首页卡片栈的细节收口，目标是：

- 让切牌时更有“压下去 / 带重量”的感觉
- 让二号卡接管后的 settle 再柔半档，不要过分机械

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮主要修改：

- 在卡片栈底部新增一层跟随主卡的 `ground shadow`
  - 空闲拖拽时，阴影会跟随主卡横移、压扁与展开
  - 切换 transition 中，阴影会先被压薄、再慢慢回稳，强化“重量感”
- 二号卡接管的 settle 再柔半档：
  - 前顶 overshoot 再收小一点
  - 旋转回摆再弱一点
  - scale 峰值也更克制一点

真机验证：

- 设备：`LC550L000721`
- 端口：`8083`
- 稳定触发切牌的验证样本：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round9/trigger-verify/after.png`

观察结果：

- 切牌仍可正常触发，没有因这轮阴影/settle 调整而破坏手势
- 新增地面阴影后，卡栈底部的“压住桌面”的感觉更明显
- settle 更柔后，新主卡落稳时没有再显得太弹或太飘

说明：

- 这轮更多是“体感优化”，自动截图能看出阴影更重，但真实效果仍以真机滑动观感更明显
- 如果继续下一轮，建议开始从“离场卡的残影节奏”或“卡片右侧索引与卡片切换的联动感”两个方向里二选一

## 27. 2026-03-09 首页滑卡第九轮：继续压离场卡残影节奏

本轮只做一个目标：

- 让旧首卡在切牌后更早缩小并更早隐去，减少尾部残影感，继续向小红书式“逐渐缩小后消失”靠拢

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮调整点：

- 继续压缩 `fromDepth === 0 -> toDepth === 5` 这一段离场曲线
- 旧首卡：
  - opacity 更早下降到接近 0
  - scale 更早缩小到小尺寸
  - 横向位移更快拉开
  - 纵向抬升略增，让它更像“甩出去并缩掉”，而不是长时间停在边缘
- 这轮没有再动二号卡主接管逻辑，避免同时引入两个变量

真机关键帧：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round10/exit-check/050ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round10/exit-check/120ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round10/exit-check/200ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round10/exit-check/320ms.png`

本轮观察结果：

- `050ms`：旧首卡已被明显甩出主视觉区域，但仍保留一小段过渡信息
- `120ms`：旧首卡已经基本退出主视觉，残影感比上一轮更轻
- `200ms`：新首卡已经完全主导页面，旧首卡不再以大面积残影停留在右侧
- 这一轮更接近“快速缩小 -> 快速隐去 -> 回到底栈”的预期节奏

当前结论：

- 离场卡残影节奏已经继续收紧了一轮
- 旧首卡不再长时间以接近完整卡面尺寸停在边缘区域
- 这部分如果还要继续抠，下一步更适合做“离场透明度与缩放的更细微相位差”而不是再单纯拉大位移

## 28. 2026-03-09 首页滑卡第十轮：离场卡进一步做“先缩后隐”

本轮继续只收一个点：

- 让旧首卡离场时更像“先缩、后隐”，而不是单纯靠位移把它甩出去

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮调整：

- 继续细化 `fromDepth === 0 -> toDepth === 5` 的相位差
- 缩放曲线：
  - 更早开始收缩
  - 更快缩到小尺寸
- 透明度曲线：
  - 相比缩放略滞后一点
  - 让用户先感知到卡片在缩，再感知它在消失
- 同时把横向脱离速度再拉快一点，减少卡片停留在边缘的面积感

真机关键帧：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round11/exit-check/050ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round11/exit-check/120ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round11/exit-check/200ms.png`
- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round11/exit-check/320ms.png`

本轮观察：

- `050ms`：旧首卡仍可感知，但体量已经更小，边缘残影感继续减弱
- `120ms`：旧首卡基本退出主视觉区，页面更快交给新主卡
- `200ms`：新主卡完全接管，旧首卡不再以大面积卡面停留

当前结论：

- 离场卡的“先缩后隐”已经比上一轮更明确
- 尾部残影继续减轻，方向正确
- 这部分如果还要继续抠，下一步更适合做更细的透明度节拍，而不是再一味拉大位移

## 29. 2026-03-09 首页滑卡第十一轮：把离场卡从“瞬隐”拉回到可感知离场

本轮背景：

- 用户反馈当前观感像是“卡片滑动结束后瞬间消失，然后卡片栈刷新”
- 这说明上一轮把离场卡的缩放 / 透明度 / 位移节奏压得过头了

本轮目标：

- 把离场卡从“几乎瞬隐”拉回到“仍能感知到一小段离场过程”
- 仍然保持尾部残影不要停留太久

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮调整：

- 离场 opacity：延后进入快速衰减区，让旧首卡在 release 后仍保留一个更可见的阶段
- 离场 scale：从过快缩小回调一档，避免肉眼像“直接没了”
- 离场位移：适度放缓首段横向脱离，减少“刚松手就完全抽离出画面”的感觉
- 整体 transition duration 从 300 拉回 320，并把 easing 调得更柔一点

真机验证：

- 稳定触发切牌前后：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round12/trigger-verify/before.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round12/trigger-verify/after.png`

本轮结论：

- 当前版本已经不再是“滑动结束后瞬间消失”的方向
- 离场卡会重新保留一小段可感知的离场过程，但仍比更早的版本干净
- 这轮属于把上一轮过猛的收口往回拉半步，方向是正确的


## 30. 2026-03-09 首页滑卡第十二轮：修离场层级与收尾闪帧

本轮目标：

- 修“滑动结束后像瞬间离场”的观感
- 修“切换结束停一下，再突然瞬闪”的分段感

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

本轮判断到的两个更核心根因：

1. 离场卡的层级被过早降到目标栈位
   - 当前 transition 中，卡片排序与 `zIndex` 都按 `toDepth` 在算
   - 这会导致 `fromDepth: 0 -> toDepth: 5` 的旧首卡在动画刚开始时就被压到后面
   - 用户肉眼就会感觉成“旧卡像没演就没了，然后直接看到下一张”

2. transition 结束后一帧，新首卡还会吃到旧的 drag 值
   - 如果先 `setTransition(null)`，但 `dragX / dragY` 下一帧才清零
   - 新首卡在 transition 退出后的第一帧会短暂继承旧手势姿态
   - 这会形成用户感知到的“停一下 -> 瞬闪 / 回跳一下”

本轮修改：

- 新增 `resolveCardLayer`
  - transition 期间将离场卡固定在最高层
  - 二号卡接管保持次高层
  - 其他卡仍按目标 depth 排序
- 重写 `fromDepth === 0 && toDepth === 5` 的离场末段
  - 不再让离场卡可见地回到尾栈位置
  - 改成继续向滑出方向缩小、抬升并淡出
  - 目标是让“回到底部”只发生在数据层，不发生在用户肉眼可见的动画层
- 调整 transition 完成回调顺序
  - 先清 `dragX / dragY`
  - 再 batched 提交 `commitIndex + setTransition(null)`
  - 最后下一帧只重置 `transitionProgress`
  - 避免新首卡首帧继承旧拖拽姿态

本轮验证：

- 设备：`LC550L000721`
- 端口：`8083`
- 重新探测稳定 adb 滑动坐标：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/coord-probe-after-fix/c3/before.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/coord-probe-after-fix/c3/after.png`
- 关键帧样本：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/exit-check-after-fix/before.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/exit-check-after-fix/100ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/exit-check-after-fix/220ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/exit-check-after-fix/380ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/exit-check-after-fix/720ms.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/exit-check-after-fix/1220ms.png`

本轮观察：

- adb 稳定滑动仍可触发切牌，说明这轮没有把首页手势改坏
- `100ms` 时旧首卡仍可见，说明这次不是“一松手就直接切成下一张”
- `220ms` 时新首卡已接管页面，离场节奏相比之前更像“滑出并缩掉”，而不是“在尾栈里停一下再消失”
- 由于 adb 截帧分辨率和时序精度有限，最终是否彻底消掉“停顿 / 瞬闪”，仍需要以你手上真机的连续观感为准

当前结论：

- 这轮修的是结构问题，不只是继续抠数值
- 如果用户仍然觉得“结束后先停一下”，下一轮优先看：
  1. `onCardChange` 触发后父层是否在切牌结束点引入了额外重渲染
  2. 二号卡 `1 -> 0` 的接管 overshoot 是否还略偏硬，导致主观上像分段


## 31. 2026-03-09 首页滑卡第十三轮：隔离离场卡 overlay，切断父层收尾重渲染

本轮背景：

- 用户反馈“体感和修改前几乎一样”
- 说明仅靠调离场曲线和层级还不够，问题更可能来自切牌结束点的换树与父层重渲染

这轮进一步处理了两条链路：

1. 父层收尾重渲染
   - `index.rn.tsx` 中原来给 `HomeCardDeck` 的 `onCardChange` 是 inline 函数
   - 每次首页进度文案更新，`HomeCardDeck` 也会跟着一起吃一次新的 props 和重渲染
   - 这很可能叠加在切牌结束点，形成用户看到的“停一下”

2. 离场卡仍和主卡栈共用一次换树
   - 即便把离场卡层级调高，只要它还在主栈 `renderModels` 里
   - transition 结束时依旧会跟着主栈一起被替换掉
   - 这类“同一批节点一起换树”的感觉很容易被用户感知成“闪一下 / 刷新一下”

本轮修改：

- 首页父层：
  - 将 `onCardChange` 改成稳定的 `useCallback`
  - 同 index 时不重复 `setActiveCardIndex`
- `HomeCardDeck`：
  - 使用 `memo(HomeCardDeck)`，尽量隔离首页进度文案更新带来的 deck 重渲染
  - 将 `onCardChange` 通知轻微延后 `72ms`，把父层更新挪出切牌最敏感的收尾窗口
  - 只给首卡保留 `PanGestureHandler`，其余卡片不再包禁用手势层
  - 新增 `exitingModel` overlay：
    - 将 `fromDepth: 0 -> toDepth: 5` 的旧首卡从主栈里拆出来单独渲染
    - 让它不再和新首卡 / 后栈共用同一次主栈换树
    - 目标是把“旧卡离场”和“新栈接管”做成视觉上更连续的两个层次

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`
- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/pages/index/index.rn.tsx`

真机处理：

- 设备：`LC550L000721`
- 端口：`8083`
- 本轮修改后已对 `com.tarodemo` 执行 `force-stop + relaunch`，确保不是旧 bundle 残留
- 切牌前后样本：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/post-exit-overlay/before.png`
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/swipe-test-8083-round13/post-exit-overlay/after.png`

本轮结论：

- 这轮修的是“动画结束那一下”的结构问题，而不是继续单纯调 easing 数值
- 如果这一轮之后用户仍然觉得“像没触发离场动画”，下一步就不再停留在现有 transition 体系上，而是直接把首卡离场和后栈接管拆成两套独立 progress 来做


## 32. 2026-03-09 首页滑卡第十四轮：从截图采样切到真机帧时序，确认卡顿是长帧不是错觉

本轮背景：

- 用户明确指出 `adb screencap` 的时间粒度太粗，看不出“停顿 / 卡顿”
- 这个判断是对的：截图只能看关键姿态，无法证明是否丢帧

因此本轮方法改成：

- 直接使用 `adb shell dumpsys gfxinfo com.tarodemo` 做真机帧时序统计
- 在首页热态下执行连续 5 次稳定 swipe，再读取 percentile / input latency / view 数量

### 32.1 发现的问题不再是单纯曲线问题，而是真有长帧

在此前版本的热态 5 次 swipe 中，得到：

- `50th percentile: 23ms`
- `90th percentile: 38ms`
- `95th percentile: 65ms`
- `99th percentile: 77ms`
- `Number High input latency: 901`

这说明：

- 用户感受到的“停一下”不是错觉，确实存在较明显的长帧
- GPU 不是主要瓶颈，问题更像是输入链路与视图树过重叠加造成的 UI pipeline 卡顿

### 32.2 本轮优化方向：先减视图树和后栈动画负担

针对首页卡片栈，本轮做了两类减负：

1. 后栈卡片简化渲染
   - 只保留前两张卡的完整纹理、正文与分数面板
   - 更深的后栈卡改为简化卡面，避免每张卡都携带完整纹理 + 文本层

2. 预览阶段简化 3D
   - 只有第二张卡保留更完整的透视跟随
   - 更深层卡不再参与完整的 `rotateX / rotateY / perspective` 组合
   - 目的是把拖拽和 release 阶段的每帧 RenderNode 更新量压下来

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

### 32.3 真机结果

本轮热态 5 次 swipe 的 `gfxinfo`：

- 样本：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/perf-round4-simplified-backstack/gfxinfo.txt`
- 指标：
  - `50th percentile: 16ms`
  - `90th percentile: 27ms`
  - `95th percentile: 53ms`
  - `99th percentile: 65ms`
  - `Janky frames (legacy): 36 (7.41%)`
  - `Number High input latency: 970`

视图树变化：

- 之前样本：约 `211 views`
- 本轮样本：`138 views`
- RenderNode 占用也明显下降到 `345.96 kB`

### 32.4 当前结论

- 这轮已经从“靠截图猜观感”切换成“靠真实帧时序收口”
- 数据证明首页卡顿确实存在，也证明后栈减负后性能已有明显改善
- 还没有完全到位，但方向是对的：
  - 首页卡片栈不是单纯 easing 不对
  - 根因之一是后栈渲染与透视层级过重

### 32.5 下一步建议

如果用户主观上仍觉得 release 末段还有顿挫，下一轮继续从两个方向里优先选一个：

1. 再减 second card 之外的动态层
   - 让真正参与运动的卡只剩 2 张半
2. 彻底拆开“首卡离场 progress”和“后栈接管 progress”
   - 不再让同一个 `transitionProgress` 同时驱动所有层


## 33. 2026-03-09 首页滑卡第十五轮：针对“松手开始卡一下”改成 release 两段式，并去掉每帧 JS 回传

本轮背景：

- 用户把顿挫点进一步定位到：
  - 手拖动过程没那么明显
  - 到达切牌阈值后，松手开始那一瞬间最卡
- 这说明问题更像是：
  - 手势结束 → JS 处理 release → transition 正式起跑
  - 这三者之间存在一个体感上的空档

### 33.1 本轮处理

本轮不再继续单纯调曲线，而是把 release 改成两段：

1. `release kickoff`
   - 用户松手且命中切牌阈值后
   - 先让当前拖拽值 `dragX / dragY` 继续沿释放方向走一小段原生 `timing`
   - 目的是让用户手离开后，卡片立刻继续动，而不是先静一拍

2. `transition takeover`
   - 在这小段 kickoff 后，再接入原本的卡栈切换 transition
   - transition 会从一个非零 `initialProgress` 起步，避免又从 0 重新“起车”

### 33.2 这轮还修掉了一个隐藏性能坑

最初为了做 kickoff 连续性，我给 `dragX / dragY` 加了 `addListener`，想从 JS 侧拿到最新位移。

但这会导致：

- 手指拖动时，每帧都把原生驱动值回传给 JS
- 这反而会加重输入链路负担

因此本轮已去掉这层每帧 JS listener，改为：

- 直接使用 `PanGestureHandler` 在 release 事件里给出的 `translationX / translationY`
- 只在松手瞬间做一次 kickoff 计算

### 33.3 真机热态结果

样本：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/perf-round6-kickoff-no-listeners/gfxinfo.txt`

热态首页连续 5 次 swipe 后：

- `50th percentile: 15ms`
- `90th percentile: 27ms`
- `95th percentile: 53ms`
- `99th percentile: 61ms`
- `Janky frames (legacy): 34 (7.59%)`
- `Number High input latency: 894`

对比意义：

- 去掉每帧 JS listener 后，指标相比监听版重新回落
- 说明“release 连续性”可以做，但不能靠每帧把 native value 回传到 JS

### 33.4 当前结论

- 用户抱怨的“松手开始那一下”是一个独立问题，不只是后栈过重
- 本轮已经把这一下改成：
  - 先原生续一小段 release 动量
  - 再接切牌 transition
- 并且避免了为此引入新的每帧 JS 回传开销

### 33.5 下一步

如果用户主观上仍然觉得 release 起步还有迟滞，下一轮优先：

1. 继续缩短 JS 参与 release 的时机
   - 例如把切牌判定前置到 threshold armed 状态，而不是完全等到 `END`
2. 把二号卡接管从当前总 transition 中再拆开
   - 只让旧首卡在 release 的前半段先独自完成离场


## 34. 2026-03-09 首页滑卡第十六轮：实验性改为“松手直接续滑”，不在 release 起点切整套 transition

本轮背景：

- 用户继续反馈：顿挫最明显的时刻仍然是“达到阈值后松手开始”
- 这说明 release 起点本身很可能仍然在发生一段用户可感知的切换开销

因此本轮做了一个更结构性的实验：

### 34.1 实验目标

- 不再在松手那一刻切进整套 `transition` 体系
- 改成：
  - 顶卡继续沿当前 `dragX / dragY` 原生续滑离场
  - 二号卡在 idle / drag 阶段就更明显地前顶接管
  - 等顶卡离场完成后，再 `commitIndex`

换句话说，本轮希望把：

- “松手 → React state 切到 transition → 开始动画”

改成：

- “松手 → 当前拖拽值直接继续动 → 动画结束后再更新索引”

### 34.2 本轮主要修改

- 删除 release 起点对 `startTransition` 的依赖
- 新增 `animateDeckAdvance`
  - 顶卡在当前 `dragX / dragY` 基础上继续原生 `timing` 到离场位置
  - 动画完成后再 `commitIndex`
- 二号卡 preview style 改得更激进
  - 让它在拖拽和 release 的前半段就更像已经在接管
- 更深层卡仍保持相对轻量，避免再次把后栈拖重

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

### 34.3 真机结果

首页已恢复正常，无红屏：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/recovery-round8b/home.png`

热态 5 次 swipe 样本：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/perf-round8c-release-direct/gfxinfo.txt`

当前统计：

- `50th percentile: 18ms`
- `90th percentile: 27ms`
- `95th percentile: 31ms`
- `99th percentile: 81ms`
- `Janky frames (legacy): 156 (30.71%)`

### 34.4 当前判断

- 这轮的方向是“更贴近用户主观手感”的结构实验，而不是更漂亮的静态关键帧
- 从统计上看结果是混合的：
  - 中位与 95 分位不差
  - 但 99 分位与 legacy jank 不理想
- 因此这轮是否值得保留，最终要以用户真机主观感受为准

### 34.5 下一步决策点

如果用户主观上觉得：

- release 起步明显更顺了
  - 就沿这个方向继续压尾部长帧与收尾刷新
- release 起步仍然明显卡
  - 下一轮就继续回退这条实验分支，改做 threshold armed / 预热切牌状态


## 35. 2026-03-09 首页滑卡第十七轮：尾部 residual settle，减少 commitIndex 后的栈瞬时归位

本轮背景：

- 用户确认当前 release 起步“确实更顺了”
- 下一步重点转向尾部长帧 / 尾部卡栈接管的观感

### 35.1 已建立的可回退提交点

为了避免实验分叉过多难以回退，本轮开始前已做快照：

- 根仓文档快照：`7f7398b` `feat: snapshot rn card swipe release experiment`
- `reffo-taro` 子仓源码快照：`5e71e2e` `feat: snapshot rn home card swipe experiment`

这意味着：

- 当前工作区如果继续往前实验，随时可以退回到“用户主观上已经确认更顺”的那一版基础上重做尾部优化

### 35.2 本轮尾部优化思路

当前 release-direct 方案里，顶卡离场结束后会直接：

- `dragX / dragY` 回零
- `commitIndex`
- 新栈瞬时归位

这容易让尾部出现一种“虽然起步顺了，但最后还是有一个归位感”的问题。

因此本轮改成：

- 顶卡离场完成后，不把新栈立即硬归位
- 而是给新栈一个很小的 residual 偏移：
  - `dragX = settleX`
  - `dragY = settleY`
- 再用原生 `spring` 把它回正

目标是让：

- commit 后的新栈接管更像“落稳”
- 而不是“替换完成后一下子回到标准位”

### 35.3 真机热态结果

样本：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/perf-round9-tail-settle/gfxinfo.txt`

热态首页连续 5 次 swipe：

- `50th percentile: 15ms`
- `90th percentile: 26ms`
- `95th percentile: 34ms`
- `99th percentile: 73ms`
- `Janky frames (legacy): 106 (20.15%)`
- `Number High input latency: 1050`

### 35.4 当前判断

- 这轮属于“尾部观感优化”的实验，不是 release 起步优化
- 数据层面是混合结果：
  - `90th / 95th` 还可以
  - 但 `99th` 仍然偏高
- 因此是否保留这一版 residual settle，仍建议以用户主观观感优先


## 36. 2026-03-09 首页滑卡第十八轮：补上 release-direct 尾段层级交接，避免二号卡“视觉上前顶但层级未接管”

本轮背景：

- 用户最新反馈：收尾时卡片层级像是没有改变
- 这与当前 `release-direct` 分支的实现是吻合的：
  - 顶卡 release 阶段不再进入原先的 `transition`
  - 但渲染排序仍然主要依赖 `resolveCardLayer(model, Boolean(transition))`
  - 当 `transition === null` 时，层级顺序仍是固定的 `60 - fromDepth`
- 结果就是：
  - 二号卡虽然在 preview transform 上已经明显放大、前顶
  - 但真实 z-order 直到 `commitIndex` 之前都没有明确接管
  - 这会让收尾阶段看起来像“卡面在变，但层级没交棒”

### 36.1 本轮修改

在 `HomeCardDeck` 中新增了一个非常轻量的 release handoff 机制：

- 新增 `releaseHandoffActive`
- 在 `animateDeckAdvance` 开始后约 `48%` 的时刻触发一次 handoff timer
- handoff 触发后：
  - 二号卡（`fromDepth === 1`）层级抬高到最前
  - 正在离场的顶卡（`fromDepth === 0`）降到它下面，但仍高于更深层卡
- 这样可以保持：
  - release 起步仍沿用当前更顺的 direct timing 路径
  - 尾段再做一次明确的视觉交棒，而不是重新回到整套 transition

涉及文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

### 36.2 真机验证

本轮产物目录：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-handoff-20260309-212131`

其中包括：

- 首页启动截图：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-handoff-20260309-212131/launch.png`
- 连续 5 次 swipe 后截图：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-handoff-20260309-212131/post-swipes.png`
- 首轮含冷启动 `gfxinfo`：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-handoff-20260309-212131/gfxinfo.txt`
- 热态 `gfxinfo`：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-handoff-20260309-212131/gfxinfo-warm.txt`

热态 5 次 swipe 样本：

- `50th percentile: 17ms`
- `90th percentile: 34ms`
- `95th percentile: 48ms`
- `99th percentile: 85ms`
- `Janky frames (legacy): 98 (22.27%)`
- `Number High input latency: 878`

### 36.3 当前判断

- 这轮修复的重点是“层级交棒是否明确”，不是继续压 release 起步卡顿
- 从实现上看，之前用户指出的问题是成立的；本轮已经补上一个显式 handoff
- 从性能统计看，这轮没有把首页打挂，但热态数据也没有优于之前的最佳样本
- 因此这轮建议以用户主观观感为准：
  - 如果你现在观察到二号卡在收尾阶段终于真正接管到了顶层，这轮可以保留
  - 如果层级问题解决了但尾部手感又变差，就继续在 handoff 时机和权重上微调


## 37. 2026-03-09 首页滑卡第十九轮：离场卡未真正沉到底层，继续压低尾段 z-order

本轮背景：

- 用户补充指出：问题不只是“层级交接不明显”
- 更准确地说，是离场卡片在切换完成、回落到卡牌栈底的阶段，层级仍然偏高
- 也就是：它虽然已经不该再挡住主卡，但视觉上仍像悬在栈面之上

### 37.1 修正思路

上一轮 handoff 里，我只做了：

- 二号卡升到最前
- 离场顶卡降到二号卡下面

但这还不够。

如果目标是“离场卡缩小后沉入栈底再消失”，那么它不应该只是低于二号卡，而应该低于整叠可见卡。

因此本轮继续收紧为：

- handoff 激活后：
  - 二号卡仍保持最高层
  - 离场顶卡直接降到所有预览卡片之下
- 同时取消离场卡在尾段继续占据“可拖拽顶卡”的身份
  - 避免它在 release 后还沿用顶卡的交互/渲染特性

### 37.2 具体修改

文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

调整内容：

- `releaseHandoffActive` 时，离场卡 `fromDepth === 0` 的层级从 `61` 下调为 `52`
  - 低于当前可见栈中最底部卡片的默认层级
- `canDrag` 改为：
  - 仅在 `!transition && !releaseHandoffActive && model.fromDepth === 0` 时成立
- handoff 阶段保留头两张卡的 rasterize / hardware texture
  - 但不再把离场卡当作“仍在顶部的主交互卡”

### 37.3 真机产物

本轮验证目录：

- `/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-bottom-20260309-214352`

其中包括：

- 尾段录屏：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-bottom-20260309-214352/reffo_tail.mp4`
- swipe 后截图：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-tail-bottom-20260309-214352/post-swipe.png`

### 37.4 当前判断

- 这一轮是对上一轮 handoff 的继续修正，不是新的动效路线
- 核心目标只有一个：
  - 让离场卡在尾段真正“沉到整叠卡下面”，而不是只在逻辑上不再是第一张
- 下一步仍建议用户主观复核：
  - 如果此时离场卡终于不会再压在栈面之上，就继续微调 timing
  - 如果仍然像浮在上面，则要继续排查 Android 侧实际绘制层是否还受 wrapper / elevation 影响


## 38. 2026-03-09 首页滑卡第二十轮：从“数值层级”转向“真实绘制层”，给外层 wrapper 和 Android elevation 同步分层

本轮背景：

- 用户确认上一轮后，层级依然不对
- 这说明问题很可能不只是 `resolveCardLayer` 返回值偏高或偏低
- 更可能的原因是：
  - 当前每张卡真正作为兄弟节点参与绘制排序的，其实是外层 wrapper
  - 而之前我主要修改的是内层 `Animated.View` 的 `zIndex`
  - 同时 `cardBase` 在 Android 上一直带固定 `elevation: 7`
- 因此即使逻辑层级数值变了，真实绘制顺序也未必跟着变

### 38.1 本轮修正

文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

这轮不再只改内层卡片，而是改成“外内两层一起分层”：

- 新增 `resolveCardElevation`
  - 让 Android 的真实 elevation 与视觉层级同步
- 新增 `styles.cardLayer`
  - 每张卡外层 wrapper 也参与 `zIndex / elevation`
- `renderCardModel` 里：
  - 外层 wrapper 使用 `style={[styles.cardLayer, {zIndex, elevation}]}`
  - 内层 `Animated.View` 也同步覆盖 `elevation`
- handoff 阶段仍保留：
  - 二号卡高层级 / 高 elevation
  - 离场卡低层级 / 低 elevation

### 38.2 当前判断

- 如果上一轮的问题真的是 Android 实际绘制层没有改掉，那么这一轮比单纯改 `zIndex` 更接近根因
- 这轮仍然没有改 release-direct 的总体路线，只是把层级控制从“逻辑排序”下沉到“真实绘制层”

### 38.3 产物

- 冒烟截图：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-layer-wrapper-20260309-220543.png`


## 39. 2026-03-09 首页滑卡第二十一轮：去掉“旧卡回弹后再切下一张”，改为独立 tail-exit 卡

本轮背景：

- 用户最新反馈非常明确：
  - 动作结束后，卡片会先明显回弹
  - 看起来像“先回到第一张卡片位置，再切到下一张”
- 这说明当前问题已经不再是层级优先，而是 release 收尾阶段仍然在复用同一组 `dragX / dragY`

### 39.1 根因判断

当前 `release-direct` 路径里：

- 顶卡离场使用 `dragX / dragY` 继续原生 timing
- 动画结束后，又用同一组 `dragX / dragY` 去驱动新的牌堆归位/接管

这会产生一个很典型的视觉问题：

- 旧卡还没彻底从渲染责任里分离出去
- 但共享的拖拽值已经被重置
- 最终观感就会变成：
  - 旧卡像被拉回顶位一下
  - 然后新卡再接管

### 39.2 本轮修改

文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

这轮不再让旧卡和新牌堆共享同一段收尾值，而是：

- 新增 `TailExitCard` 独立状态
- 新增 `tailExitProgress`
- release 完成后：
  - 先把当前卡片冻结为一张独立的 `tailExitCard`
  - 同时把 `activeIndex` 切到下一张
  - 下一张牌堆立即使用静态姿态稳定接管
  - 旧卡再用单独的 `tailExitProgress` 继续淡出/缩出
- 当 `tailExitCard` 存在时：
  - 顶卡与后栈不再继续吃旧的 `dragX / dragY`
  - 从而避免“旧卡回弹带动新栈”的问题

关键代码位点：

- `TailExitCard`：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:62`
- 状态与进度值：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1293`
- 清理函数：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1411`
- release 收尾改造：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1453`
- 独立离场卡渲染：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1692`
- 牌堆在 tail-exit 期间禁用旧拖拽值：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1775`

### 39.3 当前验证状态

本轮已完成：

- bundle 可正常从 `8083` 返回
- 代码侧未发现 `HomeCardDeck` 相关的 TypeScript 编译报错
- 录屏产物目录：`/Users/mi/code/reffo/.artifacts/reffo-rn-android/home-card-no-rebound-20260309-222048`

但二次真机观感验证被当前设备锁屏层打断：

- 当前 `uiautomator dump` 结果显示前台仍被系统 keyguard 覆盖
- 因此这轮是否彻底消除“回弹后再切下一张”，仍需用户解锁后主观复核


## 40. 2026-03-10 首页滑卡第二十二轮：设备已解锁，但 adb swipe 仍未触发 RN 卡片手势层

本轮背景：

- 设备已解锁，恢复真机验证
- 首页可正常拉起，截图正常：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/rebound-check-20260310-092750-home.png`
- 但在继续验证“是否仍然先回弹再切下一张”时，发现自动化链路本身还有一个关键限制

### 40.1 现象

针对卡面中部坐标执行 adb swipe：

- 轨迹：大致从 `(170, 520)` 到 `(500, 520)`
- 连拍序列：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/rebound-seq-card-20260310-092954/contact_sheet.png`
- 结果：
  - 序列帧几乎没有任何卡片位移
  - `gfxinfo` 统计里 `Total frames rendered: 0`

这说明：

- 当前 `adb shell input swipe` / 现有脚本链路，并没有真正触发到首页卡片的 RN `PanGestureHandler`
- 因而无法用它直接判断这轮“去回弹”结构是否已经完全生效

### 40.2 结论

- 自动化验证层面，此刻最大的瓶颈已经不是截图频率，而是 adb swipe 本身没有命中 RN 手势路径
- 代码层面，本轮仍保留第二十一轮的核心改动：
  - 旧卡与新牌堆已拆成独立 `tailExitCard`
  - 不再共享同一组 `dragX / dragY` 收尾值
- 但最终是否消除了用户主观观察到的“先回顶再切下一张”，当前仍需要人工真机滑动复核


## 41. 2026-03-10 首页滑卡第二十三轮：切牌与离场彻底解耦，松手先切下一张，旧卡再独立退场

本轮背景：

- 用户进一步指出：当前最明显的问题发生在松手瞬间
- 具体观感是：
  - 卡片会先发生一次“回到第一张位置”的返回
  - 返回到位后，层级/切牌才发生变化

### 41.1 根因判断

结合当前实现，问题更接近于：

- 旧卡真正的离场与 `activeIndex` 切换顺序仍然是串行的
- 也就是：
  - 先让旧卡沿 release 路径继续跑完
  - 然后才创建 `tailExitCard` / 更新下一张
- 这会让用户感知成：
  - 旧卡先处理自己的收尾
  - 新卡接管明显偏晚

### 41.2 本轮修正

文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

这轮把 release 流程改成：

- 一旦确认触发切牌：
  - 立即 `commitIndex(nextIndex)`
  - 旧卡立刻冻结成一张独立的 `tailExitCard`
  - 新牌堆马上以下一张为顶卡稳定接管
  - 旧卡再通过 `tailExitProgress` 单独离场
- 这样层级/切牌变化会先发生，不再等待旧卡收尾动画完成后再切

同时补了一个方向保险：

- 即使是“位移不大但速度够高”的快速左甩
- 也会保留左侧离场方向，不再默认按正向数值退到右边

### 41.3 代码位点

- release 解耦主逻辑：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1453`
- 速度触发时的离场方向归一化：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1577`

### 41.4 当前状态

- 首页可正常拉起：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/rebound-fix-20260310-093744.png`
- 针对 `HomeCardDeck` 的定向 TypeScript 检查未新增该文件报错
- 最终是否完全消除了用户主观观察到的“先回顶再切下一张”，仍需要用户手动在真机上复核


## 42. 2026-03-10 首页滑卡第二十四轮：松手先降第一张层级，下一帧再切 activeIndex

本轮背景：

- 用户明确提出一个更贴近现象的判断：
  - 问题可能不在尾段淡出本身
  - 而在于松手时第一张卡的层级没有立刻降低
- 也就是：
  - 用户松手后，旧顶卡仍然先以“第一张”的身份留在最上层
  - 等它回到位或收尾后，层级变化才发生

### 42.1 本轮修正

文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

这轮改成两段顺序：

1. `on release` 当帧：
   - 立即 `setReleaseHandoffActive(true)`
   - 先把当前第一张卡的层级降下去
2. 下一帧：
   - 再创建 `tailExitCard`
   - 再 `commitIndex(nextIndex)`
   - 然后清零 `dragX / dragY`
   - 再让旧卡独立退场

目标是让用户主观感受到：

- 松手 → 层级先变
- 然后才进入切牌与旧卡收尾

而不是：

- 松手 → 旧卡还顶在最上层处理自己的返回/收尾
- 然后层级才变化

### 42.2 代码位点

- release handoff 优先：`/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx:1453`

### 42.3 当前状态

- 针对 `HomeCardDeck` 的定向 TypeScript 检查未新增该文件报错
- 首页可正常启动：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/release-handoff-first-20260310-094307.png`
- 该轮是否命中用户主观观察到的“松手先降层级”问题，仍需用户手动在真机上复核


## 43. 2026-03-10 首页滑卡第二十五轮：去掉拖拽透明衰减，尾段改为可见缩小离场

本轮背景：

- 用户确认层级问题已经对了
- 新的两个收口点变得明确：
  1. 收尾动画感消失了
  2. 现在卡片被拖到将要离场时会逐渐变透明，但期望是“不透明、触发后缩小离场”

### 43.1 本轮修正

文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

这轮做了三件事：

- 顶卡拖拽阶段不再根据 `dragX` 做透明度衰减
  - 直接保持顶卡不透明
- `fromDepth === 0 -> toDepth === 5` 的离场动画不再以透明度衰减为主
  - 改成以位移 + 缩放为主
  - 让旧卡更像缩入卡栈尾部，而不是发白/淡出
- `tailExitCard` 的渲染也取消内容透明度渐隐
  - 同时把它的层级抬到“低于新顶卡，但高于更深层卡”的区间，尽量让缩小收尾重新可见

### 43.2 当前状态

- 首页可正常启动：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/shrink-exit-20260310-094939.png`
- 针对 `HomeCardDeck` 的定向 TypeScript 检查未新增该文件报错
- 最终观感仍需用户手动在真机上复核：
  - 松手后旧卡是否重新出现清晰的“缩小离场”
  - 拖拽到阈值附近时是否不再出现渐隐


## 44. 2026-03-10 首页滑卡第二十六轮：只收缩小离场节奏，改成单调收缩并略微延长时长

本轮背景：

- 用户反馈：旧卡已经开始缩小离场，但节奏不太对
- 这一轮因此不再碰层级与切牌顺序，只微调缩小离场本身的 keyframe

### 44.1 本轮修正

文件：

- `/Users/mi/code/reffo/frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/index.native.tsx`

调整点：

- 旧卡 `0 -> 5` 的离场缩放改成单调收缩：
  - 避免中段缩小后尾段又回弹变大
- 离场位移节奏调整为：
  - 先顺着手势带出一点
  - 再更连续地收进卡栈尾部
- `tailExitCard` 的收尾时长从 `RELEASE_SWIPE_DURATION` 分离出来
  - 新增 `TAIL_EXIT_DURATION = 280`
  - easing 改成更偏平滑收拢的曲线

### 44.2 当前状态

- 首页可正常启动：
  - `/Users/mi/code/reffo/.artifacts/reffo-rn-android/shrink-rhythm-20260310-095307.png`
- 针对 `HomeCardDeck` 的定向 TypeScript 检查未新增该文件报错
- 下一步需要用户真机主观确认：
  - 旧卡缩小离场是否更顺
  - 是否还存在“不自然的尾段节拍”
