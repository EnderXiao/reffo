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
import type {HistoryState, LoadOptions} from './types';
import type {ResumeHistory} from '@/types';
import {resumeHistoryApi} from '@/services/resumeHistory';
import {getJSON, setJSON} from '@/utils/storage';

/**
 * 历史记录存储键名
 */
const STORAGE_KEY = 'resume_histories';
const HISTORY_ID_PREFIX = 'JD';
const HISTORY_ID_SEQUENCE_LENGTH = 5;
const HISTORY_ID_MAX_SEQUENCE = 99999;
let loadHistoriesPromise: Promise<void> | null = null;

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

function formatHistoryIdDate(dateInput?: string) {
  const date = dateInput ? new Date(dateInput) : new Date();
  const resolvedDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return [
    resolvedDate.getFullYear(),
    padDatePart(resolvedDate.getMonth() + 1),
    padDatePart(resolvedDate.getDate()),
  ].join('');
}

function createHistoryId(histories: ResumeHistory[], createdAt?: string) {
  const datePart = formatHistoryIdDate(createdAt);
  const idPrefix = `${HISTORY_ID_PREFIX}${datePart}`;
  const pattern = new RegExp(`^${idPrefix}(\\d{${HISTORY_ID_SEQUENCE_LENGTH}})$`);
  const maxSequence = histories.reduce((currentMax, history) => {
    const match = history.id.match(pattern);

    if (!match) {
      return currentMax;
    }

    return Math.max(currentMax, Number.parseInt(match[1], 10));
  }, 0);
  const nextSequence = maxSequence + 1;

  if (nextSequence > HISTORY_ID_MAX_SEQUENCE) {
    throw new Error('当日历史记录编号已超过上限');
  }

  return `${idPrefix}${String(nextSequence).padStart(HISTORY_ID_SEQUENCE_LENGTH, '0')}`;
}

function getHistoryTime(history: ResumeHistory) {
  const time = new Date(history.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sortHistories(histories: ResumeHistory[]) {
  return [...histories].sort((left, right) => getHistoryTime(right) - getHistoryTime(left));
}

function mergeHistories(primaryHistories: ResumeHistory[], fallbackHistories: ResumeHistory[]) {
  const historyMap = new Map<string, ResumeHistory>();

  fallbackHistories.forEach(history => {
    historyMap.set(history.id, history);
  });

  primaryHistories.forEach(history => {
    historyMap.set(history.id, history);
  });

  return sortHistories(Array.from(historyMap.values()));
}

async function syncMissingLocalHistories(
  remoteHistories: ResumeHistory[],
  cachedHistories: ResumeHistory[],
) {
  const remoteIds = new Set(remoteHistories.map(history => history.id));
  const missingLocalHistories = cachedHistories.filter(history => !remoteIds.has(history.id));

  if (missingLocalHistories.length === 0) {
    return sortHistories(remoteHistories);
  }

  const syncedHistories: ResumeHistory[] = [];

  for (const history of missingLocalHistories) {
    try {
      syncedHistories.push(await resumeHistoryApi.saveHistory(history));
    } catch (error) {
      console.warn('[HistoryStore] Failed to sync local history:', error);
      syncedHistories.push(history);
    }
  }

  return mergeHistories([...remoteHistories, ...syncedHistories], cachedHistories);
}

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
  initialized: false,
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
   * 从接口加载历史记录
   *
   * 优先读取后端持久化数据，并用本地存储作为缓存和迁移来源
   *
   * @throws {Error} 当读取失败时设置错误状态
   *
   * @example
   * ```typescript
   * await loadHistories();
   * ```
   */
  loadHistories: async (options: LoadOptions = {}) => {
    if (options.skipIfLoaded && get().initialized && !options.force) {
      return;
    }

    if (loadHistoriesPromise && !options.force) {
      return loadHistoriesPromise;
    }

    loadHistoriesPromise = (async () => {
      set(state => ({
        loading: {
          ...state.loading,
          isLoading: true,
          error: null,
        },
      }));

      let cachedHistories: ResumeHistory[] = [];

      try {
        cachedHistories = await getJSON<ResumeHistory[]>(STORAGE_KEY) || [];

        if (cachedHistories.length > 0) {
          set({histories: sortHistories(cachedHistories)});
        }
      } catch (error) {
        console.warn('[HistoryStore] Failed to read cached histories:', error);
      }

      try {
        const remoteHistories = await resumeHistoryApi.getHistories();
        const histories = await syncMissingLocalHistories(remoteHistories, cachedHistories);

        await setJSON(STORAGE_KEY, histories);

        set({
          histories,
          loading: {
            isLoading: false,
            error: null,
          },
          initialized: true,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '加载历史记录失败';

        set(state => ({
          histories: cachedHistories.length > 0 ? sortHistories(cachedHistories) : state.histories,
          loading: {
            ...state.loading,
            isLoading: false,
            error: cachedHistories.length > 0 ? null : errorMessage,
          },
          initialized: true,
        }));

        console.error('[HistoryStore] Failed to load histories:', error);
      }
    })().finally(() => {
      loadHistoriesPromise = null;
    });

    return loadHistoriesPromise;
  },

  /**
   * 添加新的历史记录
   *
   * 将新记录保存到后端并同步本地缓存
   *
   * @param history 新的历史记录
   * @returns 新创建的历史记录 ID
   * @throws {Error} 当保存失败时设置错误状态
   *
   * @example
   * ```typescript
   * const newHistory: ResumeHistory = {
   *   id: 'JD2026070700001',
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

      const historyWithId = {
        ...history,
        id: history.id || createHistoryId(histories, history.createdAt),
      };
      let savedHistory = historyWithId;

      try {
        savedHistory = await resumeHistoryApi.saveHistory(historyWithId);
      } catch (error) {
        console.warn('[HistoryStore] Failed to save history remotely, fallback to local cache:', error);
      }

      const updatedHistories = sortHistories([
        savedHistory,
        ...histories.filter(item => item.id !== savedHistory.id),
      ]);

      await setJSON(STORAGE_KEY, updatedHistories);

      set({
        histories: updatedHistories,
        loading: {
          isLoading: false,
          error: null,
        },
        initialized: true,
      });

      return savedHistory.id;
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
   * 根据 ID 更新指定的历史记录并同步后端与本地缓存
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

      let updatedHistory = {
        ...histories[index],
        ...updates,
      };

      try {
        updatedHistory = await resumeHistoryApi.updateHistory(id, updates);
      } catch (error) {
        console.warn('[HistoryStore] Failed to update history remotely, fallback to local cache:', error);
      }

      const updatedHistories = [...histories];
      updatedHistories[index] = updatedHistory;

      await setJSON(STORAGE_KEY, updatedHistories);

      set({
        histories: updatedHistories,
        loading: {
          isLoading: false,
          error: null,
        },
        initialized: true,
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
   * 根据 ID 删除指定的历史记录并同步后端与本地缓存
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

      try {
        await resumeHistoryApi.deleteHistory(id);
      } catch (error) {
        console.warn('[HistoryStore] Failed to delete history remotely, fallback to local cache:', error);
      }

      const updatedHistories = histories.filter(h => h.id !== id);

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
        initialized: true,
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
      try {
        await resumeHistoryApi.clearHistories();
      } catch (error) {
        console.warn('[HistoryStore] Failed to clear histories remotely, fallback to local cache:', error);
      }

      await setJSON(STORAGE_KEY, []);

      set({
        histories: [],
        currentHistory: null,
        loading: {
          isLoading: false,
          error: null,
        },
        initialized: true,
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
    loadHistoriesPromise = null;
    set(initialState);
  },
}));
