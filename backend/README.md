# Reffo Backend

基于 Bun + Elysia + TypeScript 的后端服务，提供 AI 简历优化、OCR 解析、源简历持久化、生成历史持久化和 Agent Harness 观测能力。

## 技术栈

- **运行时**: Bun 1.0+
- **框架**: Elysia
- **语言**: TypeScript 5.0+
- **AI SDK**: OpenAI SDK，兼容 DeepSeek API
- **存储**: Bun SQLite

## 项目结构

```text
backend/
├── src/
│   ├── agents/           # AI Agents：简历分析、JD 解析、匹配、生成、修订、面试建议
│   ├── harness/          # Agent Harness：事件、step、attempt、评估、持久化订阅
│   ├── providers/        # LLM provider 与 fallback
│   ├── repositories/     # SQLite 仓储：Harness、源简历、生成历史
│   ├── routes/           # API 路由：mvp、parse、source-resume、resume-history
│   ├── services/ocr/     # GLM-OCR 文件解析
│   ├── workflows/        # 简历优化与 OCR 工作流
│   ├── config/           # 环境变量配置
│   ├── types/            # TypeScript 类型定义
│   ├── v5/               # v5.0.0 正式链路
│   │   ├── main/         # 主流程编排、旧响应兼容
│   │   ├── plugins/      # Plugin contract、registry
│   │   ├── prompts/      # Prompt Markdown、manifest.json
│   │   └── tests/        # V5 测试和 fixture
│   ├── index.ts          # 应用入口
│   └── test.ts           # 联调测试脚本
├── package.json
├── tsconfig.json
└── .env.example
```

## 快速开始

```bash
bun install
cp .env.example .env.local
bun run dev
```

服务将在 `http://localhost:3000` 启动，Swagger 文档为 `http://localhost:3000/swagger`。

## 环境配置

后端按单环境文件运行，不再把正式和非正式配置同时放进一个 `.env`：

- `.env.local`: 本地 SQLite 开发，默认由 `bun run dev` 使用。
- `.env.nonprod`: 非生产 Supabase，用于测试/预发合并环境。
- `.env.prod`: 正式 Supabase，仅在正式迁移或正式后端启动时使用。
- `.env.example`: 变量模板，不保存真实 key。

常用命令：

```bash
bun run dev:local
bun run dev:nonprod
bun run start:prod
bun run migrate:sqlite-to-supabase:nonprod
bun run migrate:sqlite-to-supabase:prod
```

`.env.prod` 必须设置 `APP_ENV=prod`、`DATABASE_PROVIDER=supabase`、`AUTH_REQUIRED=true`、`SUPABASE_PROJECT_ENV=prod`，并使用正式 Supabase project 的新 API key。

前端只需要选择后端 API 域名，不直接配置 Supabase URL 或 Publishable key。后端通过 `GET /api/v1/system/public-config` 返回当前环境的公开配置，避免前端 API 域名和 Supabase project 错配。

## 核心 API

### `POST /api/v1/mvp/process`

完整简历优化流程固定执行 V5：代码先生成并预检源简历 scope 计划，P01 按稳定 scope 有界分片抽取且通过后才执行 P02，随后执行 P03 匹配、P04 条件策略、本地代码构建 P05 形状的计划，再经 Blueprint 零调用预检、单次 P06D 受控 DSL、服务端编译和本地代码门禁生成成品。产物完成交付判定后立即转换为旧 MVP 响应；正式 `/process` 链路不再注册或调用 P05/P05R、P07、P09、P10/P10R 或 P11 模型。`legacy` kill switch 仍保留旧 P06/P08 路径。

完整流程固定执行 V5，不再提供 V4、shadow 或请求级版本切换。响应保留旧步骤字段，同时增加 Agent 状态、release status 和安全回退标识；架构、调用成本与发布门槛见 [`src/v5/README.md`](src/v5/README.md)。当前改动只在测试分支验证，暂不合入 `main`。

### V5 插件清单

非生产单案例验证可显式使用 `AI_MODEL=deepseek-v4-flash DEEPSEEK_THINKING_MODE=enabled DEEPSEEK_REASONING_EFFORT=low`。思考模式通过请求体显式指定，禁用无效 temperature；`completion_tokens` 已包含思考 Token，预算不能再次相加。只记录思考 Token 数，不保存或回传推理正文。模型、模式和强度进入运行及抽取缓存指纹，不提升旧缓存。调用方未传 `maxOutputTokens` 时，Provider 使用 `DEEPSEEK_THINKING_MAX_TOKENS`（默认 12000）为思考与最终输出预留共享预算；V5 阶段显式上限仍以阶段配置为准。截断仍失败即停，不自动修复/重跑。默认环境与生产模型不因此变更。

主流程通过 `V5WorkflowPluginRegistry` 调度以下插件：

- `canonical-source`：简历/JD 规范化、空输入门禁。
- `resume-extraction`：代码确定经历 scope 与时间线锚点并做零调用预检；P01/P01R 只负责分片证据抽取、缓存和有序合并校验。
- `job-extraction`：P02/P02R JD 原子需求抽取。
- `matching`：P03/P03R 证据与需求匹配、服务端评分输入。
- `adaptive-policy`：确定性策略和低置信 P04 裁决。
- `resume-planning`：由本地确定性代码构建 P05 形状的 ResumePlan 并执行计划门禁，不调用 P05/P05R。
- `artifact-generation`：默认由 Blueprint 零调用预检、单次 P06D 受控 DSL 和服务端编译生成；Schema、DSL 或 Composition 错误只形成内部确定性安全渲染稿，不调用模型修复。只有显式 `legacy` kill switch 才可能走旧 P06/P08。
- `fact-judge`：保留的历史/离线扩展 ID；正式链路不注册也不调用 P09。
- `interview-preparation`：P10/P10R 组件仅为历史数据与未来可信上下文按需能力保留；正式 `/process` 不注册也不调用，当前也未新增 V5 公共按需接口。
- `quality-judge`：保留的离线扩展 ID；正式链路不注册也不调用 P11。
- `response-compatibility`：转换为 `step1_analysis` 等旧 MVP 字段；`step4_interview_suggestions` 继续保留兼容字段，但当前 `/process` 返回为空。

插件可通过 `pluginOverrides` 替换；只有标记为 `optional` 的插件允许禁用。插件版本、状态、耗时和错误会写入 workflow manifest。当前内置插件的注册定义仍集中在 `src/v5/main/workflow.ts`，`src/v5/plugins/` 先承载通用 contract/registry；后续可将单个插件实现继续拆成独立文件。

### 单步 Agent 接口

- `POST /api/v1/mvp/analyze`: 单独分析简历。
- `POST /api/v1/mvp/match`: 单独解析 JD 并做匹配分析。
- `POST /api/v1/mvp/generate`: 单独生成最佳简历，并执行质量门禁和修订。
- `POST /api/v1/mvp/interview`: 单独生成面试建议。

### Harness 接口

- `GET /api/v1/mvp/dashboard`: Harness 指标概览。
- `GET /api/v1/mvp/regression-dataset`: 导出失败/部分成功运行的回归数据集摘要。
- `GET /api/v1/mvp/runs/:run_id`: 查询指定 run。
- `GET /api/v1/mvp/runs/:run_id/replay`: 重放 run 事件流。
- `POST /api/v1/mvp/runs/:run_id/failure-samples`: 将失败样本回流到回归数据集。

### OCR 与持久化接口

- `GET /api/v1/system/public-config`: 前端运行时公开配置。
- `GET /api/v1/parse/health`: OCR 配置状态。
- `POST /api/v1/parse/resume-file`: 使用 GLM-OCR 解析简历 PDF。
- `POST /api/v1/parse/jd-image`: 使用 GLM-OCR 解析 JD 图片。
- `/api/v1/source-resume/*`: 源简历保存、查询、删除。
- `/api/v1/resume-history/*`: 生成历史 CRUD。

## OCR 配置

OCR 会优先读取 `GLM_OCR_API_KEY`，缺省时回退到 `GLM_API_KEY`。接口缺少 OCR Key 时会返回：

```json
{
  "success": false,
  "error": {
    "code": "OCR_CONFIG_MISSING",
    "message": "GLM-OCR API Key 未配置"
  }
}
```

服务启动时也会输出 OCR 配置状态，便于本地联调提前发现配置缺失。

## 测试

```bash
bunx tsc --noEmit
bun test ./src/v5/tests
bun test ./src
```
