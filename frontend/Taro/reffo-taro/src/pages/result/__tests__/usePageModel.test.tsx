import {act, renderHook, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, jest, test} from '@jest/globals'
import {useRouter} from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {useResumeWorkspaceStore} from '@/store/resumeWorkspaceStore'
import {
  getLatestResultSession,
  saveLatestResultSession,
  type LatestResultSession,
} from '@/utils/result-session'
import {usePageModel} from '../usePageModel'

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
    readString: (key: string) => key === 'id' ? null : null,
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
    useResumeWorkspaceStore.getState().reset()
    jest.mocked(useRouter).mockReturnValue({params: {}} as never)
    jest.mocked(getLatestResultSession).mockResolvedValue(createSession())
    jest.mocked(saveLatestResultSession).mockResolvedValue(undefined)
    jest.mocked(resumeApi.generateOptimizedResume).mockResolvedValue(optimized)
    jest.mocked(resumeApi.generateInterviewSuggestions).mockResolvedValue(interview)
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
})
