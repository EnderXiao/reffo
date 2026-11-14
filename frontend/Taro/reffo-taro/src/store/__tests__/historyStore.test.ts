/**
 * History Store 单元测试
 *
 * **验证需求: Requirements 6.2, 6.4**
 */

import {describe, test, expect, beforeEach, jest} from '@jest/globals';
import {useHistoryStore} from '../historyStore';
import type {ResumeHistory} from '@/types';
import {createCompletionDocument, createPlainCompletionDocument, type ResumeCompletionDocument} from '@/shared/resume-completion';
import {RequestError} from '@/utils/request';
import {toResumeHistorySummaryFromHistory} from '@/utils/history-summary';

jest.mock('@/services/resumeHistory', () => ({
  ...jest.requireActual<typeof import('@/services/resumeHistory')>(
    '@/services/resumeHistory',
  ),
  resumeHistoryApi: {
    getHistories: jest.fn(),
    getHistorySummaries: jest.fn(),
    getHistory: jest.fn(),
    saveHistory: jest.fn(),
    updateHistory: jest.fn(),
    deleteHistory: jest.fn(),
    clearHistories: jest.fn(),
  },
}));

jest.mock('@/services/runtime-config', () => ({
  isLocalRuntimeEnvironment: jest.fn(async () => true),
  getPublicRuntimeConfig: jest.fn(),
}));

// Mock storage 模块
jest.mock('@/utils/storage', () => ({
  getJSON: jest.fn(async () => null),
  setJSON: jest.fn(async () => {}),
  storage: {
    removeItem: jest.fn(async () => {}),
  },
}));

import * as storage from '@/utils/storage';
import {resumeHistoryApi} from '@/services/resumeHistory';
import {getPublicRuntimeConfig, isLocalRuntimeEnvironment} from '@/services/runtime-config';
import {useAuthStore} from '@/store/authStore';

const mockedResumeHistoryApi = resumeHistoryApi as jest.Mocked<typeof resumeHistoryApi>;
const mockedHistoryCacheRead = storage.getJSON as jest.MockedFunction<(key: string) => Promise<ResumeHistory[] | null>>;

function completionHistory(version: 'resume-completion-v1' | 'resume-completion-v2'): ResumeHistory {
  const markdown = '- 负责需求分析。';
  const legacy = createPlainCompletionDocument(markdown);
  const document = version === 'resume-completion-v1' ? legacy : createCompletionDocument({
    schemaVersion: version, documentId: legacy.documentId, blocks: legacy.blocks,
  });
  return {id: 'completion-history', position: '产品经理', company: '测试公司', name: '测试用户',
    createdAt: '2026-11-10T00:00:00.000Z', qualityScore: 80, matchScore: 80, tags: [],
    resumeContent: '源简历', jdContent: '目标岗位', optimizedContent: markdown, processResult: {
      analysis: {quality_score: 80, strengths: [], weaknesses: [], suggestions: [], capability_summary: '',
        structured_resume: {personal_info: {name: '测试用户'}, education: [], experience: [], projects: [], skills: {hard_skills: [], soft_skills: []}}},
      matching: {match_score: 80, hard_requirements_match: [], skill_match: {matched_skills: [], missing_skills: [], match_percentage: 80},
        experience_match: {years_required: 0, years_actual: 0, relevant_experience: [], match_percentage: 80}, optimization_suggestions: []},
      optimized: {optimized_resume: markdown, completion_document: document, changes_summary: [], improvement_score: 0},
      interview: {questions: [], story_recommendations: [], follow_up_questions: []},
    }};
}

const completionSaveFailures = [
  ['409 冲突', new RequestError('填写版本已更新', 'RESUME_COMPLETION_MISMATCH', 409)],
  ['422 无效结构', new RequestError('填写结构无效', 'RESUME_COMPLETION_INVALID', 422)],
  ['网络失败', new RequestError('网络连接失败', 'NETWORK_ERROR')],
] as const;

describe('History Store', () => {
  // 在每个测试前重置 store
  beforeEach(() => {
    jest.clearAllMocks();
    useHistoryStore.getState().reset();
    useAuthStore.setState({session: null, initialized: false});
    (storage.getJSON as any).mockResolvedValue(null);
    (storage.setJSON as any).mockResolvedValue(undefined);
    mockedResumeHistoryApi.getHistories.mockResolvedValue([]);
    mockedResumeHistoryApi.getHistorySummaries.mockResolvedValue([]);
    mockedResumeHistoryApi.saveHistory.mockImplementation(async history => history);
    mockedResumeHistoryApi.updateHistory.mockImplementation(async (id, updates) => ({
      ...useHistoryStore.getState().histories.find(history => history.id === id),
      ...updates,
    } as ResumeHistory));
    mockedResumeHistoryApi.deleteHistory.mockResolvedValue(undefined);
    mockedResumeHistoryApi.clearHistories.mockResolvedValue(undefined);
    (isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(true);
    jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv: 'prod', databaseProvider: 'supabase', authRequired: true,
      supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}});
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
    test('nonprod 接口失败时不读取或展示本地缓存', async () => {
      useAuthStore.setState({
        session: {
          accessToken: 'test-token',
          user: {id: 'user-1'},
        },
        initialized: true,
      });
      (isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(false);
      mockedResumeHistoryApi.getHistories.mockRejectedValueOnce(new Error('接口失败'));

      await useHistoryStore.getState().loadHistories();

      expect(storage.getJSON).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().histories).toEqual([]);
      expect(useHistoryStore.getState().loading.error).toBe('接口失败');
    });

    test('未登录时从本地历史和 Landing 待同步记录加载，不请求受保护接口', async () => {
      const localHistory = {id: 'local-1', createdAt: '2024-01-01T00:00:00.000Z'} as ResumeHistory;
      const pendingHistory = {id: 'pending-1', createdAt: '2024-01-02T00:00:00.000Z'} as ResumeHistory;
      (storage.getJSON as jest.Mock)
        .mockResolvedValueOnce([localHistory])
        .mockResolvedValueOnce([pendingHistory]);

      await useHistoryStore.getState().loadHistories();

      expect(mockedResumeHistoryApi.getHistories).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().histories.map(history => history.id)).toEqual([
        'pending-1',
        'local-1',
      ]);
      expect(useHistoryStore.getState().loading.error).toBeNull();
    });

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
      useAuthStore.setState({
        session: {
          accessToken: 'test-token',
          user: {id: 'user-1'},
        },
        initialized: true,
      });
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

  describe('loadHistorySummaries', () => {
    test('local 免登录首页从后端刷新已有摘要，覆盖旧缓存空分数', async () => {
      jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv: 'local', databaseProvider: 'sqlite', authRequired: false,
        supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}});
      const history = {...completionHistory('resume-completion-v1'), matchScore: null};
      mockedHistoryCacheRead.mockResolvedValueOnce([history]);
      mockedResumeHistoryApi.getHistorySummaries.mockResolvedValue([toResumeHistorySummaryFromHistory({...history, matchScore: 87})]);

      await useHistoryStore.getState().loadHistorySummaries({force: true});

      expect(mockedResumeHistoryApi.getHistorySummaries).toHaveBeenCalledTimes(1);
      expect(mockedResumeHistoryApi.getHistories).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().historySummaries[0].matchScore).toBe(87);
      expect(useAuthStore.getState().session).toBeNull();
    });

    test.each([['prod', false], ['nonprod', false], ['local', true]] as const)('%s authRequired=%s 的游客不请求后端摘要', async (appEnv, authRequired) => {
      jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv, databaseProvider: 'supabase', authRequired,
        supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}});
      await useHistoryStore.getState().loadHistorySummaries({force: true});
      expect(mockedResumeHistoryApi.getHistorySummaries).not.toHaveBeenCalled();
    });

    test('刷新失败回退旧缓存时不把已恢复的数字分数改回空值', async () => {
      jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv: 'local', databaseProvider: 'sqlite', authRequired: false,
        supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}});
      const history = {...completionHistory('resume-completion-v1'), matchScore: null};
      useHistoryStore.setState({historySummaries: [toResumeHistorySummaryFromHistory({...history, matchScore: 87})]});
      mockedHistoryCacheRead.mockResolvedValueOnce([history]);
      mockedResumeHistoryApi.getHistorySummaries.mockRejectedValueOnce(new Error('离线'));
      await useHistoryStore.getState().loadHistorySummaries({force: true});
      expect(useHistoryStore.getState().historySummaries[0].matchScore).toBe(87);
    });

    test('远端摘要短暂滞后时保留当前已保存的新记录', async () => {
      useAuthStore.setState({
        session: {accessToken: 'test-token', user: {id: 'user-1'}},
        initialized: true,
      });
      (isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(false);
      mockedResumeHistoryApi.getHistorySummaries.mockResolvedValue([]);
      useHistoryStore.setState({
        historySummaries: [{
          id: 'new-history',
          position: '产品经理',
          company: 'Reffo',
          name: '候选人',
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
          qualityScore: 88,
          matchScore: 84,
          tags: [],
          location: '北京',
          strategyBody: '刚保存的新记录。',
        }],
      });

      await useHistoryStore.getState().loadHistorySummaries({force: true});

      expect(useHistoryStore.getState().historySummaries.map(item => item.id)).toEqual([
        'new-history',
      ]);
    });

    test('本地部分缓存刷新时保留当前已展示摘要', async () => {
      useAuthStore.setState({
        session: {accessToken: 'test-token', user: {id: 'user-1'}},
        initialized: true,
      });
      (isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(true);
      (storage.getJSON as jest.Mock).mockResolvedValueOnce([{
        id: 'cached-history',
        position: '前端工程师',
        company: 'Reffo',
        name: '候选人',
        createdAt: '2026-09-22T00:00:00.000Z',
        qualityScore: 80,
        matchScore: 78,
        tags: [],
        resumeContent: '# 简历',
        jdContent: '工作地点：上海',
        optimizedContent: '# 优化简历',
      } as ResumeHistory]);
      mockedResumeHistoryApi.getHistorySummaries.mockRejectedValueOnce(new Error('接口失败'));
      useHistoryStore.setState({
        historySummaries: [{
          id: 'current-history',
          position: '产品经理',
          company: 'Reffo',
          name: '候选人',
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
          qualityScore: 88,
          matchScore: 84,
          tags: [],
          location: '北京',
          strategyBody: '当前已展示的记录。',
        }],
      });

      await useHistoryStore.getState().loadHistorySummaries({force: true});

      expect(useHistoryStore.getState().historySummaries.map(item => item.id)).toEqual([
        'current-history',
        'cached-history',
      ]);
    });

    test('首页摘要加载不请求完整历史列表', async () => {
      useAuthStore.setState({
        session: {accessToken: 'test-token', user: {id: 'user-1'}},
        initialized: true,
      });
      (isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(false);
      mockedResumeHistoryApi.getHistorySummaries.mockResolvedValue([{
        id: 'history-1',
        position: '产品经理',
        company: 'Reffo',
        name: '候选人',
        createdAt: '2026-09-23T00:00:00.000Z',
        updatedAt: '2026-09-23T00:00:00.000Z',
        qualityScore: 88,
        matchScore: 84,
        tags: ['AI'],
        location: '北京',
        strategyBody: '突出 AI 产品落地。',
      }]);

      await useHistoryStore.getState().loadHistorySummaries();

      expect(mockedResumeHistoryApi.getHistories).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().historySummaries.map(item => item.id)).toEqual([
        'history-1',
      ]);
      expect(useHistoryStore.getState().summaryInitialized).toBe(true);
    });

    test('本地完整历史可离线转换为摘要', async () => {
      const history = {
        id: 'local-1',
        position: '产品经理',
        company: 'Reffo',
        name: '候选人',
        createdAt: '2026-09-23T00:00:00.000Z',
        qualityScore: 88,
        matchScore: 84,
        tags: ['AI'],
        resumeContent: '# 简历',
        jdContent: '工作地点：上海',
        optimizedContent: '# 优化简历',
      } as ResumeHistory;
      (storage.getJSON as jest.Mock).mockResolvedValueOnce([history]);

      await useHistoryStore.getState().loadHistorySummaries();

      expect(mockedResumeHistoryApi.getHistorySummaries).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().historySummaries[0]).toMatchObject({
        id: 'local-1',
        location: '上海',
      });
    });
  });

  describe('loadHistory', () => {
    test('旧缓存详情命中时不把新摘要已恢复的数字分数改回空值', async () => {
      const history = {...completionHistory('resume-completion-v1'), matchScore: null};
      useHistoryStore.setState({histories: [history], historySummaries: [toResumeHistorySummaryFromHistory({...history, matchScore: 87})]});
      await useHistoryStore.getState().loadHistory(history.id);
      expect(useHistoryStore.getState().historySummaries[0].matchScore).toBe(87);
      expect(mockedResumeHistoryApi.getHistory).not.toHaveBeenCalled();
    });

    test.each(['缺少摘要', '旧摘要'])('缓存命中时修复%s，不再请求接口', async kind => {
      const history = completionHistory('resume-completion-v1');
      useHistoryStore.setState({histories: [history], historySummaries: kind === '缺少摘要' ? [] : [{
        ...toResumeHistorySummaryFromHistory(history), name: '旧姓名', company: '旧公司', position: '旧岗位',
        matchScore: 10,
      }]});

      await useHistoryStore.getState().loadHistory(history.id);

      expect(mockedResumeHistoryApi.getHistory).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().historySummaries).toEqual([expect.objectContaining({
        id: history.id, name: history.name, position: history.position, matchScore: history.matchScore,
      })]);
      expect(useHistoryStore.getState().currentHistory).toBe(history);
    });

    test('详情按 ID 加载并回填摘要，不拉取完整列表', async () => {
      useAuthStore.setState({
        session: {accessToken: 'test-token', user: {id: 'user-1'}},
        initialized: true,
      });
      (isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(false);
      mockedResumeHistoryApi.getHistory.mockResolvedValue({
        id: 'history-1',
        position: '产品经理',
        company: 'Reffo',
        name: '候选人',
        createdAt: '2026-09-23T00:00:00.000Z',
        qualityScore: 88,
        matchScore: 84,
        tags: ['AI'],
        resumeContent: '# 简历',
        jdContent: '工作地点：北京',
        optimizedContent: '# 优化简历',
      });

      const history = await useHistoryStore.getState().loadHistory('history-1');

      expect(mockedResumeHistoryApi.getHistory).toHaveBeenCalledWith('history-1');
      expect(mockedResumeHistoryApi.getHistories).not.toHaveBeenCalled();
      expect(history?.id).toBe('history-1');
      expect(useHistoryStore.getState().historySummaries[0].id).toBe('history-1');
      expect(useHistoryStore.getState().currentHistory?.id).toBe('history-1');
    });
  });

  test('接收权威保存结果时同步详情、摘要和当前记录，保留其他卡片并去重', () => {
    const history = completionHistory('resume-completion-v1');
    const other = {...history, id: 'other-history', createdAt: '2026-11-09T00:00:00.000Z'};
    useHistoryStore.getState().acceptHistory(other);
    useHistoryStore.getState().acceptHistory({...history, company: '旧公司'});
    useHistoryStore.getState().acceptHistory(history);

    const state = useHistoryStore.getState();
    expect(state.histories).toEqual([history, other]);
    expect(state.historySummaries.map(item => [item.id, item.company])).toEqual([
      [history.id, history.company], [other.id, other.company],
    ]);
    expect(state.currentHistory).toBe(history);
  });

  test('结果页强制恢复时忽略旧缓存并读取远端当前版本', async () => {
    useAuthStore.setState({session: {accessToken: 'test-token', user: {id: 'user-1'}}, initialized: true});
    const cached = completionHistory('resume-completion-v2');
    const fresh = {...cached, optimizedContent: '远端当前版本'};
    useHistoryStore.setState({histories: [cached]});
    (storage.getJSON as jest.Mock).mockResolvedValue([cached]);
    mockedResumeHistoryApi.getHistory.mockResolvedValue(fresh);
    await expect(useHistoryStore.getState().loadHistory(cached.id, {force: true})).resolves.toEqual(fresh);
    expect(mockedResumeHistoryApi.getHistory).toHaveBeenCalledWith(cached.id);
    expect(useHistoryStore.getState().currentHistory?.optimizedContent).toBe('远端当前版本');
  });

  describe('addHistory', () => {
    test.each(completionSaveFailures)('v2 %s 不能作为本地保存成功，原有缓存保持不变', async (_label, error) => {
      const existing = {...completionHistory('resume-completion-v1'), id: 'existing-history'};
      const histories = [existing];
      useHistoryStore.setState({histories, currentHistory: existing});
      mockedResumeHistoryApi.saveHistory.mockRejectedValueOnce(error);

      await expect(useHistoryStore.getState().addHistory(completionHistory('resume-completion-v2'))).rejects.toBe(error);

      expect(useHistoryStore.getState().histories).toBe(histories);
      expect(useHistoryStore.getState().currentHistory).toBe(existing);
      expect(useHistoryStore.getState().historySummaries).toEqual([]);
      expect(storage.setJSON).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().loading).toEqual({isLoading: false, error: error.message});
    });

    test.each([['未来版本', {schemaVersion: 'resume-completion-v3'}], ['损坏结构', null]] as const)(
      '%s 的远端保存失败不能回退为本地成功', async (_label, document) => {
        const history = completionHistory('resume-completion-v2');
        history.processResult!.optimized.completion_document = document as unknown as ResumeCompletionDocument;
        const error = new Error('远端拒绝');
        mockedResumeHistoryApi.saveHistory.mockRejectedValueOnce(error);

        await expect(useHistoryStore.getState().addHistory(history)).rejects.toBe(error);

        expect(useHistoryStore.getState().histories).toEqual([]);
        expect(storage.setJSON).not.toHaveBeenCalled();
      },
    );

    test('同 ID 旧式请求不能在远端失败后覆盖已有 v2 缓存', async () => {
      const existing = completionHistory('resume-completion-v2');
      const histories = [existing];
      useHistoryStore.setState({histories});
      const error = new Error('远端拒绝降级');
      mockedResumeHistoryApi.saveHistory.mockRejectedValueOnce(error);

      await expect(useHistoryStore.getState().addHistory({...existing, processResult: undefined})).rejects.toBe(error);

      expect(useHistoryStore.getState().histories).toBe(histories);
      expect(storage.setJSON).not.toHaveBeenCalled();
    });

    test('有效 v1 文档保留本地保存回退能力', async () => {
      const history = completionHistory('resume-completion-v1');
      mockedResumeHistoryApi.saveHistory.mockRejectedValueOnce(new Error('网络连接失败'));

      await expect(useHistoryStore.getState().addHistory(history)).resolves.toBe(history.id);

      expect(useHistoryStore.getState().histories).toEqual([history]);
      expect(storage.setJSON).toHaveBeenCalledWith('resume_histories', [history]);
      expect(useHistoryStore.getState().loading.error).toBeNull();
    });

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
    test.each(completionSaveFailures)('v2 %s 必须保持失败，不能更新本地缓存', async (_label, error) => {
      const existing = completionHistory('resume-completion-v2');
      const histories = [existing];
      useHistoryStore.setState({histories, currentHistory: existing});
      mockedResumeHistoryApi.updateHistory.mockRejectedValueOnce(error);

      await expect(useHistoryStore.getState().updateHistory(existing.id, {qualityScore: 95})).rejects.toBe(error);

      expect(useHistoryStore.getState().histories).toBe(histories);
      expect(useHistoryStore.getState().currentHistory).toBe(existing);
      expect(useHistoryStore.getState().historySummaries).toEqual([]);
      expect(storage.setJSON).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().loading).toEqual({isLoading: false, error: error.message});
    });

    test('更新请求丢失填写结构时仍以已有 v2 记录要求远端确认', async () => {
      const existing = completionHistory('resume-completion-v2');
      const histories = [existing];
      useHistoryStore.setState({histories});
      const error = new Error('填写状态缺失');
      mockedResumeHistoryApi.updateHistory.mockRejectedValueOnce(error);
      const processResult = {...existing.processResult!, optimized: {optimized_resume: '旧客户端正文', changes_summary: [], improvement_score: 0}};

      await expect(useHistoryStore.getState().updateHistory(existing.id, {processResult, optimizedContent: '旧客户端正文'})).rejects.toBe(error);

      expect(useHistoryStore.getState().histories).toBe(histories);
      expect(storage.setJSON).not.toHaveBeenCalled();
    });

    test('旧记录升级为 v2 的保存失败不覆盖 v1 缓存', async () => {
      const existing = completionHistory('resume-completion-v1');
      const histories = [existing];
      useHistoryStore.setState({histories});
      const error = new Error('远端不可用');
      mockedResumeHistoryApi.updateHistory.mockRejectedValueOnce(error);

      await expect(useHistoryStore.getState().updateHistory(existing.id, {
        processResult: completionHistory('resume-completion-v2').processResult,
      })).rejects.toBe(error);

      expect(useHistoryStore.getState().histories).toBe(histories);
      expect(storage.setJSON).not.toHaveBeenCalled();
    });

    test('有效 v1 文档更新保留本地回退能力', async () => {
      const existing = completionHistory('resume-completion-v1');
      useHistoryStore.setState({histories: [existing]});
      mockedResumeHistoryApi.updateHistory.mockRejectedValueOnce(new Error('网络连接失败'));

      await expect(useHistoryStore.getState().updateHistory(existing.id, {qualityScore: 95})).resolves.toBeUndefined();

      expect(useHistoryStore.getState().histories).toEqual([{...existing, qualityScore: 95}]);
      expect(storage.setJSON).toHaveBeenCalledWith('resume_histories', [{...existing, qualityScore: 95}]);
      expect(useHistoryStore.getState().loading.error).toBeNull();
    });

    test('v2 记录经远端确认后正常新增和更新缓存', async () => {
      const history = completionHistory('resume-completion-v2');
      await expect(useHistoryStore.getState().addHistory(history)).resolves.toBe(history.id);
      await expect(useHistoryStore.getState().updateHistory(history.id, {qualityScore: 95})).resolves.toBeUndefined();
      expect(mockedResumeHistoryApi.saveHistory).toHaveBeenCalledWith(history);
      expect(mockedResumeHistoryApi.updateHistory).toHaveBeenCalledWith(history.id, {qualityScore: 95});
      expect(useHistoryStore.getState().histories).toEqual([{...history, qualityScore: 95}]);
      expect(storage.setJSON).toHaveBeenLastCalledWith('resume_histories', [{...history, qualityScore: 95}]);
    });

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
