# Taro 前端 TypeScript 遗留基线

范围：`frontend/Taro/reffo-taro`。

## 基线

执行时间：2026-08-29

```bash
corepack pnpm@10.33.2 exec tsc --noEmit --pretty false
```

当前输出：327 条 `error TS`。

按文件路径粗分：

- 测试文件：161 条，主要是 Jest mock 未声明参数类型导致的 `never` 推断，以及回调返回值类型不完整。
- 页面代码：155 条，主要是 RN `StyleSheet` 类型与 Taro H5 DOM style 类型不兼容，以及旧页面平台边界代码。
- 组件代码：2 条，主要是 H5 文件选择返回值联合类型未收窄。
- 工具代码：7 条，主要是存储回调结果和 landing session 可空值未收窄。
- 其他：2 条。

## 处理规则

- U8 只建立 Jest、H5 build、`git diff --check` 门禁；不把既有 TypeScript 债务伪装成通过。
- 后续修复按“测试 mock 类型、H5 DOM style、平台边界、可空值”拆成独立单元，每单元减少可量化错误数并补回归。
- 新增代码不得增加错误数；涉及文件的修改应优先清理同文件遗留错误。

## 复查命令

```bash
cd frontend/Taro/reffo-taro
corepack pnpm@10.33.2 exec tsc --noEmit --pretty false
```
