import {act, renderHook} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, jest, test} from '@jest/globals'
import {useDidHide, useDidShow} from '@tarojs/taro'
import type {ResumeHistorySummary} from '@/types'
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
  matchScore: 92,
  strategyTitle: '优化建议',
  strategyBody: '突出复杂前端架构和交付能力。',
} satisfies ResumeHistorySummary

describe('Complete usePageModel cached page transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    useHistoryStore.setState({
      historySummaries: [summary],
      histories: [],
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
