---
inclusion: always
---

# 测试规范

## 测试策略

Reffo 项目采用多层次测试策略：

1. **单元测试**: 测试独立的函数和类
2. **集成测试**: 测试 Agent 之间的协作
3. **端到端测试**: 测试完整的 API 流程
4. **手动测试**: 验证 AI 输出质量

## 测试框架

使用 Bun 内置的测试框架：

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
```

## 测试文件组织

### 文件命名

- 单元测试: `*.test.ts`
- 集成测试: `*.integration.test.ts`
- 端到端测试: `*.e2e.test.ts`

### 目录结构

```
backend/
├── src/
│   ├── agents/
│   │   ├── resume-analyzer.ts
│   │   └── resume-analyzer.test.ts
│   └── routes/
│       ├── mvp.ts
│       └── mvp.test.ts
└── tests/
    ├── integration/
    │   └── agent-pipeline.integration.test.ts
    └── e2e/
        └── api.e2e.test.ts
```

## 单元测试规范

### 测试结构

使用 AAA 模式（Arrange-Act-Assert）：

```typescript
describe('ResumeAnalyzerAgent', () => {
  test('should analyze resume and return quality score', async () => {
    // Arrange - 准备测试数据
    const agent = new ResumeAnalyzerAgent();
    const resume = `# 张三\n\n## 工作经历\n...`;

    // Act - 执行操作
    const result = await agent.analyze(resume);

    // Assert - 验证结果
    expect(result.quality_score).toBeGreaterThan(0);
    expect(result.quality_score).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(result.strengths.length).toBeGreaterThan(0);
  });
});
```

### 测试命名

使用描述性的测试名称：

```typescript
// ✅ 好的命名
test('should return error when resume is empty');
test('should extract personal info from markdown resume');
test('should calculate match score between 0 and 100');

// ❌ 不好的命名
test('test1');
test('analyze');
test('works');
```

### 边界条件测试

```typescript
describe('ResumeAnalyzerAgent - Edge Cases', () => {
  const agent = new ResumeAnalyzerAgent();

  test('should handle empty resume', async () => {
    await expect(agent.analyze('')).rejects.toThrow('简历内容不能为空');
  });

  test('should handle very long resume', async () => {
    const longResume = '# 张三\n' + '工作经历\n'.repeat(10000);
    const result = await agent.analyze(longResume);
    expect(result).toBeDefined();
  });

  test('should handle resume with special characters', async () => {
    const resume = `# 张三 👨‍💻\n\n## 技能\n- C++ / C# / JavaScript`;
    const result = await agent.analyze(resume);
    expect(result).toBeDefined();
  });

  test('should handle malformed markdown', async () => {
    const resume = `### 张三\n工作经历\n没有标题`;
    const result = await agent.analyze(resume);
    expect(result).toBeDefined();
  });
});
```

### Mock 和 Stub

对于 AI API 调用，可以使用 mock 进行测试：

```typescript
import { mock } from 'bun:test';

describe('ResumeAnalyzerAgent - Mocked', () => {
  test('should handle API response correctly', async () => {
    // Mock OpenAI client
    const mockClient = {
      chat: {
        completions: {
          create: mock(async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    quality_score: 85,
                    strengths: ['优势1', '优势2'],
                    weaknesses: ['问题1'],
                    suggestions: ['建议1'],
                    capability_summary: '能力总结',
                    structured_resume: {
                      personal_info: { name: '张三' },
                      education: [],
                      experience: [],
                      projects: [],
                      skills: { hard_skills: [], soft_skills: [] },
                    },
                  }),
                },
              },
            ],
          })),
        },
      },
    };

    // 使用 mock client 进行测试
    // ...
  });
});
```

## 集成测试规范

### Agent 协作测试

```typescript
describe('Agent Pipeline Integration', () => {
  let analyzer: ResumeAnalyzerAgent;
  let matcher: MatchingAgent;
  let generator: ResumeGeneratorAgent;

  beforeAll(() => {
    analyzer = new ResumeAnalyzerAgent();
    matcher = new MatchingAgent();
    generator = new ResumeGeneratorAgent();
  });

  test('should complete full optimization pipeline', async () => {
    // 准备测试数据
    const resume = `# 张三\n\n## 工作经历\n...`;
    const jd = `岗位职责：...`;

    // 步骤 1: 分析简历
    const analysis = await analyzer.analyze(resume);
    expect(analysis).toBeDefined();
    expect(analysis.quality_score).toBeGreaterThan(0);

    // 步骤 2: 匹配分析
    const matching = await matcher.match(resume, jd, analysis);
    expect(matching).toBeDefined();
    expect(matching.match_score).toBeGreaterThan(0);

    // 步骤 3: 生成优化简历
    const optimized = await generator.generate(analysis, matching);
    expect(optimized).toBeDefined();
    expect(optimized.optimized_resume).toContain('# ');

    // 验证数据流转
    expect(optimized.optimized_resume.length).toBeGreaterThan(
      resume.length * 0.5
    );
  }, 60000); // 设置较长的超时时间
});
```

## 端到端测试规范

### API 测试

```typescript
describe('MVP API E2E Tests', () => {
  const baseURL = 'http://localhost:3000';

  test('GET /api/v1/mvp/health should return healthy status', async () => {
    const response = await fetch(`${baseURL}/api/v1/mvp/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('healthy');
  });

  test('POST /api/v1/mvp/analyze should analyze resume', async () => {
    const response = await fetch(`${baseURL}/api/v1/mvp/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume_markdown: '# 张三\n\n## 工作经历\n...',
      }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.analysis).toBeDefined();
    expect(data.data.analysis.quality_score).toBeGreaterThan(0);
  }, 30000);

  test('POST /api/v1/mvp/process should complete full pipeline', async () => {
    const response = await fetch(`${baseURL}/api/v1/mvp/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume_markdown: '# 张三\n\n## 工作经历\n...',
        jd_text: '岗位职责：...',
      }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.analysis).toBeDefined();
    expect(data.data.matching).toBeDefined();
    expect(data.data.optimized).toBeDefined();
  }, 60000);
});
```

## 测试数据管理

### 测试夹具（Fixtures）

创建可复用的测试数据：

```typescript
// tests/fixtures/resumes.ts
export const sampleResumes = {
  basic: `# 张三
  
## 个人信息
- 邮箱: zhangsan@example.com
- 电话: 138****1234

## 工作经历
### 软件工程师 | ABC 公司 | 2020-2023
- 负责后端开发
- 参与系统设计`,

  detailed: `# 李四
  
## 个人信息
- 邮箱: lisi@example.com
- 电话: 139****5678
- GitHub: github.com/lisi

## 教育背景
### 计算机科学与技术 | 清华大学 | 2016-2020
- GPA: 3.8/4.0
- 获得优秀毕业生称号

## 工作经历
### 高级软件工程师 | XYZ 公司 | 2020-2023
- 主导微服务架构设计，支持日均 100 万+ 请求
- 优化数据库查询性能，响应时间降低 60%
- 带领 5 人团队完成核心业务模块开发

## 项目经验
### 电商平台后端系统
- 技术栈: Node.js, PostgreSQL, Redis, Docker
- 实现订单处理、支付集成、库存管理等核心功能
- 系统上线后交易额突破 1000 万元/月

## 技能
- 编程语言: JavaScript, TypeScript, Python, Go
- 框架: Express, NestJS, Django, Gin
- 数据库: PostgreSQL, MySQL, MongoDB, Redis
- 工具: Docker, Kubernetes, Git, CI/CD`,

  minimal: `# 王五
  
软件工程师，3 年经验。`,
};

export const sampleJDs = {
  backend: `岗位名称：后端开发工程师

岗位职责：
1. 负责后端服务的设计、开发和维护
2. 参与系统架构设计和技术选型
3. 优化系统性能，提升用户体验

任职要求：
1. 本科及以上学历，计算机相关专业
2. 3 年以上后端开发经验
3. 精通 Node.js 或 Python
4. 熟悉 MySQL、Redis 等数据库
5. 有微服务架构经验者优先`,

  frontend: `岗位名称：前端开发工程师

岗位职责：
1. 负责 Web 前端开发
2. 与设计师、产品经理协作
3. 优化前端性能

任职要求：
1. 3 年以上前端开发经验
2. 精通 React 或 Vue
3. 熟悉 TypeScript
4. 有移动端开发经验者优先`,
};
```

### 使用测试夹具

```typescript
import { sampleResumes, sampleJDs } from '../fixtures/resumes';

describe('ResumeAnalyzerAgent', () => {
  test('should analyze basic resume', async () => {
    const agent = new ResumeAnalyzerAgent();
    const result = await agent.analyze(sampleResumes.basic);
    expect(result).toBeDefined();
  });

  test('should analyze detailed resume', async () => {
    const agent = new ResumeAnalyzerAgent();
    const result = await agent.analyze(sampleResumes.detailed);
    expect(result.quality_score).toBeGreaterThan(70);
  });
});
```

## 测试覆盖率

### 目标覆盖率

- 核心业务逻辑: 80%+
- Agent 类: 70%+
- 工具函数: 90%+
- API 路由: 80%+

### 运行覆盖率报告

```bash
# 使用 Bun 运行测试并生成覆盖率报告
bun test --coverage
```

## AI 输出质量测试

由于 AI 输出具有不确定性，需要特殊的测试策略：

### 1. 结构验证

```typescript
test('should return valid structure', async () => {
  const agent = new ResumeAnalyzerAgent();
  const result = await agent.analyze(sampleResumes.detailed);

  // 验证必需字段存在
  expect(result).toHaveProperty('quality_score');
  expect(result).toHaveProperty('strengths');
  expect(result).toHaveProperty('weaknesses');
  expect(result).toHaveProperty('suggestions');
  expect(result).toHaveProperty('structured_resume');

  // 验证类型
  expect(typeof result.quality_score).toBe('number');
  expect(Array.isArray(result.strengths)).toBe(true);
});
```

### 2. 范围验证

```typescript
test('should return score in valid range', async () => {
  const agent = new ResumeAnalyzerAgent();
  const result = await agent.analyze(sampleResumes.detailed);

  expect(result.quality_score).toBeGreaterThanOrEqual(0);
  expect(result.quality_score).toBeLessThanOrEqual(100);
});
```

### 3. 一致性测试

```typescript
test('should return consistent results for same input', async () => {
  const agent = new ResumeAnalyzerAgent();
  const resume = sampleResumes.detailed;

  const result1 = await agent.analyze(resume);
  const result2 = await agent.analyze(resume);

  // 分数应该相近（允许小幅波动）
  expect(Math.abs(result1.quality_score - result2.quality_score)).toBeLessThan(
    10
  );
});
```

### 4. 真实性验证

```typescript
test('should not fabricate information', async () => {
  const agent = new ResumeGeneratorAgent();
  const analysis = {
    /* ... */
  };
  const matching = {
    /* ... */
  };

  const result = await agent.generate(analysis, matching);

  // 验证生成的简历不包含原简历中不存在的公司名
  const originalCompanies = ['ABC 公司', 'XYZ 公司'];
  const generatedText = result.optimized_resume;

  // 提取生成简历中的公司名（简化示例）
  const mentionedCompanies = originalCompanies.filter((company) =>
    generatedText.includes(company)
  );

  // 所有提到的公司都应该在原简历中存在
  expect(mentionedCompanies.length).toBeGreaterThan(0);
});
```

## 性能测试

### 响应时间测试

```typescript
describe('Performance Tests', () => {
  test('should complete analysis within 15 seconds', async () => {
    const agent = new ResumeAnalyzerAgent();
    const startTime = Date.now();

    await agent.analyze(sampleResumes.detailed);

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(15000); // 15 秒
  });

  test('should complete full pipeline within 40 seconds', async () => {
    const startTime = Date.now();

    const response = await fetch('http://localhost:3000/api/v1/mvp/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume_markdown: sampleResumes.detailed,
        jd_text: sampleJDs.backend,
      }),
    });

    await response.json();

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(40000); // 40 秒
  }, 45000);
});
```

## 测试命令

```bash
# 运行所有测试
bun test

# 运行特定文件
bun test src/agents/resume-analyzer.test.ts

# 运行匹配模式的测试
bun test --test-name-pattern "should analyze"

# 监听模式
bun test --watch

# 生成覆盖率报告
bun test --coverage
```

## 持续集成

在 CI/CD 流程中集成测试：

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## 测试最佳实践清单

- [ ] 每个 Agent 都有单元测试
- [ ] 测试覆盖边界条件
- [ ] 测试覆盖错误处理
- [ ] 集成测试验证 Agent 协作
- [ ] E2E 测试验证 API 端点
- [ ] 使用测试夹具管理测试数据
- [ ] 验证 AI 输出结构和范围
- [ ] 测试响应时间性能
- [ ] 使用描述性的测试名称
- [ ] 遵循 AAA 模式组织测试
- [ ] 定期运行完整测试套件
- [ ] 在 CI/CD 中自动运行测试
