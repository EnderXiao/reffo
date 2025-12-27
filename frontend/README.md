# Reffo Frontend

简单的 MVP 前端界面，用于展示 Reffo 简历优化流程。

## 技术栈

- React 18 + TypeScript
- Vite（构建工具）
- 纯 CSS（无 UI 库，保持简单）

## 功能

1. **步骤 1**：输入 Markdown 格式简历
2. **步骤 2**：输入岗位描述（JD）
3. **步骤 3**：展示优化结果（分析 + 匹配 + 新简历）

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev
```

前端将在 http://localhost:5173 启动

## 数据存储

使用 localStorage 存储数据（无需数据库）：
- `reffo_resume_markdown` - 简历内容
- `reffo_jd_text` - JD 内容
- `reffo_last_result` - 最后一次处理结果

## 注意事项

- 确保后端服务已启动（http://localhost:3000）
- Vite 会自动代理 `/api` 请求到后端
- 数据仅存储在浏览器本地，清除浏览器数据会丢失
