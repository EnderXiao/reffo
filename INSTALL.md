# Reffo MVP 安装指南

本指南将帮助你从零开始搭建 Reffo MVP 开发和运行环境。

## 📋 前置条件检查

在开始之前，请确认你的系统满足以下要求：

- 操作系统：Windows 10/11, macOS, 或 Linux
- 磁盘空间：至少 500MB 可用空间
- 网络：能够访问 npm 仓库和 AI API

## 🔧 步骤 1: 安装 Bun

Bun 是一个快速的 JavaScript 运行时，我们推荐使用它来运行 Reffo。

### Windows

使用 PowerShell（以管理员身份运行）：

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

### macOS / Linux

```bash
curl -fsSL https://bun.sh/install | bash
```

### 验证安装

```bash
bun --version
```

应该显示类似 `1.0.x` 的版本号。

**备选方案**：如果无法安装 Bun，也可以使用 Node.js 18+ 和 npm：

```bash
node --version  # 应该显示 v18.x.x 或更高
npm --version
```

## 🔑 步骤 2: 获取 AI API Key

你需要一个 AI API Key 来运行服务。我们推荐使用 DeepSeek（性价比高）。

### 方式一：DeepSeek（推荐）

1. 访问 [https://platform.deepseek.com/](https://platform.deepseek.com/)
2. 注册账号
3. 点击 "API Keys" 创建新的 API Key
4. 充值（建议先充值 ¥10 用于测试）
5. 复制 API Key（以 `sk-` 开头）

**优势**：
- 价格便宜（约为 OpenAI 的 1/10）
- 兼容 OpenAI SDK
- 中文理解能力强

### 方式二：OpenAI

1. 访问 [https://platform.openai.com/](https://platform.openai.com/)
2. 注册账号（需要国外手机号）
3. 创建 API Key
4. 绑定支付方式
5. 复制 API Key

## 📥 步骤 3: 下载项目代码

如果你还没有项目代码，可以从 Git 仓库克隆（假设代码已上传到 Git）：

```bash
git clone <repository-url>
cd reffo
```

或者如果你已经有代码，直接进入项目目录：

```bash
cd g:\Develop\Project\reffo
```

## 📦 步骤 4: 安装依赖

进入后端目录并安装依赖：

```bash
cd backend
bun install
```

如果使用 npm：

```bash
npm install
```

这个过程可能需要 1-2 分钟，取决于你的网络速度。

## ⚙️ 步骤 5: 配置环境变量

1. 复制环境变量模板：

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

2. 编辑 `.env` 文件：

```bash
# Windows
notepad .env

# macOS
open -e .env

# Linux
nano .env
```

3. 填入配置信息：

**使用 DeepSeek：**

```env
OPENAI_API_KEY=<DeepSeek API Key>
OPENAI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat

PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173
```

**使用 OpenAI：**

```env
OPENAI_API_KEY=<OpenAI API Key>
OPENAI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4

PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173
```

4. 保存文件

⚠️ **重要提示**：
- 不要将 `.env` 文件提交到 Git 仓库
- API Key 是敏感信息，请妥善保管
- 如果 API Key 泄露，请立即在平台上删除并重新创建

## 🚀 步骤 6: 启动服务

在 `backend` 目录下运行：

```bash
bun run dev
```

或使用 npm：

```bash
npm run dev
```

你应该看到类似以下的输出：

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

## ✅ 步骤 7: 验证安装

### 方法一：使用浏览器

打开浏览器访问：http://localhost:3000

你应该看到欢迎页面。

访问 Swagger 文档：http://localhost:3000/swagger

### 方法二：使用测试脚本

打开**新的终端窗口**（保持服务运行），运行：

```bash
cd backend
bun run test
```

或使用 npm：

```bash
npm run test
```

测试脚本会：
1. 检查服务健康状态
2. 使用示例数据测试完整流程
3. 显示三个 Agent 的处理结果

如果一切正常，你会看到完整的测试输出，包括：
- 简历分析结果
- 匹配度分析
- 优化后的简历

### 方法三：使用 cURL

```bash
curl http://localhost:3000/api/v1/mvp/health
```

应该返回：

```json
{
  "status": "ok",
  "timestamp": "2025-12-14T...",
  "service": "reffo-mvp"
}
```

## 🎉 安装完成！

恭喜！你已经成功安装并运行了 Reffo MVP。

## 📚 下一步

- 阅读 [快速启动指南](QUICKSTART.md) 了解如何使用 API
- 查看 [API 文档](http://localhost:3000/swagger) 了解接口详情
- 查看 [项目总结](PROJECT_SUMMARY.md) 了解项目架构

## 🐛 常见问题排查

### 问题 1: Bun 安装失败

**解决方案**：使用 Node.js + npm 代替

```bash
# 安装 Node.js (访问 https://nodejs.org/)
# 然后使用 npm 安装依赖
npm install
npm run dev
```

### 问题 2: 端口 3000 被占用

**错误信息**：`Error: listen EADDRINUSE: address already in use :::3000`

**解决方案**：

选项 1 - 修改端口号：
编辑 `.env` 文件，将 `PORT=3000` 改为 `PORT=3001`

选项 2 - 释放端口：

Windows:
```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

macOS/Linux:
```bash
lsof -ti:3000 | xargs kill
```

### 问题 3: API Key 无效

**错误信息**：`API Key 验证失败` 或 `401 Unauthorized`

**解决方案**：
1. 检查 `.env` 文件中的 API Key 是否正确
2. 确认 API Key 在平台上是否有效
3. 检查账户是否有余额（DeepSeek 需要充值）
4. 确认 `OPENAI_BASE_URL` 配置正确

### 问题 4: 依赖安装失败

**错误信息**：`npm ERR!` 或 `bun install failed`

**解决方案**：
1. 检查网络连接
2. 尝试使用淘宝镜像（npm）：
   ```bash
   npm config set registry https://registry.npmmirror.com
   npm install
   ```
3. 清除缓存后重试：
   ```bash
   # Bun
   rm -rf node_modules bun.lockb
   bun install

   # npm
   rm -rf node_modules package-lock.json
   npm install
   ```

### 问题 5: 测试脚本提示"无法连接到服务"

**解决方案**：
1. 确认服务已启动（运行 `bun run dev`）
2. 检查服务是否在 3000 端口运行
3. 如果修改了端口，更新测试脚本中的 `API_BASE_URL`

### 问题 6: Windows 上路径问题

**错误信息**：路径相关的错误

**解决方案**：
1. 使用 PowerShell 而不是 CMD
2. 确保路径使用正确的斜杠（`/` 或 `\`）
3. 使用绝对路径

## 💬 获取帮助

如果遇到其他问题：

1. 查看服务日志（运行 `bun run dev` 的终端输出）
2. 查看 [后端 README](backend/README.md)
3. 查看 [技术方案文档](.kiro/specs/reffo/technical-design.md)

## 🔄 卸载

如果需要完全卸载项目：

```bash
# 1. 停止服务 (Ctrl+C)

# 2. 删除依赖
cd backend
rm -rf node_modules

# 3. 删除项目目录
cd ../..
rm -rf reffo

# 4. (可选) 卸载 Bun
# macOS/Linux
rm -rf ~/.bun

# Windows
# 从控制面板卸载 Bun
```

---

**最后更新**: 2025-12-14
**适用版本**: Reffo MVP v0.1.0
