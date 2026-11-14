import {useAuthStore} from '@/store/authStore'
import {act, renderHook, waitFor} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, jest, test} from '@jest/globals'
import {useRouter} from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {resumeHistoryApi} from '@/services/resumeHistory'
import {getPublicRuntimeConfig} from '@/services/runtime-config'
import {RequestError} from '@/utils/httpTransport'
import {useResumeWorkspaceStore} from '@/store/resumeWorkspaceStore'
import {useHistoryStore} from '@/store/historyStore'
import type {ResumeHistory, ResumeStrategyReview} from '@/types'
import {resumeTextFingerprint} from '@/shared/resume-strategy'
import {
  getLatestResultSession,
  saveLatestResultSession,
  type LatestResultSession,
} from '@/utils/result-session'
import {feedback} from '@/utils/feedback'
import {usePageModel} from '../usePageModel'
import {hasStaleStrategyReview} from '../model/analysisPresentation'
import {applyCompletionCommand, createCompletionDocument, serializeDraft} from '@/shared/resume-completion'
import {completionFixture, completionResult} from './completionFixture'
import {historyCompletionBaseline} from '../model/completionSession'
import {savePendingLandingHistory} from '@/utils/pending-landing-data'

let mockResultId: string | null = null

jest.mock('@/services/runtime-config', () => {
  const mockJest = require('@jest/globals').jest as typeof jest
  return {
    ...mockJest.requireActual<typeof import('@/services/runtime-config')>('@/services/runtime-config'),
    getPublicRuntimeConfig: mockJest.fn(async () => ({appEnv: 'prod', databaseProvider: 'supabase', authRequired: true,
      supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}})),
  }
})

jest.mock('@/services/resume', () => ({
  resumeApi: {
    matchResume: jest.fn(),
    generateOptimizedResume: jest.fn(),
    generateInterviewSuggestions: jest.fn(),
  },
}))

jest.mock('@/utils/result-session', () => ({
  getLatestResultSession: jest.fn(),
  saveLatestResultSession: jest.fn(),
  getResultSessionStorageKey: () => 'reffo.test.result',
}))

jest.mock('@/utils/pending-landing-data', () => ({savePendingLandingHistory: jest.fn()}))

jest.mock('@/shared/routing', () => ({
  usePageRoute: () => ({
    params: {},
    path: '/pages/result/index',
    readString: (key: string) => key === 'id' ? mockResultId : null,
    readBoolean: () => false,
    readNumber: () => null,
  }),
  appendRouteParams: (path: string) => path,
  routePaths: {
    complete: '/pages/complete/index',
    create: '/pages/create/index',
    home: '/pages/index/index',
  },
  useRouteTransition: () => ({
    navigate: jest.fn(),
    replace: jest.fn(),
    reset: jest.fn(),
  }),
}))

const analysis = {
  quality_score: 88,
  strengths: [],
  weaknesses: [],
  suggestions: [],
  capability_summary: '',
  structured_resume: {
    personal_info: {name: 'Jeremy Smith'},
    education: [],
    experience: [],
    projects: [],
    skills: {hard_skills: [], soft_skills: []},
  },
}

const matching = {
  match_score: 91,
  hard_requirements_match: [],
  skill_match: {
    matched_skills: ['React'],
    missing_skills: [],
    match_percentage: 91,
  },
  experience_match: {
    years_required: 0,
    years_actual: 0,
    relevant_experience: [],
    match_percentage: 0,
  },
  optimization_suggestions: [],
}

const optimized = {
  optimized_resume: '# Jeremy Smith\n\n## Optimized',
  changes_summary: [],
  improvement_score: 4,
}

const interview = {
  questions: [],
  story_recommendations: [],
  follow_up_questions: [],
}

function createSession(): LatestResultSession {
  return {
    result: {
      analysis,
      matching,
      optimized: {
        optimized_resume: '',
        changes_summary: [],
        improvement_score: 0,
      },
      interview,
    },
    context: {
      company: 'OpenAI',
      position: '前端工程师',
      resumeContent: '# Resume',
      jdContent: '岗位职责',
    },
    progress: {
      analysis: 'done',
      matching: 'done',
      optimized: 'pending',
      interview: 'pending',
    },
  }
}

function completionV2Fixture() {
  const legacy = completionFixture()
  return createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: legacy.documentId, revision: legacy.revision,
    blocks: legacy.blocks.map(block => ({...block, segments: block.segments.map(segment => segment.kind === 'optional_gap_clause'
      ? {...segment, detailId: 'detail-deliverable'} : segment)}))})
}

function editCompletion(document: ReturnType<typeof completionV2Fixture>, type: 'fill' | 'clear', value?: string) {
  const result = applyCompletionCommand(document, {documentId: document.documentId, baseRevision: document.revision,
    gapId: 'deliverable', type, ...(value ? {value} : {})})
  if (!result.ok || !result.operation) throw new Error('completion fixture edit failed')
  return result
}

describe('Result usePageModel workspace generation state', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResultId = null
    useResumeWorkspaceStore.getState().reset()
    jest.mocked(useRouter).mockReturnValue({params: {}} as never)
    jest.mocked(getLatestResultSession).mockResolvedValue(createSession())
    jest.mocked(saveLatestResultSession).mockResolvedValue(undefined)
    jest.mocked(resumeApi.generateOptimizedResume).mockResolvedValue(optimized)
    jest.mocked(resumeApi.generateInterviewSuggestions).mockResolvedValue(interview)
  })

  afterEach(() => { jest.restoreAllMocks() })

  test('恢复已完成会话时保留面试展示投影', async () => {
    const session = createSession()
    const presentation = {version: 'interview-presentation-v1' as const, questions: [], stories: []}
    session.result.optimized = optimized
    session.result.interview = {...interview, questions: ['请说明方案取舍'], presentation}
    session.progress = {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.result?.interview.presentation).toEqual(presentation))
    expect(resumeApi.generateInterviewSuggestions).not.toHaveBeenCalled()
  })

  test('历史读取展示升级与本地未同步正文合并，不覆盖本地稿', async () => {
    const session = createSession()
    const presentation = {version: 'interview-presentation-v1' as const, questions: [], stories: []}
    session.originHistoryId = 'history-presentation'
    session.result.optimized = {...optimized, optimized_resume: '本地未同步填写稿'}
    session.baseHistorySnapshot = {optimizedContent: optimized.optimized_resume}
    session.progress = {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}
    const history: ResumeHistory = {id: session.originHistoryId, name: 'Jeremy Smith', company: '测试公司', position: '产品经理',
      createdAt: '2026-09-27T10:00:00Z', qualityScore: 88, matchScore: 91, tags: [], resumeContent: '# Resume', jdContent: '岗位职责',
      optimizedContent: optimized.optimized_resume, processResult: {...session.result, optimized, interview: {...interview, presentation}}, progress: session.progress}
    mockResultId = history.id
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(history)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.result?.interview.presentation).toEqual(presentation))
    expect(result.current.result?.optimized.optimized_resume).toBe('本地未同步填写稿')
    expect(result.current.recoveryConflict).toBe(false)
    expect(resumeApi.generateInterviewSuggestions).not.toHaveBeenCalled()
  })

  test('无id恢复已保存完成会话只读补充展示投影，失败仍保留本地稿', async () => {
    const session = createSession()
    const presentation = {version: 'interview-presentation-v1' as const, questions: [], stories: []}
    session.originHistoryId = 'saved-session'
    session.result.optimized = {...optimized, optimized_resume: '本地草稿'}
    session.progress = {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}
    const history: ResumeHistory = {id: session.originHistoryId, name: 'Jeremy Smith', company: '测试公司', position: '产品经理',
      createdAt: '2026-09-27T10:00:00Z', qualityScore: 88, matchScore: 91, tags: [], resumeContent: '# Resume', jdContent: '岗位职责',
      optimizedContent: optimized.optimized_resume, processResult: {...session.result, optimized, interview: {...interview, presentation}}, progress: session.progress}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const load = jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(history)
    const first = renderHook(() => usePageModel())
    await waitFor(() => expect(first.result.current.result?.interview.presentation).toEqual(presentation))
    expect(load).toHaveBeenCalledWith('saved-session', {force: true})
    expect(first.result.current.result?.optimized.optimized_resume).toBe('本地草稿')
    first.unmount()
    load.mockRejectedValue(new Error('离线'))
    const second = renderHook(() => usePageModel())
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(second.result.current.result?.optimized.optimized_resume).toBe('本地草稿')
    expect(resumeApi.generateInterviewSuggestions).not.toHaveBeenCalled()
  })

  test('从优化阶段继续并完成 workspace 状态机', async () => {
    const statuses: string[] = []
    const unsubscribe = useResumeWorkspaceStore.subscribe(state => {
      statuses.push(state.generationStatus)
    })

    renderHook(() => usePageModel())

    await waitFor(() => {
      expect(useResumeWorkspaceStore.getState().generationStatus).toBe('completed')
    })

    unsubscribe()
    expect(resumeApi.generateOptimizedResume).toHaveBeenCalledTimes(1)
    expect(resumeApi.generateInterviewSuggestions).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(expect.arrayContaining(['optimizing', 'interviewing', 'completed']))
    expect(useResumeWorkspaceStore.getState().optimizedResume).toEqual(optimized)
  })

  test('继续生成保留源简历和岗位 OCR 关联，不依赖后台任务入口', async () => {
    const session = createSession()
    session.context.resumeParseId = '33333333-3333-4333-8333-333333333333'
    session.context.jdParseId = '44444444-4444-4444-8444-444444444444'
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    renderHook(() => usePageModel())
    await waitFor(() => expect(resumeApi.generateOptimizedResume).toHaveBeenCalledWith(analysis, matching,
      {resumeParseId: session.context.resumeParseId, jdParseId: session.context.jdParseId}))
  })

  test('生成失败写入统一 failed 状态和错误', async () => {
    jest.mocked(resumeApi.generateOptimizedResume).mockRejectedValueOnce(new Error('优化失败'))

    renderHook(() => usePageModel())

    await waitFor(() => {
      expect(useResumeWorkspaceStore.getState()).toMatchObject({
        generationStatus: 'failed',
        error: '优化失败',
      })
    })
  })

  test('面试建议失败后不会自动重试，点击重试后才再次请求', async () => {
    const session = createSession()
    session.result.optimized = optimized
    session.progress = {
      analysis: 'done',
      matching: 'done',
      optimized: 'done',
      interview: 'pending',
    }
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    jest.mocked(resumeApi.generateInterviewSuggestions)
      .mockRejectedValueOnce(new Error('面试建议生成失败'))
    const feedbackError = jest.spyOn(feedback, 'error').mockImplementation(() => undefined)

    const {result} = renderHook(() => usePageModel())

    await waitFor(() => {
      expect(result.current.progress.interview).toBe('failed')
    })
    await waitFor(() => {
      expect(jest.mocked(saveLatestResultSession).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
        progress: expect.objectContaining({interview: 'failed'}),
      }))
    })

    expect(resumeApi.generateInterviewSuggestions).toHaveBeenCalledTimes(1)
    expect(feedbackError).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.handleRetryStage('interview')
    })

    expect(resumeApi.generateInterviewSuggestions).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(result.current.progress.interview).toBe('done')
    })
  })

  test('恢复已失败的面试建议时保持失败态，不触发自动重试', async () => {
    const session = createSession()
    session.result.optimized = optimized
    session.progress = {
      analysis: 'done',
      matching: 'done',
      optimized: 'done',
      interview: 'failed',
    }
    jest.mocked(getLatestResultSession).mockResolvedValue(session)

    const {result} = renderHook(() => usePageModel())

    await waitFor(() => {
      expect(result.current.progress.interview).toBe('failed')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(resumeApi.generateInterviewSuggestions).not.toHaveBeenCalled()
    expect(useResumeWorkspaceStore.getState().generationStatus).not.toBe('interviewing')
  })

  test('结果页点击失败的简历 tab 会重新调用生成接口', async () => {
    jest.mocked(resumeApi.generateOptimizedResume).mockRejectedValueOnce(new Error('优化失败'))
    const {result} = renderHook(() => usePageModel())

    await waitFor(() => {
      expect(result.current.progress.optimized).toBe('failed')
    })

    await act(async () => {
      await result.current.handleRetryStage('resume')
    })

    expect(resumeApi.generateOptimizedResume).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(result.current.progress).toMatchObject({
        optimized: 'done',
        interview: 'done',
      })
      expect(useResumeWorkspaceStore.getState().generationStatus).toBe('completed')
    })
  })

  test('未失败的 tab 不会触发额外生成调用', async () => {
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => {
      expect(useResumeWorkspaceStore.getState().generationStatus).toBe('completed')
    })

    const interviewCalls = jest.mocked(resumeApi.generateInterviewSuggestions).mock.calls.length
    await act(async () => {
      await result.current.handleRetryStage('interview')
    })

    expect(jest.mocked(resumeApi.generateInterviewSuggestions)).toHaveBeenCalledTimes(interviewCalls)
  })

  test('页面卸载会取消仍在执行的 workspace 请求', async () => {
    let resolveOptimized!: (value: typeof optimized) => void
    jest.mocked(resumeApi.generateOptimizedResume).mockReturnValueOnce(
      new Promise(resolve => {
        resolveOptimized = resolve
      }),
    )
    const {unmount} = renderHook(() => usePageModel())

    await waitFor(() => {
      expect(useResumeWorkspaceStore.getState().generationStatus).toBe('optimizing')
    })

    unmount()
    expect(useResumeWorkspaceStore.getState().generationStatus).toBe('idle')

    await act(async () => {
      resolveOptimized(optimized)
      await Promise.resolve()
    })

    expect(useResumeWorkspaceStore.getState().generationStatus).toBe('idle')
  })

  test('面试生成完成不会覆盖生成简历的人工编辑', async () => {
    const session = createSession()
    session.result.optimized = optimized
    session.progress = {
      analysis: 'done',
      matching: 'done',
      optimized: 'done',
      interview: 'pending',
    }
    jest.mocked(getLatestResultSession).mockResolvedValue(session)

    let resolveInterview!: (value: typeof interview) => void
    jest.mocked(resumeApi.generateInterviewSuggestions).mockReturnValueOnce(
      new Promise(resolve => {
        resolveInterview = resolve
      }),
    )

    const {result} = renderHook(() => usePageModel())
    await waitFor(() => {
      expect(useResumeWorkspaceStore.getState().generationStatus).toBe('interviewing')
    })

    const edited = '# Jeremy Smith\n\n## Edited while interview is generating'
    await act(async () => {
      await result.current.handleOptimizedResumeChange(edited)
    })
    expect(result.current.result?.optimized.optimized_resume).toBe(edited)

    await act(async () => {
      resolveInterview(interview)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(useResumeWorkspaceStore.getState().generationStatus).toBe('completed')
    })

    expect(result.current.result?.optimized.optimized_resume).toBe(edited)
    expect(result.current.result?.interview).toEqual(interview)
    expect(jest.mocked(saveLatestResultSession).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      result: expect.objectContaining({
        optimized: expect.objectContaining({optimized_resume: edited}),
        interview,
      }),
      progress: expect.objectContaining({interview: 'done'}),
    }))
  })

  test('历史正文优先于旧结果快照，并让原正文对应说明失效', async () => {
    const quote = '参与需求整理并完成交付跟进。'
    const original = `# Jeremy Smith\n\n## 工作经历\n${quote}`
    const edited = '# Jeremy Smith\n\n## 工作经历\n完成用户访谈记录整理。'
    const review: ResumeStrategyReview = {
      version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(original),
      items: [{strategyId: 'strategy_gap_1', strategy: '展开交付实践', status: 'linked',
        explanation: '正文包含相关材料。', references: [{outputPath: 'experience[0].bullets[0]', location: '工作经历', quote}]}],
    }
    const history: ResumeHistory = {
      id: 'history-edited', name: 'Jeremy Smith', company: '测试公司', position: '产品经理',
      createdAt: '2026-09-27T10:00:00Z', qualityScore: 88, matchScore: 91, tags: [],
      resumeContent: '# Resume', jdContent: '岗位职责', optimizedContent: edited,
      processResult: {analysis, matching, interview, optimized: {
        ...optimized, optimized_resume: original, strategy_review: review, changes_summary: [`工作经历：${quote}`],
      }},
      progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'},
    }
    mockResultId = history.id
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(history)
    const {result} = renderHook(() => usePageModel())

    await waitFor(() => expect(result.current.result?.optimized.optimized_resume).toBe(edited))
    expect(result.current.result?.optimized.changes_summary).toEqual([])
    expect(result.current.result?.optimized.strategy_review).toEqual(review)
    expect(hasStaleStrategyReview(result.current.result!)).toBe(true)
    expect(useResumeWorkspaceStore.getState().optimizedResume).toEqual(result.current.result?.optimized)
    expect(getLatestResultSession).toHaveBeenCalledTimes(1)
    expect(resumeApi.generateOptimizedResume).not.toHaveBeenCalled()
  })

  test('人工删除对应原句后清空成品摘要，并保留旧核验用于失效提示和保存', async () => {
    const quote = '参与需求整理并完成交付跟进。'
    const original = `# Jeremy Smith\n\n## 工作经历\n${quote}`
    const review: ResumeStrategyReview = {
      version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(original),
      items: [{strategyId: 'strategy_gap_1', strategy: '展开交付实践', status: 'linked',
        explanation: '正文包含相关材料。', references: [{outputPath: 'experience[0].bullets[0]', location: '工作经历', quote}]}],
    }
    const session = createSession()
    session.result.optimized = {...optimized, optimized_resume: original, strategy_review: review, changes_summary: [`工作经历：${quote}`]}
    session.progress = {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.result?.optimized.strategy_review).toEqual(review))
    expect(hasStaleStrategyReview(result.current.result!)).toBe(false)
    const edited = '# Jeremy Smith\n\n## 工作经历\n完成用户访谈记录整理。'

    await act(async () => { await result.current.handleOptimizedResumeChange(edited) })

    expect(result.current.result?.optimized).toMatchObject({optimized_resume: edited, changes_summary: [], strategy_review: review})
    expect(hasStaleStrategyReview(result.current.result!)).toBe(true)
    expect(useResumeWorkspaceStore.getState().optimizedResume).toEqual(result.current.result?.optimized)
    expect(jest.mocked(saveLatestResultSession).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      result: expect.objectContaining({optimized: expect.objectContaining({optimized_resume: edited, changes_summary: [], strategy_review: review})}),
    }))
    expect(resumeApi.generateOptimizedResume).not.toHaveBeenCalled()
  })

  test('面试失败保留请求期间完成的填写，重试落盘保留最新面试字段', async () => {
    const session = createSession()
    session.result = completionResult()
    session.progress = {analysis: 'done', matching: 'done', optimized: 'done', interview: 'pending'}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    let rejectInterview!: (error: Error) => void
    jest.mocked(resumeApi.generateInterviewSuggestions).mockReturnValueOnce(new Promise((_, reject) => { rejectInterview = reject }))
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.progress.interview).toBe('generating'))
    const doc = completionFixture()
    const change = applyCompletionCommand(doc, {documentId: doc.documentId, baseRevision: 0, gapId: 'deliverable', type: 'fill', value: '页面原型'})
    if (!change.ok) throw new Error('fixture failed')
    await act(async () => { await result.current.handleCompletionDocumentChange?.(change.document, 0, serializeDraft(doc)) })
    await act(async () => { rejectInterview(new Error('面试超时')); await Promise.resolve() })
    await waitFor(() => expect(result.current.progress.interview).toBe('failed'))
    expect(jest.mocked(saveLatestResultSession).mock.calls.at(-1)?.[0].result.optimized.completion_document).toEqual(change.document)
    expect(result.current.result?.optimized.completion_document).toEqual(change.document)
  })

  test('旧会话写入完成不会把后发生的编辑覆盖回去', async () => {
    const session = createSession()
    session.result = completionResult()
    session.progress = {analysis: 'done', matching: 'done', optimized: 'done', interview: 'pending'}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    let resolveWrite!: () => void
    jest.mocked(saveLatestResultSession).mockReturnValueOnce(new Promise(resolve => { resolveWrite = resolve }))
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(saveLatestResultSession).toHaveBeenCalledTimes(1))
    let edit!: Promise<void>
    act(() => { edit = result.current.handleOptimizedResumeChange('# 最新人工正文') })
    expect(result.current.result?.optimized.optimized_resume).toBe('# 最新人工正文')
    await act(async () => { resolveWrite(); await edit })
    expect(result.current.result?.optimized.optimized_resume).toBe('# 最新人工正文')
    expect(jest.mocked(saveLatestResultSession).mock.calls.at(-1)?.[0].result.optimized.optimized_resume).toBe('# 最新人工正文')
  })

  test('历史页刷新恢复同记录较新的会话稿，历史仍显示未保存', async () => {
    const baseResult = completionResult()
    const history: ResumeHistory = {id: 'history-cloze', position: '产品经理', company: '测试公司', name: '测试用户',
      createdAt: '2026-11-10', qualityScore: 80, matchScore: 80, tags: [], resumeContent: '# 源简历', jdContent: '岗位职责',
      optimizedContent: baseResult.optimized.optimized_resume, processResult: baseResult}
    const doc = completionFixture()
    const change = applyCompletionCommand(doc, {documentId: doc.documentId, baseRevision: 0, gapId: 'deliverable', type: 'fill', value: '页面原型'})
    if (!change.ok) throw new Error('fixture failed')
    const session: LatestResultSession = {...createSession(), result: completionResult(change.document), originHistoryId: history.id,
      baseHistorySnapshot: historyCompletionBaseline(history), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}}
    mockResultId = history.id
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(history)
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.result?.optimized.completion_document).toEqual(change.document)
    expect(result.current.saved).toBe(false)
    expect(result.current.recoveryConflict).toBe(false)
  })

  test('历史保存途中发生新编辑，旧保存成功不把新稿标成已保存', async () => {
    const session = {...createSession(), result: completionResult(), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    let finishHistory!: (id: string) => void
    jest.spyOn(useHistoryStore.getState(), 'addHistory').mockReturnValueOnce(new Promise(resolve => { finishHistory = resolve }))
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let saving!: Promise<string | null>
    act(() => { saving = result.current.handleSave() })
    await waitFor(() => expect(useHistoryStore.getState().addHistory).toHaveBeenCalled())
    await act(async () => { await result.current.handleOptimizedResumeChange('# 新版本简历') })
    await act(async () => { finishHistory('saved-cloze'); await saving })
    expect(result.current.saved).toBe(false)
    expect(result.current.result?.optimized.optimized_resume).toBe('# 新版本简历')
    const latest = jest.mocked(saveLatestResultSession).mock.calls.at(-1)?.[0]
    expect(latest?.originHistoryId).toBe('saved-cloze')
    expect(latest?.result.optimized.optimized_resume).toBe('# 新版本简历')
    expect(latest?.baseHistorySnapshot?.optimizedContent).toBe(session.result.optimized.optimized_resume)
  })

  test('v2 冲突选择本地稿后，以远端当前版本重放并保存', async () => {
    const baseline = completionV2Fixture()
    const local = editCompletion(baseline, 'fill', '页面原型')
    const remote = editCompletion(baseline, 'fill', '交互流程')
    const baseHistory: ResumeHistory = {id: 'v2-conflict', position: '产品经理', company: '测试公司', name: '测试用户',
      createdAt: '2026-11-10', qualityScore: 80, matchScore: 80, tags: [], resumeContent: '# 源简历', jdContent: '岗位职责',
      optimizedContent: serializeDraft(baseline), processResult: completionResult(baseline)}
    const history = {...baseHistory, optimizedContent: serializeDraft(remote.document), processResult: completionResult(remote.document)}
    const localResult = completionResult(local.document)
    localResult.optimized.completion_edit = {documentId: baseline.documentId, baseRevision: 0, operations: [local.operation!]}
    const session: LatestResultSession = {...createSession(), result: localResult, originHistoryId: history.id,
      baseHistorySnapshot: historyCompletionBaseline(baseHistory), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}}
    mockResultId = history.id
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(history)
    const update = jest.spyOn(useHistoryStore.getState(), 'updateHistory').mockResolvedValue(undefined)
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.recoveryConflict).toBe(true))
    await act(async () => { await result.current.handleResolveRecovery?.('session') })
    expect(result.current.recoveryConflict).toBe(false)
    expect(result.current.result?.optimized.completion_edit?.baseRevision).toBe(1)
    expect(result.current.result?.optimized.completion_document?.revision).toBe(2)
    await act(async () => { await result.current.handleSave() })
    expect(update.mock.calls[0][1].processResult?.optimized.completion_edit?.baseRevision).toBe(1)
    expect(result.current.saved).toBe(true)
    expect(result.current.result?.optimized.completion_edit).toBeUndefined()
  })

  test('未登录 Landing 连续保存保留完整 v2 操作，等待账号同步确认', async () => {
    const baseline = completionV2Fixture()
    const session = {...createSession(), result: completionResult(baseline), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    jest.mocked(savePendingLandingHistory).mockResolvedValue('landing-v2')
    const add = jest.spyOn(useHistoryStore.getState(), 'addHistory')
    const update = jest.spyOn(useHistoryStore.getState(), 'updateHistory')
    const {result} = renderHook(() => usePageModel({enteredFromLanding: true}))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const first = editCompletion(baseline, 'fill', '页面原型')
    await act(async () => { await result.current.handleCompletionDocumentChange?.(first.document, 0, serializeDraft(baseline), first.operation) })
    await act(async () => { await result.current.handleSave() })
    expect(result.current.result?.optimized.completion_edit?.operations).toHaveLength(1)
    const second = editCompletion(first.document, 'fill', '交互流程')
    await act(async () => { await result.current.handleCompletionDocumentChange?.(second.document, 1, serializeDraft(first.document), second.operation) })
    await act(async () => { await result.current.handleSave() })
    expect(savePendingLandingHistory).toHaveBeenCalledTimes(2)
    const pending = jest.mocked(savePendingLandingHistory).mock.calls[1][0]
    expect(pending.id).toBe('landing-v2')
    expect(pending.processResult?.optimized.completion_edit).toMatchObject({baseRevision: 0, operations: [first.operation, second.operation]})
    expect(result.current.result?.optimized.completion_edit?.operations).toHaveLength(2)
    expect(add).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  test('v2 首次历史保存确认填写操作后，重复保存不会重复写入', async () => {
    const base = completionV2Fixture()
    const session = {...createSession(), result: completionResult(base), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const addHistory = jest.spyOn(useHistoryStore.getState(), 'addHistory').mockResolvedValue('history-v2')
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const first = editCompletion(base, 'fill', '页面原型')
    await act(async () => {
      await result.current.handleCompletionDocumentChange?.(first.document, base.revision, serializeDraft(base), first.operation)
    })
    expect(result.current.result?.optimized.completion_edit?.operations).toHaveLength(1)

    await act(async () => { await expect(result.current.handleSave()).resolves.toBe('history-v2') })
    expect(addHistory).toHaveBeenCalledTimes(1)
    expect(addHistory.mock.calls[0]?.[0].processResult?.optimized.completion_edit).toMatchObject({
      documentId: base.documentId, baseRevision: base.revision, operations: [first.operation],
    })
    expect(result.current.result?.optimized).not.toHaveProperty('completion_edit')
    expect(result.current.saved).toBe(true)

    await act(async () => { await expect(result.current.handleSave()).resolves.toBe('history-v2') })
    expect(addHistory).toHaveBeenCalledTimes(1)
  })

  test('v2 历史保存期间新增的操作保留为下一次提交的唯一操作', async () => {
    const base = completionV2Fixture()
    const session = {...createSession(), result: completionResult(base), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    let finishHistory!: (id: string) => void
    const addHistory = jest.spyOn(useHistoryStore.getState(), 'addHistory')
      .mockReturnValueOnce(new Promise(resolve => { finishHistory = resolve }))
    const updateHistory = jest.spyOn(useHistoryStore.getState(), 'updateHistory').mockResolvedValue(undefined)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const first = editCompletion(base, 'fill', '页面原型')
    await act(async () => {
      await result.current.handleCompletionDocumentChange?.(first.document, base.revision, serializeDraft(base), first.operation)
    })
    let firstSave!: Promise<string | null>
    act(() => { firstSave = result.current.handleSave() })
    await waitFor(() => expect(addHistory).toHaveBeenCalledTimes(1))

    const second = editCompletion(first.document, 'clear')
    await act(async () => {
      await result.current.handleCompletionDocumentChange?.(second.document, first.document.revision,
        serializeDraft(first.document), second.operation)
    })
    expect(result.current.result?.optimized.completion_edit?.operations).toEqual([first.operation, second.operation])

    await act(async () => { finishHistory('history-v2'); await firstSave })
    expect(result.current.result?.optimized.completion_edit).toEqual({
      documentId: base.documentId, baseRevision: first.document.revision, operations: [second.operation],
    })
    expect(result.current.saved).toBe(false)
    expect(addHistory.mock.calls[0]?.[0].processResult?.optimized.completion_edit?.operations).toEqual([first.operation])
    expect(updateHistory).not.toHaveBeenCalled()

    await act(async () => { await expect(result.current.handleSave()).resolves.toBe('history-v2') })
    expect(updateHistory).toHaveBeenCalledTimes(1)
    expect(updateHistory.mock.calls[0][1].processResult?.optimized.completion_edit).toEqual({
      documentId: base.documentId, baseRevision: first.document.revision, operations: [second.operation],
    })
    expect(result.current.result?.optimized).not.toHaveProperty('completion_edit')
    expect(result.current.saved).toBe(true)
  })

  test('较新填写已落盘后旧失败提交重试只确认，不回写旧稿', async () => {
    const session = {...createSession(), result: completionResult(), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const original = completionFixture()
    const first = applyCompletionCommand(original, {documentId: original.documentId, baseRevision: 0, gapId: 'deliverable', type: 'fill', value: '页面原型'})
    if (!first.ok) throw new Error('fixture failed')
    jest.mocked(saveLatestResultSession).mockRejectedValueOnce(new Error('保存失败'))
    await act(async () => {
      await expect(result.current.handleCompletionDocumentChange?.(first.document, 0, serializeDraft(original))).rejects.toThrow('保存失败')
    })
    const second = applyCompletionCommand(first.document, {documentId: original.documentId, baseRevision: 1, gapId: 'deliverable', type: 'fill', value: '交互流程'})
    if (!second.ok) throw new Error('fixture failed')
    await act(async () => { await result.current.handleCompletionDocumentChange?.(second.document, 1, serializeDraft(first.document)) })
    const writeCount = jest.mocked(saveLatestResultSession).mock.calls.length
    await act(async () => { await result.current.handleCompletionDocumentChange?.(first.document, 0, serializeDraft(original)) })
    expect(result.current.result?.optimized.completion_document).toEqual(second.document)
    expect(saveLatestResultSession).toHaveBeenCalledTimes(writeCount)
    expect(result.current.completionSaveStatus).toBe('idle')
  })

  test('旧写入完成不能提前解除新填写的保存中状态', async () => {
    const session = {...createSession(), result: completionResult(), progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    const {result} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let finishFirst!: () => void
    let finishSecond!: () => void
    jest.mocked(saveLatestResultSession)
      .mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { finishSecond = resolve }))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => { first = result.current.handleOptimizedResumeChange('# 第一次编辑') })
    act(() => { second = result.current.handleOptimizedResumeChange('# 第二次编辑') })
    await act(async () => { finishFirst(); await first })
    expect(result.current.completionSaveStatus).toBe('saving')
    expect(result.current.result?.optimized.optimized_resume).toBe('# 第二次编辑')
    await act(async () => { finishSecond(); await second })
    expect(result.current.completionSaveStatus).toBe('idle')
  })
})

describe('结构化填写自动远端提交', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    useAuthStore.setState({session: null})
    useHistoryStore.setState({histories: []})
  })

  test('网络失败与刷新保留 journal 和 commit，确认后才能下载当前 revision', async () => {
    jest.clearAllMocks()
    mockResultId = null
    useAuthStore.setState({session: {accessToken: 'test-token', user: {id: 'auto-save-user'}}})
    const base = completionV2Fixture()
    const document = createCompletionDocument({...base, schemaVersion: 'resume-completion-v4'})
    const initial = completionResult(document)
    const session = {...createSession(), result: initial, progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const}
    jest.mocked(getLatestResultSession).mockResolvedValue(session)
    jest.mocked(saveLatestResultSession).mockResolvedValue(undefined)
    const requests: ResumeHistory[] = []
    const save = jest.spyOn(useHistoryStore.getState(), 'addHistory').mockImplementation(async history => {
      requests.push(history)
      if (requests.length === 1) throw new Error('网络不可用')
      const submitted = history.processResult!.optimized.completion_document!
      const stored = {...history, id: 'history-automatic', commitAck: {commit_id: history.completionCommit!.commitId,
        document_id: submitted.documentId, revision: submitted.revision}}
      useHistoryStore.setState({histories: [stored]})
      return stored.id
    })
    let {result, unmount} = renderHook(() => usePageModel())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const changed = editCompletion(document, 'fill', '交互原型')
    await act(async () => {
      await expect(result.current.handleCompletionDocumentChange!(changed.document, document.revision,
        serializeDraft(document), changed.operation)).rejects.toThrow('网络不可用')
    })
    expect(result.current.completionSaveStatus).toBe('failed')
    expect(result.current.result!.optimized.completion_edit?.operations).toHaveLength(1)
    const persistedSession = jest.mocked(saveLatestResultSession).mock.calls.at(-1)![0]
    expect(persistedSession.pendingHistoryCommit?.history.completionCommit?.commitId).toBe(requests[0].completionCommit!.commitId)
    unmount()
    jest.mocked(getLatestResultSession).mockResolvedValue(persistedSession)
    const recoveredHook = renderHook(() => usePageModel())
    result = recoveredHook.result
    unmount = recoveredHook.unmount
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.handleCompletionDocumentChange!(changed.document, document.revision, serializeDraft(document), changed.operation)
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(requests[0].completionCommit!.commitId).toBe(requests[1].completionCommit!.commitId)
    expect(requests[0]).toEqual(requests[1])
    expect(result.current.completionSaveStatus).toBe('idle')
    expect(result.current.result!.optimized.completion_document!.revision).toBe(1)
    expect(result.current.result!.optimized.completion_edit).toBeUndefined()
    expect(result.current.result!.matching).toEqual(initial.matching)
    await expect(result.current.prepareDownload!()).resolves.toEqual({historyId: 'history-automatic', documentId: document.documentId, revision: 1})
    unmount()
  })
})

test('远端恢复失败仍显示本地填写稿，保存与下载保持待同步', async () => {
  jest.clearAllMocks()
  const base = completionV2Fixture()
  const edited = editCompletion(base, 'fill', '用户访谈记录')
  const local = {...completionResult(edited.document), optimized: {...completionResult(edited.document).optimized,
    completion_edit: {documentId: base.documentId, baseRevision: 0, operations: [edited.operation!]}}}
  const session: LatestResultSession = {...createSession(), result: local, originHistoryId: 'offline-history',
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}}
  mockResultId = 'offline-history'
  jest.mocked(getLatestResultSession).mockResolvedValue(session)
  const load = jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockRejectedValue(new Error('远端网络不可用'))
  const {result, unmount} = renderHook(() => usePageModel())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(load).toHaveBeenCalledWith('offline-history', {force: true})
  expect(result.current.result!.optimized.completion_edit).toEqual(local.optimized.completion_edit)
  expect(result.current.saved).toBe(false)
  expect(result.current.completionSaveStatus).toBe('failed')
  unmount()
  load.mockRestore()
  mockResultId = null
})


describe('旧稿自动升级到v4', () => {
  function oldFixture() { return createCompletionDocument({...completionV2Fixture(), schemaVersion: 'resume-completion-v3'}) }
  function historyFor(document: ReturnType<typeof oldFixture>): ResumeHistory {
    const output = completionResult(document)
    return {id: 'upgrade-history', position: '产品经理', company: '公司', name: '用户', createdAt: '2026-11-13',
      updatedAt: '2026-11-13', qualityScore: 80, matchScore: 80, tags: [], resumeContent: '源文', jdContent: '岗位',
      optimizedContent: output.optimized.optimized_resume, processResult: output,
      progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'}}
  }
  beforeEach(() => {
    jest.clearAllMocks()
    mockResultId = 'upgrade-history'
    jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv: 'prod', databaseProvider: 'supabase', authRequired: true, supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}})
    useAuthStore.setState({session: {accessToken: 'test-token', user: {id: 'upgrade-user'}}})
    useHistoryStore.setState({histories: []})
    jest.mocked(saveLatestResultSession).mockResolvedValue(undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    mockResultId = null
    useAuthStore.setState({session: null})
    useHistoryStore.setState({histories: []})
  })

  test('先同步旧基准的pending journal，再升级并保存完整新会话；重新打开不重复升级', async () => {
    const base = oldFixture(), changed = editCompletion(base, 'fill', '交互原型')
    const original = historyFor(base)
    const edited = completionResult(changed.document)
    edited.optimized.completion_edit = {documentId: base.documentId, baseRevision: base.revision, operations: [changed.operation!]}
    const local: LatestResultSession = {...createSession(), result: edited, originHistoryId: original.id,
      baseHistorySnapshot: historyCompletionBaseline(original), progress: original.progress}
    jest.mocked(getLatestResultSession).mockResolvedValue(local)
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(original)
    const events: string[] = []
    jest.spyOn(useHistoryStore.getState(), 'updateHistory').mockImplementation(async (_id, submitted) => {
      events.push('save-v3')
      expect(submitted.processResult!.optimized.completion_document!.schemaVersion).toBe('resume-completion-v3')
      expect(submitted.processResult!.optimized.completion_edit?.operations).toHaveLength(1)
      const document = submitted.processResult!.optimized.completion_document!
      useHistoryStore.setState({histories: [{...original, ...submitted, commitAck: {commit_id: submitted.completionCommit!.commitId,
        document_id: document.documentId, revision: document.revision}}]})
    })
    const upgradedDocument = createCompletionDocument({...changed.document, schemaVersion: 'resume-completion-v4', revision: changed.document.revision + 1})
    const upgraded = historyFor(upgradedDocument)
    const upgrade = jest.spyOn(resumeHistoryApi, 'upgradeCompletion').mockImplementation(async (_id, expected) => {
      events.push('upgrade-v4')
      expect(expected).toEqual(changed.document)
      return upgraded
    })
    const hook = renderHook(() => usePageModel())
    await waitFor(() => expect(hook.result.current.result?.optimized.completion_document?.schemaVersion).toBe('resume-completion-v4'))
    expect(events).toEqual(['save-v3', 'upgrade-v4'])
    expect(hook.result.current.result?.optimized.completion_document?.revision).toBe(2)
    expect(hook.result.current.result?.optimized.optimized_resume).toContain('交互原型')
    expect(hook.result.current.result?.optimized.completion_edit).toBeUndefined()
    expect(jest.mocked(saveLatestResultSession).mock.calls.at(-1)![0].baseHistorySnapshot?.completionDocument).toEqual(upgradedDocument)
    hook.unmount()
    jest.mocked(getLatestResultSession).mockResolvedValue(jest.mocked(saveLatestResultSession).mock.calls.at(-1)![0])
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(upgraded)
    const reopened = renderHook(() => usePageModel())
    await waitFor(() => expect(reopened.result.current.loading).toBe(false))
    expect(upgrade).toHaveBeenCalledTimes(1)
    expect(useHistoryStore.getState().historySummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({id: upgraded.id, position: upgraded.position, company: upgraded.company}),
    ]))
    reopened.unmount()
  })

  test('旧稿同步失败保留待保存填写，不调用升级', async () => {
    const base = oldFixture(), changed = editCompletion(base, 'fill', '用户访谈记录'), original = historyFor(base)
    const edited = completionResult(changed.document)
    edited.optimized.completion_edit = {documentId: base.documentId, baseRevision: 0, operations: [changed.operation!]}
    jest.mocked(getLatestResultSession).mockResolvedValue({...createSession(), result: edited, originHistoryId: original.id,
      baseHistorySnapshot: historyCompletionBaseline(original), progress: original.progress})
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(original)
    jest.spyOn(useHistoryStore.getState(), 'updateHistory').mockRejectedValue(new Error('旧稿同步失败'))
    const upgrade = jest.spyOn(resumeHistoryApi, 'upgradeCompletion')
    const hook = renderHook(() => usePageModel())
    await waitFor(() => expect(hook.result.current.completionSaveStatus).toBe('failed'))
    expect(upgrade).not.toHaveBeenCalled()
    expect(hook.result.current.result?.optimized.completion_edit?.operations).toHaveLength(1)
    expect(hook.result.current.result?.optimized.optimized_resume).toContain('用户访谈记录')
    hook.unmount()
  })

  test('编辑器打开期间不升级；关闭后原稿才能进入升级', async () => {
    const original = historyFor(oldFixture())
    let resolveLoad!: (history: ResumeHistory) => void
    jest.mocked(getLatestResultSession).mockResolvedValue(null)
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockImplementation(() => new Promise(resolve => { resolveLoad = resolve }))
    const upgraded = historyFor(createCompletionDocument({...original.processResult!.optimized.completion_document!, schemaVersion: 'resume-completion-v4', revision: 1}))
    const upgrade = jest.spyOn(resumeHistoryApi, 'upgradeCompletion').mockResolvedValue(upgraded)
    const hook = renderHook(() => usePageModel())
    act(() => hook.result.current.handleCompletionEditingChange!(true))
    await act(async () => { resolveLoad(original) })
    expect(upgrade).not.toHaveBeenCalled()
    act(() => hook.result.current.handleCompletionEditingChange!(false))
    await waitFor(() => expect(upgrade).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(hook.result.current.completionSaveStatus).toBe('idle'))
    hook.unmount()
  })

  test('local免登录使用服务端开发用户升级，重新打开强制读取权威记录且不伪造登录态', async () => {
    useAuthStore.setState({session: null})
    jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv: 'local', databaseProvider: 'sqlite', authRequired: false,
      supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}})
    const original = historyFor(oldFixture())
    const upgraded = historyFor(createCompletionDocument({...original.processResult!.optimized.completion_document!, schemaVersion: 'resume-completion-v4', revision: 1}))
    jest.mocked(getLatestResultSession).mockResolvedValue(null)
    const cached = jest.spyOn(useHistoryStore.getState(), 'loadHistory')
    const get = jest.spyOn(resumeHistoryApi, 'getHistory').mockResolvedValue(original)
    const upgrade = jest.spyOn(resumeHistoryApi, 'upgradeCompletion').mockResolvedValue(upgraded)
    const hook = renderHook(() => usePageModel())
    await waitFor(() => expect(hook.result.current.result?.optimized.completion_document?.schemaVersion).toBe('resume-completion-v4'))
    expect(cached).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith('upgrade-history')
    expect(upgrade).toHaveBeenCalledTimes(1)
    expect(useHistoryStore.getState().historySummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({id: upgraded.id, position: upgraded.position, company: upgraded.company}),
    ]))
    expect(useAuthStore.getState().session).toBeNull()
    expect(hook.result.current.completionSaveStatus).toBe('idle')
    hook.unmount()
  })

  test('local免登录的pending journal先通过拥有者API保存并核对回执，再升级', async () => {
    useAuthStore.setState({session: null})
    jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv: 'local', databaseProvider: 'sqlite', authRequired: false,
      supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}})
    const base = oldFixture(), changed = editCompletion(base, 'fill', '用户访谈报告'), original = historyFor(base)
    const edited = completionResult(changed.document)
    edited.optimized.completion_edit = {documentId: base.documentId, baseRevision: 0, operations: [changed.operation!]}
    jest.mocked(getLatestResultSession).mockResolvedValue({...createSession(), result: edited, originHistoryId: original.id,
      baseHistorySnapshot: historyCompletionBaseline(original), progress: original.progress})
    jest.spyOn(resumeHistoryApi, 'getHistory').mockResolvedValue(original)
    const events: string[] = []
    let savedHistory: ResumeHistory | null = null
    jest.spyOn(resumeHistoryApi, 'updateHistory').mockImplementation(async (_id, submitted) => {
      events.push('save-owned-v3')
      expect(submitted.processResult!.optimized.completion_edit?.operations).toHaveLength(1)
      const document = submitted.processResult!.optimized.completion_document!
      savedHistory = {...original, ...submitted, commitAck: {commit_id: submitted.completionCommit!.commitId,
        document_id: document.documentId, revision: document.revision}}
      return savedHistory
    })
    const upgraded = historyFor(createCompletionDocument({...changed.document, schemaVersion: 'resume-completion-v4', revision: 2}))
    jest.spyOn(resumeHistoryApi, 'upgradeCompletion').mockImplementation(async () => {
      expect(useHistoryStore.getState().historySummaries).toEqual(expect.arrayContaining([
        expect.objectContaining({id: savedHistory!.id, position: savedHistory!.position, company: savedHistory!.company}),
      ]))
      events.push('upgrade')
      return upgraded
    })
    const hook = renderHook(() => usePageModel())
    await waitFor(() => expect(hook.result.current.result?.optimized.completion_document?.schemaVersion).toBe('resume-completion-v4'))
    expect(events).toEqual(['save-owned-v3', 'upgrade'])
    expect(hook.result.current.result?.optimized.optimized_resume).toContain('用户访谈报告')
    expect(hook.result.current.result?.optimized.completion_edit).toBeUndefined()
    expect(useAuthStore.getState().session).toBeNull()
    hook.unmount()
  })

  test.each([['prod', false], ['nonprod', false], ['local', true]] as const)('%s authRequired=%s未登录不启用开发用户升级', async (appEnv, authRequired) => {
    useAuthStore.setState({session: null})
    jest.mocked(getPublicRuntimeConfig).mockResolvedValue({appEnv, databaseProvider: 'supabase', authRequired,
      supabase: {url: '', publishableKey: '', storageBucket: 'user-files', projectEnv: ''}})
    jest.mocked(getLatestResultSession).mockResolvedValue(null)
    jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValue(historyFor(oldFixture()))
    const upgrade = jest.spyOn(resumeHistoryApi, 'upgradeCompletion')
    const get = jest.spyOn(resumeHistoryApi, 'getHistory')
    const hook = renderHook(() => usePageModel())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(upgrade).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(hook.result.current.result?.optimized.completion_document?.schemaVersion).toBe('resume-completion-v3')
    hook.unmount()
  })

  test('升级发生409时重载远端版本，不覆盖并发修改', async () => {
    const original = historyFor(oldFixture())
    const remoteDocument = createCompletionDocument({...original.processResult!.optimized.completion_document!, schemaVersion: 'resume-completion-v4', revision: 2})
    const remote = historyFor(remoteDocument)
    jest.mocked(getLatestResultSession).mockResolvedValue(null)
    const load = jest.spyOn(useHistoryStore.getState(), 'loadHistory').mockResolvedValueOnce(original).mockResolvedValue(remote)
    const upgrade = jest.spyOn(resumeHistoryApi, 'upgradeCompletion').mockRejectedValue(new RequestError('版本冲突', 'COMPLETION_CONFLICT', 409))
    const hook = renderHook(() => usePageModel())
    await waitFor(() => expect(hook.result.current.result?.optimized.completion_document?.revision).toBe(2))
    expect(load).toHaveBeenCalledTimes(2)
    expect(upgrade).toHaveBeenCalledTimes(1)
    expect(hook.result.current.result?.optimized.completion_document).toEqual(remoteDocument)
    hook.unmount()
  })
})
