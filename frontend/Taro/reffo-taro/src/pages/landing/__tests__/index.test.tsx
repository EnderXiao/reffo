import React from 'react'
import {act, fireEvent, render, screen} from '@testing-library/react'
import LandingPage from '../index'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {navigation} from '@/utils/navigation'
import {storage} from '@/utils/storage'

jest.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: jest.fn(),
  },
}))

jest.mock('@/store/historyStore', () => ({
  useHistoryStore: {
    getState: jest.fn(),
  },
}))

jest.mock('@/store/sourceResumeStore', () => ({
  useSourceResumeStore: {
    getState: jest.fn(),
  },
}))

jest.mock('@/utils/navigation', () => ({
  navigation: {
    reLaunch: jest.fn(),
  },
}))

jest.mock('@/utils/storage', () => ({
  storage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}))

jest.mock('@/components/business/HomeCardDeck/HomeScoreCard.h5', () => ({
  __esModule: true,
  default: ({card}: {card?: {role?: string}}) => (
    <div className='mock-home-score-card'>{card?.role}</div>
  ),
}))

const mockUseAuthStoreGetState = useAuthStore.getState as jest.Mock
const mockUseHistoryStoreGetState = useHistoryStore.getState as jest.Mock
const mockUseSourceResumeStoreGetState = useSourceResumeStore.getState as jest.Mock
const mockReLaunch = navigation.reLaunch as jest.Mock
const mockStorageGetItem = storage.getItem as jest.Mock
const mockStorageSetItem = storage.setItem as jest.Mock

describe('启动封页', () => {
  const restoreSession = jest.fn()
  const loadHistories = jest.fn()
  const loadLatestSourceResume = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    window.history.pushState({}, '', '/')

    restoreSession.mockResolvedValue(null)
    loadHistories.mockResolvedValue(undefined)
    loadLatestSourceResume.mockResolvedValue(undefined)
    mockReLaunch.mockResolvedValue(undefined)
    mockStorageGetItem.mockResolvedValue('1')
    mockStorageSetItem.mockResolvedValue(undefined)

    mockUseAuthStoreGetState.mockReturnValue({restoreSession})
    mockUseHistoryStoreGetState.mockReturnValue({loadHistories})
    mockUseSourceResumeStoreGetState.mockReturnValue({loadLatestSourceResume})
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
    jest.useRealTimers()
  })

  test('已看过 landing 时预取首页数据后进入首页', async () => {
    render(<LandingPage />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(restoreSession).toHaveBeenCalledTimes(1)
    expect(loadHistories).toHaveBeenCalledWith({skipIfLoaded: true})
    expect(loadLatestSourceResume).toHaveBeenCalledWith({skipIfLoaded: true})
    expect(mockStorageGetItem).toHaveBeenCalledWith('reffo.landing.seen')
    expect(mockReLaunch).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(879)
      await Promise.resolve()
    })

    expect(mockReLaunch).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(1)
      await Promise.resolve()
    })

    expect(screen.getByRole('img').parentElement?.className).toContain('reffo-landing--leaving')

    await act(async () => {
      jest.advanceTimersByTime(240)
      await Promise.resolve()
    })

    expect(mockReLaunch).toHaveBeenCalledWith('/pages/index/index')
  })

  test('未看过 landing 时预取后停留在第一步引导页', async () => {
    mockStorageGetItem.mockResolvedValue(null)

    render(<LandingPage />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(880)
      await Promise.resolve()
    })

    expect(screen.getByText('岗位')).not.toBeNull()
    expect(screen.getByText('简历')).not.toBeNull()
    expect(screen.getByText('Product Designer')).not.toBeNull()
    expect(screen.getByText('Growth Analyst')).not.toBeNull()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('带 startLanding=true 时即使已看过也停留在第一步引导页', async () => {
    window.history.pushState({}, '', '/#/pages/landing/index?startLanding=true')

    render(<LandingPage />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(880)
      await Promise.resolve()
    })

    expect(screen.getByText('岗位')).not.toBeNull()
    expect(screen.getByText('简历')).not.toBeNull()
    expect(screen.getByText('Product Designer')).not.toBeNull()
    expect(screen.getByText('Growth Analyst')).not.toBeNull()
    expect(mockStorageGetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('未看过 landing 时右滑进入第二步引导页', async () => {
    mockStorageGetItem.mockResolvedValue(null)

    const {container} = render(<LandingPage />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(880)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    expect(screen.getByText('全新体验')).not.toBeNull()
    expect(screen.getByText('reffo会结合工作经历和目标岗位，重新组织简历重点，并准备针对性的面试建议。')).not.toBeNull()
    expect(screen.getByText('跳过')).not.toBeNull()
    expect(screen.getByText('进入教程')).not.toBeNull()
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('第二步右滑进入第三步引导页', async () => {
    mockStorageGetItem.mockResolvedValue(null)

    const {container} = render(<LandingPage />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(880)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    expect(screen.getByText('谁是')).not.toBeNull()
    expect(screen.getByText('求职者')).not.toBeNull()
    expect(screen.getByText('跳过教程')).not.toBeNull()
    expect(screen.getByText('Frontend Engineer')).not.toBeNull()
    expect(screen.getByText('Brand Strategist')).not.toBeNull()
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('第三步右滑完成引导并进入首页', async () => {
    mockStorageGetItem.mockResolvedValue(null)

    const {container} = render(<LandingPage />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(880)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    expect(mockStorageSetItem).toHaveBeenCalledWith('reffo.landing.seen', '1')

    await act(async () => {
      jest.advanceTimersByTime(80)
      await Promise.resolve()
    })

    expect(mockReLaunch).toHaveBeenCalledWith('/pages/index/index')
  })

  test('第三步点击跳过教程完成引导并进入首页', async () => {
    mockStorageGetItem.mockResolvedValue(null)

    const {container} = render(<LandingPage />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(880)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('跳过教程'))
      await Promise.resolve()
    })

    expect(mockStorageSetItem).toHaveBeenCalledWith('reffo.landing.seen', '1')

    await act(async () => {
      jest.advanceTimersByTime(80)
      await Promise.resolve()
    })

    expect(mockReLaunch).toHaveBeenCalledWith('/pages/index/index')
  })
})
