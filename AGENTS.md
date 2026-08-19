# Reffo Agent Development Manual

本手册面向接手本仓库的开发 agent。开始任务前先阅读本文件；进入 `frontend/Taro/reffo-taro` 时还需要阅读该目录下的 `AGENTS.md`。

## 项目概览

Reffo 是一个 AI 简历优化应用，核心目标是基于源简历和目标 JD 生成一岗一简历。仓库同时保留 MVP Web 版本、Bun 后端服务，以及当前重点开发的 Taro 多端前端。

主要子项目：

- `backend/`: Bun + Elysia + TypeScript 后端，提供 AI Agent 编排 API。
- `frontend/Web/`: React + Vite 的轻量 MVP Web 前端。
- `frontend/Taro/reffo-taro/`: Taro 4 + React + TypeScript 前端，目标覆盖 H5/Web、RN Android/iOS 和小程序平台；这是当前主要产品前端。
- `.codex/skills/`: 本仓库沉淀的 agent skill，例如 Taro RN Android 真机对比。
- `.artifacts/`: 本地验证、截图、设计稿和调试产物。不要把临时产物纳入提交。

## 技术栈

### 后端

- Runtime: Bun 1.0+
- Framework: Elysia
- Language: TypeScript, strict mode
- API docs: `@elysiajs/swagger`
- CORS: `@elysiajs/cors`
- AI SDK: OpenAI SDK，当前用于兼容 DeepSeek API
- Path alias: `@/* -> backend/src/*`

### MVP Web 前端

- React 18
- TypeScript
- Vite 5
- 纯 CSS，无 UI 库
- 本地数据存储在 `localStorage`

### Taro 前端

- Taro 4.1.9
- React 18
- TypeScript, strict mode
- Sass/SCSS
- Zustand 5
- React Native 0.73 / Expo 50 相关能力
- Three.js 0.185，用于高性能平台的高级视觉效果
- Jest + Testing Library
- Path alias: `@/* -> frontend/Taro/reffo-taro/src/*`

## 目录结构

```text
reffo/
├── backend/
│   ├── src/
│   │   ├── agents/          # AI Agent: 简历分析、JD 匹配、简历生成
│   │   ├── config/          # 环境变量与配置校验
│   │   ├── repositories/    # 数据访问与持久化封装
│   │   ├── routes/          # Elysia API 路由
│   │   ├── types/           # 后端领域类型
│   │   ├── index.ts         # 服务入口
│   │   └── test.ts          # Bun 测试脚本入口
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── Web/
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── App.css
│   │   │   ├── index.css
│   │   │   └── main.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── Taro/reffo-taro/
│       ├── config/          # Taro 多端构建配置
│       ├── src/
│       │   ├── assets/      # 品牌和业务静态资源
│       │   ├── components/  # 基础组件、通用组件、业务组件
│       │   ├── pages/       # 页面，按页面聚合 model/constants/components
│       │   ├── services/    # API client 与业务接口
│       │   ├── store/       # Zustand 状态管理
│       │   ├── styles/      # reset、tokens、variables
│       │   ├── types/       # 前端共享类型
│       │   ├── utils/       # 平台、请求、存储、视觉能力等工具
│       │   ├── app.config.ts
│       │   ├── app.scss
│       │   └── app.ts
│       ├── android/
│       ├── ios/
│       ├── package.json
│       └── AGENTS.md
└── README.md
```

## 常用命令

### 后端

```bash
cd backend
bun install
bun run dev
bun run test
```

后端默认地址是 `http://localhost:3000`，Swagger 文档是 `http://localhost:3000/swagger`。

### MVP Web

```bash
cd frontend/Web
bun install
bun run dev
bun run build
```

### Taro 前端

优先使用 Node 22：

```bash
cd frontend/Taro/reffo-taro
source ~/.nvm/nvm.sh && nvm use 22
corepack pnpm@10.33.2 build:h5
corepack pnpm@10.33.2 test
```

常用脚本：

- `corepack pnpm@10.33.2 build:h5`: 构建 H5/Web。
- `corepack pnpm@10.33.2 serve:h5`: 本地预览 `dist`，端口 `4173`；该脚本依赖 `npx http-server`，网络受限时可能失败。
- `corepack pnpm@10.33.2 build:rn`: 构建 RN bundle。
- `corepack pnpm@10.33.2 start`: 启动 RN Metro，端口 `8083`。
- `corepack pnpm@10.33.2 android`: 安装/运行 Android app。
- `corepack pnpm@10.33.2 test`: 运行 Jest。

构建 H5 时当前可能出现既有警告，例如 Browserslist 数据过期、bundle size 超限、`webpackExports`。除非任务要求，不要把这些警告当作当前改动的失败。

### 本地服务管理

- 启动或重启前后端服务前，必须先检查目标端口和历史进程，确认是否已有 Reffo 相关服务正在运行。
- 后端默认检查 `3000` 端口；Taro H5 默认检查 `10086` 端口；MVP Web、H5 静态预览、RN Metro 分别按实际脚本检查对应端口，例如 `4173`、`8083`。
- 若端口已有 Reffo 前端或后端历史服务占用，应先确认进程命令行属于本仓库，再关闭旧服务并等待端口释放，最后重新启动。
- 不要只因为端口占用就盲目杀进程；必须区分是否为当前项目服务，避免影响用户机器上的其他开发服务。
- 停止服务优先使用精确 PID，不使用宽泛的进程名批量清理。清理后用 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 或等价命令复查端口。
- 重启完成后必须验证服务可用：后端检查 `/api/v1/mvp/health`，前端检查页面入口或 dev server 首页是否可访问。
- 启动服务时如果发现已有构建 warning，除非和本次改动直接相关，否则只记录为既有警告，不把它当作启动失败。

## 后端开发规范

- 保持 ESM + TypeScript strict 风格，优先使用 `@/` 别名引用 `src` 内模块。
- API 路由放在 `backend/src/routes/`，使用 Elysia `t.Object` 定义请求体验证，并补充 `detail` 供 Swagger 展示。
- AI 编排逻辑放在 `backend/src/agents/`；路由层只负责编排调用、参数校验和响应格式，不承载复杂 prompt 或解析逻辑。
- 数据访问和持久化放在 `backend/src/repositories/`，不要在路由中散落文件或存储细节。
- 响应格式遵循 `ApiResponse<T>`：成功返回 `{ success: true, data }`，失败返回 `{ success: false, error: { code, message, details? } }`。
- 错误处理：路由内捕获业务错误并设置合适 `set.status`；未处理错误交给 `src/index.ts` 的全局错误处理。
- 环境变量集中在 `backend/src/config/env.ts`，新增配置时同步更新 `.env.example` 和文档。
- 日志可以保留面向开发调试的流程日志，但不要输出 API Key、完整简历隐私内容或其他敏感信息。

## Taro 前端开发规范

### 模块边界

- 页面代码放在 `src/pages/<page>/`，复杂页面按需拆出：
  - `components/`: 页面私有组件。
  - `model/`: 页面 view model、hooks、状态编排。
  - `constants/`: 页面文案、静态配置。
  - `utils/`: 页面私有工具函数。
- 可复用业务组件放在 `src/components/business/`。
- 跨业务通用组件放在 `src/components/common/` 或 `src/components/`。
- API 调用统一走 `src/services/`，不要在组件里直接拼接 fetch 细节。
- 全局或跨页状态使用 `src/store/` 的 Zustand store；组件内短生命周期状态继续使用 React state。
- 平台差异优先封装在 `src/utils/platform.ts`、`src/utils/web-file.ts`、H5 mocks 或平台后缀文件中。

### Taro 多端原则

- 默认使用 `@tarojs/components` 的 `View`、`Text`、`Image` 等组件，不在多端共享代码里直接使用 DOM 标签。
- H5 专用实现使用 `.h5.tsx` / `.h5.scss` 后缀；RN 或小程序专用代码也应通过平台文件或明确的适配层隔离。
- H5 构建中，部分 RN/Expo 依赖通过 `config/index.ts` alias 到 `src/__mocks__/h5/`。新增 RN-only 依赖时必须评估 H5 替代或 mock，不要让 H5 构建直接消费原生模块。
- Taro H5 的 `postcss.pxtransform` 设计稿宽度是 `393`，`baseFontSize` 是 `20`。不要随意修改，除非同步验证移动端、平板、桌面宽屏。
- Taro 全局 `designWidth` 仍是 `750`，H5 单独覆盖为 `393`。处理 Web 样式问题时优先检查 H5 pxtransform 配置和具体 CSS 单位。

### H5 样式单位规则

Taro H5 样式必须区分布局尺寸和视觉效果参数：

- 使用小写 `px` 表示需要随设计稿宽度缩放的几何和排版值，包括 `width`、`height`、`margin`、`padding`、`top/right/bottom/left`、`font-size`、`line-height`、`border-radius`、`border-width`、图标尺寸和组件间距。
- 使用大写 `PX` 表示不应被 Taro 转换、需要保持稳定物理强度的渲染效果值，包括 `filter` / `backdrop-filter` 的 blur 半径、阴影 blur/spread、glow/highlight 半径、噪声或材质效果尺度等。
- 判断标准：控制元素占位和布局的值用 `px`；控制视觉渲染强度的值用 `PX`。

```scss
.card {
  width: 210px;
  height: 332px;
  padding: 22px;
  border-radius: 10px;
  font-size: 14px;

  backdrop-filter: blur(5PX);
  box-shadow: 0 12PX 24PX rgba(0, 0, 0, 0.16);
}
```

### 样式和响应式

- H5 页面样式按 Web CSS/SCSS 编写，不需要把 RN style 转成 Web CSS。
- 移动端布局优先使用 flex、百分比、`clamp()`、`min()`、`max()`、`dvh/svh` 等响应式能力。避免固定像素把真实设备布局锁死。
- 卡片、棋盘、波轮、工具栏等固定格式 UI 必须定义稳定尺寸、宽高比或响应式约束，避免 hover、动态文本、加载态导致布局跳动。
- 文本必须在移动端和桌面端都不溢出按钮、卡片和固定容器；必要时使用固定高度、渐隐 mask、换行或截断。
- 不要在页面根容器上加入固定大边距。移动端应贴合视口安全区，宽屏再使用受控的 `max-width` 或 CSS 变量约束。
- 对真实设备和浏览器模拟器表现不一致的问题，优先检查 viewport、root font-size、Taro pxtransform、`visualViewport`、安全区和动态地址栏。

### 设计规范

- 当前主设计稿来自 Figma。实现设计稿时优先还原布局节奏、材质、层级、动效和响应式行为，而不是只对齐静态尺寸。
- 首页卡片设计尺寸是 `210px * 332px`，必须保持长宽比。卡片内容、字号、间距应跟随卡片缩放或 Taro H5 pxtransform 规则响应。
- 首页卡片底部信息区使用毛玻璃材质；评分区和整张卡片本体不应整体套毛玻璃。
- 毛玻璃 blur 等渲染强度值使用 `PX`，例如 `blur(5PX)`，避免被不同设备比例缩放。
- 高性能平台可以使用 Three.js 提升材质效果；低性能或不支持平台必须有 CSS 降级方案。
- 视觉能力判断集中复用 `src/utils/visual-tier.ts`，不要在每个组件里重复写平台/性能判断。各组件只根据 `basic | enhanced | premium` 提供自己的降级与增强实现。
- 可通过 URL 或 localStorage 覆盖视觉等级：`visualTier` / `reffoVisualTier` 或 `localStorage.reffo.visualTier`。
- 动效应优先使用 `transform` 和 `opacity`，避免频繁触发布局。复杂卡片堆动画可使用 FLIP 或 Web Animations API；不要依赖浏览器对 CSS custom properties 的 transform 插值。
- 尊重 `prefers-reduced-motion`，低性能平台不强制播放昂贵动画。

### 状态、请求和存储

- 业务请求通过 `src/services/api.ts` 的 `ApiClient` 和业务 service 封装。组件中不要直接散落 base URL、错误码解析或 fetch option。
- API 错误统一用 `RequestError` 语义处理，UI 层只展示可理解的错误信息。
- 本地存储使用 `src/utils/storage.ts` 的跨平台封装，不直接使用浏览器 `localStorage` 或 RN AsyncStorage。
- Zustand store 中优先选择性订阅，避免 `const store = useXxxStore()` 订阅整个 store 导致不必要重渲染。

### 测试和验证

- 小改动至少运行相关单测或目标构建；Taro H5 改动常用 `corepack pnpm@10.33.2 build:h5`。
- 影响 RN Android 的改动，使用仓库 skill `reffo-taro-rn-android-compare` 做真机验证。
- 影响视觉的改动应尽量保留截图或说明验证视口：移动端、平板/桌面宽屏、深色/浅色卡片、高/低视觉等级。
- 不要提交 `.artifacts/`、本地截图、录屏、临时日志或构建产物，除非任务明确要求。

## MVP Web 前端规范

- `frontend/Web` 是轻量 MVP，不要把 Taro 多端逻辑迁入这里。
- 保持 React + TypeScript + 纯 CSS 的简单结构。
- API 由 Vite 代理到后端 `/api`，修改接口路径时同步检查 Vite 配置和后端路由。
- 本地数据仍使用 README 中列出的 `localStorage` key；涉及隐私数据时不要增加无清理机制的持久化。

## 依赖管理

- 后端和 MVP Web 使用 Bun。
- Taro 前端使用 pnpm，推荐通过 Corepack 指定版本：`corepack pnpm@10.33.2 ...`。
- 不要混用 npm/yarn/pnpm 生成新的 lockfile。Taro 子项目已有 `pnpm-lock.yaml`，Web 子项目也有 `pnpm-lock.yaml`。
- 新增依赖前先检查是否已有同类能力。Web/H5 依赖必须确认浏览器兼容；RN 依赖必须确认 H5 mock 或替代方案；Three.js 等大依赖要考虑 bundle size。
- 网络受限环境下，安装依赖或使用 `npx` 可能失败；失败时明确说明，不要把缺失依赖伪装成代码问题。

## 代码风格

- TypeScript 保持 strict，新增类型不要用宽泛 `any`，除非和 Taro/RN 类型边界交互且局部隔离。
- 优先使用命名清晰的小函数和局部 hooks，避免把页面交互全部堆进 JSX。
- 导入项目内部模块优先使用 `@/` 别名；同目录私有模块使用相对路径。
- 遵循现有代码风格：Taro 前端普遍无分号、单引号；后端也以单引号和无分号为主。
- 注释只解释不明显的业务规则、兼容原因、性能权衡或平台限制，不写重复代码含义的空注释。
- 不做无关重构，不格式化未触碰的大文件，不回滚用户或其他 agent 的改动。

## Git 和交付

- 开始任何新改动前先确认当前分支和工作区状态：运行 `git branch --show-current` 和 `git status --short`。
- 不允许直接在 `main` 分支修改代码。需要基于最新 `main` 新建个人 `private` 分支，完成后通过 PR 合并。
- `private` 分支命名规则：`private/<short-topic>-<github-id>`。`short-topic` 使用 1-2 个英文单词描述功能、需求或改动，例如 `private/harness-xgy`、`private/jd-card-xgy`。
- 不要在其他人的 `private` 分支上直接修改代码。如果必须基于对方工作继续开发，应从对方 `private` 分支拉出新的个人 `private` 分支，并向对方 `private` 分支提交 PR。
- 大型需求或跨多人协作需求建议先创建 `feature/<scope>-<summary>` 作为需求验证分支。每个人基于该 `feature` 分支拉取自己的 `private` 分支开发，完成后分别向 `feature` 提 PR；统一验证无问题后，再由 `feature` 向 `main` 提 PR。
- 开始提交前先运行 `git status --short`，确认只包含当前任务相关文件。
- 分支命名使用小写英文、数字和短横线，按用途添加前缀：
  - `feature/<scope>-<summary>`: 新功能或较完整的体验优化。
  - `fix/<scope>-<summary>`: 缺陷修复。
  - `refactor/<scope>-<summary>`: 不改变行为的结构调整。
  - `docs/<scope>-<summary>`: 文档改动。
  - `chore/<scope>-<summary>`: 构建、依赖、工具或杂项维护。
- 私人开发分支可以使用 `private/<owner-or-alias>` 或 `private/<owner-or-alias>-<topic>`。当前常用工作分支是 `private/reffo-xgy`。
- Commit 标题必须使用 Conventional Commit 前缀，格式为 `<type>: <中文标题>`，例如 `feat: 优化首页卡片切换动画`。
- Commit type 优先使用：
  - `feat`: 新功能、体验增强、设计稿还原、用户可感知能力新增。
  - `fix`: bug 修复、样式错乱修复、兼容性修复。
  - `refactor`: 结构调整、抽组件、拆模块，且不改变外部行为。
  - `docs`: 文档、手册、注释说明。
  - `test`: 测试新增或测试修复。
  - `chore`: 依赖、配置、构建脚本、仓库维护。
  - `perf`: 性能优化。
  - `style`: 代码格式或非功能性样式整理；注意 UI 样式行为变化通常应使用 `feat` 或 `fix`。
- Commit 标题和详细描述必须使用中文。除代码标识、文件路径、命令、英文专有名词外，不要写英文描述。
- Commit 必须包含中文详细描述。推荐使用一行中文标题加多段 `-m` 正文，正文说明：
  - 改了什么。
  - 为什么这么改。
  - 对哪些端、页面、模块或行为有影响。
  - 做过哪些验证，或说明未验证原因。
- 示例：

```bash
git commit \
  -m "feat: 优化首页卡片堆切换过渡动画" \
  -m "将首页 H5 卡片堆切换改为基于真实 transform 快照的 FLIP 动画，避免 CSS 变量变化在浏览器中无法稳定触发过渡的问题。" \
  -m "调整卡片排序与回收逻辑，让首张卡片切换后插入卡片堆末尾，并保留尾部正确卡片淡入、旧卡淡出的非线性动画。" \
  -m "验证：已运行 corepack pnpm@10.33.2 build:h5。"
```

- 推送前确认当前分支和远端目标；不要在用户未要求时 rebase、force push 或覆盖远端历史。
- 不要提交本地截图、录屏、`.artifacts/` 下的临时产物、`dist/`、日志或依赖缓存。
- PR 标题必须使用 Conventional Commit 前缀，格式为 `<type>: <中文标题>`，例如 `feat: 优化 Harness 业务恢复`、`fix: 修复结果页返回逻辑`。
- PR 描述必须使用中文，并复用 `.github/pull_request_template.md`。除代码标识、文件路径、命令、英文专有名词外，不要写英文描述。
- PR 描述必须包含 source 分支到 target 分支 diff 中所有 commit 的概述。创建 PR 前用 `git log --oneline <target>..<source>` 或平台 diff 逐条确认，不遗漏 commit。
- PR 的 assignee 必须填写触发本次 PR 的用户；reviewer 必须包含用户本人。若用户未明确 GitHub ID，应在提交 PR 前确认。
- PR 描述必须说明改了什么、为什么改、影响范围、验证结果、风险与回滚方案；未验证项必须明确写出原因。

## Agent 工作流程建议

1. 先读本手册、目标子项目 README/AGENTS 和相关源码。
2. 用 `rg` 查调用链和样式来源，不靠猜测定位问题。
3. 先确认平台：后端、MVP Web、Taro H5、Taro RN、小程序，不同平台的兼容策略不同。
4. 开始新改动前确认当前分支是否符合协作规则；如果在 `main` 或他人的 `private` 分支上，先按 Git 规则创建合适分支。
5. 修改前向用户说明将编辑哪些区域；实现时保持变更范围小。
6. 完成后运行能覆盖本次改动的最小验证命令，并说明未能验证的原因。
7. 若任务涉及 Figma 或截图，按设计稿核对尺寸、层级、状态和动效，不只看静态页面能否显示。
