/**
 * Resume Store
 *
 * 管理简历内容和分析结果的全局状态
 *
 * @example
 * ```tsx
 * import { useResumeStore } from '@/store';
 *
 * function ResumeAnalyzer() {
 *   const {
 *     resumeContent,
 *     analysis,
 *     loading,
 *     setResumeContent,
 *     setAnalysis,
 *     setLoading,
 *     setError,
 *     reset
 *   } = useResumeStore();
 *
 *   const handleAnalyze = async () => {
 *     setLoading(true);
 *     try {
 *       const result = await analyzeResume(resumeContent);
 *       setAnalysis(result);
 *     } catch (error) {
 *       setError(error.message);
 *     } finally {
 *       setLoading(false);
 *     }
 *   };
 *
 *   return (
 *     <View>
 *       {loading.isLoading && <Text>分析中...</Text>}
 *       {loading.error && <Text>错误: {loading.error}</Text>}
 *       {analysis && <Text>质量评分: {analysis.quality_score}</Text>}
 *     </View>
 *   );
 * }
 * ```
 */

import {create} from 'zustand';
import type {ResumeState} from './types';

/**
 * 初始状态
 */
const initialState = {
  resumeContent: '',
  analysis: null,
  loading: {
    isLoading: false,
    error: null,
  },
};

/**
 * Resume Store Hook
 *
 * **验证需求: Requirements 6.2**
 * - 管理简历内容状态
 * - 管理分析结果状态
 * - 处理加载状态和错误
 * - 提供重置功能
 */
export const useResumeStore = create<ResumeState>(set => ({
  ...initialState,

  /**
   * 设置简历内容
   * @param content 简历 Markdown 内容
   */
  setResumeContent: (content: string) => {
    set({resumeContent: content});
  },

  /**
   * 设置分析结果
   * @param analysis 简历分析结果，null 表示清空
   */
  setAnalysis: analysis => {
    set({analysis});
  },

  /**
   * 设置加载状态
   * @param isLoading 是否正在加载
   */
  setLoading: (isLoading: boolean) => {
    set(state => ({
      loading: {
        ...state.loading,
        isLoading,
      },
    }));
  },

  /**
   * 设置错误信息
   * @param error 错误信息，null 表示清空错误
   */
  setError: (error: string | null) => {
    set(state => ({
      loading: {
        ...state.loading,
        error,
      },
    }));
  },

  /**
   * 重置 store 到初始状态
   */
  reset: () => {
    set(initialState);
  },
}));
