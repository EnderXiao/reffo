---
inclusion: always
---

# AI Agent 开发规范

## Agent 设计原则

### 1. 单一职责原则

每个 Agent 只负责一个明确的任务：

- **Resume Analyzer**: 仅负责分析简历
- **Matching Agent**: 仅负责匹配分析
- **Resume Generator**: 仅负责生成优化简历

### 2. 真实性第一

AI 生成的内容必须基于用户提供的真实信息：

- ❌ 不得杜撰工作经历
- ❌ 不得虚构项目经验
- ❌ 不得编造技能
- ✅ 可以优化表达方式
- ✅ 可以重新组织结构
- ✅ 可以量化已有成果

### 3. 可测试性

Agent 的输出必须是结构化的、可验证的：

- 使用 JSON 格式输出
- 定义明确的类型接口
- 提供输出验证机制

## Agent 实现模板

### 基础结构

```typescript
import OpenAI from 'openai';
import { env } from '@/config/env';
import type { InputType, OutputType } from '@/types';

/**
 * Agent 名称和职责描述
 */
export class MyAgent {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    });
  }

  /**
   * 主要功能方法
   * @param input 输入参数
   * @returns 处理结果
   */
  async process(input: InputType): Promise<OutputType> {
    const prompt = this.buildPrompt(input);

    try {
      const response = await this.client.chat.completions.create({
        model: env.AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3, // 根据需求调整
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('AI 返回内容为空');
      }

      return this.parseResponse(content);
    } catch (error) {
      console.error('Agent processing failed:', error);
      throw new Error(
        `处理失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  /**
   * 构建 Prompt
   */
  private buildPrompt(input: InputType): string {
    // Prompt 构建逻辑
    return `...`;
  }

  /**
   * 解析 AI 响应
   */
  private parseResponse(content: string): OutputType {
    const result = JSON.parse(content) as OutputType;
    // 可选：添加验证逻辑
    return result;
  }
}
```

## Prompt 工程最佳实践

### 1. 角色定义

明确告诉 AI 它的角色和专业领域：

```typescript
const prompt = `你是一位资深的人力资源专家和简历顾问。
你拥有 10 年以上的招聘经验，擅长分析简历质量并提供专业建议。`;
```

### 2. 任务分解

将复杂任务分解为清晰的步骤：

```typescript
const prompt = `请完成以下任务：

1. **结构化提取**：
   - 提取个人信息
   - 提取教育背景
   - 提取工作经历

2. **质量评分**：
   - 评估完整性（0-100 分）
   - 评估专业性（0-100 分）

3. **优化建议**：
   - 列出 3-5 条具体建议`;
```

### 3. 输出格式约束

明确指定输出格式和结构：

```typescript
const prompt = `返回格式示例：
{
  "quality_score": 75,
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}

**重要提示**：
- 必须严格按照 JSON 格式返回
- 所有信息必须基于简历内容，不得杜撰
- 如果某些信息缺失，对应字段可为空数组或空字符串`;
```

### 4. 示例驱动（Few-shot Learning）

提供具体示例帮助 AI 理解期望：

```typescript
const prompt = `示例输入：
"负责项目开发"

示例输出：
"主导 XX 项目的架构设计与开发，使用 React + Node.js 技术栈，
成功交付 5 个核心功能模块，项目上线后用户满意度达 95%"`;
```

### 5. 约束和边界

明确告知 AI 不应该做什么：

```typescript
const prompt = `**严格约束**：
- 不得添加简历中不存在的工作经历
- 不得虚构项目经验
- 不得编造技能和证书
- 只能基于现有信息进行优化和重组`;
```

## Temperature 设置指南

根据任务类型选择合适的 temperature：

```typescript
// 结构化提取和分析：低 temperature（0.1-0.3）
// 需要稳定、一致的输出
temperature: 0.3;

// 创意性改写：中等 temperature（0.5-0.7）
// 需要多样化的表达方式
temperature: 0.6;

// 头脑风暴：高 temperature（0.8-1.0）
// 需要创新和多样性
temperature: 0.9;
```

## 错误处理策略

### 1. AI 响应验证

```typescript
private validateResponse(result: any): result is OutputType {
  // 检查必需字段
  if (!result.quality_score || typeof result.quality_score !== 'number') {
    return false
  }

  if (!Array.isArray(result.strengths)) {
    return false
  }

  return true
}

async process(input: InputType): Promise<OutputType> {
  // ...
  const result = JSON.parse(content)

  if (!this.validateResponse(result)) {
    throw new Error('AI 返回格式不符合预期')
  }

  return result
}
```

### 2. 重试机制

```typescript
async processWithRetry(
  input: InputType,
  maxRetries: number = 3
): Promise<OutputType> {
  let lastError: Error | null = null

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await this.process(input)
    } catch (error) {
      lastError = error as Error
      console.warn(`Attempt ${i + 1} failed, retrying...`)
      // 可选：添加延迟
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
    }
  }

  throw new Error(`处理失败，已重试 ${maxRetries} 次: ${lastError?.message}`)
}
```

### 3. 降级策略

```typescript
async process(input: InputType): Promise<OutputType> {
  try {
    // 尝试使用主模型
    return await this.processWithModel(env.AI_MODEL, input)
  } catch (error) {
    console.warn('Primary model failed, falling back to backup')
    // 降级到备用模型
    return await this.processWithModel(env.BACKUP_MODEL, input)
  }
}
```

## 性能优化

### 1. 流式响应（适用于长文本生成）

```typescript
async generateStream(input: InputType): Promise<ReadableStream> {
  const stream = await this.client.chat.completions.create({
    model: env.AI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  })

  return stream
}
```

### 2. 批量处理

```typescript
async processBatch(inputs: InputType[]): Promise<OutputType[]> {
  // 使用 Promise.all 并发处理
  return await Promise.all(
    inputs.map(input => this.process(input))
  )
}
```

### 3. 缓存策略

```typescript
private cache = new Map<string, OutputType>()

async process(input: InputType): Promise<OutputType> {
  const cacheKey = this.getCacheKey(input)

  // 检查缓存
  if (this.cache.has(cacheKey)) {
    return this.cache.get(cacheKey)!
  }

  // 处理并缓存
  const result = await this.processInternal(input)
  this.cache.set(cacheKey, result)

  return result
}
```

## 测试 Agent

### 1. 单元测试示例

```typescript
import { describe, test, expect } from 'bun:test';
import { ResumeAnalyzerAgent } from './resume-analyzer';

describe('ResumeAnalyzerAgent', () => {
  const agent = new ResumeAnalyzerAgent();

  test('should analyze resume successfully', async () => {
    const resume = `# 张三\n\n## 工作经历\n...`;
    const result = await agent.analyze(resume);

    expect(result.quality_score).toBeGreaterThan(0);
    expect(result.quality_score).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.strengths)).toBe(true);
  });

  test('should handle empty resume', async () => {
    await expect(agent.analyze('')).rejects.toThrow();
  });
});
```

### 2. 集成测试

```typescript
test('should complete full pipeline', async () => {
  const analyzer = new ResumeAnalyzerAgent();
  const matcher = new MatchingAgent();
  const generator = new ResumeGeneratorAgent();

  // 分析
  const analysis = await analyzer.analyze(resume);
  expect(analysis).toBeDefined();

  // 匹配
  const matching = await matcher.match(resume, jd, analysis);
  expect(matching.match_score).toBeGreaterThan(0);

  // 生成
  const optimized = await generator.generate(analysis, matching);
  expect(optimized.optimized_resume).toContain('# ');
});
```

## 监控和日志

### 1. 结构化日志

```typescript
async process(input: InputType): Promise<OutputType> {
  const startTime = Date.now()

  try {
    console.log('[Agent] Processing started', {
      agent: this.constructor.name,
      inputSize: JSON.stringify(input).length,
    })

    const result = await this.processInternal(input)

    console.log('[Agent] Processing completed', {
      agent: this.constructor.name,
      duration: Date.now() - startTime,
      outputSize: JSON.stringify(result).length,
    })

    return result
  } catch (error) {
    console.error('[Agent] Processing failed', {
      agent: this.constructor.name,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
    })
    throw error
  }
}
```

### 2. 性能监控

```typescript
private metrics = {
  totalCalls: 0,
  successCalls: 0,
  failedCalls: 0,
  totalDuration: 0,
}

async process(input: InputType): Promise<OutputType> {
  this.metrics.totalCalls++
  const startTime = Date.now()

  try {
    const result = await this.processInternal(input)
    this.metrics.successCalls++
    return result
  } catch (error) {
    this.metrics.failedCalls++
    throw error
  } finally {
    this.metrics.totalDuration += Date.now() - startTime
  }
}

getMetrics() {
  return {
    ...this.metrics,
    averageDuration: this.metrics.totalDuration / this.metrics.totalCalls,
    successRate: this.metrics.successCalls / this.metrics.totalCalls,
  }
}
```

## 最佳实践清单

- [ ] Agent 职责单一明确
- [ ] Prompt 包含角色定义
- [ ] Prompt 包含任务分解
- [ ] Prompt 包含输出格式约束
- [ ] Prompt 包含真实性约束
- [ ] 使用 JSON 格式输出
- [ ] 实现响应验证
- [ ] 实现错误处理
- [ ] 添加结构化日志
- [ ] 编写单元测试
- [ ] 添加 JSDoc 注释
- [ ] 考虑性能优化
