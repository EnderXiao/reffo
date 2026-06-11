# API 服务层

API 服务层提供统一的后端接口调用能力，封装了网络请求、错误处理、认证等功能。

## 目录结构

```
services/
├── api.ts              # API 客户端基类
├── resume.ts           # 简历 API 服务
├── index.ts            # 统一导出
├── __tests__/
│   ├── api.test.ts     # API 客户端测试
│   └── resume.test.ts  # 简历 API 测试
└── README.md           # 本文档
```

## 核心模块

### ApiClient - API 客户端基类

`ApiClient` 是所有 API 调用的基础类，提供统一的请求/响应处理。

#### 特性

- ✅ 统一的 baseURL 配置
- ✅ 自动添加通用请求头
- ✅ 统一的响应格式处理
- ✅ 统一的错误处理
- ✅ 请求/响应日志记录
- ✅ 支持认证 token
- ✅ TypeScript 类型安全

#### 基本使用

```typescript
import {apiClient} from '@/services/api';

// GET 请求
const data = await apiClient.get('/mvp/health');

// POST 请求
const result = await apiClient.post('/mvp/analyze', {
  resume_markdown: '# 张三\n...',
});

// PUT 请求
const updated = await apiClient.put('/users/1', {
  name: '李四',
});

// DELETE 请求
await apiClient.delete('/users/1');
```

#### 创建自定义实例

```typescript
import {ApiClient} from '@/services/api';

const customClient = new ApiClient({
  baseURL: 'https://custom-api.com/v1',
  timeout: 60000, // 60 秒
  enableLog: true,
});
```

#### 认证 Token

```typescript
// 设置 token
apiClient.setAuthToken('your-token-here');

// 获取 token
const token = apiClient.getAuthToken();

// 清除 token
apiClient.setAuthToken(null);
```

#### 类型安全

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

// 使用泛型指定响应类型
const user = await apiClient.get<User>('/users/1');
console.log(user.name); // TypeScript 知道 user 有 name 属性
```

## 响应格式

所有 API 响应遵循统一格式：

```typescript
interface ApiResponse<T> {
  success: boolean; // 是否成功
  data?: T; // 响应数据
  error?: {
    // 错误信息（仅在失败时）
    code: string;
    message: string;
    details?: any;
  };
  message?: string; // 可选的消息
}
```

### 成功响应示例

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "张三"
  }
}
```

### 错误响应示例

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数验证失败",
    "details": {
      "field": "email",
      "reason": "格式不正确"
    }
  }
}
```

## 错误处理

API 客户端会自动处理各种错误情况：

### 业务错误

当 API 返回 `success: false` 时，会抛出 `RequestError`：

```typescript
import {RequestError} from '@/utils/request';

try {
  await apiClient.post('/users', {email: 'invalid'});
} catch (error) {
  if (error instanceof RequestError) {
    console.error('错误码:', error.code); // VALIDATION_ERROR
    console.error('错误信息:', error.message); // 参数验证失败
    console.error('状态码:', error.statusCode); // 400
  }
}
```

### HTTP 错误

当 HTTP 状态码不是 2xx 时，会抛出错误：

```typescript
try {
  await apiClient.get('/not-found');
} catch (error) {
  if (error instanceof RequestError) {
    console.error('HTTP 错误:', error.statusCode); // 404
  }
}
```

### 网络错误

当网络请求失败时（超时、断网等），会抛出错误：

```typescript
try {
  await apiClient.get('/endpoint');
} catch (error) {
  if (error instanceof RequestError) {
    if (error.code === 'TIMEOUT') {
      console.error('请求超时');
    } else if (error.code === 'NETWORK_ERROR') {
      console.error('网络连接失败');
    }
  }
}
```

## 拦截器

API 客户端内置了请求/响应拦截器：

### 请求拦截器

自动处理：

- 添加 baseURL
- 添加 `Content-Type: application/json` 头
- 添加认证 token（如果已设置）
- 记录请求日志

### 响应拦截器

自动处理：

- 检查业务错误（`success: false`）
- 提取 `data` 字段
- 记录响应日志

### 错误拦截器

自动处理：

- 记录错误日志
- 统一错误格式

## 配置

### 环境变量

API 客户端支持通过环境变量配置：

```bash
# API 基础 URL
API_BASE_URL=http://localhost:3000/api/v1

# 环境
NODE_ENV=development
```

### 默认配置

```typescript
{
  baseURL: process.env.API_BASE_URL || 'http://localhost:3000/api/v1',
  timeout: 30000, // 30 秒
  enableLog: process.env.NODE_ENV === 'development'
}
```

## 日志

在开发环境下，API 客户端会自动记录日志：

### 请求日志

```
[API Request] {
  method: 'POST',
  url: 'http://localhost:3000/api/v1/mvp/analyze',
  data: { resume_markdown: '...' },
  timestamp: '2025-01-01T12:00:00.000Z'
}
```

### 响应日志

```
[API Response] {
  url: 'http://localhost:3000/api/v1/mvp/analyze',
  statusCode: 200,
  success: true,
  timestamp: '2025-01-01T12:00:01.000Z'
}
```

### 错误日志

```
[API Error] {
  code: 'VALIDATION_ERROR',
  message: '参数验证失败',
  statusCode: 400,
  timestamp: '2025-01-01T12:00:01.000Z'
}
```

## 测试

运行测试：

```bash
bun test src/services/__tests__/api.test.ts
```

测试覆盖：

- ✅ 构造函数和配置
- ✅ 认证 token 管理
- ✅ GET/POST/PUT/DELETE 请求
- ✅ 错误处理（业务错误、HTTP 错误、网络错误）
- ✅ 响应格式处理
- ✅ 请求拦截器
- ✅ TypeScript 类型安全

## 最佳实践

### 1. 使用默认实例

对于大多数场景，使用默认导出的 `apiClient` 实例：

```typescript
import {apiClient} from '@/services/api';

const data = await apiClient.get('/endpoint');
```

### 2. 定义类型接口

为 API 响应定义 TypeScript 接口：

```typescript
interface ResumeAnalysis {
  quality_score: number;
  strengths: string[];
  weaknesses: string[];
}

const analysis = await apiClient.post<ResumeAnalysis>('/mvp/analyze', {
  resume_markdown: '...',
});
```

### 3. 统一错误处理

在组件或页面级别统一处理错误：

```typescript
import Taro from '@tarojs/taro';
import {RequestError} from '@/utils/request';

async function handleApiCall() {
  try {
    const data = await apiClient.get('/endpoint');
    return data;
  } catch (error) {
    if (error instanceof RequestError) {
      Taro.showToast({
        title: error.message,
        icon: 'none',
      });
    }
    throw error;
  }
}
```

### 4. 使用 async/await

优先使用 async/await 而非 Promise 链：

```typescript
// ✅ 推荐
async function fetchData() {
  const data = await apiClient.get('/endpoint');
  return data;
}

// ❌ 避免
function fetchData() {
  return apiClient.get('/endpoint').then(data => data);
}
```

### 5. 设置合适的超时时间

根据接口特点设置超时时间：

```typescript
// 快速接口：10 秒
const quickClient = new ApiClient({
  baseURL: 'https://api.example.com',
  timeout: 10000,
});

// 慢速接口（如 AI 处理）：60 秒
const slowClient = new ApiClient({
  baseURL: 'https://api.example.com',
  timeout: 60000,
});
```

## 相关文档

- [请求适配器](../utils/request.ts) - 底层网络请求实现
- [API 开发规范](../../../../.kiro/steering/05-api-development.md) - API 开发指南
- [错误处理](../utils/README.md#错误处理) - 错误处理工具

## 后续扩展

计划添加的功能：

- [ ] 请求重试机制
- [ ] 请求缓存
- [ ] 请求取消
- [ ] 上传进度
- [ ] 下载进度
- [ ] 批量请求
- [ ] 请求队列

---

## 简历 API 服务

### ResumeApi - 简历相关接口

`ResumeApi` 提供简历分析和优化相关的 API 调用方法。

#### 特性

- ✅ 简历分析（质量评分、优势劣势）
- ✅ 完整优化流程（分析 + 匹配 + 生成）
- ✅ 输入验证
- ✅ 详细的 JSDoc 注释
- ✅ TypeScript 类型安全
- ✅ 完整的单元测试

#### 基本使用

```typescript
import {resumeApi} from '@/services/resume';

// 分析简历
const analysis = await resumeApi.analyzeResume(`
  # 张三
  
  ## 工作经历
  ### 软件工程师 | ABC 公司 | 2020-2023
  - 负责后端开发
`);

console.log('质量评分:', analysis.quality_score);
console.log('优势:', analysis.strengths);
console.log('劣势:', analysis.weaknesses);

// 完整优化流程
const result = await resumeApi.processResume(
  `# 张三\n\n## 工作经历\n...`,
  `岗位名称：后端开发工程师\n\n岗位职责：\n...`,
);

console.log('简历分析:', result.analysis);
console.log('匹配度:', result.matching.match_score);
console.log('优化后的简历:', result.optimized.optimized_resume);
```

### API 方法

#### analyzeResume(resumeMarkdown: string)

分析简历内容，返回质量评分和优化建议。

**参数:**

- `resumeMarkdown` (string): Markdown 格式的简历内容（最少 10 个字符）

**返回值:**

```typescript
interface ResumeAnalysis {
  quality_score: number; // 质量评分 0-100
  strengths: string[]; // 优势列表
  weaknesses: string[]; // 劣势列表
  suggestions: string[]; // 优化建议
  capability_summary: string; // 能力总结
  structured_resume: StructuredResume; // 结构化简历数据
}
```

**错误:**

- 简历内容为空或过短：抛出 `Error`
- API 调用失败：抛出 `RequestError`

**示例:**

```typescript
try {
  const analysis = await resumeApi.analyzeResume(resumeContent);

  // 显示质量评分
  console.log(`质量评分: ${analysis.quality_score}/100`);

  // 显示优势
  analysis.strengths.forEach(strength => {
    console.log(`✓ ${strength}`);
  });

  // 显示劣势
  analysis.weaknesses.forEach(weakness => {
    console.log(`✗ ${weakness}`);
  });
} catch (error) {
  if (error instanceof RequestError) {
    console.error('分析失败:', error.message);
  }
}
```

#### processResume(resumeMarkdown: string, jdText: string)

执行完整的简历优化流程：分析 → 匹配 → 生成。

**参数:**

- `resumeMarkdown` (string): Markdown 格式的简历内容（最少 10 个字符）
- `jdText` (string): JD 文本内容（最少 10 个字符）

**返回值:**

```typescript
interface ProcessResult {
  analysis: ResumeAnalysis; // 简历分析结果
  matching: MatchingResult; // 匹配分析结果
  optimized: OptimizedResume; // 优化结果
}

interface MatchingResult {
  match_score: number; // 匹配度 0-100
  hard_requirements_match: HardRequirement[]; // 硬性要求匹配
  skill_match: SkillMatch; // 技能匹配
  experience_match: ExperienceMatch; // 经验匹配
  optimization_suggestions: string[]; // 优化建议
}

interface OptimizedResume {
  optimized_resume: string; // 优化后的简历（Markdown）
  changes_summary: string[]; // 变更摘要
  improvement_score: number; // 改进分数
}
```

**错误:**

- 简历或 JD 内容为空或过短：抛出 `Error`
- API 调用失败：抛出 `RequestError`

**性能:**

- 预计响应时间：15-40 秒
- 建议使用加载提示

**示例:**

```typescript
import Taro from '@tarojs/taro';

async function optimizeResume(resume: string, jd: string) {
  // 显示加载提示
  Taro.showLoading({
    title: '正在优化简历...',
    mask: true,
  });

  try {
    const result = await resumeApi.processResume(resume, jd);

    Taro.hideLoading();

    // 显示结果
    console.log('分析完成！');
    console.log(`质量评分: ${result.analysis.quality_score}/100`);
    console.log(`匹配度: ${result.matching.match_score}/100`);
    console.log(`改进分数: ${result.optimized.improvement_score}`);

    // 显示优化后的简历
    console.log('优化后的简历:');
    console.log(result.optimized.optimized_resume);

    return result;
  } catch (error) {
    Taro.hideLoading();

    if (error instanceof RequestError) {
      Taro.showToast({
        title: error.message,
        icon: 'none',
        duration: 3000,
      });
    }

    throw error;
  }
}
```

### 在组件中使用

#### 简历分析示例

```typescript
import {useState} from 'react';
import {View, Button, Textarea} from '@tarojs/components';
import {resumeApi} from '@/services/resume';
import type {ResumeAnalysis} from '@/types';

export default function ResumeAnalyzer() {
  const [resume, setResume] = useState('');
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!resume.trim()) {
      Taro.showToast({
        title: '请输入简历内容',
        icon: 'none',
      });
      return;
    }

    setLoading(true);

    try {
      const result = await resumeApi.analyzeResume(resume);
      setAnalysis(result);

      Taro.showToast({
        title: '分析完成',
        icon: 'success',
      });
    } catch (error) {
      console.error('分析失败:', error);
      Taro.showToast({
        title: '分析失败，请重试',
        icon: 'none',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <Textarea
        value={resume}
        onInput={e => setResume(e.detail.value)}
        placeholder='请输入简历内容（Markdown 格式）'
      />

      <Button onClick={handleAnalyze} loading={loading}>
        分析简历
      </Button>

      {analysis && (
        <View>
          <Text>质量评分: {analysis.quality_score}/100</Text>
          <Text>优势: {analysis.strengths.join(', ')}</Text>
          <Text>劣势: {analysis.weaknesses.join(', ')}</Text>
        </View>
      )}
    </View>
  );
}
```

#### 完整优化流程示例

```typescript
import {useState} from 'react';
import {View, Button, Textarea} from '@tarojs/components';
import {resumeApi} from '@/services/resume';
import type {ProcessResult} from '@/types';

export default function ResumeOptimizer() {
  const [resume, setResume] = useState('');
  const [jd, setJd] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOptimize = async () => {
    // 验证输入
    if (!resume.trim() || !jd.trim()) {
      Taro.showToast({
        title: '请输入简历和 JD 内容',
        icon: 'none',
      });
      return;
    }

    setLoading(true);

    Taro.showLoading({
      title: '正在优化...',
      mask: true,
    });

    try {
      const optimized = await resumeApi.processResume(resume, jd);
      setResult(optimized);

      Taro.hideLoading();
      Taro.showToast({
        title: '优化完成',
        icon: 'success',
      });
    } catch (error) {
      console.error('优化失败:', error);

      Taro.hideLoading();
      Taro.showToast({
        title: '优化失败，请重试',
        icon: 'none',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <Textarea
        value={resume}
        onInput={e => setResume(e.detail.value)}
        placeholder='请输入简历内容'
      />

      <Textarea
        value={jd}
        onInput={e => setJd(e.detail.value)}
        placeholder='请输入 JD 内容'
      />

      <Button onClick={handleOptimize} loading={loading}>
        开始优化
      </Button>

      {result && (
        <View>
          <Text>质量评分: {result.analysis.quality_score}/100</Text>
          <Text>匹配度: {result.matching.match_score}/100</Text>
          <Text>改进分数: {result.optimized.improvement_score}</Text>
          <View>{result.optimized.optimized_resume}</View>
        </View>
      )}
    </View>
  );
}
```

### 错误处理最佳实践

```typescript
import {RequestError} from '@/utils/request';

async function handleResumeAnalysis(resume: string) {
  try {
    // 前置验证
    if (!resume || resume.trim().length < 10) {
      throw new Error('简历内容不能为空且至少需要 10 个字符');
    }

    // 调用 API
    const analysis = await resumeApi.analyzeResume(resume);

    return analysis;
  } catch (error) {
    // 区分错误类型
    if (error instanceof RequestError) {
      // 网络或 API 错误
      switch (error.code) {
        case 'TIMEOUT':
          console.error('请求超时，请检查网络连接');
          break;
        case 'NETWORK_ERROR':
          console.error('网络连接失败');
          break;
        case 'ANALYSIS_FAILED':
          console.error('AI 分析失败，请稍后重试');
          break;
        default:
          console.error('请求失败:', error.message);
      }
    } else if (error instanceof Error) {
      // 验证错误
      console.error('输入错误:', error.message);
    } else {
      // 未知错误
      console.error('未知错误');
    }

    throw error;
  }
}
```

### 性能优化建议

#### 1. 使用加载提示

```typescript
async function analyzeWithLoading(resume: string) {
  Taro.showLoading({
    title: '分析中...',
    mask: true,
  });

  try {
    const result = await resumeApi.analyzeResume(resume);
    return result;
  } finally {
    Taro.hideLoading();
  }
}
```

#### 2. 防抖处理

```typescript
import {debounce} from 'lodash';

const debouncedAnalyze = debounce(async (resume: string) => {
  const result = await resumeApi.analyzeResume(resume);
  // 处理结果
}, 1000);
```

#### 3. 缓存结果

```typescript
const analysisCache = new Map<string, ResumeAnalysis>();

async function analyzeWithCache(resume: string) {
  // 生成缓存键
  const cacheKey = hashString(resume);

  // 检查缓存
  if (analysisCache.has(cacheKey)) {
    return analysisCache.get(cacheKey)!;
  }

  // 调用 API
  const result = await resumeApi.analyzeResume(resume);

  // 缓存结果
  analysisCache.set(cacheKey, result);

  return result;
}
```

### 测试

运行测试：

```bash
bun test src/services/__tests__/resume.test.ts
```

测试覆盖：

- ✅ 简历分析成功场景
- ✅ 完整优化流程成功场景
- ✅ 输入验证（空内容、过短内容）
- ✅ API 错误处理
- ✅ 网络错误处理
- ✅ 边界条件（最小有效长度）
- ✅ 改进分数计算
- ✅ TypeScript 类型安全

### API 端点参考

#### POST /api/v1/mvp/analyze

分析简历

**请求:**

```json
{
  "resume_markdown": "# 张三\n\n## 工作经历\n..."
}
```

**响应:**

```json
{
  "success": true,
  "data": {
    "analysis": {
      "quality_score": 75,
      "strengths": ["优势1", "优势2"],
      "weaknesses": ["问题1"],
      "suggestions": ["建议1"],
      "capability_summary": "能力总结",
      "structured_resume": {
        "personal_info": {...},
        "education": [...],
        "experience": [...],
        "projects": [...],
        "skills": {...}
      }
    }
  }
}
```

#### POST /api/v1/mvp/process

完整优化流程

**请求:**

```json
{
  "resume_markdown": "# 张三\n\n## 工作经历\n...",
  "jd_text": "岗位职责：..."
}
```

**响应:**

```json
{
  "success": true,
  "data": {
    "step1_analysis": {...},
    "step2_matching": {
      "match_score": 80,
      "hard_requirements_match": [...],
      "skill_match": {...},
      "experience_match": {...},
      "optimization_suggestions": [...]
    },
    "step3_optimized_resume": "# 张三\n\n## 工作经历\n..."
  }
}
```

### 相关文档

- [API 客户端](./api.ts) - API 客户端基类
- [类型定义](../types/index.ts) - TypeScript 类型定义
- [后端 API](../../../../backend/src/routes/mvp.ts) - 后端 API 实现

---

## 变更日志

### v0.1.0 (2025-01-01)

- ✅ 实现 API 客户端基类
- ✅ 支持 GET/POST/PUT/DELETE 方法
- ✅ 实现请求/响应拦截器
- ✅ 实现统一错误处理
- ✅ 添加认证 token 支持
- ✅ 添加日志记录
- ✅ 完整的单元测试
