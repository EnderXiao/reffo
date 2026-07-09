/**
 * JD Store
 *
 * 管理 JD 内容和匹配结果的全局状态
 *
 * @example
 * ```tsx
 * import { useJDStore } from '@/store';
 *
 * function JDMatcher() {
 *   const {
 *     jdContent,
 *     matching,
 *     loading,
 *     setJDContent,
 *     setMatching,
 *     setLoading,
 *     setError,
 *     reset
 *   } = useJDStore();
 *
 *   const handleMatch = async () => {
 *     setLoading(true);
 *     try {
 *       const result = await matchResumeWithJD(resumeContent, jdContent);
 *       setMatching(result);
 *     } catch (error) {
 *       setError(error.message);
 *     } finally {
 *       setLoading(false);
 *     }
 *   };
 *
 *   return (
 *     <View>
 *       {loading.isLoading && <Text>匹配中...</Text>}
 *       {loading.error && <Text>错误: {loading.error}</Text>}
 *       {matching && <Text>匹配度: {matching.match_score}</Text>}
 *     </View>
 *   );
 * }
 * ```
 */

import {create} from 'zustand';
import type {JDState} from './types';

/**
 * 初始状态
 */
const initialState = {
  jdContent: '',
  matching: null,
  loading: {
    isLoading: false,
    error: null,
  },
};

/**
 * JD Store Hook
 *
 * **验证需求: Requirements 6.2**
 * - 管理 JD 内容状态
 * - 管理匹配结果状态
 * - 处理加载状态和错误
 * - 提供重置功能
 */
export const useJDStore = create<JDState>(set => ({
  ...initialState,

  /**
   * 设置 JD 内容
   * @param content JD 文本内容
   */
  setJDContent: (content: string) => {
    set({jdContent: content});
  },

  /**
   * 设置匹配结果
   * @param matching 匹配分析结果，null 表示清空
   */
  setMatching: matching => {
    set({matching});
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
