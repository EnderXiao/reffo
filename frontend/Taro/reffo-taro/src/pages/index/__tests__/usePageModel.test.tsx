import React from 'react'
import {act, fireEvent, render, screen} from '@testing-library/react'
import Taro from '@tarojs/taro'
import {useHistoryStore} from '@/store/historyStore'
import {resumeWorkspaceActions} from '@/store/resumeWorkspaceStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import type {ResumeHistory, SourceResumeSummary} from '@/types'
import {toResumeHistorySummaryFromHistory} from '@/utils/history-summary'
import {usePageModel} from '../model/usePageModel'

jest.mock('@tarojs/taro', () => ({
  navigateTo: jest.fn(),
  showToast: jest.fn(),
  useDidShow: jest.fn(),
  useRouter: jest.fn(() => ({params: {}})),
}))

jest.mock('@/store/historyStore')
jest.mock('@/store/resumeWorkspaceStore', () => ({
  resumeWorkspaceActions: {
    reset: jest.fn(),
  },
}))
jest.mock('@/store/sourceResumeStore')
const mockUseHistoryStore = useHistoryStore as jest.MockedFunction<typeof useHistoryStore>
const mockResetWorkspace = resumeWorkspaceActions.reset as jest.Mock
const mockUseRouter = (Taro as any).useRouter as jest.Mock
const mockUseSourceResumeStore = useSourceResumeStore as jest.MockedFunction<
  typeof useSourceResumeStore
>
const RESULT_RETURN_HOME_STORAGE_KEY = 'reffo.resultReturnHome'
let latestCardPressResult: Promise<void> | null = null

function HookProbe() {
  const model = usePageModel('logo.png')

  return (
    <>
      <div data-testid='strategy'>{model.isStrategyVisible ? 'yes' : 'no'}</div>
      <div data-testid='create-mode'>{model.isCreateMode ? 'yes' : 'no'}</div>
      <div data-testid='card-id'>{model.currentCard?.id ?? 'none'}</div>
      <button onClick={model.handleDeckFirstInteraction} type='button'>
        touch
      </button>
      <button onClick={model.handleEnterCreateMode} type='button'>
        enter-create
      </button>
      <button onClick={model.handleCancelCreate} type='button'>
        cancel-create
      </button>
      <button onClick={model.handleConfirmCreate} type='button'>
        confirm-create
      </button>
      <button onClick={model.handleViewHistory} type='button'>
        source-resume
      </button>
      <button
        onClick={() => {
          if (model.currentCard) {
            latestCardPressResult = model.handleCardPress(model.currentCard)
          }
        }}
        type='button'
      >
        open-card
      </button>
    </>
  )
}

describe('usePageModel', () => {
  const mockLoadHistories = jest.fn()
  const mockLoadHistorySummaries = jest.fn()
  const mockLoadHistory = jest.fn()
  const mockLoadLatestSourceResume = jest.fn()
  const mockLoadLatestSourceSummary = jest.fn()

  const setHistoryState = (histories: ResumeHistory[]) => {
    const state = {
      histories,
      historySummaries: histories.map(toResumeHistorySummaryFromHistory),
      currentHistory: null,
      loading: {isLoading: false, error: null},
      initialized: true,
      summaryInitialized: true,
      loadHistories: mockLoadHistories,
      loadHistorySummaries: mockLoadHistorySummaries,
      loadHistory: mockLoadHistory,
    }
    ;(mockUseHistoryStore as any).mockImplementation((selector: any) => selector(state))
  }

  const setSourceResumeState = (latestSourceResume: SourceResumeSummary | null) => {
    const state = {
      latestSourceResume,
      latestSourceResumeSummary: latestSourceResume
        ? {
            id: latestSourceResume.id,
            title: latestSourceResume.title,
            sourceType: latestSourceResume.sourceType,
            originalFileName: latestSourceResume.originalFileName,
            createdAt: latestSourceResume.createdAt,
            updatedAt: latestSourceResume.updatedAt,
          }
        : null,
      loading: {isLoading: false, error: null},
      initialized: true,
      summaryInitialized: true,
      loadLatestSourceResume: mockLoadLatestSourceResume,
      loadLatestSourceSummary: mockLoadLatestSourceSummary,
      setLatestSourceResume: jest.fn(),
      clearLatestSourceResume: jest.fn(),
      reset: jest.fn(),
    }
    ;(mockUseSourceResumeStore as any).mockImplementation((selector: any) => selector(state))
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    window.history.replaceState(null, '', '/')
    window.sessionStorage.removeItem(RESULT_RETURN_HOME_STORAGE_KEY)
    latestCardPressResult = null
    mockUseRouter.mockReturnValue({params: {}})
    setHistoryState([])
    setSourceResumeState(null)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('2 秒后自动切到策略文案', () => {
    const history: ResumeHistory = {
      id: 'JD2026070700001',
      position: '前端工程师',
      company: 'ABC 公司',
      name: '张三',
      createdAt: '2026-07-07T12:00:00.000Z',
      qualityScore: 88,
      matchScore: 92,
      tags: ['React', 'TypeScript'],
      resumeContent: '# 张三',
      jdContent: '岗位职责：...',
      optimizedContent: '# 张三（优化版）',
    }

    setHistoryState([history])

    render(<HookProbe />)

    expect((screen.getByTestId('strategy') as any).textContent).toBe('no')
    expect((screen.getByTestId('card-id') as any).textContent).toBe('JD2026070700001')

    act(() => {
      jest.advanceTimersByTime(1999)
    })
    expect((screen.getByTestId('strategy') as any).textContent).toBe('no')

    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect((screen.getByTestId('strategy') as any).textContent).toBe('yes')
    expect(mockLoadHistorySummaries).toHaveBeenCalledTimes(1)
    expect(mockLoadLatestSourceSummary).toHaveBeenCalledTimes(1)
  })

  test('没有历史简历时不展示示例卡片并直接进入新申请创建态', () => {
    render(<HookProbe />)

    expect((screen.getByTestId('card-id') as any).textContent).toBe('none')
    expect((screen.getByTestId('create-mode') as any).textContent).toBe('yes')
    expect((screen.getByTestId('strategy') as any).textContent).toBe('no')

    act(() => {
      jest.advanceTimersByTime(2200)
    })

    expect((screen.getByTestId('card-id') as any).textContent).toBe('none')
    expect((screen.getByTestId('create-mode') as any).textContent).toBe('yes')
    expect((screen.getByTestId('strategy') as any).textContent).toBe('no')
  })

  test('首次触摸卡片时立即切到策略文案', () => {
    const history: ResumeHistory = {
      id: 'JD2026070700001',
      position: '前端工程师',
      company: 'ABC 公司',
      name: '张三',
      createdAt: '2026-07-07T12:00:00.000Z',
      qualityScore: 88,
      matchScore: 92,
      tags: ['React', 'TypeScript'],
      resumeContent: '# 张三',
      jdContent: '岗位职责：...',
      optimizedContent: '# 张三（优化版）',
    }

    setHistoryState([history])

    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'touch'}))

    expect((screen.getByTestId('strategy') as any).textContent).toBe('yes')

    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect((screen.getByTestId('strategy') as any).textContent).toBe('yes')
  })

  test('进入创建态后暂停自动策略切换，取消后恢复预览态', () => {
    const history: ResumeHistory = {
      id: 'JD2026070700001',
      position: '前端工程师',
      company: 'ABC 公司',
      name: '张三',
      createdAt: '2026-07-07T12:00:00.000Z',
      qualityScore: 88,
      matchScore: 92,
      tags: ['React', 'TypeScript'],
      resumeContent: '# 张三',
      jdContent: '岗位职责：...',
      optimizedContent: '# 张三（优化版）',
    }

    setHistoryState([history])

    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'enter-create'}))

    expect((screen.getByTestId('create-mode') as any).textContent).toBe('yes')

    act(() => {
      jest.advanceTimersByTime(2200)
    })

    expect((screen.getByTestId('strategy') as any).textContent).toBe('no')

    fireEvent.click(screen.getByRole('button', {name: 'cancel-create'}))

    expect((screen.getByTestId('create-mode') as any).textContent).toBe('no')
  })

  test('无源简历时确认创建导航到创建第一页', () => {
    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'confirm-create'}))

    expect(mockResetWorkspace).toHaveBeenCalledTimes(1)
    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index',
    })
  })

  test('已有源简历时确认创建导航到 JD 步骤', () => {
    setSourceResumeState({
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith',
      sourceType: 'manual',
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    })

    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'confirm-create'}))

    expect(mockResetWorkspace).toHaveBeenCalledTimes(1)
    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index?step=jobDescription',
    })
  })

  test('已有源简历时点击源简历按钮导航到完成页', () => {
    setSourceResumeState({
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith',
      sourceType: 'manual',
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    })

    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'source-resume'}))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index?step=resumeSummary',
    })
  })

  test('无源简历时点击源简历按钮导航到上传页', () => {
    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'source-resume'}))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index',
    })
  })

  test('点击真实历史卡片时携带卡片来源打开结果页', () => {
    const history: ResumeHistory = {
      id: 'JD2026070700001',
      position: '前端工程师',
      company: 'ABC 公司',
      name: '张三',
      createdAt: '2026-07-07T12:00:00.000Z',
      qualityScore: 88,
      matchScore: 92,
      tags: ['React', 'TypeScript'],
      resumeContent: '# 张三',
      jdContent: '岗位职责：...',
      optimizedContent: '# 张三（优化版）',
    }

    setHistoryState([history])

    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'open-card'}))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/result/index?id=JD2026070700001&fromCard=1',
    })
    expect(latestCardPressResult).toBeInstanceOf(Promise)
  })

  test('从结果页返回首页时直接展示原卡片策略文案', () => {
    const histories: ResumeHistory[] = [
      {
        id: 'JD2026070700001',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2026-07-07T12:00:00.000Z',
        qualityScore: 88,
        matchScore: 92,
        tags: ['React', 'TypeScript'],
        resumeContent: '# 张三',
        jdContent: '岗位职责：...',
        optimizedContent: '# 张三（优化版）',
      },
      {
        id: 'JD2026070700002',
        position: '产品经理',
        company: 'XYZ 公司',
        name: '李四',
        createdAt: '2026-07-08T12:00:00.000Z',
        qualityScore: 86,
        matchScore: 89,
        tags: ['AI', '增长'],
        resumeContent: '# 李四',
        jdContent: '岗位职责：...',
        optimizedContent: '# 李四（优化版）',
      },
    ]

    window.sessionStorage.setItem(
      RESULT_RETURN_HOME_STORAGE_KEY,
      JSON.stringify({cardId: 'JD2026070700002'}),
    )
    setHistoryState(histories)

    render(<HookProbe />)

    expect((screen.getByTestId('strategy') as any).textContent).toBe('yes')
    expect((screen.getByTestId('card-id') as any).textContent).toBe('JD2026070700002')
    expect(mockLoadHistorySummaries).not.toHaveBeenCalled()
    expect(mockLoadLatestSourceSummary).not.toHaveBeenCalled()
  })

  test('从完成页回首页时消费 newCardId 并清理 URL 参数', () => {
    const histories: ResumeHistory[] = [
      {
        id: 'JD2026070700001',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2026-07-07T12:00:00.000Z',
        qualityScore: 88,
        matchScore: 92,
        tags: ['React', 'TypeScript'],
        resumeContent: '# 张三',
        jdContent: '岗位职责：...',
        optimizedContent: '# 张三（优化版）',
      },
      {
        id: 'JD2026070700002',
        position: '产品经理',
        company: 'XYZ 公司',
        name: '李四',
        createdAt: '2026-07-08T12:00:00.000Z',
        qualityScore: 86,
        matchScore: 89,
        tags: ['AI', '增长'],
        resumeContent: '# 李四',
        jdContent: '岗位职责：...',
        optimizedContent: '# 李四（优化版）',
      },
    ]

    window.history.replaceState(null, '', '/#/pages/index/index?newCardId=JD2026070700002')
    mockUseRouter.mockReturnValue({params: {newCardId: 'JD2026070700002'}})
    setHistoryState(histories)

    render(<HookProbe />)

    expect((screen.getByTestId('card-id') as any).textContent).toBe('JD2026070700002')
    expect(window.location.hash).toBe('#/pages/index/index')
  })

  test('没有历史简历时点击卡片入口不会打开结果页', () => {
    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'open-card'}))

    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })

})
