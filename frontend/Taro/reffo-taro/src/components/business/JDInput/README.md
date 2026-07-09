# JDInput 组件

JD（Job Description）输入组件，用于输入和编辑岗位描述内容。

## 功能特性

- ✅ 多行文本输入
- ✅ 实时字数统计
- ✅ 字数限制提示
- ✅ 清空功能
- ✅ 响应式设计
- ✅ 暗色模式支持

## 使用示例

### 基础用法

```tsx
import {JDInput} from '@/components/business';

function MyPage() {
  const [jdContent, setJDContent] = useState('');

  return <JDInput value={jdContent} onChange={setJDContent} />;
}
```

### 自定义配置

```tsx
<JDInput
  value={jdContent}
  onChange={setJDContent}
  placeholder="请输入岗位描述..."
  maxLength={5000}
  className="custom-jd-input"
/>
```

## Props

| 属性        | 类型                      | 默认值                      | 说明                 |
| ----------- | ------------------------- | --------------------------- | -------------------- |
| value       | `string`                  | `''`                        | 输入内容             |
| onChange    | `(value: string) => void` | -                           | 内容变化回调（必需） |
| placeholder | `string`                  | `'请输入或粘贴 JD 内容...'` | 占位符文本           |
| maxLength   | `number`                  | `10000`                     | 最大字数限制         |
| className   | `string`                  | -                           | 自定义样式类名       |

## 字数统计

组件会实时显示当前字数和限制：

- **正常状态**：显示为灰色
- **接近限制**（>80%）：显示为橙色警告
- **超出限制**：显示为红色错误，并显示警告提示

## 样式定制

组件使用 CSS Modules，可以通过以下方式定制样式：

```scss
// 自定义样式
.customJDInput {
  :global {
    .jdInput {
      .textarea {
        min-height: 400px;
        font-size: 16px;
      }
    }
  }
}
```

## 响应式设计

组件在不同屏幕尺寸下自动适配：

- **桌面端**：最小高度 300px
- **移动端**：最小高度 200px，工具栏垂直布局

## 可访问性

- 支持键盘导航
- 提供清晰的视觉反馈
- 字数限制提示明确

## 验证需求

该组件实现了以下需求：

- **Requirements 4.7**: 实现多行文本输入和字数统计功能

## 测试覆盖

组件包含完整的单元测试，覆盖：

- ✅ 基础渲染
- ✅ 文本输入
- ✅ 字数统计
- ✅ 清空功能
- ✅ 提示信息
- ✅ 边界情况
- ✅ 需求验证

运行测试：

```bash
pnpm test -- JDInput
```
