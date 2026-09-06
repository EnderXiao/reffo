import {fireEvent, render, screen} from '@testing-library/react'
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
  }

  test('只接收展示状态并渲染生成态内容', () => {
    render(<GenerationStageH5 state={state} onCancelGeneration={jest.fn()} />)

    expect(screen.getByTestId('create-analysis-stage')).toBeTruthy()
    expect(screen.getByTestId('generation-card')).toBeTruthy()
    expect(screen.getByText('正在为你的目标岗位量身定做相契简历……')).toBeTruthy()
    expect(screen.getAllByText('我的简历')).toHaveLength(2)
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
