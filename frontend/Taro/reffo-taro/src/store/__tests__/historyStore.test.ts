/**
 * History Store 单元测试
 *
 * **验证需求: Requirements 6.2, 6.4**
 */

import {describe, test, expect, beforeEach, jest} from '@jest/globals';
import {useHistoryStore} from '../historyStore';
import type {ResumeHistory} from '@/types';

jest.mock('@/services/resumeHistory', () => ({
  resumeHistoryApi: {
    getHistories: jest.fn(),
    saveHistory: jest.fn(),
    updateHistory: jest.fn(),
    deleteHistory: jest.fn(),
    clearHistories: jest.fn(),
  },
}));

// Mock storage 模块
jest.mock('@/utils/storage', () => ({
  getJSON: jest.fn(async () => null),
  setJSON: jest.fn(async () => {}),
}));

import * as storage from '@/utils/storage';
import {resumeHistoryApi} from '@/services/resumeHistory';

const mockedResumeHistoryApi = resumeHistoryApi as jest.Mocked<typeof resumeHistoryApi>;

describe('History Store', () => {
  // 在每个测试前重置 store
  beforeEach(() => {
    jest.clearAllMocks();
    useHistoryStore.getState().reset();
    (storage.getJSON as any).mockResolvedValue(null);
    (storage.setJSON as any).mockResolvedValue(undefined);
    mockedResumeHistoryApi.getHistories.mockResolvedValue([]);
    mockedResumeHistoryApi.saveHistory.mockImplementation(async history => history);
    mockedResumeHistoryApi.updateHistory.mockImplementation(async (id, updates) => ({
      ...useHistoryStore.getState().histories.find(history => history.id === id),
      ...updates,
    } as ResumeHistory));
    mockedResumeHistoryApi.deleteHistory.mockResolvedValue(undefined);
    mockedResumeHistoryApi.clearHistories.mockResolvedValue(undefined);
  });

  describe('初始状态', () => {
    test('应该有正确的初始状态', () => {
      const state = useHistoryStore.getState();

      expect(state.histories).toEqual([]);
      expect(state.currentHistory).toBeNull();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });
  });

  describe('loadHistories', () => {
    test('应该从本地存储加载历史记录', async () => {
      const mockHistories: ResumeHistory[] = [
        {
          id: '1',
          position: '前端工程师',
          company: 'ABC 公司',
          name: '张三',
          createdAt: '2024-01-01T00:00:00.000Z',
          qualityScore: 85,
          matchScore: 90,
          tags: ['React', 'TypeScript'],
          resumeContent: '# 张三\n...',
          jdContent: '岗位职责：...',
          optimizedContent: '# 张三（优化版）\n...',
        },
        {
          id: '2',
          position: '后端工程师',
          company: 'XYZ 公司',
          name: '李四',
          createdAt: '2024-01-02T00:00:00.000Z',
          qualityScore: 80,
          matchScore: 85,
          tags: ['Node.js', 'Python'],
          resumeContent: '# 李四\n...',
          jdContent: '岗位要求：...',
          optimizedContent: '# 李四（优化版）\n...',
        },
      ];

      // Mock getJSON 返回历史记录
      (storage.getJSON as any).mockResolvedValueOnce(mockHistories);

      const {loadHistories} = useHistoryStore.getState();
      await loadHistories();

      const state = useHistoryStore.getState();
      expect(state.histories).toEqual([mockHistories[1], mockHistories[0]]);
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });

    test('应该处理空的历史记录', async () => {
      // Mock getJSON 返回 null
      (storage.getJSON as any).mockResolvedValueOnce(null);

      const {loadHistories} = useHistoryStore.getState();
      await loadHistories();

      const state = useHistoryStore.getState();
      expect(state.histories).toEqual([]);
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });

    test('应该处理加载错误', async () => {
      const errorMessage = '读取失败';
      (storage.getJSON as any).mockRejectedValueOnce(
        new Error(errorMessage),
      );
      mockedResumeHistoryApi.getHistories.mockRejectedValueOnce(new Error(errorMessage));

      const {loadHistories} = useHistoryStore.getState();
      await loadHistories();

      const state = useHistoryStore.getState();
      expect(state.histories).toEqual([]);
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBe(errorMessage);
    });

    test('加载时应该设置 loading 状态', async () => {
      let resolvePromise: any;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      (storage.getJSON as any).mockReturnValueOnce(promise);

      const {loadHistories} = useHistoryStore.getState();
      const loadPromise = loadHistories();

      // 检查 loading 状态
      expect(useHistoryStore.getState().loading.isLoading).toBe(true);

      // 完成加载
      resolvePromise([]);
      await loadPromise;

      expect(useHistoryStore.getState().loading.isLoading).toBe(false);
    });
  });

  describe('addHistory', () => {
    test('应该添加新的历史记录', async () => {
      const newHistory: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React', 'TypeScript'],
        resumeContent: '# 张三\n...',
        jdContent: '岗位职责：...',
        optimizedContent: '# 张三（优化版）\n...',
      };

      (storage.setJSON as any).mockResolvedValueOnce(undefined);

      const {addHistory} = useHistoryStore.getState();
      await addHistory(newHistory);

      const state = useHistoryStore.getState();
      expect(state.histories).toHaveLength(1);
      expect(state.histories[0]).toEqual(newHistory);
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();

      // 验证调用了 setJSON
      expect(storage.setJSON).toHaveBeenCalledWith('resume_histories', [
        newHistory,
      ]);
    });

    test('未提供 ID 时应该生成 JD+年月日+递增编号的 15 位编码', async () => {
      const existingHistory: ResumeHistory = {
        id: 'JD2026070700002',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2026-07-07T08:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '# 张三',
        jdContent: '岗位职责：...',
        optimizedContent: '# 张三（优化版）',
      };
      const newHistory: ResumeHistory = {
        ...existingHistory,
        id: '',
        position: '产品经理',
        createdAt: '2026-07-07T12:00:00.000Z',
      };

      useHistoryStore.setState({histories: [existingHistory]});
      (storage.setJSON as any).mockResolvedValue(undefined);

      const id = await useHistoryStore.getState().addHistory(newHistory);

      expect(id).toBe('JD2026070700003');
      expect(id).toHaveLength(15);
      expect(useHistoryStore.getState().histories[0].id).toBe('JD2026070700003');
    });

    test('应该将新记录添加到列表开头', async () => {
      const history1: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      const history2: ResumeHistory = {
        id: '2',
        position: '后端工程师',
        company: 'XYZ 公司',
        name: '李四',
        createdAt: '2024-01-02T00:00:00.000Z',
        qualityScore: 80,
        matchScore: 85,
        tags: ['Node.js'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValue(undefined);

      const {addHistory} = useHistoryStore.getState();
      await addHistory(history1);
      await addHistory(history2);

      const state = useHistoryStore.getState();
      expect(state.histories).toHaveLength(2);
      expect(state.histories[0].id).toBe('2'); // 最新的在前
      expect(state.histories[1].id).toBe('1');
    });

    test('应该处理添加错误', async () => {
      const newHistory: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      const errorMessage = '存储失败';
      (storage.setJSON as any).mockRejectedValueOnce(new Error(errorMessage));

      const {addHistory} = useHistoryStore.getState();

      await expect(addHistory(newHistory)).rejects.toThrow();

      const state = useHistoryStore.getState();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBe(errorMessage);
    });
  });

  describe('updateHistory', () => {
    test('应该更新指定的历史记录', async () => {
      const history: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValue(undefined);

      const {addHistory, updateHistory} = useHistoryStore.getState();
      await addHistory(history);

      // 更新记录
      await updateHistory('1', {
        qualityScore: 95,
        tags: ['React', 'TypeScript'],
      });

      const state = useHistoryStore.getState();
      expect(state.histories[0].qualityScore).toBe(95);
      expect(state.histories[0].tags).toEqual(['React', 'TypeScript']);
      expect(state.histories[0].position).toBe('前端工程师'); // 其他字段不变
    });

    test('应该在记录不存在时抛出错误', async () => {
      (storage.setJSON as any).mockResolvedValue(undefined);

      const {updateHistory} = useHistoryStore.getState();

      await expect(
        updateHistory('non-existent', {qualityScore: 95}),
      ).rejects.toThrow('历史记录不存在');
    });

    test('应该处理更新错误', async () => {
      const history: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValueOnce(undefined);

      const {addHistory, updateHistory} = useHistoryStore.getState();
      await addHistory(history);

      // Mock 更新时的错误
      const errorMessage = '更新失败';
      (storage.setJSON as any).mockRejectedValueOnce(new Error(errorMessage));

      await expect(updateHistory('1', {qualityScore: 95})).rejects.toThrow();

      const state = useHistoryStore.getState();
      expect(state.loading.error).toBe(errorMessage);
    });
  });

  describe('deleteHistory', () => {
    test('应该删除指定的历史记录', async () => {
      const history1: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      const history2: ResumeHistory = {
        id: '2',
        position: '后端工程师',
        company: 'XYZ 公司',
        name: '李四',
        createdAt: '2024-01-02T00:00:00.000Z',
        qualityScore: 80,
        matchScore: 85,
        tags: ['Node.js'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValue(undefined);

      const {addHistory, deleteHistory} = useHistoryStore.getState();
      await addHistory(history1);
      await addHistory(history2);

      // 删除第一条记录
      await deleteHistory('2');

      const state = useHistoryStore.getState();
      expect(state.histories).toHaveLength(1);
      expect(state.histories[0].id).toBe('1');
    });

    test('应该在删除当前选中记录时清空选中状态', async () => {
      const history: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValue(undefined);

      const {addHistory, setCurrentHistory, deleteHistory} =
        useHistoryStore.getState();
      await addHistory(history);
      setCurrentHistory(history);

      expect(useHistoryStore.getState().currentHistory).not.toBeNull();

      // 删除当前选中的记录
      await deleteHistory('1');

      const state = useHistoryStore.getState();
      expect(state.currentHistory).toBeNull();
    });

    test('应该处理删除错误', async () => {
      const history: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValueOnce(undefined);

      const {addHistory, deleteHistory} = useHistoryStore.getState();
      await addHistory(history);

      // Mock 删除时的错误
      const errorMessage = '删除失败';
      (storage.setJSON as any).mockRejectedValueOnce(new Error(errorMessage));

      await expect(deleteHistory('1')).rejects.toThrow();

      const state = useHistoryStore.getState();
      expect(state.loading.error).toBe(errorMessage);
    });
  });

  describe('clearHistories', () => {
    test('应该清空所有历史记录', async () => {
      const history1: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      const history2: ResumeHistory = {
        id: '2',
        position: '后端工程师',
        company: 'XYZ 公司',
        name: '李四',
        createdAt: '2024-01-02T00:00:00.000Z',
        qualityScore: 80,
        matchScore: 85,
        tags: ['Node.js'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValue(undefined);

      const {addHistory, clearHistories} = useHistoryStore.getState();
      await addHistory(history1);
      await addHistory(history2);

      expect(useHistoryStore.getState().histories).toHaveLength(2);

      // 清空所有记录
      await clearHistories();

      const state = useHistoryStore.getState();
      expect(state.histories).toEqual([]);
      expect(state.currentHistory).toBeNull();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();

      // 验证调用了 setJSON 清空存储
      expect(storage.setJSON).toHaveBeenCalledWith('resume_histories', []);
    });

    test('应该处理清空错误', async () => {
      const errorMessage = '清空失败';
      (storage.setJSON as any).mockRejectedValueOnce(new Error(errorMessage));

      const {clearHistories} = useHistoryStore.getState();

      await expect(clearHistories()).rejects.toThrow();

      const state = useHistoryStore.getState();
      expect(state.loading.error).toBe(errorMessage);
    });
  });

  describe('setCurrentHistory', () => {
    test('应该设置当前选中的历史记录', () => {
      const history: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      const {setCurrentHistory} = useHistoryStore.getState();
      setCurrentHistory(history);

      const state = useHistoryStore.getState();
      expect(state.currentHistory).toEqual(history);
    });

    test('应该能够取消选中', () => {
      const history: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      const {setCurrentHistory} = useHistoryStore.getState();
      setCurrentHistory(history);
      expect(useHistoryStore.getState().currentHistory).not.toBeNull();

      setCurrentHistory(null);
      expect(useHistoryStore.getState().currentHistory).toBeNull();
    });
  });

  describe('reset', () => {
    test('应该重置 store 到初始状态', async () => {
      const history: ResumeHistory = {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React'],
        resumeContent: '...',
        jdContent: '...',
        optimizedContent: '...',
      };

      (storage.setJSON as any).mockResolvedValue(undefined);

      const {addHistory, setCurrentHistory, reset} = useHistoryStore.getState();
      await addHistory(history);
      setCurrentHistory(history);

      expect(useHistoryStore.getState().histories).toHaveLength(1);
      expect(useHistoryStore.getState().currentHistory).not.toBeNull();

      // 重置
      reset();

      const state = useHistoryStore.getState();
      expect(state.histories).toEqual([]);
      expect(state.currentHistory).toBeNull();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });
  });
});
