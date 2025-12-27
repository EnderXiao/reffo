# Reffo Backend

基于 Bun + Elysia + TypeScript 的后端服务。

## 技术栈

- **运行时**: Bun 1.0+
- **框架**: Elysia
- **语言**: TypeScript 5.0+
- **AI SDK**: OpenAI SDK (兼容 DeepSeek API)

## 项目结构

```
backend/
├── src/
│   ├── agents/           # AI Agents
│   │   ├── resume-analyzer.ts
│   │   ├── matching-agent.ts
│   │   └── resume-generator.ts
│   ├── routes/           # API 路由
│   │   └── mvp.ts
│   ├── types/            # TypeScript 类型定义
│   │   └── index.ts
│   ├── config/           # 配置文件
│   │   └── env.ts
│   ├── index.ts          # 应用入口
│   └── test.ts           # 测试脚本
├── package.json
├── tsconfig.json
└── .env.example
```

## 快速开始

1. 安装依赖

```bash
bun install
```

2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 API Key
```

3. 启动开发服务器

```bash
bun run dev
```

服务将在 http://localhost:3000 启动

## API 文档

启动服务后访问 http://localhost:3000/swagger 查看 API 文档

## MVP API 端点

### POST /api/v1/mvp/process

处理完整的简历优化流程（三个 Agent 串联）

**请求体:**
```json
{
  "resume_markdown": "# 张三\n\n## 工作经历\n...",
  "jd_text": "岗位职责：..."
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "step1_analysis": { ... },
    "step2_matching": { ... },
    "step3_optimized_resume": "# 张三\n\n..."
  }
}
```

## 测试

```bash
bun run test
```
