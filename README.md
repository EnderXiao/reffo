# Reffo - AI智能简历优化工具

基于 AI Agent 架构，提供从工作履历到一岗一简历生成的针对目标岗位的最佳简历生成服务!

## 项目结构

```
reffo/
├── backend/          # 后端服务 (Bun + Elysia + TypeScript)
├── frontend/         # 前端应用，包括 MVP Web 与 Taro 主产品前端
├── docs/             # 技术方案、TODO、升级清单和调研文档
├── .kiro/           # 项目文档和规范
│   └── specs/       # 需求文档和技术设计
└── README.md        # 项目说明
```

## 当前功能进度

早期 MVP Web 版本仍保留三步演示流程；当前主线已推进到 Taro 多端前端和更完整的后端 Agent 编排。

已完成或基本可联调的能力：

1. **源简历管理**：支持保存最新源简历，供首页和创建流程复用。
2. **OCR 解析**：支持简历 PDF 解析和 JD 图片解析，基于 GLM-OCR。
3. **V5 Agent 编排**：主流程与 Plugin Registry 分离，包含证据抽取、JD 原子需求、岗位匹配、策略、计划、Artifact 门禁、事实审查和面试建议。
4. **生成历史**：已生成的一岗一简历卡片可持久化到本地 SQLite，并在 Taro 首页卡片堆展示。
5. **Harness 观测**：后端记录 run、step、attempt、event、artifact、evaluation 和失败样本。
6. **Taro H5 主链路**：首页、创建页、结果页、完成页已串起源简历、JD、生成、保存和回首页流程。

V5 后端代码结构：

```text
backend/src/v5/
├── main/       # 主流程编排和旧响应兼容
├── plugins/    # 可插拔 Plugin contract、registry
├── prompts/    # Markdown Prompt 和 manifest.json
└── tests/      # V5 测试与 fixture
```

当前内置插件：`canonical-source`、`resume-extraction`、`job-extraction`、`matching`、`adaptive-policy`、`resume-planning`、`artifact-generation`、`fact-judge`、`interview-preparation`、`quality-judge`、`response-compatibility`。详细职责见 [`backend/README.md`](backend/README.md)。

## 🚀 快速开始

### ⚡ 一键启动

```bash
# 终端 1: 启动后端
cd backend
bun install
bun run dev

# 终端 2: 启动早期 MVP Web
cd frontend
bun install
bun run dev
```

然后访问：**http://localhost:5173**

Taro H5 主线：

```bash
cd frontend/Taro/reffo-taro
source ~/.nvm/nvm.sh && nvm use 22
corepack pnpm@10.33.2 build:h5
corepack pnpm@10.33.2 dev:h5
```

后端环境由后端启动脚本决定：

```bash
cd backend
bun run dev:local
bun run dev:nonprod
bun run start:prod
```

Taro H5 只选择要连接的后端 API 环境，Supabase public 配置由后端 `/api/v1/system/public-config` 返回：

```bash
cd frontend/Taro/reffo-taro
corepack pnpm@10.33.2 dev:h5:local
corepack pnpm@10.33.2 dev:h5:nonprod
corepack pnpm@10.33.2 build:h5:prod
```

### 📚 详细文档

- **[Agent 开发手册](AGENTS.md)** - 面向开发 agent 的项目结构、技术栈、代码规范、设计规范和验证流程
- [项目调研纪要](PROJECT_SURVEY.md) - 当前仓库结构、主链路和风险点梳理
- **[MVP 完整运行指南](MVP_GUIDE.md)** - ⭐ 推荐阅读
- [安装指南](INSTALL.md) - 从零开始搭建环境
- [快速启动指南](QUICKSTART.md) - 快速上手
- [项目总结](PROJECT_SUMMARY.md) - 技术细节

## ✅ MVP 状态

- ✅ 后端核心 Agent 与 Harness 已完成基础落地
- ✅ Taro H5 主链路已能构建
- ✅ MVP Web 三步演示版仍可作为轻量验证入口
- ⚠️ RN / 小程序端仍需真实设备回归确认
- ⚠️ 上线部署、用户体系、鉴权和生产数据库方案仍待补齐
- ⚠️ H5 bundle 体积和整体动效统一仍需治理

## 🛠 环境要求

- Bun 1.0+（后端）
- Node.js 22 + Corepack pnpm 10.33.2（Taro 前端）
- DeepSeek 或 OpenAI 兼容 API Key
- GLM-OCR API Key（使用 PDF / 图片解析时需要）

## 📖 项目文档

- [需求文档](.kiro/specs/reffo/requirements.md)
- [技术方案](.kiro/specs/reffo/technical-design.md)
- [MVP 需求](.kiro/specs/mvp/requirement.md)

## License

MIT
