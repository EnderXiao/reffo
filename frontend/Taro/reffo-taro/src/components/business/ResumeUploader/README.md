# ResumeUploader 组件

## 概述

ResumeUploader 是一个用于上传和输入简历内容的业务组件，支持文件选择和文本输入两种方式。

## 功能特性

### ✅ 已实现功能

1. **文本输入**
   - 支持多行文本输入
   - 自动高度调整
   - 实时字符计数
   - 占位符提示

2. **文件选择**
   - 支持通过 Taro API 选择文件
   - 自动读取文件内容
   - 文件上传成功提示

3. **文件类型验证**
   - 默认支持 `.md` 和 `.txt` 格式
   - 可自定义支持的文件类型
   - 不支持的类型会显示错误提示

4. **文件大小验证**
   - 默认最大 5MB
   - 可自定义最大文件大小
   - 超过限制会显示错误提示

5. **错误处理**
   - 文件类型错误提示
   - 文件大小错误提示
   - 文件选择失败提示
   - 文件读取失败提示
   - 输入新内容时自动清除错误

6. **用户体验**
   - 清空按钮（有内容时显示）
   - 友好的错误提示
   - Toast 消息反馈
   - 响应式布局

## 使用方法

```tsx
import {ResumeUploader} from '@/components/business/ResumeUploader';

function MyPage() {
  const [resumeContent, setResumeContent] = useState('');

  return (
    <ResumeUploader
      value={resumeContent}
      onUpload={setResumeContent}
      maxSize={5}
      acceptTypes={['.md', '.txt']}
      placeholder="请输入简历内容..."
    />
  );
}
```

## Props

| 属性        | 类型                      | 默认值              | 说明               |
| ----------- | ------------------------- | ------------------- | ------------------ |
| value       | string                    | ''                  | 当前内容值         |
| onUpload    | (content: string) => void | 必填                | 内容变化回调       |
| maxSize     | number                    | 5                   | 最大文件大小（MB） |
| acceptTypes | string[]                  | ['.md', '.txt']     | 支持的文件类型     |
| placeholder | string                    | '请输入简历内容...' | 输入框占位符       |
| className   | string                    | -                   | 自定义样式类名     |

## 验证需求

**Validates: Requirements 4.7**

根据 taro-frontend 规范的需求 4.7，本组件实现了以下功能：

- ✅ 支持文件选择
- ✅ 支持文本输入
- ✅ 实现文件类型验证
- ✅ 实现文件大小验证

## 测试

组件包含完整的单元测试，覆盖以下场景：

- ✅ 组件渲染
- ✅ 文本输入
- ✅ 字符计数显示
- ✅ 清空功能
- ✅ 文件类型验证（支持的类型）
- ✅ 文件类型验证（不支持的类型）
- ✅ 文件大小验证（超过限制）
- ✅ 文件大小验证（在限制内）
- ✅ 文件选择失败处理
- ✅ 文件读取失败处理
- ✅ 自定义 acceptTypes
- ✅ 自定义 maxSize
- ✅ 自定义 placeholder
- ✅ 初始值支持
- ✅ 错误信息显示
- ✅ 输入时清除错误

运行测试：

```bash
pnpm test -- ResumeUploader
```

## 样式

组件使用 CSS Modules 和 SCSS 变量，支持：

- 响应式布局（移动端和桌面端）
- 主题色系统
- 焦点状态样式
- 错误状态样式
- 平滑过渡动画

## 平台兼容性

- ✅ iOS (通过 Taro Native Shell)
- ✅ 微信小程序
- ✅ H5

## 注意事项

1. **文件选择 API**：使用 `Taro.chooseMessageFile` API，在不同平台上行为可能略有差异
2. **文件读取**：使用 `Taro.getFileSystemManager` 读取文件内容，仅支持文本文件
3. **错误处理**：所有错误都会通过 Toast 提示用户，并在组件内显示错误信息
4. **性能**：大文件读取可能需要时间，建议设置合理的文件大小限制

## 未来改进

- [ ] 支持拖拽上传（H5 平台）
- [ ] 支持粘贴上传
- [ ] 支持 PDF 文件解析
- [ ] 支持文件预览
- [ ] 支持多文件上传
- [ ] 添加上传进度显示
