import {act, renderHook} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, jest, test} from '@jest/globals'
import {useDidHide, useDidShow} from '@tarojs/taro'
import type {ResumeHistory, ResumeHistorySummary} from '@/types'
import {
  consumeCompleteInitialEntry,
  consumeShareReturnEntry,
  runShareHandoffTransition,
} from '@/utils/navigation-transition'
import {useHistoryStore} from '@/store/historyStore'
import {usePageModel} from '../usePageModel'

const mockNavigate = jest.fn()
const mockReset = jest.fn()
const mockRunShareHandoffTransition = jest.mocked(runShareHandoffTransition)

jest.mock('@/shared/routing', () => ({
  routePaths: {
    home: '/pages/index/index',
    share: '/pages/share/index',
  },
  usePageRoute: () => ({
    readString: (key: string) => key === 'historyId' ? 'history-1' : null,
  }),
  useRouteTransition: () => ({
    navigate: mockNavigate,
    reset: mockReset,
  }),
}))

jest.mock('@/utils/navigation-transition', () => ({
  consumeCompleteInitialEntry: jest.fn(),
  consumeShareReturnEntry: jest.fn(),
  runShareHandoffTransition: jest.fn(),
}))

const summary = {
  id: 'history-1',
  name: '测试用户',
  company: 'Reffo',
  position: '前端工程师',
  location: '北京',
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
  qualityScore: 88,
  tags: ['React'],
  matchScore: 92,
  strategyTitle: '优化建议',
  strategyBody: '突出复杂前端架构和交付能力。',
} satisfies ResumeHistorySummary

const history: ResumeHistory = {
  ...summary,
  qualityScore: 88,
  tags: ['React'],
  resumeContent: '# 测试用户',
  jdContent: '工作地点：北京',
  optimizedContent: '# 测试用户\n\n## 工作经历\n- 负责前端开发。',
}

describe('Complete usePageModel cached page transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    useHistoryStore.setState({
      historySummaries: [summary],
      histories: [],
      currentHistory: null,
      loading: {
        isLoading: false,
        error: null,
      },
      loadHistory: jest.fn(async () => undefined),
      loadHistorySummaries: jest.fn(async () => undefined),
    } as unknown as ReturnType<typeof useHistoryStore.getState>)
    jest.mocked(consumeCompleteInitialEntry).mockReturnValue(true)
    jest.mocked(consumeShareReturnEntry).mockReturnValue(false)
    mockRunShareHandoffTransition.mockImplementation(async action => action())
    jest.mocked(useDidHide).mockImplementation(callback => {
      mockDidHide = callback
    })
    jest.mocked(useDidShow).mockImplementation(callback => {
      mockDidShow = callback
    })
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  test('仅有生成详情而缺少摘要时展示真实简历卡，并能打开对应分享页', async () => {
    useHistoryStore.setState({historySummaries: [], histories: [history]})
    const {result} = renderHook(() => usePageModel())

    expect(result.current.card).toEqual(expect.objectContaining({id: history.id}))
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(useHistoryStore.getState().loadHistory).not.toHaveBeenCalled()
    act(() => result.current.handleShare())
    await act(async () => {
      jest.advanceTimersByTime(720)
      await Promise.resolve()
    })
    expect(mockNavigate).toHaveBeenCalledWith('/pages/share/index', {historyId: history.id})
  })

  test('详情加载完成后出现真实卡片和分享能力', async () => {
    let resolveHistory!: (history: ResumeHistory) => void
    useHistoryStore.setState({historySummaries: [], loadHistory: jest.fn(async () => {
      const loaded = await new Promise<ResumeHistory>(resolve => { resolveHistory = resolve })
      useHistoryStore.getState().acceptHistory(loaded)
      return loaded
    })})
    const {result} = renderHook(() => usePageModel())
    expect(result.current.card).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => { resolveHistory(history) })
    expect(result.current.card?.id).toBe(history.id)
    expect(result.current.loading).toBe(false)
    act(() => result.current.handleShare())
    await act(async () => {
      jest.advanceTimersByTime(720)
      await Promise.resolve()
    })
    expect(mockNavigate).toHaveBeenCalledWith('/pages/share/index', {historyId: history.id})
  })

  test.each(['missing', 'failed'])('详情%s时保留错误状态，不自动返回；重试成功后恢复卡片', async mode => {
    const loadHistory = jest.fn<() => Promise<ResumeHistory | null>>(async () => {
      if (mode === 'failed') throw new Error('网络失败')
      return null
    })
    useHistoryStore.setState({historySummaries: [], loadHistory})
    const {result} = renderHook(() => usePageModel())
    await act(async () => { await Promise.resolve() })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeTruthy()
    expect(result.current.card).toBeNull()
    act(() => {
      result.current.handleShare()
      jest.advanceTimersByTime(12000)
    })
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockReset).not.toHaveBeenCalled()
    loadHistory.mockImplementation(async () => {
      useHistoryStore.getState().acceptHistory(history)
      return history
    })
    await act(async () => { result.current.handleRetry() })
    expect(result.current.card?.id).toBe(history.id)
    expect(result.current.error).toBeNull()
    expect(loadHistory).toHaveBeenCalledTimes(2)
  })

  test('does not replay entry state after the cached complete page is hidden', async () => {
    const {result} = renderHook(() => usePageModel())

    expect(result.current.hasInitialEntryAnimation).toBe(true)

    act(() => {
      result.current.handleShare()
    })

    expect(result.current.isSharingTransition).toBe(true)

    act(() => {
      mockDidHide()
    })

    expect(result.current.hasInitialEntryAnimation).toBe(false)
    expect(result.current.isSharingTransition).toBe(false)

    await act(async () => {
      jest.advanceTimersByTime(720)
      await Promise.resolve()
    })
  })

  test('keeps entry animation as a one-shot state even without a hide event', () => {
    const {result} = renderHook(() => usePageModel())

    expect(result.current.hasInitialEntryAnimation).toBe(true)

    act(() => {
      jest.advanceTimersByTime(1500)
    })

    expect(result.current.hasInitialEntryAnimation).toBe(false)
  })

  test('does not replay entry animation when completing page mounts from share return', () => {
    jest.mocked(consumeCompleteInitialEntry).mockReturnValue(true)
    jest.mocked(consumeShareReturnEntry).mockReturnValue(true)

    const {result} = renderHook(() => usePageModel())

    expect(result.current.hasInitialEntryAnimation).toBe(false)
    expect(result.current.isShareReturnEntry).toBe(true)
  })

  test('marks a cached complete page as the share return target when shown', () => {
    jest.mocked(consumeCompleteInitialEntry).mockReturnValue(false)
    jest.mocked(consumeShareReturnEntry).mockReturnValue(false)
    const {result} = renderHook(() => usePageModel())

    expect(result.current.isShareReturnEntry).toBe(false)

    jest.mocked(consumeShareReturnEntry).mockReturnValue(true)
    act(() => {
      mockDidShow()
    })

    expect(result.current.isShareReturnEntry).toBe(true)
    expect(result.current.hasInitialEntryAnimation).toBe(false)
  })
})

let mockDidHide: () => void = () => undefined
let mockDidShow: () => void = () => undefined
