/**
 * Store 统一导出
 *
 * 使用 Zustand 进行全局状态管理
 *
 * @example
 * ```tsx
 * import { useResumeStore, useHistoryStore } from '@/store';
 *
 * function MyComponent() {
 *   const { resumeContent, setResumeContent } = useResumeStore();
 *   const { histories, loadHistories } = useHistoryStore();
 *
 *   // 使用 store...
 * }
 * ```
 */

// 导出类型
export type {
  ResumeState,
  JDState,
  OptimizedState,
  HistoryState,
  SourceResumeState,
  LoadingState,
} from './types';

// Store 实现
export {useResumeStore} from './resumeStore';
export {useJDStore} from './jdStore';
export {useHistoryStore} from './historyStore';
export {useSourceResumeStore} from './sourceResumeStore';
export {useAuthStore} from './authStore';

// 以下 Store 将在后续任务中实现
// export { useOptimizedStore } from './optimizedStore';
