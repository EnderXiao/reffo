# Store 状态管理

本目录包含基于 Zustand 的全局状态管理实现。

## 技术栈

- **Zustand 5.0+**: 轻量级状态管理库
- **TypeScript**: 完整的类型支持
- **持久化**: 使用 Taro 存储 API 进行状态持久化

## 目录结构

```
store/
├── index.ts          # 统一导出
├── types.ts          # TypeScript 类型定义
├── resumeStore.ts    # 简历状态管理 ✅
├── jdStore.ts        # JD 状态管理 ✅
├── historyStore.ts   # 历史记录状态管理 ✅
└── optimizedStore.ts # 优化结果状态管理（待实现）
```

## 使用方法

### 基础用法

```tsx
import {useResumeStore, useJDStore, useHistoryStore} from '@/store';

function MyComponent() {
  // 使用 Resume Store
  const {resumeContent, setResumeContent, analysis} = useResumeStore();

  // 使用 JD Store
  const {jdContent, setJDContent, matching} = useJDStore();

  // 使用 History Store
  const {histories, loadHistories} = useHistoryStore();

  useEffect(() => {
    loadHistories();
  }, []);

  return (
    <View>
      <Text>{resumeContent}</Text>
      <Text>{jdContent}</Text>
    </View>
  );
}
```

### 选择性订阅

为了优化性能，可以只订阅需要的状态：

```tsx
// ✅ 推荐：只订阅需要的状态
const resumeContent = useResumeStore(state => state.resumeContent);
const setResumeContent = useResumeStore(state => state.setResumeContent);

// ❌ 避免：订阅整个 store（会导致不必要的重渲染）
const store = useResumeStore();
```

## Store 设计

### Resume Store

管理简历相关状态：

- 简历内容
- 分析结果
- 加载状态和错误

### JD Store

管理 JD 相关状态：

- JD 内容
- 匹配结果
- 加载状态和错误

### Optimized Store

管理优化结果状态：

- 优化后的简历
- 加载状态和错误

### History Store

管理历史记录状态：

- 历史记录列表
- 当前选中的历史记录
- CRUD 操作
- 本地持久化

**使用示例：**

```tsx
import {useHistoryStore} from '@/store';
import {useEffect} from 'react';

function HistoryList() {
  const {
    histories,
    loading,
    loadHistories,
    addHistory,
    updateHistory,
    deleteHistory,
    clearHistories,
    setCurrentHistory,
  } = useHistoryStore();

  // 组件挂载时加载历史记录
  useEffect(() => {
    loadHistories();
  }, []);

  // 添加新记录
  const handleAddHistory = async () => {
    const newHistory = {
      id: 'JD2026070700001',
      position: '前端工程师',
      company: 'ABC 公司',
      name: '张三',
      createdAt: new Date().toISOString(),
      qualityScore: 85,
      matchScore: 90,
      tags: ['React', 'TypeScript'],
      resumeContent: '# 张三\n...',
      jdContent: '岗位职责：...',
      optimizedContent: '# 张三（优化版）\n...',
    };

    await addHistory(newHistory);
  };

  // 更新记录
  const handleUpdateHistory = async (id: string) => {
    await updateHistory(id, {
      qualityScore: 95,
      tags: ['React', 'TypeScript', 'Node.js'],
    });
  };

  // 删除记录
  const handleDeleteHistory = async (id: string) => {
    await deleteHistory(id);
  };

  // 清空所有记录
  const handleClearAll = async () => {
    if (confirm('确定要清空所有历史记录吗？')) {
      await clearHistories();
    }
  };

  // 选中记录
  const handleSelectHistory = (history: ResumeHistory) => {
    setCurrentHistory(history);
    // 跳转到详情页...
  };

  if (loading.isLoading) {
    return <Text>加载中...</Text>;
  }

  if (loading.error) {
    return <Text>错误: {loading.error}</Text>;
  }

  return (
    <View>
      <Button onClick={handleAddHistory}>添加记录</Button>
      <Button onClick={handleClearAll}>清空所有</Button>

      {histories.map(history => (
        <View key={history.id} onClick={() => handleSelectHistory(history)}>
          <Text>
            {history.position} @ {history.company}
          </Text>
          <Text>质量评分: {history.qualityScore}</Text>
          <Text>匹配度: {history.matchScore}</Text>
          <Button onClick={() => handleUpdateHistory(history.id)}>更新</Button>
          <Button onClick={() => handleDeleteHistory(history.id)}>删除</Button>
        </View>
      ))}
    </View>
  );
}
```

**API 说明：**

- `loadHistories()`: 从本地存储加载历史记录
- `addHistory(history)`: 添加新的历史记录（自动持久化）
- `updateHistory(id, updates)`: 更新指定记录（部分更新）
- `deleteHistory(id)`: 删除指定记录
- `clearHistories()`: 清空所有历史记录
- `setCurrentHistory(history)`: 设置当前选中的记录
- `reset()`: 重置 store 到初始状态（不删除本地存储）

## 持久化配置

History Store 使用 Taro 存储 API 进行本地持久化：

```typescript
// historyStore.ts
const STORAGE_KEY = 'resume_histories';

// 加载历史记录
const histories = await getJSON<ResumeHistory[]>(STORAGE_KEY);

// 保存历史记录
await setJSON(STORAGE_KEY, updatedHistories);
```

### 持久化的 Store

- ✅ **History Store**: 持久化历史记录列表到本地存储
  - 存储键: `resume_histories`
  - 数据格式: `ResumeHistory[]`
  - 自动加载: 需要手动调用 `loadHistories()`
  - 自动保存: 所有 CRUD 操作自动持久化

- ❌ **Resume Store**: 不持久化（临时数据）
- ❌ **JD Store**: 不持久化（临时数据）
- ❌ **Optimized Store**: 不持久化（临时数据）

### 存储工具函数

使用 `@/utils/storage` 提供的工具函数：

```typescript
import {getJSON, setJSON} from '@/utils/storage';

// 存储 JSON 对象
await setJSON('key', {name: '张三', age: 25});

// 读取 JSON 对象
const data = await getJSON<User>('key');
```

## 类型安全

所有 Store 都有完整的 TypeScript 类型定义：

```typescript
// types.ts
export interface ResumeState {
  resumeContent: string;
  analysis: ResumeAnalysis | null;
  loading: LoadingState;

  // Actions
  setResumeContent: (content: string) => void;
  setAnalysis: (analysis: ResumeAnalysis | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}
```

## 最佳实践

### 1. 使用选择性订阅

```tsx
// ✅ 好的做法
const isLoading = useResumeStore(state => state.loading.isLoading);

// ❌ 不好的做法
const {loading} = useResumeStore();
const isLoading = loading.isLoading;
```

### 2. 在组件外部使用 Store

```tsx
// 可以在组件外部直接调用 store 的 actions
import {useResumeStore} from '@/store';

export async function analyzeResume(content: string) {
  const {setLoading, setAnalysis, setError} = useResumeStore.getState();

  setLoading(true);
  try {
    const result = await api.analyzeResume(content);
    setAnalysis(result);
  } catch (error) {
    setError(error.message);
  } finally {
    setLoading(false);
  }
}
```

### 3. 重置状态

```tsx
// 在页面卸载或需要清空数据时重置状态
useEffect(() => {
  return () => {
    useResumeStore.getState().reset();
  };
}, []);
```

## 开发计划

- [x] 4.1 配置 Zustand
  - ✅ 安装 zustand 依赖
  - ✅ 创建类型定义
  - ✅ 创建统一导出

- [x] 4.2 实现 Resume Store
  - ✅ 创建 resumeStore.ts
  - ✅ 实现状态管理
  - ✅ 编写单元测试（19 个测试用例）

- [x] 4.3 实现 JD Store
  - ✅ 创建 jdStore.ts
  - ✅ 实现状态管理
  - ✅ 编写单元测试（19 个测试用例）

- [x] 4.4 实现 History Store
  - ✅ 创建 historyStore.ts
  - ✅ 实现 CRUD 操作
  - ✅ 实现本地持久化
  - ✅ 编写单元测试（19 个测试用例）
  - ✅ 更新文档

- [ ] 4.5 实现 Optimized Store

## 参考资料

- [Zustand 官方文档](https://github.com/pmndrs/zustand)
- [Zustand TypeScript 指南](https://github.com/pmndrs/zustand#typescript)
- [Taro 存储 API](https://taro-docs.jd.com/docs/apis/storage/setStorage)
