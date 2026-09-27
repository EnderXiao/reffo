import {act, renderHook, waitFor} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, jest, test} from '@jest/globals'
import {useRouter} from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {useResumeWorkspaceStore} from '@/store/resumeWorkspaceStore'
import {useHistoryStore} from '@/store/historyStore'
import type {ResumeHistory, ResumeStrategyReview} from '@/types'
import {resumeTextFingerprint} from '../../../../../../../shared/resume-strategy'
import {
  getLatestResultSession,
  saveLatestResultSession,
  type LatestResultSession,
} from '@/utils/result-session'
import {usePageModel} from '../usePageModel'
import {hasStaleStrategyReview} from '../model/analysisPresentation'

let mockResultId: string | null = null

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
}))

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

  afterEach(() => jest.restoreAllMocks())

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
    expect(getLatestResultSession).not.toHaveBeenCalled()
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
    expect(saveLatestResultSession).toHaveBeenLastCalledWith(expect.objectContaining({
      result: expect.objectContaining({optimized: expect.objectContaining({optimized_resume: edited, changes_summary: [], strategy_review: review})}),
    }))
    expect(resumeApi.generateOptimizedResume).not.toHaveBeenCalled()
  })
})
