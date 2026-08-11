import React from 'react'
import {act, fireEvent, render, screen} from '@testing-library/react'
import LandingPage from '../index'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useResumeStore} from '@/store/resumeStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {feedback} from '@/utils/feedback'
import {navigation} from '@/utils/navigation'
import {storage} from '@/utils/storage'
import {pickAndParseResumeFile} from '@/utils/resume-file-upload'

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

jest.mock('@/store/resumeStore', () => ({
  useResumeStore: {
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

jest.mock('@/utils/feedback', () => ({
  feedback: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/utils/resume-file-upload', () => ({
  formatResumeFileSize: (size: number) => `${Math.max(1, Math.round(size / 1024))} Kb`,
  isResumeFileUploadCancelled: (error: unknown) => /cancel|取消/i.test(String(error || '')),
  pickAndParseResumeFile: jest.fn(),
}))

jest.mock('@/components/business/HomeCardDeck/HomeScoreCard.h5', () => ({
  __esModule: true,
  default: ({card, onClick, uploadFile, uploadStatus, onUploadRemove}: {
    card?: {
      role?: string
      queueCardKind?: 'resume' | 'upload'
      resumeProfile?: {name?: string; tags?: string[]}
    }
    onClick?: () => void
    uploadStatus?: 'idle' | 'uploading' | 'success' | 'error'
    uploadFile?: {name: string; sizeLabel: string} | null
    onUploadRemove?: () => void
  }) => (
    <div className='mock-home-score-card' onClick={onClick}>
      {card?.resumeProfile?.name ?? card?.role}
      {card?.resumeProfile?.tags?.join('')}
      {card?.resumeProfile ? <div className='reffo-home-card__queue-face--resume-back' /> : null}
      {card?.queueCardKind === 'upload' ? (
        <div className='reffo-home-card__upload-back'>
          {uploadStatus === 'success' && uploadFile ? (
            <div className='reffo-home-card__upload-complete'>
              <div className='reffo-home-card__upload-complete-icon' />
              <span>{uploadFile.name}</span>
              <span>{uploadFile.sizeLabel}</span>
              <button
                type='button'
                aria-label='删除已上传简历'
                onClick={event => {
                  event.stopPropagation()
                  onUploadRemove?.()
                }}
              >
                删除
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  ),
}))

const mockUseAuthStoreGetState = useAuthStore.getState as jest.Mock
const mockUseHistoryStoreGetState = useHistoryStore.getState as jest.Mock
const mockUseResumeStoreGetState = useResumeStore.getState as jest.Mock
const mockUseSourceResumeStoreGetState = useSourceResumeStore.getState as jest.Mock
const mockFeedbackSuccess = feedback.success as jest.Mock
const mockFeedbackError = feedback.error as jest.Mock
const mockPickAndParseResumeFile = pickAndParseResumeFile as jest.Mock
const mockReLaunch = navigation.reLaunch as jest.Mock
const mockStorageGetItem = storage.getItem as jest.Mock
const mockStorageSetItem = storage.setItem as jest.Mock

async function enterQueueStep(container: HTMLElement) {
  await act(async () => {
    await Promise.resolve()
  })

  await act(async () => {
    jest.advanceTimersByTime(880)
    await Promise.resolve()
  })

  for (let index = 0; index < 2; index += 1) {
    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 80, clientY: 620}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 168, clientY: 626}],
      })
      await Promise.resolve()
    })
  }

  await act(async () => {
    jest.advanceTimersByTime(980)
    await Promise.resolve()
  })
}

async function selectUploadQueueCard(container: HTMLElement) {
  await enterQueueStep(container)

  await act(async () => {
    fireEvent.touchStart(container.firstElementChild as Element, {
      touches: [{clientX: 100, clientY: 520}],
    })
    fireEvent.touchMove(container.firstElementChild as Element, {
      touches: [{clientX: 572, clientY: 520}],
    })
    jest.advanceTimersByTime(100)
    fireEvent.touchMove(container.firstElementChild as Element, {
      touches: [{clientX: 572, clientY: 520}],
    })
    fireEvent.touchEnd(container.firstElementChild as Element, {
      changedTouches: [{clientX: 572, clientY: 520}],
    })
    jest.advanceTimersByTime(1200)
    await Promise.resolve()
  })
}

async function swipeSelectedCardDown(container: HTMLElement) {
  await act(async () => {
    fireEvent.touchStart(container.firstElementChild as Element, {
      touches: [{clientX: 198, clientY: 438}],
    })
    fireEvent.touchEnd(container.firstElementChild as Element, {
      changedTouches: [{clientX: 200, clientY: 508}],
    })
    await Promise.resolve()
  })
}

describe('启动封页', () => {
  const restoreSession = jest.fn()
  const loadHistories = jest.fn()
  const loadLatestSourceResume = jest.fn()
  const setResumeContent = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    window.history.pushState({}, '', '/')

    restoreSession.mockResolvedValue(null)
    loadHistories.mockResolvedValue(undefined)
    loadLatestSourceResume.mockResolvedValue(undefined)
    setResumeContent.mockReset()
    mockReLaunch.mockResolvedValue(undefined)
    mockStorageGetItem.mockResolvedValue('1')
    mockStorageSetItem.mockResolvedValue(undefined)

    mockUseAuthStoreGetState.mockReturnValue({restoreSession})
    mockUseHistoryStoreGetState.mockReturnValue({loadHistories})
    mockUseResumeStoreGetState.mockReturnValue({setResumeContent})
    mockUseSourceResumeStoreGetState.mockReturnValue({loadLatestSourceResume})
    mockPickAndParseResumeFile.mockResolvedValue(null)
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
    expect(screen.getByText(/视觉传达设计/)).not.toBeNull()
    expect(screen.getByText(/临床医学/)).not.toBeNull()
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
    expect(screen.getByText(/视觉传达设计/)).not.toBeNull()
    expect(screen.getByText(/临床医学/)).not.toBeNull()
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
    expect(screen.getByText(/生物统计/)).not.toBeNull()
    expect(screen.getByText(/汉语言文学/)).not.toBeNull()
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('第三步横向拖动队列后吸附并展开选中卡片', async () => {
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
        touches: [{clientX: 230, clientY: 520}],
      })
      fireEvent.touchMove(container.firstElementChild as Element, {
        touches: [{clientX: 82, clientY: 526}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-manual')

    await act(async () => {
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 82, clientY: 526}],
      })
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(1200)
      await Promise.resolve()
    })

    const selectedSourceCard = container.querySelector('[data-queue-offset="3"]')

    expect(selectedSourceCard?.className).toContain('reffo-landing-onboarding__card--queue-selected-source')
    expect(selectedSourceCard?.querySelector('.mock-home-score-card')).not.toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__selected')).toBeNull()
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('第三步下滑队列后吸附并展开选中卡片', async () => {
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
      jest.advanceTimersByTime(980)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 196, clientY: 420}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 198, clientY: 492}],
      })
      jest.advanceTimersByTime(700)
      await Promise.resolve()
    })

    const selectedSourceCard = container.querySelector('[data-queue-offset="3"]')

    expect(selectedSourceCard?.className).toContain('reffo-landing-onboarding__card--queue-selected-source')
    expect(selectedSourceCard?.querySelector('.mock-home-score-card')).not.toBeNull()
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('第三步选中卡片后再次拖动会先收回展开卡片', async () => {
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
      jest.advanceTimersByTime(980)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 196, clientY: 420}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 198, clientY: 492}],
      })
      jest.advanceTimersByTime(700)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 260, clientY: 520}],
      })
      fireEvent.touchMove(container.firstElementChild as Element, {
        touches: [{clientX: 178, clientY: 523}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-dismissing')
    expect(container.querySelector('[data-queue-offset="3"]')?.className)
      .toContain('reffo-landing-onboarding__card--queue-selected-source')

    await act(async () => {
      jest.advanceTimersByTime(560)
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-manual')
    expect(container.querySelector('[data-queue-offset="3"]')?.className)
      .not.toContain('reffo-landing-onboarding__card--queue-selected-source')
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('第三步展开卡片回缩完成后继续滑动才驱动队列滚动', async () => {
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
      jest.advanceTimersByTime(980)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 196, clientY: 420}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 198, clientY: 492}],
      })
      jest.advanceTimersByTime(700)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 260, clientY: 520}],
      })
      fireEvent.touchMove(container.firstElementChild as Element, {
        touches: [{clientX: 178, clientY: 523}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-dismissing')

    await act(async () => {
      jest.advanceTimersByTime(560)
      await Promise.resolve()
    })

    const sourceCard = container.querySelector<HTMLElement>('[data-queue-offset="3"]')
    const transformAfterDismiss = sourceCard?.style.transform

    await act(async () => {
      fireEvent.touchMove(container.firstElementChild as Element, {
        touches: [{clientX: 136, clientY: 524}],
      })
      await Promise.resolve()
    })

    expect(sourceCard?.style.transform).toBe(transformAfterDismiss)

    await act(async () => {
      fireEvent.touchMove(container.firstElementChild as Element, {
        touches: [{clientX: 68, clientY: 526}],
      })
      await Promise.resolve()
    })

    expect(sourceCard?.style.transform).not.toBe(transformAfterDismiss)
    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-manual')
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('第三步选中卡片后进入详情，再次下滑进入目标岗位文件夹阶段', async () => {
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
      jest.advanceTimersByTime(980)
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 196, clientY: 420}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 198, clientY: 492}],
      })
      jest.advanceTimersByTime(700)
      await Promise.resolve()
    })

    expect(screen.getByText('简历还没准备好？可以选择一位虚构的求职者以开始。')).not.toBeNull()

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 198, clientY: 438}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 200, clientY: 508}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-detail')
    expect(container.querySelector('.reffo-landing-onboarding__queue-detail-back')).not.toBeNull()
    expect(container.querySelector('.reffo-home-card__queue-face--resume-back')).not.toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder')).not.toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-card-arrow')).not.toBeNull()
    expect(screen.getByText('选中求职者后，恭喜你现在已经准备好进入下一步！')).not.toBeNull()
    expect(screen.queryByText('小D的体验简历')).toBeNull()

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 240, clientY: 500}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 170, clientY: 502}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-detail-leaving')
    expect(container.querySelector('.reffo-landing-onboarding__queue-detail-back')).not.toBeNull()

    await act(async () => {
      jest.advanceTimersByTime(430)
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-selected')
    expect(container.firstElementChild?.className).not.toContain('reffo-landing-onboarding--queue-detail-leaving')
    expect(container.querySelector('.reffo-landing-onboarding__queue-detail-back')).toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder')).toBeNull()
    expect(container.querySelector('[data-queue-offset="3"]')?.className)
      .toContain('reffo-landing-onboarding__card--queue-selected-source')
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 198, clientY: 438}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 200, clientY: 508}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-detail')

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 198, clientY: 438}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 200, clientY: 508}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-folder')
    expect(screen.getByText('目标岗位')).not.toBeNull()
    expect(screen.getByText(/重新匹配简历与岗位的价值/)).not.toBeNull()
    expect(screen.getByText('自定义岗位描述')).not.toBeNull()
    expect(screen.getByText('软件工程师')).not.toBeNull()
    expect(screen.getByText('互联网产品经理')).not.toBeNull()
    expect(container.querySelectorAll('.reffo-landing-onboarding__target-file')).toHaveLength(3)
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder-front')).not.toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder-shape')).not.toBeNull()
    expect(container.querySelectorAll('.reffo-landing-onboarding__pager-dot')[1]?.className)
      .toContain('reffo-landing-onboarding__pager-dot--active')
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.touchStart(container.firstElementChild as Element, {
        touches: [{clientX: 240, clientY: 500}],
      })
      fireEvent.touchEnd(container.firstElementChild as Element, {
        changedTouches: [{clientX: 170, clientY: 502}],
      })
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-folder-returning')
    expect(container.querySelectorAll('.reffo-landing-onboarding__pager-dot')[0]?.className)
      .toContain('reffo-landing-onboarding__pager-dot--active')

    await act(async () => {
      jest.advanceTimersByTime(830)
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-detail')
    expect(container.firstElementChild?.className).toContain('reffo-landing-onboarding--queue-detail-restored')
    expect(container.querySelectorAll('.reffo-landing-onboarding__pager-dot')[0]?.className)
      .toContain('reffo-landing-onboarding__pager-dot--active')
    expect(mockStorageSetItem).not.toHaveBeenCalled()
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  test('上传卡片停顿后展示上传说明且不显示额外删除按钮', async () => {
    mockStorageGetItem.mockResolvedValue(null)

    const {container} = render(<LandingPage />)
    await selectUploadQueueCard(container)

    const selectedUploadCard = container.querySelector('[data-queue-card-kind="upload"]')

    expect(selectedUploadCard?.className)
      .toContain('reffo-landing-onboarding__card--queue-selected-source')
    expect(screen.getByText('已经准备好了简历？可以上传自己的简历以开始。')).not.toBeNull()
    expect(screen.queryByRole('button', {name: '删除上传简历卡片'})).toBeNull()
  })

  test('上传卡片翻面后等待文件成功才显示箭头和文件夹', async () => {
    mockStorageGetItem.mockResolvedValue(null)
    mockPickAndParseResumeFile.mockImplementation(async ({onFileSelected, onProgress}) => {
      const file = {
        name: 'resume.pdf',
        path: 'blob:resume',
        size: 128 * 1024,
        extension: '.pdf',
        file: {} as File,
      }
      onFileSelected?.(file)
      onProgress?.(52)
      return {
        ...file,
        extractedText: '# Melvin Kuffour\n\n## Experience',
      }
    })

    const {container} = render(<LandingPage />)
    await selectUploadQueueCard(container)
    await swipeSelectedCardDown(container)

    expect(container.firstElementChild?.className)
      .toContain('reffo-landing-onboarding--queue-detail-upload')
    expect(screen.getByText('上传的信息越详细，reffo 就能为您生成一份与目标职位越契合的简历。'))
      .not.toBeNull()
    expect(screen.getByText('上传文件以下一步')).not.toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-card-arrow')).toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder')).toBeNull()

    await swipeSelectedCardDown(container)

    expect(container.firstElementChild?.className)
      .toContain('reffo-landing-onboarding--queue-detail')
    expect(container.firstElementChild?.className)
      .not.toContain('reffo-landing-onboarding--queue-folder')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: '上传简历文件'}))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPickAndParseResumeFile).toHaveBeenCalledTimes(1)
    expect(setResumeContent).toHaveBeenCalledWith('# Melvin Kuffour\n\n## Experience')
    expect(mockFeedbackSuccess).toHaveBeenCalledWith('resume.pdf 已上传')
    expect(mockFeedbackError).not.toHaveBeenCalled()
    expect(container.firstElementChild?.className)
      .toContain('reffo-landing-onboarding--queue-detail-uploaded')
    expect(container.querySelector('.reffo-landing-onboarding__detail-card-arrow')).not.toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder')).not.toBeNull()
    expect(screen.queryByText('上传文件以下一步')).toBeNull()
    expect(screen.getAllByText('resume.pdf').length).toBeGreaterThan(0)
    expect(screen.getAllByText('128 Kb').length).toBeGreaterThan(0)
    expect(container.querySelector('.reffo-home-card__upload-complete-icon')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
      jest.advanceTimersByTime(430)
      await Promise.resolve()
    })

    expect(container.firstElementChild?.className)
      .toContain('reffo-landing-onboarding--queue-selected')

    await swipeSelectedCardDown(container)

    expect(container.firstElementChild?.className)
      .toContain('reffo-landing-onboarding--queue-detail-uploaded')
    expect(container.querySelector('.reffo-landing-onboarding__detail-card-arrow')).not.toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder')).not.toBeNull()
    expect(mockPickAndParseResumeFile).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', {name: '删除已上传简历'})[0])
      await Promise.resolve()
    })

    expect(setResumeContent).toHaveBeenLastCalledWith('')
    expect(container.firstElementChild?.className)
      .toContain('reffo-landing-onboarding--queue-upload-pending')
    expect(container.querySelector('.reffo-landing-onboarding__detail-card-arrow')).toBeNull()
    expect(container.querySelector('.reffo-landing-onboarding__detail-folder')).toBeNull()
    expect(screen.getByText('上传文件以下一步')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: '上传简历文件'}))
      await Promise.resolve()
    })

    await swipeSelectedCardDown(container)

    expect(container.firstElementChild?.className)
      .toContain('reffo-landing-onboarding--queue-folder')
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
