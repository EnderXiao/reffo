import {act, fireEvent, render, screen} from '@testing-library/react'
import {GENERATION_PRESENTATION_STEP_DURATION_MS} from '@/pages/create/constants/generationPresentation'
import GenerationStageH5 from '../index'

jest.mock('@/components/business/HomeCardDeck/HomeScoreCard.h5', () => ({
  __esModule: true,
  default: () => <div data-testid='generation-card' />,
}))

jest.mock('@/utils', () => ({
  useVisualTier: () => ({tier: 'basic'}),
}))

describe('GenerationStageH5', () => {
  const state = {
    resumeTitle: '我的简历',
    companyName: 'Reffo',
    positionName: '前端工程师',
    baseLocation: '上海',
    monogram: '我',
    phase: 'analyzing' as const,
  }

  test('只接收展示状态并渲染生成态内容', () => {
    render(<GenerationStageH5 state={state} onCancelGeneration={jest.fn()} />)

    expect(screen.getByTestId('create-analysis-stage')).toBeTruthy()
    expect(screen.getByTestId('generation-card')).toBeTruthy()
    expect(screen.getByText('正在为你的目标岗位量身定做相契简历……')).toBeTruthy()
    expect(screen.getAllByText('我的简历')).toHaveLength(1)
    expect(screen.getByTestId('generation-title-reel-track').getAttribute('data-reel-count')).toBe('4')
  })

  test('标题轮播去重相同文案', () => {
    render(
      <GenerationStageH5
        state={{
          resumeTitle: 'web 前端',
          companyName: 'web 前端',
          positionName: 'web 前端',
          baseLocation: 'web 前端',
          monogram: 'W',
        }}
        onCancelGeneration={jest.fn()}
      />,
    )

    expect(screen.getAllByText('web 前端')).toHaveLength(1)
  })

  test('标题轮播运行时不产生反向复位状态', () => {
    jest.useFakeTimers()
    try {
      render(<GenerationStageH5 state={state} onCancelGeneration={jest.fn()} />)
      const track = screen.getByTestId('generation-title-reel-track')

      act(() => { jest.advanceTimersByTime(2400 * 4) })
      expect(track.className).toBe('reffo-create-generation__title-reel-track')

      act(() => { jest.advanceTimersByTime(2400) })
      expect(track.className).toBe('reffo-create-generation__title-reel-track')
    } finally {
      jest.useRealTimers()
    }
  })

  test('loading 三阶段独立依次激活并完整播放', () => {
    jest.useFakeTimers()
    try {
      const onPresentationComplete = jest.fn()
      render(
        <GenerationStageH5
          state={{...state, phase: 'generating'}}
          onCancelGeneration={jest.fn()}
          onPresentationComplete={onPresentationComplete}
        />,
      )

      expect(screen.getByTestId('generation-presentation-analyzing').getAttribute('data-status')).toBe('active')
      expect(screen.getByTestId('generation-presentation-matching').getAttribute('data-status')).toBe('pending')

      act(() => { jest.advanceTimersByTime(GENERATION_PRESENTATION_STEP_DURATION_MS) })
      expect(screen.getByTestId('generation-presentation-analyzing').getAttribute('data-status')).toBe('done')
      expect(screen.getByTestId('generation-presentation-matching').getAttribute('data-status')).toBe('active')

      act(() => { jest.advanceTimersByTime(GENERATION_PRESENTATION_STEP_DURATION_MS) })
      expect(screen.getByTestId('generation-presentation-matching').getAttribute('data-status')).toBe('done')
      expect(screen.getByTestId('generation-presentation-generating').getAttribute('data-status')).toBe('active')
      expect(onPresentationComplete).not.toHaveBeenCalled()

      act(() => { jest.advanceTimersByTime(GENERATION_PRESENTATION_STEP_DURATION_MS) })
      expect(onPresentationComplete).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  test('通过 header 插槽承载页面私有头部', () => {
    render(
      <GenerationStageH5
        state={state}
        onCancelGeneration={jest.fn()}
        header={<div data-testid='landing-header'>返回</div>}
      />,
    )

    expect(screen.getByTestId('landing-header')).toBeTruthy()
  })

  test('取消操作只触发回调', () => {
    const onCancelGeneration = jest.fn()
    render(<GenerationStageH5 state={state} onCancelGeneration={onCancelGeneration} />)

    fireEvent.click(screen.getByTestId('analysis-cancel-action'))

    expect(onCancelGeneration).toHaveBeenCalledTimes(1)
  })
})
