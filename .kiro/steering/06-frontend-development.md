---
inclusion: always
---

# 前端开发规范

## 技术栈

- **框架**: React 18.2+
- **构建工具**: Vite 5.0+
- **语言**: TypeScript 5.0+
- **样式**: CSS（原生 CSS，无预处理器）

## 项目结构

```
frontend/
├── src/
│   ├── components/        # 可复用组件
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── Card.tsx
│   ├── pages/            # 页面组件
│   │   ├── Home.tsx
│   │   └── Resume.tsx
│   ├── hooks/            # 自定义 Hooks
│   │   └── useApi.ts
│   ├── services/         # API 服务
│   │   └── api.ts
│   ├── types/            # TypeScript 类型
│   │   └── index.ts
│   ├── utils/            # 工具函数
│   │   └── helpers.ts
│   ├── App.tsx           # 主应用组件
│   ├── App.css           # 应用样式
│   ├── main.tsx          # 入口文件
│   └── index.css         # 全局样式
├── public/               # 静态资源
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 组件开发规范

### 函数组件

优先使用函数组件和 Hooks：

```typescript
import { useState, useEffect } from 'react';

interface Props {
  title: string;
  onSubmit: (data: string) => void;
}

export function MyComponent({ title, onSubmit }: Props) {
  const [value, setValue] = useState('');

  useEffect(() => {
    // 副作用逻辑
  }, []);

  const handleSubmit = () => {
    onSubmit(value);
  };

  return (
    <div>
      <h2>{title}</h2>
      <input value={value} onChange={(e) => setValue(e.target.value)} />
      <button onClick={handleSubmit}>提交</button>
    </div>
  );
}
```

### 组件命名

1. **组件文件**: PascalCase

   - `Button.tsx`
   - `ResumeCard.tsx`

2. **组件函数**: PascalCase

   - `function Button() { ... }`
   - `function ResumeCard() { ... }`

3. **Props 接口**: `ComponentNameProps`
   - `interface ButtonProps { ... }`
   - `interface ResumeCardProps { ... }`

### Props 类型定义

```typescript
// ✅ 推荐：使用 interface
interface ButtonProps {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export function Button({
  text,
  onClick,
  disabled = false,
  variant = 'primary',
}: ButtonProps) {
  // ...
}

// ❌ 避免：内联类型
export function Button({
  text,
  onClick,
}: {
  text: string;
  onClick: () => void;
}) {
  // ...
}
```

### 组件导出

```typescript
// ✅ 推荐：命名导出
export function Button(props: ButtonProps) {
  // ...
}

// ❌ 避免：默认导出（除非是页面组件）
export default function Button(props: ButtonProps) {
  // ...
}
```

## Hooks 使用规范

### 自定义 Hooks

```typescript
// hooks/useApi.ts
import { useState, useCallback } from 'react';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: () => Promise<void>;
}

export function useApi<T>(apiCall: () => Promise<T>): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiCall();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  return { data, loading, error, execute };
}
```

### Hooks 使用示例

```typescript
function ResumeAnalyzer() {
  const { data, loading, error, execute } = useApi(() =>
    analyzeResume(resumeContent)
  );

  return (
    <div>
      <button onClick={execute} disabled={loading}>
        {loading ? '分析中...' : '分析简历'}
      </button>
      {error && <div className='error'>{error}</div>}
      {data && <div className='result'>{JSON.stringify(data)}</div>}
    </div>
  );
}
```

### Hooks 规则

1. **只在顶层调用 Hooks**

```typescript
// ✅ 正确
function MyComponent() {
  const [value, setValue] = useState('');

  if (condition) {
    // 使用 value
  }
}

// ❌ 错误
function MyComponent() {
  if (condition) {
    const [value, setValue] = useState(''); // 不要在条件中调用
  }
}
```

2. **只在 React 函数中调用 Hooks**

```typescript
// ✅ 正确：在组件中
function MyComponent() {
  const [value, setValue] = useState('');
}

// ✅ 正确：在自定义 Hook 中
function useMyHook() {
  const [value, setValue] = useState('');
}

// ❌ 错误：在普通函数中
function myFunction() {
  const [value, setValue] = useState(''); // 不要在普通函数中调用
}
```

## 状态管理

### 本地状态

使用 `useState` 管理组件本地状态：

```typescript
function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>增加</button>
    </div>
  );
}
```

### 状态提升

当多个组件需要共享状态时，将状态提升到共同的父组件：

```typescript
function Parent() {
  const [sharedValue, setSharedValue] = useState('');

  return (
    <div>
      <ChildA value={sharedValue} onChange={setSharedValue} />
      <ChildB value={sharedValue} />
    </div>
  );
}
```

### Context（跨层级状态）

```typescript
import { createContext, useContext, useState } from 'react';

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  return (
    <AppContext.Provider value={{ user, setUser }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
```

## API 调用

### API 服务层

```typescript
// services/api.ts
const API_BASE_URL = 'http://localhost:3000/api/v1';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export async function analyzeResume(resumeMarkdown: string) {
  const response = await fetch(`${API_BASE_URL}/mvp/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume_markdown: resumeMarkdown }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result: ApiResponse<any> = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || '请求失败');
  }

  return result.data;
}

export async function processResume(resumeMarkdown: string, jdText: string) {
  const response = await fetch(`${API_BASE_URL}/mvp/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resume_markdown: resumeMarkdown,
      jd_text: jdText,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result: ApiResponse<any> = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || '请求失败');
  }

  return result.data;
}
```

### 在组件中使用

```typescript
import { useState } from 'react';
import { analyzeResume } from './services/api';

function ResumeAnalyzer() {
  const [resume, setResume] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await analyzeResume(resume);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <textarea
        value={resume}
        onChange={(e) => setResume(e.target.value)}
        placeholder='粘贴简历内容...'
      />
      <button onClick={handleAnalyze} disabled={loading}>
        {loading ? '分析中...' : '分析简历'}
      </button>
      {error && <div className='error'>{error}</div>}
      {result && <div className='result'>{JSON.stringify(result)}</div>}
    </div>
  );
}
```

## 样式规范

### CSS 模块化

使用 CSS 文件与组件对应：

```
Button.tsx
Button.css
```

### CSS 命名

使用 BEM 命名规范：

```css
/* Button.css */
.button {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.button--primary {
  background-color: #007bff;
  color: white;
}

.button--secondary {
  background-color: #6c757d;
  color: white;
}

.button--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### 在组件中使用

```typescript
import './Button.css';

interface ButtonProps {
  text: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  onClick: () => void;
}

export function Button({
  text,
  variant = 'primary',
  disabled = false,
  onClick,
}: ButtonProps) {
  const className = `button button--${variant} ${
    disabled ? 'button--disabled' : ''
  }`;

  return (
    <button className={className} onClick={onClick} disabled={disabled}>
      {text}
    </button>
  );
}
```

### 全局样式

```css
/* index.css */
:root {
  --color-primary: #007bff;
  --color-secondary: #6c757d;
  --color-success: #28a745;
  --color-danger: #dc3545;
  --color-warning: #ffc107;

  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  --font-size-sm: 14px;
  --font-size-md: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
    sans-serif;
  font-size: var(--font-size-md);
  line-height: 1.5;
  color: #333;
}
```

## 表单处理

### 受控组件

```typescript
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 处理提交
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type='email'
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder='邮箱'
      />
      <input
        type='password'
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder='密码'
      />
      <button type='submit'>登录</button>
    </form>
  );
}
```

### 表单验证

```typescript
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {}
  );

  const validate = () => {
    const newErrors: typeof errors = {};

    if (!email) {
      newErrors.email = '邮箱不能为空';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = '邮箱格式不正确';
    }

    if (!password) {
      newErrors.password = '密码不能为空';
    } else if (password.length < 6) {
      newErrors.password = '密码至少 6 位';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      // 提交表单
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <input
          type='email'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder='邮箱'
        />
        {errors.email && <span className='error'>{errors.email}</span>}
      </div>
      <div>
        <input
          type='password'
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder='密码'
        />
        {errors.password && <span className='error'>{errors.password}</span>}
      </div>
      <button type='submit'>登录</button>
    </form>
  );
}
```

## 错误处理

### 错误边界

```typescript
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className='error-boundary'>
            <h2>出错了</h2>
            <p>{this.state.error?.message}</p>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
```

### 使用错误边界

```typescript
function App() {
  return (
    <ErrorBoundary>
      <MyComponent />
    </ErrorBoundary>
  );
}
```

## 性能优化

### React.memo

```typescript
import { memo } from 'react';

interface Props {
  title: string;
  count: number;
}

export const ExpensiveComponent = memo(function ExpensiveComponent({
  title,
  count,
}: Props) {
  // 只在 props 变化时重新渲染
  return (
    <div>
      <h2>{title}</h2>
      <p>Count: {count}</p>
    </div>
  );
});
```

### useCallback

```typescript
import { useState, useCallback } from 'react';

function Parent() {
  const [count, setCount] = useState(0);

  // 缓存回调函数
  const handleClick = useCallback(() => {
    setCount((c) => c + 1);
  }, []);

  return <Child onClick={handleClick} />;
}
```

### useMemo

```typescript
import { useMemo } from 'react';

function ExpensiveCalculation({ data }: { data: number[] }) {
  // 缓存计算结果
  const result = useMemo(() => {
    return data.reduce((sum, n) => sum + n, 0);
  }, [data]);

  return <div>Sum: {result}</div>;
}
```

## 可访问性

### 语义化 HTML

```typescript
// ✅ 使用语义化标签
function Article() {
  return (
    <article>
      <header>
        <h1>标题</h1>
      </header>
      <main>
        <p>内容</p>
      </main>
      <footer>
        <p>页脚</p>
      </footer>
    </article>
  );
}

// ❌ 避免过度使用 div
function Article() {
  return (
    <div>
      <div>
        <div>标题</div>
      </div>
      <div>
        <div>内容</div>
      </div>
    </div>
  );
}
```

### ARIA 属性

```typescript
function Button({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      aria-label={loading ? '加载中' : '提交'}
    >
      {loading ? '加载中...' : '提交'}
    </button>
  );
}
```

## 测试

### 组件测试

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect } from 'bun:test';
import { Button } from './Button';

describe('Button', () => {
  test('renders with text', () => {
    render(<Button text='Click me' onClick={() => {}} />);
    expect(screen.getByText('Click me')).toBeDefined();
  });

  test('calls onClick when clicked', () => {
    let clicked = false;
    render(
      <Button
        text='Click me'
        onClick={() => {
          clicked = true;
        }}
      />
    );

    fireEvent.click(screen.getByText('Click me'));
    expect(clicked).toBe(true);
  });

  test('is disabled when disabled prop is true', () => {
    render(<Button text='Click me' onClick={() => {}} disabled />);
    const button = screen.getByText('Click me');
    expect(button.disabled).toBe(true);
  });
});
```

## 前端最佳实践清单

- [ ] 使用函数组件和 Hooks
- [ ] 为所有组件定义 Props 类型
- [ ] 使用命名导出（除页面组件外）
- [ ] 遵循 Hooks 规则
- [ ] 合理管理状态（本地 vs 提升 vs Context）
- [ ] 创建独立的 API 服务层
- [ ] 使用 BEM 命名 CSS 类
- [ ] 实现错误边界
- [ ] 使用 React.memo/useCallback/useMemo 优化性能
- [ ] 使用语义化 HTML
- [ ] 添加 ARIA 属性提升可访问性
- [ ] 编写组件测试
- [ ] 处理加载和错误状态
- [ ] 验证表单输入
- [ ] 使用 TypeScript 类型检查
