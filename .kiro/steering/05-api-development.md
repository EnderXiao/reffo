---
inclusion: always
---

# API 开发规范

## API 设计原则

### 1. RESTful 风格

遵循 REST 架构风格设计 API：

- 使用名词表示资源
- 使用 HTTP 方法表示操作
- 使用 HTTP 状态码表示结果

### 2. 版本控制

在 URL 中包含 API 版本：

```
/api/v1/mvp/process
/api/v2/resume/analyze
```

### 3. 一致的响应格式

所有 API 响应使用统一的格式：

```typescript
// 成功响应
{
  "success": true,
  "data": { /* 实际数据 */ },
  "message": "操作成功"
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": { /* 可选的详细信息 */ }
  }
}
```

## Elysia 路由规范

### 基础路由结构

```typescript
import { Elysia } from 'elysia';
import type { RequestBody, ResponseData } from '@/types';

export const myRoutes = new Elysia({ prefix: '/api/v1/my-resource' })
  .get('/health', () => ({
    success: true,
    data: { status: 'healthy' },
  }))
  .post('/process', async ({ body }) => {
    try {
      // 处理逻辑
      const result = await processData(body);

      return {
        success: true,
        data: result,
        message: '处理成功',
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PROCESS_ERROR',
          message: error instanceof Error ? error.message : '处理失败',
        },
      };
    }
  });
```

### 路由组织

按功能模块组织路由：

```
backend/src/routes/
├── mvp.ts              # MVP 相关路由
├── resume.ts           # 简历管理路由
├── user.ts             # 用户相关路由
└── index.ts            # 路由汇总
```

### 路由汇总

```typescript
// routes/index.ts
import { Elysia } from 'elysia';
import { mvpRoutes } from './mvp';
import { resumeRoutes } from './resume';
import { userRoutes } from './user';

export const routes = new Elysia()
  .use(mvpRoutes)
  .use(resumeRoutes)
  .use(userRoutes);
```

## 请求验证

### 使用 Elysia 的类型验证

```typescript
import { Elysia, t } from 'elysia';

export const myRoutes = new Elysia({ prefix: '/api/v1/my-resource' }).post(
  '/process',
  async ({ body }) => {
    // body 已经过验证
    const result = await processData(body);
    return { success: true, data: result };
  },
  {
    body: t.Object({
      resume_markdown: t.String({ minLength: 1 }),
      jd_text: t.String({ minLength: 1 }),
    }),
    response: t.Object({
      success: t.Boolean(),
      data: t.Object({
        // 定义响应数据结构
      }),
    }),
  }
);
```

### 自定义验证逻辑

```typescript
.post('/process', async ({ body, error }) => {
  // 自定义验证
  if (!body.resume_markdown || body.resume_markdown.trim().length === 0) {
    return error(400, {
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: '简历内容不能为空'
      }
    })
  }

  // 处理逻辑
  // ...
})
```

## 错误处理

### 统一错误处理中间件

```typescript
import { Elysia } from 'elysia';

export const errorHandler = new Elysia().onError(({ code, error, set }) => {
  console.error('[API Error]', { code, error: error.message });

  // 根据错误类型设置状态码
  switch (code) {
    case 'VALIDATION':
      set.status = 400;
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数验证失败',
          details: error.message,
        },
      };

    case 'NOT_FOUND':
      set.status = 404;
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '资源不存在',
        },
      };

    default:
      set.status = 500;
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务器内部错误',
          details: error.message,
        },
      };
  }
});
```

### 业务错误处理

```typescript
class BusinessError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message)
    this.name = 'BusinessError'
  }
}

// 使用
.post('/process', async ({ body, error }) => {
  try {
    if (!isValidInput(body)) {
      throw new BusinessError('INVALID_INPUT', '输入数据不合法', 400)
    }

    const result = await processData(body)
    return { success: true, data: result }
  } catch (err) {
    if (err instanceof BusinessError) {
      return error(err.statusCode, {
        success: false,
        error: {
          code: err.code,
          message: err.message
        }
      })
    }

    throw err // 让全局错误处理器处理
  }
})
```

## HTTP 状态码使用

### 常用状态码

- `200 OK`: 请求成功
- `201 Created`: 资源创建成功
- `400 Bad Request`: 请求参数错误
- `401 Unauthorized`: 未认证
- `403 Forbidden`: 无权限
- `404 Not Found`: 资源不存在
- `500 Internal Server Error`: 服务器错误
- `503 Service Unavailable`: 服务不可用

### 状态码使用示例

```typescript
.post('/resume', async ({ body, set }) => {
  const resume = await createResume(body)
  set.status = 201 // 创建成功
  return { success: true, data: resume }
})

.get('/resume/:id', async ({ params, error }) => {
  const resume = await findResume(params.id)
  if (!resume) {
    return error(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: '简历不存在' }
    })
  }
  return { success: true, data: resume }
})
```

## 请求日志

### 结构化日志中间件

```typescript
export const requestLogger = new Elysia()
  .onRequest(({ request, path }) => {
    console.log('[Request]', {
      method: request.method,
      path,
      timestamp: new Date().toISOString(),
    });
  })
  .onResponse(({ request, path, set }) => {
    console.log('[Response]', {
      method: request.method,
      path,
      status: set.status,
      timestamp: new Date().toISOString(),
    });
  });
```

### 性能监控

```typescript
export const performanceMonitor = new Elysia()
  .derive(({ request }) => {
    return {
      startTime: Date.now(),
    };
  })
  .onResponse(({ request, path, startTime }) => {
    const duration = Date.now() - startTime;
    console.log('[Performance]', {
      method: request.method,
      path,
      duration: `${duration}ms`,
    });

    // 慢请求告警
    if (duration > 5000) {
      console.warn('[Slow Request]', {
        method: request.method,
        path,
        duration: `${duration}ms`,
      });
    }
  });
```

## CORS 配置

```typescript
import { cors } from '@elysiajs/cors';

const app = new Elysia().use(
  cors({
    origin:
      process.env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : true, // 开发环境允许所有来源
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
```

## API 文档

### Swagger 集成

```typescript
import { swagger } from '@elysiajs/swagger';

const app = new Elysia().use(
  swagger({
    documentation: {
      info: {
        title: 'Reffo API',
        version: '1.0.0',
        description: 'AI-powered resume optimization service',
      },
      tags: [
        { name: 'MVP', description: 'MVP endpoints' },
        { name: 'Resume', description: 'Resume management' },
      ],
    },
  })
);
```

### 路由文档注解

```typescript
.post('/process', async ({ body }) => {
  // 处理逻辑
}, {
  detail: {
    summary: '完整简历优化流程',
    description: '分析简历、匹配 JD、生成优化简历的完整流程',
    tags: ['MVP'],
    body: {
      description: '简历和 JD 内容',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              resume_markdown: {
                type: 'string',
                description: 'Markdown 格式的简历内容'
              },
              jd_text: {
                type: 'string',
                description: 'JD 文本内容'
              }
            },
            required: ['resume_markdown', 'jd_text']
          }
        }
      }
    },
    responses: {
      200: {
        description: '处理成功',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                data: {
                  type: 'object',
                  properties: {
                    analysis: { type: 'object' },
                    matching: { type: 'object' },
                    optimized: { type: 'object' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
})
```

## 速率限制

```typescript
// 简单的内存速率限制器
const rateLimiter = new Map<string, { count: number; resetTime: number }>();

export const rateLimit = (maxRequests: number, windowMs: number) => {
  return new Elysia().onRequest(({ request, error }) => {
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();

    const record = rateLimiter.get(ip);

    if (!record || now > record.resetTime) {
      rateLimiter.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      return;
    }

    if (record.count >= maxRequests) {
      return error(429, {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: '请求过于频繁，请稍后再试',
        },
      });
    }

    record.count++;
  });
};

// 使用
const app = new Elysia().use(rateLimit(100, 60000)); // 每分钟最多 100 个请求
```

## 认证和授权

### JWT 认证中间件

```typescript
import { jwt } from '@elysiajs/jwt';

const app = new Elysia()
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET!,
    })
  )
  .derive(async ({ jwt, headers, error }) => {
    const auth = headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return error(401, {
        success: false,
        error: { code: 'UNAUTHORIZED', message: '未提供认证令牌' },
      });
    }

    const token = auth.slice(7);
    const payload = await jwt.verify(token);

    if (!payload) {
      return error(401, {
        success: false,
        error: { code: 'INVALID_TOKEN', message: '无效的认证令牌' },
      });
    }

    return { user: payload };
  });
```

### 受保护的路由

```typescript
.get('/profile', async ({ user }) => {
  // user 已经通过认证中间件验证
  return {
    success: true,
    data: { userId: user.id, email: user.email }
  }
})
```

## 分页

### 分页参数

```typescript
.get('/resumes', async ({ query }) => {
  const page = parseInt(query.page || '1')
  const limit = parseInt(query.limit || '10')
  const offset = (page - 1) * limit

  const resumes = await getResumes({ limit, offset })
  const total = await countResumes()

  return {
    success: true,
    data: {
      items: resumes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  }
})
```

## 文件上传

### 处理文件上传

```typescript
.post('/upload', async ({ body }) => {
  const file = body.file

  if (!file) {
    return error(400, {
      success: false,
      error: { code: 'NO_FILE', message: '未提供文件' }
    })
  }

  // 验证文件类型
  const allowedTypes = ['application/pdf', 'application/msword']
  if (!allowedTypes.includes(file.type)) {
    return error(400, {
      success: false,
      error: { code: 'INVALID_FILE_TYPE', message: '不支持的文件类型' }
    })
  }

  // 验证文件大小（5MB）
  if (file.size > 5 * 1024 * 1024) {
    return error(400, {
      success: false,
      error: { code: 'FILE_TOO_LARGE', message: '文件大小超过限制' }
    })
  }

  // 保存文件
  const buffer = await file.arrayBuffer()
  // ... 处理文件

  return {
    success: true,
    data: { fileId: 'xxx', filename: file.name }
  }
}, {
  body: t.Object({
    file: t.File()
  })
})
```

## API 测试

### 使用 Bun 测试 API

```typescript
import { describe, test, expect } from 'bun:test';

describe('MVP API', () => {
  const baseURL = 'http://localhost:3000';

  test('POST /api/v1/mvp/process', async () => {
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
    expect(data.data).toBeDefined();
  });
});
```

## API 最佳实践清单

- [ ] 使用 RESTful 风格设计 API
- [ ] 在 URL 中包含版本号
- [ ] 使用统一的响应格式
- [ ] 实现全局错误处理
- [ ] 添加请求验证
- [ ] 使用合适的 HTTP 状态码
- [ ] 实现请求日志记录
- [ ] 配置 CORS
- [ ] 生成 Swagger 文档
- [ ] 实现速率限制
- [ ] 添加认证和授权（如需要）
- [ ] 实现分页（如需要）
- [ ] 验证文件上传（如需要）
- [ ] 编写 API 测试
- [ ] 监控 API 性能
