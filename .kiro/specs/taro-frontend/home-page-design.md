# 首页详细设计

基于最新设计稿，首页采用卡片堆叠展示方式，有两个状态：

## 设计要点

### 视觉风格

- **Logo**: 蓝色 Reffo logo，左上角显示
- **标语**: "一个岗位，一份简历" - 大标题
- **副标题**: "AI 优化策略" + 产品定位说明
- **卡片堆叠**: 3D 透视效果，展示最近的简历记录
- **主操作按钮**: 蓝色圆角按钮 "创建 Reffo 简历"
- **免责声明**: 底部灰色小字

### 卡片设计

- **几何图案背景**: 绿色/黑色等不同颜色的几何图案
- **公司名**: 左上角白色文字
- **姓名**: 大字号显示
- **岗位**: 中等字号
- **主成就日期**: 显示具体日期
- **质量评分**: 大字号数字 + "% 匹配度"

## 状态 1：空状态（无历史记录）

### 布局结构

```
┌─────────────────────────────────────┐
│           Header                    │
│         Reffo Logo                  │
│      AI 驱动的智能简历优化           │
├─────────────────────────────────────┤
│                                     │
│         Empty State Icon            │
│            📄                       │
│                                     │
│    开始创建你的第一份优化简历        │
│                                     │
│  上传简历和目标岗位 JD，             │
│  AI 将为你生成针对性优化的简历       │
│                                     │
│      [  创建简历  ]                 │
│                                     │
├─────────────────────────────────────┤
│           Footer                    │
│  我们承诺不会杜撰任何信息，          │
│  仅基于您的真实经历进行优化          │
└─────────────────────────────────────┘
```

### 组件实现

```typescript
// src/pages/index/components/EmptyState.tsx

import { View, Text } from '@tarojs/components';
import { Button } from '@/components/ui';
import Taro from '@tarojs/taro';
import styles from './EmptyState.module.scss';

interface EmptyStateProps {
  onCreateNew: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onCreateNew }) => {
  return (
    <View className={styles.emptyState}>
      {/* 空状态图标 */}
      <View className={styles.iconWrapper}>
        <Text className={styles.icon}>📄</Text>
      </View>

      {/* 标题 */}
      <Text className={styles.title}>开始创建你的第一份优化简历</Text>

      {/* 描述 */}
      <Text className={styles.description}>
        上传简历和目标岗位 JD，AI 将为你生成针对性优化的简历
      </Text>

      {/* 创建按钮 */}
      <Button
        type='primary'
        size='large'
        onClick={onCreateNew}
        className={styles.createButton}
      >
        创建简历
      </Button>
    </View>
  );
};
```

```scss
// src/pages/index/components/EmptyState.module.scss

.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-3xl) var(--spacing-lg);
  min-height: 60vh;
}

.iconWrapper {
  margin-bottom: var(--spacing-xl);
}

.icon {
  font-size: 120px;
  line-height: 1;
}

.title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  text-align: center;
  margin-bottom: var(--spacing-md);
}

.description {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  text-align: center;
  line-height: var(--line-height-relaxed);
  max-width: 600px;
  margin-bottom: var(--spacing-xl);
}

.createButton {
  min-width: 320px;
}
```

## 状态 2：有历史记录

### 布局结构

```
┌─────────────────────────────────────┐
│  Reffo Logo        [创建新简历]      │
├─────────────────────────────────────┤
│  最近生成                            │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ 前端开发工程师        2024-01-01│  │
│  │                               │  │
│  │ 质量评分: 85    匹配度: 92%   │  │
│  │                               │  │
│  │ [React] [TypeScript] [前端]  │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 后端开发工程师        2024-01-02│  │
│  │                               │  │
│  │ 质量评分: 88    匹配度: 90%   │  │
│  │                               │  │
│  │ [Node.js] [Python] [后端]    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 数据模型

```typescript
// src/types/history.ts

export interface ResumeHistory {
  id: string;
  position: string; // 岗位名称
  company?: string; // 公司名称（可选）
  createdAt: string; // 创建时间
  qualityScore: number; // 质量评分 0-100
  matchScore: number; // 匹配度 0-100
  tags: string[]; // 标签（技能、领域等）
  resumeContent: string; // 简历内容
  jdContent: string; // JD 内容
  optimizedContent: string; // 优化后的简历
}
```

### 组件实现

```typescript
// src/pages/index/components/HistoryList.tsx

import { View, Text } from '@tarojs/components';
import { Button, Card } from '@/components/ui';
import { ResumeHistory } from '@/types/history';
import Taro from '@tarojs/taro';
import styles from './HistoryList.module.scss';

interface HistoryListProps {
  histories: ResumeHistory[];
  onCreateNew: () => void;
  onViewDetail: (id: string) => void;
}

export const HistoryList: React.FC<HistoryListProps> = ({
  histories,
  onCreateNew,
  onViewDetail,
}) => {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(date.getDate()).padStart(2, '0')}`;
  };

  return (
    <View className={styles.historyList}>
      {/* 头部 */}
      <View className={styles.header}>
        <Text className={styles.sectionTitle}>最近生成</Text>
        <Button type='primary' size='small' onClick={onCreateNew}>
          创建新简历
        </Button>
      </View>

      {/* 历史记录列表 */}
      <View className={styles.list}>
        {histories.map((history) => (
          <Card
            key={history.id}
            hoverable
            onClick={() => onViewDetail(history.id)}
            className={styles.historyCard}
          >
            {/* 卡片头部 */}
            <View className={styles.cardHeader}>
              <Text className={styles.position}>{history.position}</Text>
              <Text className={styles.date}>
                {formatDate(history.createdAt)}
              </Text>
            </View>

            {/* 评分信息 */}
            <View className={styles.scores}>
              <View className={styles.scoreItem}>
                <Text className={styles.scoreLabel}>质量评分</Text>
                <Text className={styles.scoreValue}>
                  {history.qualityScore}
                </Text>
              </View>
              <View className={styles.scoreItem}>
                <Text className={styles.scoreLabel}>匹配度</Text>
                <Text className={styles.scoreValue}>{history.matchScore}%</Text>
              </View>
            </View>

            {/* 标签 */}
            <View className={styles.tags}>
              {history.tags.map((tag) => (
                <View key={tag} className={styles.tag}>
                  <Text className={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </Card>
        ))}
      </View>
    </View>
  );
};
```

```scss
// src/pages/index/components/HistoryList.module.scss

.historyList {
  padding: var(--spacing-lg);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-lg);
}

.sectionTitle {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.historyCard {
  padding: var(--spacing-lg);
  cursor: pointer;
  transition: all 0.3s ease;

  &:active {
    transform: scale(0.98);
  }
}

.cardHeader {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-md);
}

.position {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  flex: 1;
}

.date {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-left: var(--spacing-sm);
}

.scores {
  display: flex;
  gap: var(--spacing-xl);
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-md) 0;
  border-top: 1px solid var(--color-border-light);
  border-bottom: 1px solid var(--color-border-light);
}

.scoreItem {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.scoreLabel {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.scoreValue {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.tag {
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
}

.tagText {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
```

## 完整首页实现

```typescript
// src/pages/index/index.tsx

import { View, Text } from '@tarojs/components';
import { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { useHistoryStore } from '@/store';
import { EmptyState } from './components/EmptyState';
import { HistoryList } from './components/HistoryList';
import styles from './index.module.scss';

export default function HomePage() {
  const { histories, loadHistories, hasHistory } = useHistoryStore();

  useEffect(() => {
    // 加载历史记录
    loadHistories();
  }, []);

  const handleCreateNew = () => {
    Taro.navigateTo({
      url: '/pages/create/index',
    });
  };

  const handleViewDetail = (id: string) => {
    Taro.navigateTo({
      url: `/pages/result/index?id=${id}`,
    });
  };

  return (
    <View className={styles.container}>
      {/* 头部 */}
      <View className={styles.header}>
        <Text className={styles.logo}>Reffo</Text>
        {!hasHistory && (
          <Text className={styles.tagline}>AI 驱动的智能简历优化</Text>
        )}
      </View>

      {/* 主要内容 */}
      <View className={styles.content}>
        {hasHistory ? (
          <HistoryList
            histories={histories}
            onCreateNew={handleCreateNew}
            onViewDetail={handleViewDetail}
          />
        ) : (
          <EmptyState onCreateNew={handleCreateNew} />
        )}
      </View>

      {/* 底部说明 */}
      {!hasHistory && (
        <View className={styles.footer}>
          <Text className={styles.footerText}>
            我们承诺不会杜撰任何信息，仅基于您的真实经历进行优化
          </Text>
        </View>
      )}
    </View>
  );
}
```

```scss
// src/pages/index/index.module.scss

.container {
  min-height: 100vh;
  background: var(--color-bg-secondary);
  display: flex;
  flex-direction: column;
}

.header {
  padding: var(--spacing-xl) var(--spacing-lg);
  text-align: center;
  background: var(--color-bg-primary);
  box-shadow: var(--shadow-sm);
}

.logo {
  display: block;
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary);
  margin-bottom: var(--spacing-xs);
}

.tagline {
  display: block;
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.footer {
  padding: var(--spacing-lg);
  text-align: center;
  background: var(--color-bg-primary);
  border-top: 1px solid var(--color-border-light);
}

.footerText {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  line-height: var(--line-height-relaxed);
}
```

## Store 实现

```typescript
// src/store/history.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ResumeHistory } from '@/types/history';
import { storageAdapter } from '@/utils/platform';

interface HistoryState {
  histories: ResumeHistory[];
  hasHistory: boolean;

  // 操作
  loadHistories: () => Promise<void>;
  addHistory: (history: ResumeHistory) => Promise<void>;
  removeHistory: (id: string) => Promise<void>;
  clearHistories: () => Promise<void>;
  getHistoryById: (id: string) => ResumeHistory | undefined;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      histories: [],
      hasHistory: false,

      loadHistories: async () => {
        try {
          const stored = await storageAdapter.getItem('resume_histories');
          if (stored) {
            const histories = JSON.parse(stored) as ResumeHistory[];
            set({
              histories: histories.sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              ),
              hasHistory: histories.length > 0,
            });
          }
        } catch (error) {
          console.error('Failed to load histories:', error);
        }
      },

      addHistory: async (history) => {
        const { histories } = get();
        const newHistories = [history, ...histories];

        await storageAdapter.setItem(
          'resume_histories',
          JSON.stringify(newHistories),
        );

        set({
          histories: newHistories,
          hasHistory: true,
        });
      },

      removeHistory: async (id) => {
        const { histories } = get();
        const newHistories = histories.filter((h) => h.id !== id);

        await storageAdapter.setItem(
          'resume_histories',
          JSON.stringify(newHistories),
        );

        set({
          histories: newHistories,
          hasHistory: newHistories.length > 0,
        });
      },

      clearHistories: async () => {
        await storageAdapter.removeItem('resume_histories');
        set({ histories: [], hasHistory: false });
      },

      getHistoryById: (id) => {
        return get().histories.find((h) => h.id === id);
      },
    }),
    {
      name: 'history-storage',
      storage: {
        getItem: async (name) => {
          const value = await storageAdapter.getItem(name);
          return value ? JSON.parse(value) : null;
        },
        setItem: async (name, value) => {
          await storageAdapter.setItem(name, JSON.stringify(value));
        },
        removeItem: async (name) => {
          await storageAdapter.removeItem(name);
        },
      },
    },
  ),
);
```

## 交互流程

### 首次使用流程

```
用户打开应用
    ↓
检查历史记录
    ↓
无历史记录
    ↓
显示空状态页面
    ↓
用户点击"创建简历"
    ↓
跳转到创建页面
```

### 有历史记录流程

```
用户打开应用
    ↓
检查历史记录
    ↓
有历史记录
    ↓
显示历史记录列表
    ↓
用户可以：
  - 点击卡片查看详情
  - 点击"创建新简历"创建新的
```

## 响应式设计

### 小屏幕（手机）

- 卡片全宽显示
- 单列布局
- 字体大小适中

### 中屏幕（平板）

- 卡片可以两列显示
- 增加左右边距

### 大屏幕（桌面/H5）

- 最大宽度限制（1200px）
- 居中显示
- 卡片可以三列显示

```scss
// 响应式样式示例
.list {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--spacing-md);

  // 平板
  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }

  // 桌面
  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

## 性能优化

### 虚拟滚动

如果历史记录很多（>50 条），使用虚拟滚动：

```typescript
import { VirtualList } from '@/components/ui';

<VirtualList
  data={histories}
  itemHeight={200}
  renderItem={(history) => (
    <HistoryCard history={history} onClick={handleViewDetail} />
  )}
/>;
```

### 懒加载

历史记录分页加载：

```typescript
const [page, setPage] = useState(1);
const pageSize = 20;

const loadMore = async () => {
  const nextPage = page + 1;
  const moreHistories = await loadHistoriesPage(nextPage, pageSize);
  setHistories([...histories, ...moreHistories]);
  setPage(nextPage);
};
```

## 动画效果

### 卡片进入动画

```scss
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.historyCard {
  animation: slideIn 0.3s ease-out;
  animation-fill-mode: both;

  @for $i from 1 through 10 {
    &:nth-child(#{$i}) {
      animation-delay: #{$i * 0.05}s;
    }
  }
}
```

### 点击反馈

```scss
.historyCard {
  transition: all 0.2s ease;

  &:active {
    transform: scale(0.98);
    box-shadow: var(--shadow-sm);
  }
}
```
