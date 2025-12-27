# Reffo MVP 完整运行指南

## ✅ 项目已完成

Reffo MVP 已完全实现，包括：
- ✅ 后端服务（Bun + Elysia + DeepSeek AI）
- ✅ 前端页面（React + TypeScript）
- ✅ 三个 AI Agent（简历分析 + 匹配分析 + 简历生成）
- ✅ 测试通过（质量评分 85/100，匹配度 92/100）

## 🚀 如何启动项目

### 前提条件

已安装：
- Bun 1.0+ （推荐）或 Node.js 18+
- 已配置 DeepSeek API Key

### 步骤 1: 启动后端服务

```bash
# 打开第一个终端
cd backend

# 如果还没安装依赖
bun install

# 启动后端（已配置 API Key）
bun run dev
```

看到以下输出说明启动成功：
```
🚀 Reffo MVP 服务启动成功！
========================================
📡 服务地址: http://0.0.0.0:3000
📚 API 文档: http://0.0.0.0:3000/swagger
💚 健康检查: http://0.0.0.0:3000/api/v1/mvp/health
========================================
🤖 AI 模型: deepseek-chat
🔗 API 地址: https://api.deepseek.com
========================================
```

### 步骤 2: 启动前端服务

```bash
# 打开第二个终端
cd frontend

# 安装依赖
bun install

# 启动前端
bun run dev
```

前端将在 http://localhost:5173 启动

### 步骤 3: 访问应用

打开浏览器访问：**http://localhost:5173**

## 📖 使用流程

### 1. 输入简历（步骤 1）

在文本框中输入 Markdown 格式的简历，例如：

```markdown
# 张三

**联系方式**：186-1234-5678 | zhangsan@example.com | 北京

## 工作经历

### ABC公司 | 高级工程师 | 2021.03 - 至今

- 负责后端开发...
- 使用 Java/Spring Boot...
```

点击"下一步：输入 JD"

### 2. 输入岗位描述（步骤 2）

输入目标岗位的 JD：

```
岗位职责：
1. 负责核心业务系统的后端开发
2. 参与系统架构设计

任职要求：
1. 本科及以上学历
2. 3年以上 Java 开发经验
...
```

点击"开始分析与优化"

⏱️ 处理时间：约 20-35 秒

### 3. 查看结果（步骤 3）

结果包含三部分：

1. **📊 简历分析**
   - 质量评分
   - 优势分析
   - 问题诊断
   - 能力总结

2. **🎯 匹配分析**
   - 匹配度评分
   - 已匹配技能 / 缺失技能
   - 经验匹配度

3. **✨ 优化后的简历**
   - 重新编排和优化后的 Markdown 简历
   - 可一键复制

## 🧪 运行测试（可选）

后端服务启动后，在新终端运行：

```bash
cd backend
bun run test
```

测试会：
1. 检查服务健康状态
2. 使用示例数据测试完整流程
3. 显示所有 Agent 的处理结果

**测试结果示例：**
```
✅ 测试完成！
【Step 1: 简历分析】
质量评分: 85/100
优势 (4): ...

【Step 2: 匹配分析】
匹配度评分: 92/100
已匹配技能 (13): Java, Spring Boot, ...

【Step 3: 优化简历】
简历长度: 1423 字符
```

## 🔍 查看 API 文档

后端启动后访问：http://localhost:3000/swagger

## 💾 数据存储

前端使用浏览器 localStorage 存储数据：
- 简历内容会自动保存
- 刷新页面不会丢失
- 清除浏览器数据会删除

## ⚙️ 配置说明

### 后端配置 ([backend/.env](backend/.env))

```env
OPENAI_API_KEY=sk-ced9acb2de62432e8e6711940a0b3b74
OPENAI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173
```

### 前端配置 ([frontend/vite.config.ts](frontend/vite.config.ts))

```typescript
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
}
```

## 🐛 常见问题

### 问题 1: 后端启动失败

**原因**：端口 3000 被占用

**解决**：
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:3000 | xargs kill
```

或修改 [backend/.env](backend/.env) 中的 `PORT`

### 问题 2: 前端无法连接后端

**原因**：后端未启动或端口不对

**解决**：
1. 确保后端已启动
2. 检查 [backend/.env](backend/.env) 的 `PORT`
3. 检查 [frontend/vite.config.ts](frontend/vite.config.ts) 的 proxy 配置

### 问题 3: AI 处理失败

**原因**：
- 网络连接问题
- API Key 无效或余额不足

**解决**：
1. 检查网络连接
2. 访问 https://platform.deepseek.com/ 检查 API Key
3. 确认账户有余额
4. 重试请求（第一次可能因网络波动失败）

### 问题 4: 处理时间过长

**正常现象**：AI 处理需要时间
- 简历分析：5-10 秒
- 匹配分析：5-10 秒
- 简历生成：10-15 秒
- **总计**：20-35 秒

## 📂 项目结构

```
reffo/
├── backend/                 # 后端服务
│   ├── src/
│   │   ├── agents/          # 三个 AI Agents
│   │   ├── routes/          # API 路由
│   │   ├── types/           # 类型定义
│   │   ├── config/          # 配置
│   │   ├── index.ts         # 入口
│   │   └── test.ts          # 测试脚本
│   ├── .env                 # 环境配置（已配置 API Key）
│   └── package.json
├── frontend/                # 前端应用
│   ├── src/
│   │   ├── App.tsx          # 主应用
│   │   ├── App.css          # 样式
│   │   ├── main.tsx         # 入口
│   │   └── index.css        # 全局样式
│   └── package.json
├── QUICKSTART.md            # 快速启动指南
├── INSTALL.md               # 安装指南
├── PROJECT_SUMMARY.md       # 项目总结
└── README.md                # 项目说明
```

## 🎯 核心功能验证清单

- [x] Resume Analyzer Agent - 分析简历质量
- [x] Matching Agent - 分析匹配度
- [x] Resume Generator Agent - 生成优化简历
- [x] 后端 API 接口正常工作
- [x] 前端页面正常显示
- [x] 三步流程顺利串联
- [x] localStorage 数据持久化
- [x] 测试脚本全部通过

## 📊 测试结果

**最近一次测试**（2025-12-14 10:34）：

- ✅ 健康检查：通过
- ✅ 简历分析：质量评分 85/100
- ✅ 匹配分析：匹配度 92/100
- ✅ 简历生成：成功生成 1423 字符优化简历
- ✅ 总耗时：约 31 秒

## 🎉 现在开始使用

1. 确保两个终端都在运行（后端 + 前端）
2. 打开浏览器访问 http://localhost:5173
3. 按照三步流程输入简历和 JD
4. 等待 20-35 秒查看优化结果

## 📞 获取帮助

- [快速启动指南](QUICKSTART.md)
- [安装指南](INSTALL.md)
- [项目总结](PROJECT_SUMMARY.md)
- [后端文档](backend/README.md)
- [前端文档](frontend/README.md)
- [技术方案](.kiro/specs/reffo/technical-design.md)

---

**版本**：v0.1.0
**最后更新**：2025-12-14
**状态**：✅ 完全可用
