# Utils 工具模块

本目录包含 Reffo Taro 应用的工具函数和平台兼容层。

## 模块列表

### 平台兼容层 (platform.ts)

提供跨平台的平台检测功能。

**主要功能：**

- `getPlatform()` - 获取当前运行平台
- `isIOS()` / `isAndroid()` / `isWeapp()` / `isH5()` - 平台判断
- `isNative()` - 判断是否为原生平台
- `getPlatformName()` - 获取平台显示名称

**使用示例：**

```typescript
import {getPlatform, isIOS, PlatformType} from '@/utils/platform';

// 获取当前平台
const platform = getPlatform();
console.log('当前平台:', platform);

// 平台判断
if (isIOS()) {
  console.log('运行在 iOS 平台');
}

// 根据平台执行不同逻辑
switch (getPlatform()) {
  case PlatformType.IOS:
    // iOS 特定逻辑
    break;
  case PlatformType.WEAPP:
    // 小程序特定逻辑
    break;
  case PlatformType.H5:
    // H5 特定逻辑
    break;
}
```

### 存储适配器 (storage.ts)

提供跨平台的本地存储功能，统一封装 Taro 的存储 API。

**主要功能：**

- `StorageAdapter` 接口 - 定义统一的存储接口
- `TaroStorageAdapter` 类 - 基于 Taro API 的实现
- `storage` 单例 - 全局存储实例
- `setJSON()` / `getJSON()` - JSON 对象存储工具
- `hasKey()` - 检查键是否存在
- `getAllKeys()` - 获取所有键名
- `getStorageInfo()` - 获取存储信息

**使用示例：**

#### 基础用法

```typescript
import {storage} from '@/utils/storage';

// 存储字符串
await storage.setItem('token', 'abc123');

// 读取字符串
const token = await storage.getItem('token');
console.log('Token:', token);

// 删除数据
await storage.removeItem('token');

// 清空所有数据
await storage.clear();
```

#### JSON 对象存储

```typescript
import {setJSON, getJSON} from '@/utils/storage';

// 存储对象
const user = {
  id: '123',
  name: '张三',
  age: 25,
};
await setJSON('user', user);

// 读取对象
const savedUser = await getJSON<typeof user>('user');
if (savedUser) {
  console.log('用户名:', savedUser.name);
}
```

#### 检查键是否存在

```typescript
import {hasKey} from '@/utils/storage';

if (await hasKey('token')) {
  console.log('用户已登录');
} else {
  console.log('用户未登录');
}
```

#### 获取存储信息

```typescript
import {getAllKeys, getStorageInfo} from '@/utils/storage';

// 获取所有键名
const keys = await getAllKeys();
console.log('存储的键:', keys);

// 获取存储统计信息
const info = await getStorageInfo();
console.log(`存储了 ${info.keys.length} 个键`);
console.log(`占用空间: ${info.currentSize}KB / ${info.limitSize}KB`);
```

#### 在 Zustand Store 中使用

```typescript
import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {storage} from '@/utils/storage';

interface UserState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    set => ({
      user: null,
      setUser: user => set({user}),
    }),
    {
      name: 'user-storage',
      storage: {
        getItem: async name => {
          const value = await storage.getItem(name);
          return value ? JSON.parse(value) : null;
        },
        setItem: async (name, value) => {
          await storage.setItem(name, JSON.stringify(value));
        },
        removeItem: async name => {
          await storage.removeItem(name);
        },
      },
    },
  ),
);
```

## 错误处理

所有存储操作都包含完善的错误处理：

```typescript
import {storage} from '@/utils/storage';

try {
  await storage.setItem('key', 'value');
  console.log('存储成功');
} catch (error) {
  console.error('存储失败:', error);
  // 错误信息会包含具体的失败原因
}
```

## 类型安全

所有工具函数都提供完整的 TypeScript 类型定义：

```typescript
import {getJSON} from '@/utils/storage';

interface User {
  id: string;
  name: string;
  age: number;
}

// TypeScript 会自动推断类型
const user = await getJSON<User>('user');
if (user) {
  // user 的类型为 User | null
  console.log(user.name); // ✅ 类型安全
}
```

## 测试

所有工具函数都包含完整的单元测试，位于 `__tests__` 目录：

```bash
# 运行所有测试
npm test

# 运行特定测试
npm test -- src/utils/__tests__/storage.test.ts

# 运行测试并生成覆盖率报告
npm run test:coverage
```

## 最佳实践

1. **使用单例实例**：优先使用导出的 `storage` 单例，而不是创建新的 `TaroStorageAdapter` 实例

2. **使用 JSON 工具函数**：存储对象时使用 `setJSON()` 和 `getJSON()`，自动处理序列化

3. **错误处理**：始终使用 try-catch 包裹存储操作

4. **类型安全**：使用 TypeScript 泛型确保类型安全

5. **避免存储敏感信息**：不要在本地存储中保存密码、私钥等敏感信息

## 平台兼容性

存储适配器在以下平台上经过测试：

- ✅ iOS (React Native)
- ✅ Android (React Native)
- ✅ 微信小程序
- ✅ H5 浏览器

所有平台使用相同的 API，无需针对不同平台编写不同的代码。

### 错误处理工具 (error.ts)

提供统一的错误处理机制，包括错误分类、友好提示和错误日志。

**主要功能：**

- `AppError` 类 - 应用级错误类
- `handleError()` - 统一错误处理函数
- `showErrorToast()` - 显示错误提示
- `showErrorModal()` - 显示错误模态框
- `getErrorMessage()` - 获取友好的错误消息
- 错误创建函数 - `createNetworkError()`, `createTimeoutError()` 等
- 错误类型判断 - `isNetworkError()`, `isApiError()` 等

**使用示例：**

#### 基础错误处理

```typescript
import {handleError, showErrorToast} from '@/utils/error';

try {
  await apiCall();
} catch (error) {
  // 统一处理错误
  const appError = handleError(error, {action: 'analyzeResume'});

  // 显示错误提示
  showErrorToast(appError);
}
```

#### 创建自定义错误

```typescript
import {
  createValidationError,
  createNetworkError,
  createApiError,
} from '@/utils/error';

// 验证错误
if (!resumeContent.trim()) {
  throw createValidationError('简历内容不能为空', {field: 'resume'});
}

// 网络错误
if (!navigator.onLine) {
  throw createNetworkError('网络连接失败');
}

// API 错误
if (response.statusCode !== 200) {
  throw createApiError('服务器返回错误', {statusCode: response.statusCode});
}
```

#### 错误类型判断

```typescript
import {handleError, isNetworkError, isApiError} from '@/utils/error';

try {
  await apiCall();
} catch (error) {
  const appError = handleError(error);

  if (isNetworkError(appError)) {
    // 网络错误，提示用户检查网络
    console.log('请检查网络连接');
  } else if (isApiError(appError)) {
    // API 错误，可能需要重试
    console.log('服务器错误，请稍后重试');
  }
}
```

#### 显示错误模态框

```typescript
import {showErrorModal} from '@/utils/error';

try {
  await apiCall();
} catch (error) {
  showErrorModal(error, {
    title: '操作失败',
    confirmText: '重试',
    cancelText: '取消',
    onConfirm: () => {
      // 重试逻辑
      retry();
    },
    onCancel: () => {
      // 取消逻辑
      goBack();
    },
  });
}
```

#### 在 API 服务中使用

```typescript
import {createApiError, createTimeoutError} from '@/utils/error';
import {request} from '@/utils/request';

export async function analyzeResume(resumeMarkdown: string) {
  try {
    const response = await request.post('/api/v1/mvp/analyze', {
      resume_markdown: resumeMarkdown,
    });

    if (!response.data.success) {
      throw createApiError(response.data.error?.message || 'API 调用失败', {
        code: response.data.error?.code,
      });
    }

    return response.data.data;
  } catch (error) {
    // 处理超时错误
    if (error.code === 'TIMEOUT') {
      throw createTimeoutError();
    }

    // 重新抛出其他错误
    throw error;
  }
}
```

#### 在组件中使用

```typescript
import { useState } from 'react';
import { handleError, showErrorToast } from '@/utils/error';
import { analyzeResume } from '@/services/api';

function ResumeAnalyzer() {
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);

    try {
      const result = await analyzeResume(resumeContent);
      console.log('分析结果:', result);
    } catch (error) {
      // 统一错误处理
      const appError = handleError(error, {
        component: 'ResumeAnalyzer',
        action: 'analyze',
      });

      // 显示错误提示
      showErrorToast(appError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleAnalyze} disabled={loading}>
      {loading ? '分析中...' : '分析简历'}
    </button>
  );
}
```

**错误类型：**

- `NETWORK_ERROR` - 网络连接失败
- `TIMEOUT` - 请求超时
- `API_ERROR` - API 返回错误
- `VALIDATION_ERROR` - 输入验证失败
- `BUSINESS_ERROR` - 业务逻辑错误
- `UNKNOWN_ERROR` - 未知错误

**友好错误提示映射：**

| 错误类型         | 用户提示                           |
| ---------------- | ---------------------------------- |
| NETWORK_ERROR    | 网络连接失败，请检查网络设置       |
| TIMEOUT          | 网络请求超时，请检查网络连接后重试 |
| API_ERROR        | 服务器错误，请稍后重试             |
| VALIDATION_ERROR | 输入数据不合法，请检查后重试       |
| BUSINESS_ERROR   | 操作失败，请稍后重试               |
| UNKNOWN_ERROR    | 操作失败，请稍后重试               |

**最佳实践：**

1. **始终使用 try-catch** - 包裹所有可能失败的操作
2. **使用 handleError** - 统一处理各种类型的错误
3. **提供上下文** - 在 handleError 中传入错误上下文，便于调试
4. **友好提示** - 使用 showErrorToast 或 showErrorModal 显示用户友好的错误信息
5. **错误日志** - handleError 会自动记录错误日志到控制台
6. **类型判断** - 使用 isNetworkError 等函数判断错误类型，执行不同的处理逻辑

### 请求重试工具 (retry.ts)

提供通用的请求重试机制，支持多种退避策略和自定义重试条件。

**主要功能：**

- `retry()` - 通用重试函数
- `withRetry()` - 创建带重试的函数
- `Retry` 装饰器 - 方法装饰器，自动添加重试功能
- `retryAll()` - 批量重试多个函数
- `retryUntil()` - 条件重试，直到满足条件
- `RetryPresets` - 预设的重试配置

**使用示例：**

#### 基础用法

```typescript
import {retry} from '@/utils/retry';
import {apiClient} from '@/services/api';

// 基础重试
const result = await retry(() => apiClient.get('/data'), {maxRetries: 3});

// 自定义配置
const result = await retry(() => apiClient.post('/submit', data), {
  maxRetries: 5,
  delay: 2000,
  backoff: 'exponential',
  maxDelay: 30000,
});
```

#### 退避策略

```typescript
import {retry} from '@/utils/retry';

// 固定延迟：每次重试延迟相同
await retry(fn, {
  maxRetries: 3,
  delay: 1000,
  backoff: 'fixed', // 每次延迟 1000ms
});

// 线性延迟：延迟线性增长
await retry(fn, {
  maxRetries: 3,
  delay: 1000,
  backoff: 'linear', // 第1次: 1000ms, 第2次: 2000ms, 第3次: 3000ms
});

// 指数延迟：延迟指数增长（推荐）
await retry(fn, {
  maxRetries: 3,
  delay: 1000,
  backoff: 'exponential', // 第1次: 1000ms, 第2次: 2000ms, 第3次: 4000ms
});

// 限制最大延迟
await retry(fn, {
  maxRetries: 5,
  delay: 1000,
  backoff: 'exponential',
  maxDelay: 10000, // 延迟不超过 10 秒
});
```

#### 自定义重试条件

```typescript
import {retry} from '@/utils/retry';

// 只在特定错误时重试
const result = await retry(() => apiClient.get('/data'), {
  maxRetries: 3,
  shouldRetry: (error, attempt) => {
    // 只重试网络错误和超时错误
    return error.type === 'NETWORK_ERROR' || error.type === 'TIMEOUT';
  },
});

// 根据重试次数决定是否继续
const result = await retry(() => apiClient.get('/data'), {
  maxRetries: 5,
  shouldRetry: (error, attempt) => {
    // 前 3 次重试所有错误，之后只重试网络错误
    if (attempt <= 3) return true;
    return error.type === 'NETWORK_ERROR';
  },
});
```

#### 监听重试事件

```typescript
import {retry} from '@/utils/retry';
import Taro from '@tarojs/taro';

const result = await retry(() => apiClient.get('/data'), {
  maxRetries: 3,
  onRetry: (error, attempt, delay) => {
    console.log(`第 ${attempt} 次重试，延迟 ${delay}ms`);

    // 显示重试提示
    Taro.showToast({
      title: `正在重试 (${attempt}/3)`,
      icon: 'loading',
      duration: delay,
    });
  },
});
```

#### 使用 withRetry 创建带重试的函数

```typescript
import {withRetry} from '@/utils/retry';
import {apiClient} from '@/services/api';

// 创建带重试的 API 调用函数
const fetchDataWithRetry = withRetry(() => apiClient.get('/data'), {
  maxRetries: 3,
});

// 使用
const data = await fetchDataWithRetry();
```

#### 使用装饰器

```typescript
import {Retry} from '@/utils/retry';

class ApiService {
  @Retry({maxRetries: 3, delay: 1000})
  async fetchData() {
    return await apiClient.get('/data');
  }

  @Retry({maxRetries: 5, backoff: 'exponential'})
  async submitData(data: any) {
    return await apiClient.post('/submit', data);
  }
}
```

#### 批量重试

```typescript
import {retryAll} from '@/utils/retry';

// 并发执行多个请求，每个都有独立的重试机制
const results = await retryAll(
  [
    () => apiClient.get('/data1'),
    () => apiClient.get('/data2'),
    () => apiClient.get('/data3'),
  ],
  {maxRetries: 3},
);

console.log('所有结果:', results);
```

#### 条件重试（轮询）

```typescript
import {retryUntil} from '@/utils/retry';

// 轮询直到数据准备好
const data = await retryUntil(
  () => apiClient.get('/status'),
  result => result.status === 'ready',
  {
    maxRetries: 10,
    delay: 2000,
    backoff: 'fixed',
  },
);

console.log('数据已准备好:', data);
```

#### 使用预设配置

```typescript
import {retry, RetryPresets} from '@/utils/retry';

// 快速重试（2次，固定500ms延迟）
await retry(fn, RetryPresets.fast);

// 标准重试（3次，指数退避，初始1000ms）
await retry(fn, RetryPresets.standard);

// 持久重试（5次，指数退避，初始2000ms，最大30秒）
await retry(fn, RetryPresets.persistent);

// 轮询重试（10次，固定3000ms延迟）
await retry(fn, RetryPresets.polling);

// 覆盖预设配置
await retry(fn, {
  ...RetryPresets.standard,
  maxRetries: 5, // 覆盖重试次数
});
```

#### 在 API 客户端中集成

```typescript
import {ApiClient} from '@/services/api';

// 创建启用重试的 API 客户端
const apiClient = new ApiClient({
  baseURL: 'http://localhost:3000/api/v1',
  timeout: 30000,
  retry: {
    maxRetries: 3,
    delay: 1000,
    backoff: 'exponential',
  },
});

// 所有请求自动重试
const data = await apiClient.get('/data');

// 禁用重试
const apiClientNoRetry = new ApiClient({
  baseURL: 'http://localhost:3000/api/v1',
  retry: false, // 禁用重试
});
```

**退避策略对比：**

| 策略        | 延迟计算公式          | 示例（delay=1000ms）           |
| ----------- | --------------------- | ------------------------------ |
| fixed       | delay                 | 1000ms, 1000ms, 1000ms         |
| linear      | delay × attempt       | 1000ms, 2000ms, 3000ms         |
| exponential | delay × 2^(attempt-1) | 1000ms, 2000ms, 4000ms, 8000ms |

**预设配置：**

| 预设       | maxRetries | delay | backoff     | maxDelay | 适用场景         |
| ---------- | ---------- | ----- | ----------- | -------- | ---------------- |
| fast       | 2          | 500ms | fixed       | -        | 快速失败的操作   |
| standard   | 3          | 1s    | exponential | -        | 一般 API 请求    |
| persistent | 5          | 2s    | exponential | 30s      | 重要的长时间操作 |
| polling    | 10         | 3s    | fixed       | -        | 轮询状态直到完成 |

**默认行为：**

- **默认重试次数**: 3 次
- **默认延迟**: 1000ms
- **默认退避策略**: exponential（指数退避）
- **默认重试条件**: 只重试网络错误和超时错误
- **最大延迟**: 30000ms（30秒）

**最佳实践：**

1. **选择合适的退避策略** - 一般情况使用指数退避，轮询使用固定延迟
2. **设置最大延迟** - 使用指数退避时设置 maxDelay 避免延迟过长
3. **自定义重试条件** - 根据业务需求决定哪些错误需要重试
4. **监听重试事件** - 在重试时给用户反馈，提升用户体验
5. **使用预设配置** - 优先使用预设配置，减少配置代码
6. **避免过度重试** - 合理设置重试次数，避免浪费资源
7. **幂等性** - 确保重试的操作是幂等的，多次执行结果相同

**与 API 客户端集成：**

API 客户端默认启用重试机制，使用标准配置（3次重试，指数退避）。所有通过 `apiClient.get()`, `apiClient.post()` 等方法发起的请求都会自动重试网络错误和超时错误。

```typescript
import {apiClient} from '@/services/api';

// 自动重试
const data = await apiClient.get('/data');

// 如需自定义重试配置，创建新的客户端实例
import {ApiClient} from '@/services/api';

const customClient = new ApiClient({
  baseURL: 'http://localhost:3000/api/v1',
  retry: {
    maxRetries: 5,
    delay: 2000,
    backoff: 'exponential',
    onRetry: (error, attempt, delay) => {
      console.log(`重试中: ${attempt}/5`);
    },
  },
});
```
