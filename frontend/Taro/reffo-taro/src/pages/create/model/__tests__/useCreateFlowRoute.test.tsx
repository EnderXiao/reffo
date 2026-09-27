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
})
