# 首页 History Store 集成手动测试指南

## 测试环境准备

1. 启动开发服务器：

```bash
cd frontend/Taro/reffo-taro
npm run dev:h5  # H5 平台测试
# 或
npm run dev:weapp  # 微信小程序测试
```

2. 打开浏览器开发者工具（F12）

## 测试用例

### 测试 1: 空状态显示

**目的**: 验证无历史记录时显示空状态

**步骤**:

1. 打开浏览器开发者工具 -> Application -> Local Storage
2. 清空 `resume_histories` 键（如果存在）
3. 刷新页面

**预期结果**:

- ✅ 显示空状态图标 📄
- ✅ 显示文案 "开始创建你的第一份优化简历"
- ✅ 显示描述文字
- ✅ 显示 "+ 创建 Reffo 简历" 按钮
- ✅ 显示免责声明

---

### 测试 2: 创建按钮导航

**目的**: 验证点击创建按钮导航到创建页面

**步骤**:

1. 在空状态下，点击 "+ 创建 Reffo 简历" 按钮

**预期结果**:

- ✅ 导航到创建页面 `/pages/create/index`

---

### 测试 3: 历史记录显示

**目的**: 验证有历史记录时正确显示

**步骤**:

1. 打开浏览器开发者工具 -> Console
2. 执行以下代码添加测试数据：

```javascript
const testData = [
  {
    id: '1',
    position: '前端工程师',
    company: 'ABC 公司',
    name: '张三',
    createdAt: new Date().toISOString(),
    qualityScore: 85,
    matchScore: 90,
    tags: ['React', 'TypeScript'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#84cc16',
  },
  {
    id: '2',
    position: '后端工程师',
    company: 'XYZ 公司',
    name: '李四',
    createdAt: new Date().toISOString(),
    qualityScore: 88,
    matchScore: 92,
    tags: ['Node.js', 'Python'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#3b82f6',
  },
  {
    id: '3',
    position: '全栈工程师',
    company: 'DEF 公司',
    name: '王五',
    createdAt: new Date().toISOString(),
    qualityScore: 90,
    matchScore: 95,
    tags: ['Full Stack'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#f59e0b',
  },
];

localStorage.setItem('resume_histories', JSON.stringify(testData));
location.reload();
```

**预期结果**:

- ✅ 不显示空状态
- ✅ 显示 3 张历史记录卡片（堆叠效果）
- ✅ 第一张卡片显示匹配度评分 "90% 匹配度"
- ✅ 显示 "当前简历 3 份"
- ✅ 卡片显示正确的岗位名称、公司名称、姓名、日期

---

### 测试 4: 卡片堆叠效果

**目的**: 验证卡片的 3D 堆叠效果

**步骤**:

1. 确保有至少 3 条历史记录（参考测试 3）
2. 观察卡片的视觉效果

**预期结果**:

- ✅ 卡片有垂直偏移（每张卡片向下 20px）
- ✅ 卡片有水平偏移（每张卡片向右 10px）
- ✅ 卡片有旋转效果（每张卡片旋转 2 度）
- ✅ 卡片层级正确（第一张在最上面）

---

### 测试 5: 点击卡片导航

**目的**: 验证点击历史记录卡片导航到详情页

**步骤**:

1. 确保有历史记录（参考测试 3）
2. 点击任意一张历史记录卡片

**预期结果**:

- ✅ 导航到结果页面 `/pages/result/index?id=<历史记录ID>`
- ✅ URL 包含正确的历史记录 ID

---

### 测试 6: 最多显示 3 张卡片

**目的**: 验证只显示最近 3 条记录

**步骤**:

1. 添加 4 条或更多历史记录：

```javascript
const testData = [
  {
    id: '1',
    position: '前端工程师',
    company: 'ABC 公司',
    name: '张三',
    createdAt: new Date().toISOString(),
    qualityScore: 85,
    matchScore: 90,
    tags: ['React'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#84cc16',
  },
  {
    id: '2',
    position: '后端工程师',
    company: 'XYZ 公司',
    name: '李四',
    createdAt: new Date().toISOString(),
    qualityScore: 88,
    matchScore: 92,
    tags: ['Node.js'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#3b82f6',
  },
  {
    id: '3',
    position: '全栈工程师',
    company: 'DEF 公司',
    name: '王五',
    createdAt: new Date().toISOString(),
    qualityScore: 90,
    matchScore: 95,
    tags: ['Full Stack'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#f59e0b',
  },
  {
    id: '4',
    position: '测试工程师',
    company: 'GHI 公司',
    name: '赵六',
    createdAt: new Date().toISOString(),
    qualityScore: 87,
    matchScore: 89,
    tags: ['Testing'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#ef4444',
  },
];

localStorage.setItem('resume_histories', JSON.stringify(testData));
location.reload();
```

**预期结果**:

- ✅ 只显示 3 张卡片
- ✅ 显示 "当前简历 4 份"
- ✅ 第 4 条记录不显示在卡片中

---

### 测试 7: 加载状态

**目的**: 验证加载状态显示（需要修改代码模拟）

**步骤**:

1. 在 `historyStore.ts` 的 `loadHistories` 方法中添加延迟：

```typescript
loadHistories: async () => {
  set(state => ({
    loading: {
      ...state.loading,
      isLoading: true,
      error: null,
    },
  }));

  // 添加延迟模拟加载
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ... 其余代码
};
```

2. 刷新页面

**预期结果**:

- ✅ 显示 "加载中..." 提示
- ✅ 2 秒后显示历史记录或空状态

---

### 测试 8: 错误状态

**目的**: 验证错误状态显示（需要修改代码模拟）

**步骤**:

1. 在 `historyStore.ts` 的 `loadHistories` 方法中模拟错误：

```typescript
loadHistories: async () => {
  set(state => ({
    loading: {
      ...state.loading,
      isLoading: true,
      error: null,
    },
  }));

  try {
    // 模拟错误
    throw new Error('加载失败');

    // ... 其余代码
  } catch (error) {
    // ... 错误处理
  }
};
```

2. 刷新页面

**预期结果**:

- ✅ 显示 "加载失败: 加载失败" 错误信息
- ✅ 不显示历史记录或空状态

---

### 测试 9: 状态切换

**目的**: 验证从空状态到历史记录状态的切换

**步骤**:

1. 清空本地存储，刷新页面（显示空状态）
2. 打开开发者工具 Console，执行：

```javascript
const testData = [
  {
    id: '1',
    position: '前端工程师',
    company: 'ABC 公司',
    name: '张三',
    createdAt: new Date().toISOString(),
    qualityScore: 85,
    matchScore: 90,
    tags: ['React'],
    resumeContent: '简历内容',
    jdContent: 'JD 内容',
    optimizedContent: '优化后的简历',
    cardColor: '#84cc16',
  },
];

localStorage.setItem('resume_histories', JSON.stringify(testData));
location.reload();
```

**预期结果**:

- ✅ 从空状态切换到历史记录状态
- ✅ 显示 1 张历史记录卡片
- ✅ 显示 "当前简历 1 份"

---

## 测试检查清单

完成所有测试后，请确认：

- [ ] 空状态正确显示
- [ ] 创建按钮导航正常
- [ ] 历史记录正确显示
- [ ] 卡片堆叠效果正确
- [ ] 点击卡片导航正常
- [ ] 最多显示 3 张卡片
- [ ] 加载状态正确显示
- [ ] 错误状态正确显示
- [ ] 状态切换正常

## 常见问题

### Q: 刷新后历史记录消失

A: 检查本地存储是否正确保存数据，确认 `localStorage.setItem` 执行成功

### Q: 卡片点击没有反应

A: 检查浏览器控制台是否有错误，确认 Taro.navigateTo 方法正常工作

### Q: 样式显示不正确

A: 确认 SCSS 文件已正确编译，检查 CSS 类名是否正确

## 下一步

完成测试后，可以继续以下任务：

- 任务 8.4: 实现动画效果
- 任务 8.5: 编写历史记录状态测试（自动化测试）
