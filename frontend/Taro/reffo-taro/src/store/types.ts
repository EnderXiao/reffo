/**
 * Store 类型定义
 */

import type {
  ResumeAnalysis,
  MatchingResult,
  OptimizedResume,
  ResumeHistory,
  SourceResumeSummary,
} from '@/types';

// ============ 加载状态 ============

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

// ============ Resume Store ============

export interface ResumeState {
  // 简历内容
  resumeContent: string;

  // 分析结果
  analysis: ResumeAnalysis | null;

  // 加载状态
  loading: LoadingState;

  // Actions
  setResumeContent: (content: string) => void;
  setAnalysis: (analysis: ResumeAnalysis | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

// ============ JD Store ============

export interface JDState {
  // JD 内容
  jdContent: string;

  // 匹配结果
  matching: MatchingResult | null;

  // 加载状态
  loading: LoadingState;

  // Actions
  setJDContent: (content: string) => void;
  setMatching: (matching: MatchingResult | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
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

  // 当前选中的历史记录
  currentHistory: ResumeHistory | null;

  // 加载状态
  loading: LoadingState;

  // Actions
  loadHistories: () => Promise<void>;
  addHistory: (history: ResumeHistory) => Promise<string>;
  updateHistory: (id: string, history: Partial<ResumeHistory>) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  clearHistories: () => Promise<void>;
  setCurrentHistory: (history: ResumeHistory | null) => void;
  reset: () => void;
}

export interface SourceResumeState {
  latestSourceResume: SourceResumeSummary | null;
  loading: LoadingState;
  loadLatestSourceResume: () => Promise<void>;
  setLatestSourceResume: (resume: SourceResumeSummary | null) => Promise<void>;
  deleteLatestSourceResume: (id: string) => Promise<void>;
  clearLatestSourceResume: () => Promise<void>;
  reset: () => void;
}
