import React from 'react'
import {act, fireEvent, render, screen} from '@testing-library/react'
import Taro from '@tarojs/taro'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {usePageModel} from '../model/usePageModel'

jest.mock('@tarojs/taro', () => ({
  navigateTo: jest.fn(),
  showToast: jest.fn(),
  useDidShow: jest.fn(),
  useRouter: jest.fn(() => ({params: {}})),
}))

jest.mock('@/store/historyStore')
jest.mock('@/store/sourceResumeStore')

const mockUseHistoryStore = useHistoryStore as jest.MockedFunction<typeof useHistoryStore>
const mockUseSourceResumeStore = useSourceResumeStore as jest.MockedFunction<
  typeof useSourceResumeStore
>

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
    </>
  )
}

describe('usePageModel', () => {
  const mockLoadHistories = jest.fn()
  const mockLoadLatestSourceResume = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    mockUseHistoryStore.mockReturnValue({
      histories: [],
      loading: {isLoading: false, error: null},
      loadHistories: mockLoadHistories,
    } as ReturnType<typeof useHistoryStore>)
    mockUseSourceResumeStore.mockReturnValue({
      latestSourceResume: null,
      loading: {isLoading: false, error: null},
      loadLatestSourceResume: mockLoadLatestSourceResume,
      setLatestSourceResume: jest.fn(),
      clearLatestSourceResume: jest.fn(),
      reset: jest.fn(),
    } as ReturnType<typeof useSourceResumeStore>)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('2 秒后自动切到策略文案', () => {
    render(<HookProbe />)

    expect((screen.getByTestId('strategy') as any).textContent).toBe('no')
    expect((screen.getByTestId('card-id') as any).textContent).toBe('demo-x')

    act(() => {
      jest.advanceTimersByTime(1999)
    })
    expect((screen.getByTestId('strategy') as any).textContent).toBe('no')

    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect((screen.getByTestId('strategy') as any).textContent).toBe('yes')
    expect(mockLoadHistories).toHaveBeenCalledTimes(1)
    expect(mockLoadLatestSourceResume).toHaveBeenCalledTimes(1)
  })

  test('首次触摸卡片时立即切到策略文案', () => {
    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'touch'}))

    expect((screen.getByTestId('strategy') as any).textContent).toBe('yes')

    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect((screen.getByTestId('strategy') as any).textContent).toBe('yes')
  })

  test('进入创建态后暂停自动策略切换，取消后恢复预览态', () => {
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

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index',
    })
  })

  test('已有源简历时确认创建导航到 JD 步骤', () => {
    mockUseSourceResumeStore.mockReturnValue({
      latestSourceResume: {
        id: 'source-resume-1',
        title: 'Jeremy Smith',
        resumeMarkdown: '# Jeremy Smith',
        sourceType: 'manual',
        originalFileName: 'Jeremy Smith.md',
        createdAt: '2026-03-25T12:00:00.000Z',
        updatedAt: '2026-03-25T12:00:00.000Z',
      },
      loading: {isLoading: false, error: null},
      loadLatestSourceResume: mockLoadLatestSourceResume,
      setLatestSourceResume: jest.fn(),
      clearLatestSourceResume: jest.fn(),
      reset: jest.fn(),
    } as ReturnType<typeof useSourceResumeStore>)

    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'confirm-create'}))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index?step=jobDescription',
    })
  })

  test('已有源简历时点击源简历按钮导航到完成页', () => {
    mockUseSourceResumeStore.mockReturnValue({
      latestSourceResume: {
        id: 'source-resume-1',
        title: 'Jeremy Smith',
        resumeMarkdown: '# Jeremy Smith',
        sourceType: 'manual',
        originalFileName: 'Jeremy Smith.md',
        createdAt: '2026-03-25T12:00:00.000Z',
        updatedAt: '2026-03-25T12:00:00.000Z',
      },
      loading: {isLoading: false, error: null},
      loadLatestSourceResume: mockLoadLatestSourceResume,
      setLatestSourceResume: jest.fn(),
      clearLatestSourceResume: jest.fn(),
      reset: jest.fn(),
    } as ReturnType<typeof useSourceResumeStore>)

    render(<HookProbe />)

    fireEvent.click(screen.getByRole('button', {name: 'source-resume'}))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index?step=resumeSummary',
    })
  })
})
