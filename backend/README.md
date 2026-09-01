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
│   ├── v5/               # v5.0.0 证据优先、自适应、阻断式门禁正式链路
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

完整简历优化流程：

1. 简历分析。
2. JD 解析。
3. 岗位匹配。
4. 最佳简历生成。
5. Markdown 质量门禁。
6. 最多 2 次自愈修订。
7. 面试建议生成。

该接口支持 `RESUME_AGENT_MODE=v4|shadow|v5` 和请求级 `agent_version=v4.4|v5.0`。v5 保留旧响应结构，同时增加 Agent 状态、release status 和安全回退标识；架构、迁移、调用成本与发布门槛见 [`src/v5/README.md`](src/v5/README.md)。

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
bun test ./src/v5
bun test ./src
```
