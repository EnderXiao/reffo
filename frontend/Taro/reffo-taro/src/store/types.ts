/**
 * Store 类型定义
 */

import type {
  OptimizedResume,
  ResumeHistory,
  ResumeHistorySummary,
  SourceResumeSummary,
  SourceResumeSummaryMeta,
} from '@/types';

// ============ 加载状态 ============

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

export interface LoadOptions {
  skipIfLoaded?: boolean;
  force?: boolean;
}

// ============ Optimized Store ============

export interface OptimizedState {
  // 优化结果
  optimized: OptimizedResume | null;

  // 加载状态
  loading: LoadingState;

  // Actions
  setOptimized: (optimized: OptimizedResume | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

// ============ History Store ============

export interface HistoryState {
  // 历史记录列表
  histories: ResumeHistory[];
  historySummaries: ResumeHistorySummary[];

  // 当前选中的历史记录
  currentHistory: ResumeHistory | null;

  // 加载状态
  loading: LoadingState;

  // 是否完成过一次加载尝试
  initialized: boolean;
  summaryInitialized: boolean;

  // Actions
  loadHistories: (options?: LoadOptions) => Promise<void>;
  loadHistorySummaries: (options?: LoadOptions) => Promise<void>;
  loadHistory: (id: string) => Promise<ResumeHistory | null>;
  addHistory: (history: ResumeHistory) => Promise<string>;
  updateHistory: (id: string, history: Partial<ResumeHistory>) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  clearHistories: () => Promise<void>;
  setCurrentHistory: (history: ResumeHistory | null) => void;
  reset: () => void;
}

export interface SourceResumeState {
  latestSourceResume: SourceResumeSummary | null;
  latestSourceResumeSummary: SourceResumeSummaryMeta | null;
  loading: LoadingState;
  initialized: boolean;
  summaryInitialized: boolean;
  loadLatestSourceResume: (options?: LoadOptions) => Promise<void>;
  loadLatestSourceSummary: (options?: LoadOptions) => Promise<void>;
  setLatestSourceResume: (resume: SourceResumeSummary | null) => Promise<void>;
  deleteLatestSourceResume: (id: string) => Promise<void>;
  clearLatestSourceResume: () => Promise<void>;
  reset: () => void;
}
