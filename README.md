# Reffo - AI智能简历优化工具

基于 AI Agent 架构，提供从工作履历到一岗一简历生成的针对目标岗位的最佳简历生成服务。

## 项目结构

```
reffo/
├── backend/          # 后端服务 (Bun + Elysia + TypeScript)
├── frontend/         # 前端应用 (React + TypeScript + Vite)
├── .kiro/           # 项目文档和规范
│   └── specs/       # 需求文档和技术设计
└── README.md        # 项目说明
```

## MVP 功能

当前 MVP 版本实现了三个核心 Agent 的串联流程：

1. **Resume Analyzer Agent** - 分析输入的 Markdown 格式简历
2. **Matching Agent** - 分析 JD 与简历的匹配度
3. **Resume Generator Agent** - 根据匹配度重新编排和优化简历

## 🚀 快速开始

### ⚡ 一键启动

```bash
# 终端 1: 启动后端
cd backend
bun install
bun run dev

# 终端 2: 启动前端
cd frontend
bun install
bun run dev
```

然后访问：**http://localhost:5173**

### 📚 详细文档

- [项目调研纪要](PROJECT_SURVEY.md) - 当前仓库结构、主链路和风险点梳理
- **[MVP 完整运行指南](MVP_GUIDE.md)** - ⭐ 推荐阅读
- [安装指南](INSTALL.md) - 从零开始搭建环境
- [快速启动指南](QUICKSTART.md) - 快速上手
- [项目总结](PROJECT_SUMMARY.md) - 技术细节

## ✅ MVP 状态

- ✅ 后端服务完成（三个 AI Agent）
- ✅ 前端界面完成（三步流程）
- ✅ 测试通过（质量评分 85/100，匹配度 92/100）
- ✅ DeepSeek API 已配置
- ✅ 完全可用

## 🛠 环境要求

- Bun 1.0+（推荐）或 Node.js 18+
- DeepSeek API Key（已配置）

## 📖 项目文档

- [需求文档](.kiro/specs/reffo/requirements.md)
- [技术方案](.kiro/specs/reffo/technical-design.md)
- [MVP 需求](.kiro/specs/mvp/requirement.md)

## License

MIT
