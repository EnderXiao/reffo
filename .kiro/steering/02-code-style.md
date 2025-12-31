---
inclusion: always
---

# 代码风格和开发规范

## TypeScript 规范

### 类型定义

1. **优先使用 interface 而非 type**（除非需要联合类型）

```typescript
// ✅ 推荐
interface User {
  id: string;
  name: string;
}

// ❌ 避免（除非必要）
type User = {
  id: string;
  name: string;
};
```

2. **导出所有公共类型**

```typescript
// types/index.ts
export interface ResumeAnalysis {
  quality_score: number;
  strengths: string[];
  // ...
}
```

3. **使用严格的类型检查**

- 启用 `strict: true`
- 避免使用 `any`，必要时使用 `unknown`
- 为函数参数和返回值明确标注类型

### 命名规范

1. **文件命名**: kebab-case

   - `resume-analyzer.ts`
   - `matching-agent.ts`

2. **类命名**: PascalCase

   - `ResumeAnalyzerAgent`
   - `MatchingAgent`

3. **函数和变量**: camelCase

   - `analyzeResume()`
   - `qualityScore`

4. **常量**: UPPER_SNAKE_CASE

   - `MAX_FILE_SIZE`
   - `DEFAULT_TIMEOUT`

5. **接口和类型**: PascalCase
   - `ResumeAnalysis`
   - `MatchingResult`

### 代码组织

1. **导入顺序**

```typescript
// 1. 外部依赖
import OpenAI from 'openai';
import { Elysia } from 'elysia';

// 2. 内部模块（使用路径别名）
import { env } from '@/config/env';
import type { ResumeAnalysis } from '@/types';

// 3. 相对路径导入
import { helper } from './utils';
```

2. **类结构顺序**

```typescript
export class MyAgent {
  // 1. 私有属性
  private client: OpenAI;

  // 2. 构造函数
  constructor() {
    // ...
  }

  // 3. 公共方法
  async analyze() {
    // ...
  }

  // 4. 私有方法
  private parseResult() {
    // ...
  }
}
```

## 注释规范

### JSDoc 注释

为所有公共 API 添加 JSDoc 注释：

```typescript
/**
 * 分析简历内容并提取结构化信息
 * @param resumeMarkdown Markdown 格式的简历内容
 * @returns 简历分析结果，包含质量评分和优化建议
 * @throws {Error} 当 AI 调用失败或返回格式错误时
 */
async analyze(resumeMarkdown: string): Promise<ResumeAnalysis> {
  // ...
}
```

### 行内注释

1. **解释"为什么"而非"是什么"**

```typescript
// ✅ 好的注释
// 使用较低的 temperature 确保输出稳定性和一致性
temperature: 0.3;

// ❌ 不必要的注释
// 设置 temperature 为 0.3
temperature: 0.3;
```

2. **复杂逻辑添加注释**

```typescript
// 计算匹配度时，硬性要求权重占 40%，技能匹配占 30%，经验匹配占 30%
const matchScore =
  hardRequirements * 0.4 + skillMatch * 0.3 + experienceMatch * 0.3;
```

## 错误处理

### 统一的错误处理模式

```typescript
try {
  const response = await this.client.chat.completions.create({
    // ...
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('AI 返回内容为空');
  }

  return JSON.parse(content);
} catch (error) {
  console.error('Operation failed:', error);
  throw new Error(
    `操作失败: ${error instanceof Error ? error.message : '未知错误'}`
  );
}
```

### 错误信息规范

1. **使用中文错误信息**（面向中文用户）
2. **提供具体的错误上下文**
3. **保留原始错误信息**

```typescript
throw new Error(
  `简历分析失败: ${error instanceof Error ? error.message : '未知错误'}`
);
```

## 异步处理

1. **优先使用 async/await**

```typescript
// ✅ 推荐
async function fetchData() {
  const result = await api.call();
  return result;
}

// ❌ 避免
function fetchData() {
  return api.call().then((result) => result);
}
```

2. **并发请求使用 Promise.all**

```typescript
const [analysis, matching] = await Promise.all([
  analyzeResume(resume),
  matchWithJD(resume, jd),
]);
```

## 代码格式化

### 使用一致的格式

1. **缩进**: 2 空格
2. **引号**: 单引号 `'`
3. **分号**: 不使用分号（遵循 Bun/Deno 风格）
4. **行宽**: 建议 100 字符

### 对象和数组

```typescript
// ✅ 多行时每项独占一行
const config = {
  apiKey: env.API_KEY,
  baseURL: env.BASE_URL,
  timeout: 30000,
};

// ✅ 简短时可单行
const point = { x: 10, y: 20 };
```

## 性能考虑

1. **避免不必要的对象创建**

```typescript
// ✅ 复用 client 实例
export class MyAgent {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({ ... })
  }
}

// ❌ 每次调用都创建新实例
async analyze() {
  const client = new OpenAI({ ... })
}
```

2. **合理使用缓存**

```typescript
// 对于不变的配置，使用模块级缓存
const config = loadConfig();
```

## Git 提交规范

### Commit Message 格式

```
<type>(<scope>): <subject>

<body>
```

### Type 类型

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 重构（不是新功能也不是修复）
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

### 示例

```
feat(agent): 添加简历质量评分功能

- 实现质量评分算法
- 添加评分标准文档
- 更新 API 响应格式
```

## 安全规范

1. **永远不要提交敏感信息**

   - API Keys
   - 密码
   - 私钥

2. **使用环境变量管理配置**

```typescript
// ✅ 从环境变量读取
const apiKey = env.OPENAI_API_KEY;

// ❌ 硬编码
const apiKey = 'sk-xxx';
```

3. **验证用户输入**

```typescript
if (!resumeMarkdown || resumeMarkdown.trim().length === 0) {
  throw new Error('简历内容不能为空');
}
```

## 文档规范

1. **README.md**: 每个主要目录都应有 README
2. **API 文档**: 使用 Swagger 自动生成
3. **类型文档**: 通过 JSDoc 和 TypeScript 类型提供
4. **更新日志**: 重要变更记录在项目根目录的文档中
