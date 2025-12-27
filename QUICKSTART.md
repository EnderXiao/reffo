# Reffo MVP 快速启动指南

## 项目说明

这是 Reffo 项目的 MVP 版本，实现了基于 AI Agent 的简历优化核心流程：

1. **Resume Analyzer Agent** - 分析 Markdown 简历，提取结构化信息
2. **Matching Agent** - 分析 JD 与简历的匹配度
3. **Resume Generator Agent** - 生成优化后的简历

## 前置要求

- [Bun](https://bun.sh/) 1.0+ (推荐) 或 Node.js 18+
- DeepSeek API Key 或 OpenAI API Key

## 快速开始

### 1. 获取 API Key

**方式一：使用 DeepSeek (推荐，性价比高)**

1. 访问 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 注册并获取 API Key
3. DeepSeek API 兼容 OpenAI SDK，无需修改代码

**方式二：使用 OpenAI**

1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 创建 API Key

### 2. 启动后端服务

```bash
# 进入后端目录
cd backend

# 安装依赖
bun install

# 复制环境变量配置
cp .env.example .env

# 编辑 .env 文件，填入你的 API Key
# Windows: notepad .env
# macOS/Linux: nano .env

# 启动开发服务器
bun run dev
```

服务将在 `http://localhost:3000` 启动

### 3. 测试功能

在另一个终端窗口运行测试脚本：

```bash
cd backend
bun run test
```

测试脚本会：
1. 检查服务健康状态
2. 使用示例简历和 JD 调用完整流程
3. 打印三个 Agent 的处理结果

### 4. 查看 API 文档

启动服务后访问：http://localhost:3000/swagger

## API 接口说明

### 完整流程接口

```bash
POST /api/v1/mvp/process
Content-Type: application/json

{
  "resume_markdown": "# 姓名\n\n## 工作经历\n...",
  "jd_text": "岗位职责：\n1. ..."
}
```

### 单独分析简历

```bash
POST /api/v1/mvp/analyze
Content-Type: application/json

{
  "resume_markdown": "# 姓名\n\n## 工作经历\n..."
}
```

### 健康检查

```bash
GET /api/v1/mvp/health
```

## 使用 cURL 测试

```bash
# 健康检查
curl http://localhost:3000/api/v1/mvp/health

# 完整流程（需要准备 resume.md 和 jd.txt 文件）
curl -X POST http://localhost:3000/api/v1/mvp/process \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "resume_markdown": "$(cat resume.md)",
  "jd_text": "$(cat jd.txt)"
}
EOF
```

## 环境变量说明

在 `backend/.env` 文件中配置：

```bash
# 使用 DeepSeek
OPENAI_API_KEY=your_deepseek_api_key
OPENAI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat

# 或使用 OpenAI
# OPENAI_API_KEY=your_openai_api_key
# OPENAI_BASE_URL=https://api.openai.com/v1
# AI_MODEL=gpt-4

# 服务器配置
PORT=3000
HOST=0.0.0.0

# CORS 配置（前端地址）
CORS_ORIGIN=http://localhost:5173
```

## 项目结构

```
backend/
├── src/
│   ├── agents/              # AI Agents
│   │   ├── resume-analyzer.ts
│   │   ├── matching-agent.ts
│   │   └── resume-generator.ts
│   ├── routes/              # API 路由
│   │   └── mvp.ts
│   ├── types/               # TypeScript 类型
│   │   └── index.ts
│   ├── config/              # 配置
│   │   └── env.ts
│   ├── index.ts             # 应用入口
│   └── test.ts              # 测试脚本
├── package.json
├── tsconfig.json
├── .env.example
├── Containerfile            # 容器化配置
└── README.md
```

## 常见问题

### 1. API Key 无效

确保在 `.env` 文件中正确配置了 API Key，并且 Key 有效且有余额。

### 2. 服务启动失败

检查端口 3000 是否被占用：

```bash
# Windows
netstat -ano | findstr :3000

# macOS/Linux
lsof -i :3000
```

### 3. 测试失败

确保服务已经启动并运行在 http://localhost:3000

## 下一步

- [ ] 添加数据库存储（PostgreSQL）
- [ ] 实现用户认证
- [ ] 添加文件上传功能（PDF/Word）
- [ ] 实现前端界面
- [ ] 添加简历导出功能

## 技术支持

如有问题，请查看：
- [技术方案](.kiro/specs/reffo/technical-design.md)
- [需求文档](.kiro/specs/reffo/requirements.md)
- [MVP 需求](.kiro/specs/mvp/requirement.md)
