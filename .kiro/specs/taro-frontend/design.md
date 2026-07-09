# Design Document - Taro 前端重构

## Overview

本设计文档描述了 Reffo 项目从 Web MVP 到 0.1 版本的前端架构重构方案。采用 Taro 框架构建跨平台应用，首先支持 iOS 平台，后续扩展到微信小程序和 H5 平台。

### 核心目标

1. **跨平台支持**: 一套代码编译到 iOS、小程序、H5
2. **原生体验**: 使用 Taro Native Shell 提供原生应用体验
3. **可维护性**: 清晰的架构分层和代码组织
4. **可扩展性**: 易于添加新功能和新平台
5. **性能优化**: 快速响应和流畅交互

### 技术选型

- **框架**: Taro 3.6+
- **UI 库**: React 18+
- **语言**: TypeScript 5.0+
- **状态管理**: Zustand
- **样式方案**: CSS Modules + CSS Variables
- **构建工具**: Webpack 5 (Taro 内置)
- **包管理器**: pnpm

## Architecture

### 整体架构

```
┌─────────────────────────────────────────────────┐
│                  Taro Application               │
├─────────────────────────────────────────────────┤
│  Pages Layer                                    │
│  ├─ Home Page (首页)                            │
│  ├─ Result Page (结果页)                        │
│  └─ Settings Page (设置页)                      │
├─────────────────────────────────────────────────┤
│  Components Layer                               │
│  ├─ UI Components (Button, Input, Card)        │
│  ├─ Business Components (ResumeUploader)       │
│  └─ Layout Components (Header, Footer)         │
├─────────────────────────────────────────────────┤
│  Services Layer                                 │
│  ├─ API Service (后端接口调用)                  │
│  ├─ Storage Service (本地存储)                  │
│  └─ Platform Service (平台能力封装)             │
├─────────────────────────────────────────────────┤
│  Store Layer (Zustand)                          │
│  ├─ Resume Store                                │
│  ├─ JD Store                                    │
│  └─ UI Store                                    │
├─────────────────────────────────────────────────┤
│  Utils Layer                                    │
│  ├─ Platform Compatibility (兼容层)             │
│  ├─ Validators (验证工具)                       │
│  └─ Helpers (辅助函数)                          │
└─────────────────────────────────────────────────┘
         ↓                    ↓                ↓
    iOS Native          WeChat Mini       H5 Browser
   (Native Shell)        Program
```

### 目录结构

```
frontend/Taro/
├── src/
│   ├── app.config.ts           # 应用配置
│   ├── app.ts                  # 应用入口
│   ├── app.scss                # 全局样式
│   ├── pages/                  # 页面
│   │   ├── index/              # 首页
│   │   │   ├── index.tsx
│   │   │   ├── index.module.scss
│   │   │   └── index.config.ts
│   │   ├── result/             # 结果页
│   │   │   ├── index.tsx
│   │   │   ├── index.module.scss
│   │   │   └── index.config.ts
│   │   └── settings/           # 设置页
│   │       ├── index.tsx
│   │       ├── index.module.scss
│   │       └── index.config.ts
│   ├── components/             # 组件
│   │   ├── ui/                 # UI 基础组件
│   │   │   ├── Button/
│   │   │   │   ├── index.tsx
│   │   │   │   └── index.module.scss
│   │   │   ├── Input/
│   │   │   ├── Card/
│   │   │   └── index.ts        # 统一导出
│   │   ├── business/           # 业务组件
│   │   │   ├── ResumeUploader/
│   │   │   ├── JDInput/
│   │   │   └── ResultDisplay/
│   │   └── layout/             # 布局组件
│   │       ├── Header/
│   │       └── Footer/
│   ├── services/               # 服务层
│   │   ├── api/                # API 服务
│   │   │   ├── index.ts
│   │   │   ├── resume.ts
│   │   │   └── types.ts
│   │   ├── storage/            # 存储服务
│   │   │   └── index.ts
│   │   └── platform/           # 平台服务
│   │       └── index.ts
│   ├── store/                  # 状态管理
│   │   ├── index.ts
│   │   ├── resume.ts
│   │   ├── jd.ts
│   │   └── ui.ts
│   ├── utils/                  # 工具函数
│   │   ├── platform.ts         # 平台兼容层
│   │   ├── validator.ts        # 验证工具
│   │   └── helpers.ts          # 辅助函数
│   ├── styles/                 # 样式
│   │   ├── variables.scss      # 设计 token
│   │   ├── mixins.scss         # 样式混入
│   │   └── reset.scss          # 样式重置
│   ├── types/                  # 类型定义
│   │   └── index.ts
│   └── constants/              # 常量
│       └── index.ts
├── config/                     # 配置文件
│   ├── index.ts                # 通用配置
│   ├── dev.ts                  # 开发环境
│   └── prod.ts                 # 生产环境
├── native-shell/               # 原生壳（iOS）
│   └── ios/
│       └── TaroNativeShell/
├── package.json
├── tsconfig.json
├── project.config.json         # 小程序配置
└── .eslintrc.js
```

## Components and Interfaces

### 1. 平台兼容层 (Platform Compatibility Layer)

```typescript
// src/utils/platform.ts

/**
 * 平台类型枚举
 */
export enum PlatformType {
  IOS = 'ios',
  ANDROID = 'android',
  WEAPP = 'weapp',
  H5 = 'h5',
}

/**
 * 获取当前平台
 */
export function getPlatform(): PlatformType {
  // 实现平台检测逻辑
}

/**
 * 平台兼容的存储接口
 */
export interface StorageAdapter {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * 平台兼容的网络请求接口
 */
export interface RequestAdapter {
  request<T>(config: RequestConfig): Promise<T>;
}

/**
 * 平台兼容的导航接口
 */
export interface NavigationAdapter {
  navigateTo(url: string, params?: Record<string, any>): Promise<void>;
  navigateBack(delta?: number): Promise<void>;
  redirectTo(url: string, params?: Record<string, any>): Promise<void>;
}
```

### 2. API 服务层

```typescript
// src/services/api/types.ts

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface ResumeAnalysis {
  quality_score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  structured_resume: StructuredResume;
}

export interface MatchingResult {
  match_score: number;
  hard_requirements_match: HardRequirement[];
  skill_match: SkillMatch;
  experience_match: ExperienceMatch;
  optimization_suggestions: string[];
}

export interface OptimizedResume {
  optimized_resume: string;
  changes_summary: string[];
  improvement_score: number;
}

// src/services/api/index.ts

export class ApiService {
  private baseURL: string;
  private timeout: number;

  constructor(config: ApiConfig) {
    this.baseURL = config.baseURL;
    this.timeout = config.timeout;
  }

  /**
   * 分析简历
   */
  async analyzeResume(resumeMarkdown: string): Promise<ResumeAnalysis> {
    // 实现 API 调用
  }

  /**
   * 完整优化流程
   */
  async processResume(
    resumeMarkdown: string,
    jdText: string
  ): Promise<{
    analysis: ResumeAnalysis;
    matching: MatchingResult;
    optimized: OptimizedResume;
  }> {
    // 实现 API 调用
  }
}
```

### 3. 状态管理 (Zustand Store)

```typescript
// src/store/resume.ts

interface ResumeState {
  // 状态
  resumeContent: string;
  analysis: ResumeAnalysis | null;
  isAnalyzing: boolean;
  error: string | null;

  // 操作
  setResumeContent: (content: string) => void;
  analyzeResume: () => Promise<void>;
  clearResume: () => void;
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  resumeContent: '',
  analysis: null,
  isAnalyzing: false,
  error: null,

  setResumeContent: (content) => set({ resumeContent: content }),

  analyzeResume: async () => {
    set({ isAnalyzing: true, error: null });
    try {
      const { resumeContent } = get();
      const analysis = await apiService.analyzeResume(resumeContent);
      set({ analysis, isAnalyzing: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '分析失败',
        isAnalyzing: false,
      });
    }
  },

  clearResume: () =>
    set({
      resumeContent: '',
      analysis: null,
      error: null,
    }),
}));

// src/store/jd.ts

interface JDState {
  jdContent: string;
  setJDContent: (content: string) => void;
  clearJD: () => void;
}

export const useJDStore = create<JDState>((set) => ({
  jdContent: '',
  setJDContent: (content) => set({ jdContent: content }),
  clearJD: () => set({ jdContent: '' }),
}));
```

### 4. UI 组件设计

```typescript
// src/components/ui/Button/index.tsx

interface ButtonProps {
  type?: 'primary' | 'secondary' | 'text';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  type = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  block = false,
  onClick,
  children,
}) => {
  // 实现按钮组件
};

// src/components/ui/Input/index.tsx

interface InputProps {
  value: string;
  placeholder?: string;
  type?: 'text' | 'textarea';
  maxLength?: number;
  disabled?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

export const Input: React.FC<InputProps> = ({
  value,
  placeholder,
  type = 'text',
  maxLength,
  disabled = false,
  error,
  onChange,
  onBlur,
}) => {
  // 实现输入组件
};

// src/components/ui/Card/index.tsx

interface CardProps {
  title?: string;
  extra?: React.ReactNode;
  bordered?: boolean;
  hoverable?: boolean;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  extra,
  bordered = true,
  hoverable = false,
  children,
}) => {
  // 实现卡片组件
};
```

### 5. 业务组件设计

```typescript
// src/components/business/ResumeUploader/index.tsx

interface ResumeUploaderProps {
  onUpload: (content: string) => void;
  maxSize?: number; // MB
  acceptTypes?: string[];
}

export const ResumeUploader: React.FC<ResumeUploaderProps> = ({
  onUpload,
  maxSize = 5,
  acceptTypes = ['.md', '.txt', '.pdf'],
}) => {
  // 实现简历上传组件
  // 支持文件选择、拖拽上传、粘贴上传
};

// src/components/business/JDInput/index.tsx

interface JDInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const JDInput: React.FC<JDInputProps> = ({
  value,
  onChange,
  placeholder = '请输入或粘贴 JD 内容...',
}) => {
  // 实现 JD 输入组件
};

// src/components/business/ResultDisplay/index.tsx

interface ResultDisplayProps {
  analysis: ResumeAnalysis;
  matching: MatchingResult;
  optimized: OptimizedResume;
}

export const ResultDisplay: React.FC<ResultDisplayProps> = ({
  analysis,
  matching,
  optimized,
}) => {
  // 实现结果展示组件
  // 包含质量评分、匹配度、优化建议等
};
```

## Data Models

### 简历数据模型

```typescript
// src/types/index.ts

/**
 * 结构化简历
 */
export interface StructuredResume {
  personal_info: PersonalInfo;
  education: Education[];
  experience: WorkExperience[];
  projects: Project[];
  skills: Skills;
}

export interface PersonalInfo {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  github?: string;
  linkedin?: string;
}

export interface Education {
  school: string;
  degree: string;
  major: string;
  start_date: string;
  end_date: string;
  gpa?: string;
  achievements?: string[];
}

export interface WorkExperience {
  company: string;
  position: string;
  start_date: string;
  end_date: string;
  responsibilities: string[];
  achievements: string[];
}

export interface Project {
  name: string;
  description: string;
  tech_stack: string[];
  role: string;
  achievements: string[];
  url?: string;
}

export interface Skills {
  hard_skills: string[];
  soft_skills: string[];
  languages?: string[];
  certifications?: string[];
}
```

### JD 数据模型

```typescript
/**
 * JD 解析结果
 */
export interface ParsedJD {
  position: string;
  company?: string;
  responsibilities: string[];
  requirements: Requirement[];
  preferred_qualifications?: string[];
}

export interface Requirement {
  category: 'education' | 'experience' | 'skill' | 'other';
  content: string;
  is_hard: boolean; // 是否为硬性要求
}
```

### 匹配结果模型

```typescript
/**
 * 硬性要求匹配
 */
export interface HardRequirement {
  requirement: string;
  matched: boolean;
  evidence?: string;
  suggestion?: string;
}

/**
 * 技能匹配
 */
export interface SkillMatch {
  matched_skills: string[];
  missing_skills: string[];
  match_percentage: number;
}

/**
 * 经验匹配
 */
export interface ExperienceMatch {
  years_required: number;
  years_actual: number;
  relevant_experience: string[];
  match_percentage: number;
}
```

## Correctness Properties

_属性是系统应该在所有有效执行中保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。_

### Property 1: 平台兼容性一致性

_对于任何_ 平台（iOS、小程序、H5），当调用兼容层 API 时，应该返回相同的数据结构和行为结果

**Validates: Requirements 3.2, 3.3, 3.4, 3.5**

### Property 2: 状态持久化往返

_对于任何_ 应用状态数据，保存到本地存储后再读取，应该得到等价的数据对象

**Validates: Requirements 6.4**

### Property 3: API 响应验证

_对于任何_ API 调用，返回的数据结构应该符合预定义的 TypeScript 接口定义

**Validates: Requirements 7.1, 7.2**

### Property 4: 输入验证完整性

_对于任何_ 用户输入（简历、JD），在提交前应该通过所有必需的验证规则

**Validates: Requirements 4.8**

### Property 5: 错误处理覆盖

_对于任何_ 可能失败的操作（网络请求、文件读取），应该有对应的错误处理和用户提示

**Validates: Requirements 9.2, 9.3, 9.4**

### Property 6: 路由参数传递

_对于任何_ 页面跳转，传递的参数应该在目标页面正确接收且类型匹配

**Validates: Requirements 8.4**

### Property 7: 组件 Props 类型安全

_对于任何_ UI 组件，传入的 props 应该符合组件的 TypeScript 接口定义

**Validates: Requirements 5.4**

### Property 8: 响应式布局适配

_对于任何_ 屏幕尺寸，UI 组件应该保持正确的布局和可读性

**Validates: Requirements 4.6**

## Error Handling

### 错误分类

1. **网络错误**

   - 连接超时
   - 请求失败
   - 服务器错误

2. **业务错误**

   - API 返回错误
   - 数据验证失败
   - 权限不足

3. **系统错误**
   - 内存不足
   - 存储空间不足
   - 平台 API 调用失败

### 错误处理策略

```typescript
// src/utils/error-handler.ts

export class AppError extends Error {
  constructor(public code: string, message: string, public details?: any) {
    super(message);
    this.name = 'AppError';
  }
}

export enum ErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  PLATFORM_ERROR = 'PLATFORM_ERROR',
}

export function handleError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.API_ERROR, error.message, {
      originalError: error,
    });
  }

  return new AppError(ErrorCode.API_ERROR, '未知错误', {
    originalError: error,
  });
}

export function showErrorToast(error: AppError) {
  Taro.showToast({
    title: error.message,
    icon: 'none',
    duration: 3000,
  });
}
```

### 全局错误边界

```typescript
// src/components/ErrorBoundary/index.tsx

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    // 可以上报错误到监控系统
  }

  render() {
    if (this.state.hasError) {
      return (
        <View className='error-boundary'>
          <Text>出错了，请稍后重试</Text>
          <Button onClick={() => this.setState({ hasError: false })}>
            重试
          </Button>
        </View>
      );
    }

    return this.props.children;
  }
}
```

## Testing Strategy

### 测试框架

- **单元测试**: Jest + @testing-library/react
- **端到端测试**: Cypress (H5) / Appium (iOS)
- **类型检查**: TypeScript strict mode

### 单元测试

测试独立的函数、组件和工具类：

```typescript
// src/utils/__tests__/platform.test.ts

describe('Platform Utils', () => {
  test('should detect iOS platform', () => {
    // Mock Taro.getSystemInfoSync
    const result = getPlatform();
    expect(result).toBe(PlatformType.IOS);
  });

  test('should provide consistent storage API across platforms', async () => {
    const storage = getStorageAdapter();
    await storage.setItem('test', 'value');
    const value = await storage.getItem('test');
    expect(value).toBe('value');
  });
});

// src/components/ui/Button/__tests__/Button.test.tsx

describe('Button Component', () => {
  test('should render with text', () => {
    const { getByText } = render(<Button>Click me</Button>);
    expect(getByText('Click me')).toBeTruthy();
  });

  test('should call onClick when clicked', () => {
    const onClick = jest.fn();
    const { getByText } = render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(getByText('Click me'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('should be disabled when disabled prop is true', () => {
    const { getByText } = render(<Button disabled>Click me</Button>);
    const button = getByText('Click me').parentElement;
    expect(button).toHaveClass('button--disabled');
  });
});
```

### 集成测试

测试组件之间的交互和数据流：

```typescript
// src/pages/index/__tests__/index.test.tsx

describe('Home Page', () => {
  test('should submit resume and JD for processing', async () => {
    const { getByPlaceholderText, getByText } = render(<HomePage />);

    // 输入简历
    const resumeInput = getByPlaceholderText('请输入简历内容');
    fireEvent.change(resumeInput, { target: { value: '# 张三\n...' } });

    // 输入 JD
    const jdInput = getByPlaceholderText('请输入 JD 内容');
    fireEvent.change(jdInput, { target: { value: '岗位职责：...' } });

    // 点击提交
    const submitButton = getByText('开始优化');
    fireEvent.click(submitButton);

    // 验证 API 调用
    await waitFor(() => {
      expect(mockApiService.processResume).toHaveBeenCalledWith(
        '# 张三\n...',
        '岗位职责：...'
      );
    });
  });
});
```

### 端到端测试

测试完整的用户流程：

```typescript
// cypress/e2e/resume-optimization.cy.ts

describe('Resume Optimization Flow', () => {
  it('should complete full optimization process', () => {
    cy.visit('/');

    // 上传简历
    cy.get('[data-testid="resume-uploader"]').click();
    cy.get('input[type="file"]').selectFile('fixtures/sample-resume.md');

    // 输入 JD
    cy.get('[data-testid="jd-input"]').type('岗位职责：...');

    // 提交
    cy.get('[data-testid="submit-button"]').click();

    // 等待结果
    cy.get('[data-testid="result-display"]', { timeout: 30000 }).should(
      'be.visible'
    );

    // 验证结果包含必要信息
    cy.get('[data-testid="quality-score"]').should('exist');
    cy.get('[data-testid="match-score"]').should('exist');
    cy.get('[data-testid="optimized-resume"]').should('exist');
  });
});
```

### 测试覆盖率目标

- **工具函数**: 90%+
- **UI 组件**: 80%+
- **业务组件**: 80%+
- **服务层**: 85%+
- **Store**: 85%+

### 测试最佳实践

1. **使用 data-testid 而非 class 或 id 选择器**
2. **测试用户行为而非实现细节**
3. **Mock 外部依赖（API、存储）**
4. **为每个 Property 编写对应的测试**
5. **使用 TypeScript 确保测试类型安全**

## Design System

### 颜色系统

```scss
// src/styles/variables.scss

:root {
  // 主色
  --color-primary: #1890ff;
  --color-primary-light: #40a9ff;
  --color-primary-dark: #096dd9;

  // 辅助色
  --color-secondary: #52c41a;
  --color-warning: #faad14;
  --color-danger: #ff4d4f;
  --color-info: #1890ff;

  // 中性色
  --color-text-primary: #262626;
  --color-text-secondary: #595959;
  --color-text-tertiary: #8c8c8c;
  --color-text-disabled: #bfbfbf;

  --color-bg-primary: #ffffff;
  --color-bg-secondary: #fafafa;
  --color-bg-tertiary: #f5f5f5;

  --color-border: #d9d9d9;
  --color-border-light: #f0f0f0;

  // 状态色
  --color-success: #52c41a;
  --color-error: #ff4d4f;
  --color-warning: #faad14;

  // 阴影
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.12);
  --shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.16);
}

// 暗色模式
@media (prefers-color-scheme: dark) {
  :root {
    --color-text-primary: #e8e8e8;
    --color-text-secondary: #a6a6a6;
    --color-text-tertiary: #737373;

    --color-bg-primary: #141414;
    --color-bg-secondary: #1f1f1f;
    --color-bg-tertiary: #2a2a2a;

    --color-border: #434343;
    --color-border-light: #303030;
  }
}
```

### 字体系统

```scss
:root {
  // 字号
  --font-size-xs: 24px; // 12px * 2
  --font-size-sm: 28px; // 14px * 2
  --font-size-md: 32px; // 16px * 2
  --font-size-lg: 36px; // 18px * 2
  --font-size-xl: 40px; // 20px * 2
  --font-size-2xl: 48px; // 24px * 2
  --font-size-3xl: 56px; // 28px * 2

  // 字重
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  // 行高
  --line-height-tight: 1.2;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;

  // 字体族
  --font-family-base: -apple-system, BlinkMacSystemFont, 'Segoe UI',
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  --font-family-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono',
    'Courier New', monospace;
}
```

### 间距系统

```scss
:root {
  // 基础间距单位：8px
  --spacing-xs: 8px; // 4px * 2
  --spacing-sm: 16px; // 8px * 2
  --spacing-md: 24px; // 12px * 2
  --spacing-lg: 32px; // 16px * 2
  --spacing-xl: 48px; // 24px * 2
  --spacing-2xl: 64px; // 32px * 2
  --spacing-3xl: 96px; // 48px * 2

  // 圆角
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}
```

### 首页设计

基于 Figma 设计稿（由于 MCP 未连接，这里提供通用的首页设计方案）：

```typescript
// src/pages/index/index.tsx

import { View, Text } from '@tarojs/components';
import { Button, Card } from '@/components/ui';
import { ResumeUploader, JDInput } from '@/components/business';
import { useResumeStore, useJDStore } from '@/store';
import Taro from '@tarojs/taro';
import styles from './index.module.scss';

export default function HomePage() {
  const { resumeContent, setResumeContent } = useResumeStore();
  const { jdContent, setJDContent } = useJDStore();

  const handleSubmit = async () => {
    // 验证输入
    if (!resumeContent.trim()) {
      Taro.showToast({
        title: '请输入简历内容',
        icon: 'none',
      });
      return;
    }

    if (!jdContent.trim()) {
      Taro.showToast({
        title: '请输入 JD 内容',
        icon: 'none',
      });
      return;
    }

    // 跳转到结果页
    Taro.navigateTo({
      url: '/pages/result/index',
    });
  };

  return (
    <View className={styles.container}>
      {/* 头部 */}
      <View className={styles.header}>
        <Text className={styles.logo}>Reffo</Text>
        <Text className={styles.tagline}>AI 驱动的智能简历优化</Text>
      </View>

      {/* 主要内容 */}
      <View className={styles.content}>
        {/* 简历输入区 */}
        <Card title='简历内容' className={styles.section}>
          <ResumeUploader onUpload={setResumeContent} value={resumeContent} />
        </Card>

        {/* JD 输入区 */}
        <Card title='目标岗位 JD' className={styles.section}>
          <JDInput value={jdContent} onChange={setJDContent} />
        </Card>

        {/* 提交按钮 */}
        <Button
          type='primary'
          size='large'
          block
          onClick={handleSubmit}
          className={styles.submitButton}
        >
          开始优化
        </Button>
      </View>

      {/* 底部说明 */}
      <View className={styles.footer}>
        <Text className={styles.footerText}>
          我们承诺不会杜撰任何信息，仅基于您的真实经历进行优化
        </Text>
      </View>
    </View>
  );
}
```

```scss
// src/pages/index/index.module.scss

.container {
  min-height: 100vh;
  background: var(--color-bg-secondary);
  padding: var(--spacing-lg);
}

.header {
  text-align: center;
  margin-bottom: var(--spacing-2xl);
  padding-top: var(--spacing-xl);
}

.logo {
  display: block;
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary);
  margin-bottom: var(--spacing-sm);
}

.tagline {
  display: block;
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
}

.content {
  max-width: 1200px;
  margin: 0 auto;
}

.section {
  margin-bottom: var(--spacing-lg);
}

.submitButton {
  margin-top: var(--spacing-xl);
}

.footer {
  text-align: center;
  margin-top: var(--spacing-2xl);
  padding: var(--spacing-lg);
}

.footerText {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  line-height: var(--line-height-relaxed);
}
```

## Performance Optimization

### 代码分割

```typescript
// src/app.config.ts

export default defineAppConfig({
  pages: ['pages/index/index', 'pages/result/index', 'pages/settings/index'],
  // 分包配置
  subPackages: [
    {
      root: 'pages/settings',
      pages: ['index'],
    },
  ],
  // 预加载规则
  preloadRule: {
    'pages/index/index': {
      network: 'all',
      packages: ['pages/result'],
    },
  },
});
```

### 图片优化

```typescript
// src/components/ui/Image/index.tsx

interface ImageProps {
  src: string;
  lazy?: boolean;
  placeholder?: string;
  mode?: 'aspectFit' | 'aspectFill' | 'widthFix';
}

export const Image: React.FC<ImageProps> = ({
  src,
  lazy = true,
  placeholder,
  mode = 'aspectFit',
}) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <View className='image-wrapper'>
      {!loaded && placeholder && <TaroImage src={placeholder} mode={mode} />}
      <TaroImage
        src={src}
        mode={mode}
        lazyLoad={lazy}
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </View>
  );
};
```

### 请求缓存

```typescript
// src/services/api/cache.ts

interface CacheConfig {
  ttl: number; // 缓存时间（毫秒）
  key: string;
}

class ApiCache {
  private cache = new Map<string, { data: any; expiry: number }>();

  set(key: string, data: any, ttl: number) {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttl,
    });
  }

  get(key: string): any | null {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  clear() {
    this.cache.clear();
  }
}

export const apiCache = new ApiCache();

// 使用示例
export async function analyzeResumeWithCache(
  resumeMarkdown: string
): Promise<ResumeAnalysis> {
  const cacheKey = `analyze:${hashString(resumeMarkdown)}`;
  const cached = apiCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const result = await apiService.analyzeResume(resumeMarkdown);
  apiCache.set(cacheKey, result, 5 * 60 * 1000); // 缓存 5 分钟

  return result;
}
```

### 虚拟列表

```typescript
// src/components/ui/VirtualList/index.tsx

interface VirtualListProps<T> {
  data: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}

export function VirtualList<T>({
  data,
  itemHeight,
  renderItem,
}: VirtualListProps<T>) {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });

  const handleScroll = (e: any) => {
    const scrollTop = e.detail.scrollTop;
    const start = Math.floor(scrollTop / itemHeight);
    const end = start + 20;

    setVisibleRange({ start, end });
  };

  const visibleData = data.slice(visibleRange.start, visibleRange.end);

  return (
    <ScrollView scrollY onScroll={handleScroll} style={{ height: '100vh' }}>
      <View style={{ height: data.length * itemHeight }}>
        <View
          style={{
            transform: `translateY(${visibleRange.start * itemHeight}px)`,
          }}
        >
          {visibleData.map((item, index) =>
            renderItem(item, visibleRange.start + index)
          )}
        </View>
      </View>
    </ScrollView>
  );
}
```

## Deployment Configuration

### 环境配置

```typescript
// config/index.ts

const config = {
  projectName: 'reffo-taro',
  date: '2025-1-1',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  copy: {
    patterns: [],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  cache: {
    enable: true,
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      autoprefixer: {
        enable: true,
      },
    },
  },
};

export default config;

// config/dev.ts
export default {
  env: {
    NODE_ENV: '"development"',
  },
  defineConstants: {
    API_BASE_URL: '"http://localhost:3000/api/v1"',
  },
  mini: {},
  h5: {
    devServer: {
      port: 10086,
    },
  },
};

// config/prod.ts
export default {
  env: {
    NODE_ENV: '"production"',
  },
  defineConstants: {
    API_BASE_URL: '"https://api.reffo.app/api/v1"',
  },
  mini: {
    miniCssExtractPluginOption: {
      ignoreOrder: true,
    },
  },
  h5: {
    publicPath: 'https://cdn.reffo.app/',
  },
};
```

### iOS 原生壳配置

```json
// native-shell/ios/TaroNativeShell/app.json
{
  "appId": "com.reffo.app",
  "appName": "Reffo",
  "version": "0.1.0",
  "pages": ["pages/index/index", "pages/result/index"],
  "window": {
    "navigationBarTitleText": "Reffo",
    "navigationBarBackgroundColor": "#1890ff",
    "navigationBarTextStyle": "white",
    "backgroundColor": "#fafafa"
  },
  "tabBar": {
    "color": "#8c8c8c",
    "selectedColor": "#1890ff",
    "backgroundColor": "#ffffff",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "assets/icons/home.png",
        "selectedIconPath": "assets/icons/home-active.png"
      },
      {
        "pagePath": "pages/settings/index",
        "text": "设置",
        "iconPath": "assets/icons/settings.png",
        "selectedIconPath": "assets/icons/settings-active.png"
      }
    ]
  }
}
```

### 构建脚本

```json
// package.json
{
  "scripts": {
    "dev:ios": "taro build --type rn --watch",
    "dev:weapp": "taro build --type weapp --watch",
    "dev:h5": "taro build --type h5 --watch",
    "build:ios": "taro build --type rn",
    "build:weapp": "taro build --type weapp",
    "build:h5": "taro build --type h5",
    "lint": "eslint --ext .js,.jsx,.ts,.tsx src",
    "lint:fix": "eslint --ext .js,.jsx,.ts,.tsx src --fix",
    "test": "jest",
    "test:coverage": "jest --coverage"
  }
}
```

## Implementation Notes

### 开发顺序建议

1. **第一阶段：基础设施**

   - 初始化 Taro 项目
   - 配置 TypeScript、ESLint、Prettier
   - 搭建目录结构
   - 实现平台兼容层

2. **第二阶段：设计系统**

   - 定义设计 token（颜色、字体、间距）
   - 实现基础 UI 组件（Button、Input、Card）
   - 编写组件文档和示例

3. **第三阶段：状态管理和服务层**

   - 配置 Zustand store
   - 实现 API 服务层
   - 实现存储服务

4. **第四阶段：首页实现**

   - 实现首页布局
   - 实现简历上传组件
   - 实现 JD 输入组件
   - 集成 API 调用

5. **第五阶段：结果页和其他页面**

   - 实现结果展示页
   - 实现设置页
   - 完善路由配置

6. **第六阶段：原生壳集成**

   - 配置 Taro Native Shell
   - 测试 iOS 平台
   - 优化性能

7. **第七阶段：测试和优化**
   - 编写单元测试
   - 编写集成测试
   - 性能优化
   - 修复 bug

### 关键技术决策

1. **为什么选择 Zustand 而非 Redux？**

   - 更简单的 API
   - 更小的包体积
   - 更好的 TypeScript 支持
   - 足够满足当前需求

2. **为什么使用 CSS Modules？**

   - 避免样式冲突
   - 更好的可维护性
   - 支持 CSS Variables

3. **为什么需要平台兼容层？**
   - 统一不同平台的 API 差异
   - 便于后续添加新平台
   - 提高代码可测试性

### 风险和挑战

1. **Taro Native Shell 的学习曲线**

   - 需要熟悉原生开发知识
   - 调试相对复杂

2. **平台差异处理**

   - 不同平台的 API 和行为差异
   - 需要充分测试

3. **性能优化**

   - 大文件处理（简历、JD）
   - 网络请求优化

4. **用户体验一致性**
   - 不同平台的交互习惯
   - 需要针对性优化

## 首页详细设计

**完整的首页设计文档请参考：[home-page-design.md](./home-page-design.md)**

### 概述

基于 Figma 设计稿，首页实现了两种状态的智能切换：

1. **空状态（无历史记录）**

   - 欢迎界面，引导用户创建第一份简历
   - 包含品牌标识、说明文字和创建按钮
   - 简洁友好的空状态设计

2. **有历史记录状态**
   - 展示最近生成的简历列表
   - 每个卡片显示：岗位名称、日期、质量评分、匹配度、标签
   - 提供快速访问和创建新简历的入口

### 核心功能

- **历史记录管理**：使用 Zustand 管理状态，支持本地持久化
- **响应式设计**：适配手机、平板、桌面多种屏幕尺寸
- **流畅动画**：卡片进入动画和点击反馈
- **性能优化**：虚拟滚动和懒加载支持

### 技术实现

- **状态管理**：Zustand + persist 中间件
- **本地存储**：平台兼容的存储适配器
- **组件化**：EmptyState、HistoryList、HistoryCard
- **样式方案**：CSS Modules + CSS Variables

详细的组件实现、样式代码和交互流程请查看 [home-page-design.md](./home-page-design.md)。
