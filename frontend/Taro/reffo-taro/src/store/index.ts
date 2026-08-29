/**
 * Store 统一导出
 *
 * 使用 Zustand 进行全局状态管理
 *
 * @example
 * ```tsx
 * import { useResumeWorkspaceStore, useHistoryStore } from '@/store';
 *
 * function MyComponent() {
 *   const sourceResume = useResumeWorkspaceStore(state => state.sourceResume);
 *   const { histories, loadHistories } = useHistoryStore();
 *
 *   // 使用 store...
 * }
 * ```
 */

// 导出类型
export type {
  OptimizedState,
  HistoryState,
  SourceResumeState,
  LoadingState,
} from './types';

// Store 实现
export {useHistoryStore} from './historyStore';
export {useSourceResumeStore} from './sourceResumeStore';
export {useAuthStore} from './authStore';
export {useLandingFlowStore} from './landingFlowStore';
export {resumeWorkspaceActions, useResumeWorkspaceStore} from './resumeWorkspaceStore';
export type {
  ActiveGenerationStatus,
  ResumeWorkspaceState,
  GenerationStatus,
} from './resumeWorkspaceStore';

// 以下 Store 将在后续任务中实现
// export { useOptimizedStore } from './optimizedStore';
