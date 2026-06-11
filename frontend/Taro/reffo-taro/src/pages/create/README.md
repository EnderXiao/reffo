# 创建页面 (Create Page)

## 概述

创建页面是用户输入简历和 JD 内容，并提交进行优化的主要页面。

## 功能特性

### ✅ 已实现功能

1. **页面布局** (Requirement 4.1)
   - 头部导航栏（返回按钮 + 标题）
   - 主要内容区（简历输入 + JD 输入）
   - 底部提交按钮
   - 响应式设计

2. **组件集成** (Requirement 4.7)
   - 集成 ResumeUploader 组件（支持文件上传和文本输入）
   - 集成 JDInput 组件（支持多行文本输入和字数统计）

3. **输入验证** (Requirement 4.8)
   - 简历内容不能为空
   - 简历内容至少 50 个字符
   - JD 内容不能为空
   - JD 内容至少 30 个字符
   - 实时验证和错误提示
   - 提交按钮根据验证状态启用/禁用

4. **API 集成** (Requirements 7.1, 7.2, 7.3, 7.4)
   - 调用 `resumeApi.processResume()` 执行完整优化流程
   - 显示加载状态（Loading 提示）
   - 处理网络错误、超时错误、API 错误
   - 友好的错误提示

5. **状态管理**
   - 使用 Zustand 管理简历和 JD 内容
   - 使用 History Store 保存优化结果
   - 本地验证状态管理

6. **用户体验**
   - 加载提示（"正在优化简历..."）
   - 成功提示（"优化成功"）
   - 错误提示（根据错误类型显示不同消息）
   - 返回首页功能
   - 优化提示信息

## API 调用流程

```typescript
// 1. 验证输入
if (!validateInputs()) {
  showError();
  return;
}

// 2. 显示加载状态
setLoading(true);
Taro.showLoading({title: '正在优化简历...'});

// 3. 调用 API
const result = await resumeApi.processResume(resumeContent, jdContent);

// 4. 保存到历史记录
const historyId = historyStore.addHistory({
  resumeContent,
  jdContent,
  analysis: result.analysis,
  matching: result.matching,
  optimized: result.optimized,
});

// 5. 导航到结果页
Taro.navigateTo({url: `/pages/result/index?id=${historyId}`});
```

## 错误处理

页面实现了完善的错误处理机制：

### 错误类型

1. **网络错误** (`NETWORK_ERROR`)
   - 提示：网络连接失败，请检查网络设置

2. **超时错误** (`TIMEOUT`)
   - 提示：请求超时，请稍后重试

3. **API 错误** (`API_ERROR`)
   - 提示：服务器错误，请稍后重试
   - 或显示 API 返回的具体错误信息

4. **验证错误**
   - 提示：简历内容不能为空 / 简历内容过短
   - 提示：JD 内容不能为空 / JD 内容过短

### 错误处理流程

```typescript
try {
  // API 调用
} catch (error) {
  Taro.hideLoading();

  let errorMessage = '优化失败，请重试';

  if (error instanceof RequestError) {
    // 根据错误代码显示不同提示
    if (error.code === 'NETWORK_ERROR') {
      errorMessage = '网络连接失败，请检查网络设置';
    } else if (error.code === 'TIMEOUT') {
      errorMessage = '请求超时，请稍后重试';
    }
  }

  setError(errorMessage);
  Taro.showToast({title: errorMessage, icon: 'none'});
}
```

## 页面结构

```
CreatePage
├── Header (头部导航)
│   ├── BackButton (返回按钮)
│   ├── Title (页面标题)
│   └── Placeholder (占位符，保持标题居中)
├── Content (主要内容)
│   ├── ResumeSection (简历输入区)
│   │   ├── SectionHeader (标题 + 必填标记)
│   │   ├── ResumeUploader (简历上传组件)
│   │   └── ErrorMessage (验证错误提示)
│   ├── JDSection (JD 输入区)
│   │   ├── SectionHeader (标题 + 必填标记)
│   │   ├── JDInput (JD 输入组件)
│   │   └── ErrorMessage (验证错误提示)
│   └── Tips (优化提示)
└── Footer (底部提交区)
    ├── SubmitButton (提交按钮)
    └── Disclaimer (免责声明)
```

## 样式特性

- **响应式设计**：桌面端最大宽度 800px，居中显示
- **粘性头部**：头部导航固定在顶部
- **阴影效果**：底部提交区有阴影，提升层次感
- **暗色模式**：支持系统暗色模式
- **过渡动画**：按钮点击、边框聚焦等有平滑过渡

## 验证需求

该页面实现了以下需求：

- ✅ **Requirement 4.1**: 实现页面布局
- ✅ **Requirement 4.2**: 包含应用标题和品牌标识
- ✅ **Requirement 4.3**: 包含简历上传/输入入口
- ✅ **Requirement 4.4**: 包含 JD 输入入口
- ✅ **Requirement 4.5**: 包含开始优化按钮
- ✅ **Requirement 4.7**: 集成 ResumeUploader 和 JDInput 组件
- ✅ **Requirement 4.8**: 实现输入验证
- ✅ **Requirement 7.1**: 集成后端 API
- ✅ **Requirement 7.2**: 封装 API 调用
- ✅ **Requirement 7.3**: 处理请求超时
- ✅ **Requirement 7.4**: 提供友好的错误提示

## 测试

页面包含完整的单元测试，覆盖：

- ✅ 基础渲染
- ✅ 输入验证
- ✅ 返回功能
- ✅ Requirements 验证

运行测试：

```bash
pnpm test -- create
```

## 使用示例

### 正常流程

1. 用户进入创建页面
2. 输入或上传简历内容（至少 50 个字符）
3. 输入 JD 内容（至少 30 个字符）
4. 点击"开始优化"按钮
5. 等待 API 处理（15-40 秒）
6. 自动跳转到结果页查看优化结果

### 错误处理

1. 如果输入不完整，显示验证错误
2. 如果网络错误，显示网络错误提示
3. 如果 API 错误，显示服务器错误提示
4. 用户可以修改输入后重新提交

## 性能考虑

- **API 超时**：processResume API 默认超时 60 秒
- **加载提示**：使用 Taro.showLoading 显示加载状态，防止用户重复提交
- **错误恢复**：错误后用户可以直接修改输入重新提交，无需刷新页面

## 未来改进

- [ ] 添加草稿保存功能
- [ ] 支持历史记录快速填充
- [ ] 添加输入内容预览
- [ ] 支持批量处理多个简历
- [ ] 添加进度条显示 API 处理进度
