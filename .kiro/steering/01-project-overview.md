---
inclusion: always
---

# Reffo 项目概览

## 项目定位

Reffo 是一个基于 AI Agent 架构的智能简历优化工具，核心功能是将用户的源简历针对特定岗位 JD 进行分析和优化，生成高度匹配的定制化简历。

## 技术栈

### 后端 (backend/)

- **运行时**: Bun 1.0+
- **框架**: Elysia (高性能 TypeScript Web 框架)
- **AI SDK**: OpenAI SDK (兼容 DeepSeek API)
- **语言**: TypeScript 5.0+
- **API 文档**: Swagger (自动生成)
- **包管理**: bun

### 前端 (frontend/)

- **框架**: React 18.2+
- **构建工具**: Vite 5.0+
- **语言**: TypeScript 5.0+
- **样式**: CSS
- **包管理**: node 22

## 核心架构

### AI Agent 架构

项目采用三个独立的 AI Agent 串联完成简历优化流程：

1. **Resume Analyzer Agent** (`backend/src/agents/resume-analyzer.ts`)
   - 分析 Markdown 格式简历
   - 提取结构化信息
   - 评估质量并提供优化建议

2. **Matching Agent** (`backend/src/agents/matching-agent.ts`)
   - 解析 JD 要求
   - 分析简历与 JD 的匹配度
   - 识别优势和劣势

3. **Resume Generator Agent** (`backend/src/agents/resume-generator.ts`)
   - 基于匹配分析生成优化简历
   - 遵循真实性第一原则
   - 输出 Markdown 格式

### 目录结构

```
reffo/
├── .kiro/
│   ├── specs/              # 需求和设计文档
│   └── steering/           # 开发规范和指南
├── backend/
│   ├── src/
│   │   ├── agents/         # AI Agent 实现
│   │   ├── routes/         # API 路由
│   │   ├── types/          # TypeScript 类型定义
│   │   ├── config/         # 配置管理
│   │   └── index.ts        # 应用入口
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── App.tsx         # 主应用组件
    │   └── main.tsx        # 入口文件
    └── package.json
```

## 开发原则

1. **类型安全**: 全面使用 TypeScript，确保端到端类型安全
2. **模块化**: Agent 独立封装，职责单一
3. **真实性第一**: AI 生成内容不得杜撰信息
4. **用户体验**: 提供清晰的错误提示和状态反馈
5. **性能优先**: 使用 Bun 运行时，优化响应时间

## 环境配置

### 必需的环境变量 (backend/.env)

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
PORT=3000
```

## API 端点

- `GET /api/v1/mvp/health` - 健康检查
- `POST /api/v1/mvp/analyze` - 仅分析简历
- `POST /api/v1/mvp/process` - 完整优化流程（分析 + 匹配 + 生成）
- `GET /swagger` - API 文档

## 开发命令

### 后端

```bash
cd backend
bun install          # 安装依赖
bun run dev          # 开发模式（热重载）
bun run start        # 生产模式
bun run test         # 运行测试
```

### 前端

```bash
cd frontend
bun install          # 安装依赖
bun run dev          # 开发服务器
bun run build        # 构建生产版本
bun run preview      # 预览生产构建
```

## 文档参考

- [需求文档](.kiro/specs/reffo/requirements.md)
- [技术设计](.kiro/specs/reffo/technical-design.md)
- [项目总结](../../PROJECT_SUMMARY.md)
- [快速启动](../../QUICKSTART.md)
