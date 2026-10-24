import {act, renderHook} from '@testing-library/react'
import {runViewTransition} from '@/shared/motion'
import {preloadCreateStep} from '../lazyCreateSteps'
import {useCreateFlowRoute} from '../useCreateFlowRoute'

jest.mock('@/shared/motion', () => ({
  runViewTransition: jest.fn(async (_kind, update) => update()),
}))

jest.mock('../lazyCreateSteps', () => ({
  preloadCreateStep: jest.fn(async () => undefined),
}))

const mockRunViewTransition = runViewTransition as jest.MockedFunction<typeof runViewTransition>
const mockPreloadCreateStep = preloadCreateStep as jest.MockedFunction<typeof preloadCreateStep>

describe('useCreateFlowRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPreloadCreateStep.mockReset()
    mockPreloadCreateStep.mockResolvedValue(undefined)
  })

  test('step chunk 加载完成后才执行 forward 转场', async () => {
    let finishPreload!: () => void
    mockPreloadCreateStep.mockReturnValue(new Promise<undefined>(resolve => {
      finishPreload = () => resolve(undefined)
    }))
    const {result} = renderHook(() => useCreateFlowRoute('resumeUpload'))

    let transitionPromise!: Promise<void>
    act(() => {
      transitionPromise = result.current.transitionToStep('jobDescription', 'forward')
    })

    expect(mockPreloadCreateStep).toHaveBeenCalledWith('jobDescription')
    expect(mockRunViewTransition).not.toHaveBeenCalled()

    await act(async () => {
      finishPreload()
      await transitionPromise
    })

    expect(mockRunViewTransition).toHaveBeenCalledWith('forward', expect.any(Function))
    expect(result.current.currentStep).toBe('jobDescription')
    expect(result.current.routeKey).toBe(1)
  })

  test('replaceStep 使用 replace 转场并同步提交状态更新', async () => {
    const update = jest.fn()
    const {result} = renderHook(() => useCreateFlowRoute('resumeSummary'))

    await act(async () => {
      await result.current.replaceStep('resumeUpload', update)
    })

    expect(mockRunViewTransition).toHaveBeenCalledWith('replace', expect.any(Function))
    expect(update).toHaveBeenCalledTimes(1)
    expect(result.current.currentStep).toBe('resumeUpload')
    expect(result.current.routeKey).toBe(1)
  })

  test('初始分包预加载失败后记录警告且仍可再次转场', async () => {
    const error = new Error('Loading chunk failed')
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockPreloadCreateStep.mockRejectedValueOnce(error)

    try {
      const {result} = renderHook(() => useCreateFlowRoute('jobDescription'))

      await act(async () => {
        await Promise.resolve()
      })

      expect(warn).toHaveBeenCalledWith(
        '[useCreateFlowRoute] Failed to preload initial step:',
        error,
      )
      expect(mockRunViewTransition).not.toHaveBeenCalled()

      await act(async () => {
        await result.current.transitionToStep('jobDescription')
      })

      expect(mockPreloadCreateStep).toHaveBeenCalledTimes(2)
      expect(mockRunViewTransition).toHaveBeenCalledWith('forward', expect.any(Function))
      expect(result.current.currentStep).toBe('jobDescription')
    } finally {
      warn.mockRestore()
    }
  })

  test('禁用初始预加载时仍在显式转场前加载分包', async () => {
    const {result} = renderHook(() => useCreateFlowRoute('jobDescription', {
      preloadInitialStep: false,
    }))

    expect(mockPreloadCreateStep).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.transitionToStep('resumeSummary')
    })

    expect(mockPreloadCreateStep).toHaveBeenCalledTimes(1)
    expect(mockPreloadCreateStep).toHaveBeenCalledWith('resumeSummary')
    expect(mockRunViewTransition).toHaveBeenCalledWith('forward', expect.any(Function))
    expect(result.current.currentStep).toBe('resumeSummary')
    expect(result.current.routeKey).toBe(1)
  })
})
