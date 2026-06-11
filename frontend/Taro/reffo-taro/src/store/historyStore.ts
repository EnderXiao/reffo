/**
 * History Store
 *
 * 管理历史记录列表的全局状态，支持本地持久化
 *
 * @example
 * ```tsx
 * import { useHistoryStore } from '@/store';
 *
 * function HistoryList() {
 *   const {
 *     histories,
 *     loading,
 *     loadHistories,
 *     addHistory,
 *     updateHistory,
 *     deleteHistory,
 *     setCurrentHistory,
 *     reset
 *   } = useHistoryStore();
 *
 *   useEffect(() => {
 *     loadHistories();
 *   }, []);
 *
 *   const handleDelete = async (id: string) => {
 *     await deleteHistory(id);
 *   };
 *
 *   return (
 *     <View>
 *       {loading.isLoading && <Text>加载中...</Text>}
 *       {loading.error && <Text>错误: {loading.error}</Text>}
 *       {histories.map(history => (
 *         <View key={history.id}>
 *           <Text>{history.position} @ {history.company}</Text>
 *           <Button onClick={() => handleDelete(history.id)}>删除</Button>
 *         </View>
 *       ))}
 *     </View>
 *   );
 * }
 * ```
 */

import {create} from 'zustand';
import type {HistoryState} from './types';
import type {ResumeHistory} from '@/types';
import {getJSON, setJSON} from '@/utils/storage';

/**
 * 历史记录存储键名
 */
const STORAGE_KEY = 'resume_histories';

/**
 * 初始状态
 */
const initialState = {
  histories: [],
  currentHistory: null,
  loading: {
    isLoading: false,
    error: null,
  },
};

/**
 * History Store Hook
 *
 * **验证需求: Requirements 6.2, 6.4**
 * - 管理历史记录列表状态
 * - 实现本地持久化存储
 * - 提供 CRUD 操作
 * - 处理加载状态和错误
 * - 支持当前选中记录
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  ...initialState,

  /**
   * 从本地存储加载历史记录
   *
   * 读取本地存储的历史记录列表并更新到 store
   *
   * @throws {Error} 当读取失败时设置错误状态
   *
   * @example
   * ```typescript
   * await loadHistories();
   * ```
   */
  loadHistories: async () => {
    set(state => ({
      loading: {
        ...state.loading,
        isLoading: true,
        error: null,
      },
    }));

    try {
      const histories = await getJSON<ResumeHistory[]>(STORAGE_KEY);

      set({
        histories: histories || [],
        loading: {
          isLoading: false,
          error: null,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '加载历史记录失败';

      set(state => ({
        loading: {
          ...state.loading,
          isLoading: false,
          error: errorMessage,
        },
      }));

      console.error('[HistoryStore] Failed to load histories:', error);
    }
  },

  /**
   * 添加新的历史记录
   *
   * 将新记录添加到列表开头（最新的在前）并持久化到本地存储
   *
   * @param history 新的历史记录
   * @returns 新创建的历史记录 ID
   * @throws {Error} 当保存失败时设置错误状态
   *
   * @example
   * ```typescript
   * const newHistory: ResumeHistory = {
   *   id: Date.now().toString(),
   *   position: '前端工程师',
   *   company: 'ABC 公司',
   *   name: '张三',
   *   createdAt: new Date().toISOString(),
   *   qualityScore: 85,
   *   matchScore: 90,
   *   tags: ['React', 'TypeScript'],
   *   resumeContent: '...',
   *   jdContent: '...',
   *   optimizedContent: '...',
   * };
   *
   * const id = await addHistory(newHistory);
   * ```
   */
  addHistory: async (history: ResumeHistory): Promise<string> => {
    set(state => ({
      loading: {
        ...state.loading,
        isLoading: true,
        error: null,
      },
    }));

    try {
      const {histories} = get();

      // 确保有 ID
      const historyWithId = {
        ...history,
        id: history.id || Date.now().toString(),
      };

      // 将新记录添加到列表开头
      const updatedHistories = [historyWithId, ...histories];

      // 持久化到本地存储
      await setJSON(STORAGE_KEY, updatedHistories);

      set({
        histories: updatedHistories,
        loading: {
          isLoading: false,
          error: null,
        },
      });

      return historyWithId.id;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '添加历史记录失败';

      set(state => ({
        loading: {
          ...state.loading,
          isLoading: false,
          error: errorMessage,
        },
      }));

      console.error('[HistoryStore] Failed to add history:', error);
      throw error;
    }
  },

  /**
   * 更新历史记录
   *
   * 根据 ID 更新指定的历史记录并持久化到本地存储
   *
   * @param id 历史记录 ID
   * @param updates 要更新的字段（部分更新）
   * @throws {Error} 当记录不存在或保存失败时设置错误状态
   *
   * @example
   * ```typescript
   * await updateHistory('123', {
   *   qualityScore: 90,
   *   tags: ['React', 'TypeScript', 'Node.js'],
   * });
   * ```
   */
  updateHistory: async (id: string, updates: Partial<ResumeHistory>) => {
    set(state => ({
      loading: {
        ...state.loading,
        isLoading: true,
        error: null,
      },
    }));

    try {
      const {histories} = get();

      // 查找并更新记录
      const index = histories.findIndex(h => h.id === id);

      if (index === -1) {
        throw new Error(`历史记录不存在: ${id}`);
      }

      const updatedHistories = [...histories];
      updatedHistories[index] = {
        ...updatedHistories[index],
        ...updates,
      };

      // 持久化到本地存储
      await setJSON(STORAGE_KEY, updatedHistories);

      set({
        histories: updatedHistories,
        loading: {
          isLoading: false,
          error: null,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '更新历史记录失败';

      set(state => ({
        loading: {
          ...state.loading,
          isLoading: false,
          error: errorMessage,
        },
      }));

      console.error('[HistoryStore] Failed to update history:', error);
      throw error;
    }
  },

  /**
   * 删除历史记录
   *
   * 根据 ID 删除指定的历史记录并持久化到本地存储
   *
   * @param id 历史记录 ID
   * @throws {Error} 当保存失败时设置错误状态
   *
   * @example
   * ```typescript
   * await deleteHistory('123');
   * ```
   */
  deleteHistory: async (id: string) => {
    set(state => ({
      loading: {
        ...state.loading,
        isLoading: true,
        error: null,
      },
    }));

    try {
      const {histories, currentHistory} = get();

      // 过滤掉要删除的记录
      const updatedHistories = histories.filter(h => h.id !== id);

      // 持久化到本地存储
      await setJSON(STORAGE_KEY, updatedHistories);

      // 如果删除的是当前选中的记录，清空选中状态
      const updatedCurrentHistory =
        currentHistory?.id === id ? null : currentHistory;

      set({
        histories: updatedHistories,
        currentHistory: updatedCurrentHistory,
        loading: {
          isLoading: false,
          error: null,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '删除历史记录失败';

      set(state => ({
        loading: {
          ...state.loading,
          isLoading: false,
          error: errorMessage,
        },
      }));

      console.error('[HistoryStore] Failed to delete history:', error);
      throw error;
    }
  },

  /**
   * 清空所有历史记录
   *
   * 删除所有历史记录并清空本地存储
   *
   * ⚠️ **警告：此操作不可逆**
   *
   * @throws {Error} 当清空失败时设置错误状态
   *
   * @example
   * ```typescript
   * await clearHistories();
   * ```
   */
  clearHistories: async () => {
    set(state => ({
      loading: {
        ...state.loading,
        isLoading: true,
        error: null,
      },
    }));

    try {
      // 清空本地存储
      await setJSON(STORAGE_KEY, []);

      set({
        histories: [],
        currentHistory: null,
        loading: {
          isLoading: false,
          error: null,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '清空历史记录失败';

      set(state => ({
        loading: {
          ...state.loading,
          isLoading: false,
          error: errorMessage,
        },
      }));

      console.error('[HistoryStore] Failed to clear histories:', error);
      throw error;
    }
  },

  /**
   * 设置当前选中的历史记录
   *
   * 用于在详情页或编辑页显示选中的记录
   *
   * @param history 要选中的历史记录，null 表示取消选中
   *
   * @example
   * ```typescript
   * // 选中记录
   * setCurrentHistory(histories[0]);
   *
   * // 取消选中
   * setCurrentHistory(null);
   * ```
   */
  setCurrentHistory: (history: ResumeHistory | null) => {
    set({currentHistory: history});
  },

  /**
   * 重置 store 到初始状态
   *
   * 清空内存中的状态，但不删除本地存储的数据
   *
   * @example
   * ```typescript
   * reset();
   * ```
   */
  reset: () => {
    set(initialState);
  },
}));
