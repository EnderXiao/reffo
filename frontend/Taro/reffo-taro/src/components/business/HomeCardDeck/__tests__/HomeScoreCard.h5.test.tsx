import {act, render, screen} from '@testing-library/react'
import HomeScoreCard from '../HomeScoreCard.h5'
import type {HomeCardItem} from '../shared'

const card: HomeCardItem = {
  id: 'task-1',
  generationTaskId: 'task-1',
  generationStatus: 'generating',
  company: 'Reffo',
  indexLabel: 'R',
  location: '上海',
  role: '产品经理',
  dateLabel: '今天',
  score: 0,
  primaryColor: '#286FE7',
  surfaceColor: '#F3F7FF',
  stackColor: '#DDE9FF',
  logoColor: '#286FE7',
  borderColor: '#DCE8FF',
  tone: 'default',
  strategyBody: '',
}

describe('HomeScoreCard H5', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('首页等待卡用贴纸覆盖成功卡层', () => {
    const {container} = render(
      <HomeScoreCard card={card} depth={0} active visualTier='basic' />,
    )

    expect(screen.getAllByText('等待中').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Reffo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('产品经理').length).toBeGreaterThan(0)
    expect(screen.queryByText('正在为你准备')).toBeNull()
    expect(container.querySelector('.reffo-card-foil')).not.toBeNull()
    expect(container.querySelector('.reffo-home-card__loading-sticker')).not.toBeNull()
    expect(container.querySelector('.reffo-home-card__loading-sticker-success-preview')).toBeNull()
    expect(container.querySelector('.reffo-home-card__loading-sticker-sheet')).not.toBeNull()
    expect(container.querySelector('.reffo-home-card__loading-sticker-glass')).toBeNull()
    expect(container.querySelector('.reffo-home-card__loading-sticker-composite')).toBeNull()
    expect(container.querySelectorAll('.reffo-home-card__loading-sticker-peel-back')).toHaveLength(1)
    expect(container.querySelector('.reffo-home-card__loading-sticker-peel-depth')).toBeNull()
    expect(container.querySelector('.reffo-home-card__loading-sticker-peel-highlight')).toBeNull()
    expect(container.querySelector('.reffo-home-card__score--waiting')).toBeNull()
    expect(container.querySelector('.reffo-home-card__score-result')).not.toBeNull()
  })

  test('等待卡完成时保留双状态层并切换为未读', () => {
    const {container, rerender} = render(
      <HomeScoreCard card={card} depth={0} active visualTier='basic' />,
    )
    const score = container.querySelectorAll('.reffo-home-card__score').item(
      container.querySelectorAll('.reffo-home-card__score').length - 1,
    )
    const badge = container.querySelector('.reffo-home-card__unread')

    expect(score?.querySelector('.reffo-home-card__score-waiting')).not.toBeNull()
    expect(score?.querySelector('.reffo-home-card__score-result')).not.toBeNull()
    expect(badge?.classList.contains('reffo-home-card__unread--visible')).toBe(true)

    rerender(
      <HomeScoreCard
        card={{...card, generationStatus: 'completed', unread: true, score: 88}}
        depth={0}
        active
        visualTier='basic'
      />,
    )
    expect(
      container.querySelectorAll('.reffo-home-card__score').item(
        container.querySelectorAll('.reffo-home-card__score').length - 1,
      ),
    ).toBe(score)
    expect(container.querySelector('.reffo-home-card__unread')).toBe(badge)
    expect(score?.classList.contains('reffo-home-card__score--waiting')).toBe(false)
    expect(score?.querySelector('.reffo-home-card__score-waiting')).not.toBeNull()
    expect(score?.querySelector('.reffo-home-card__score-result')).not.toBeNull()
    expect(badge?.classList.contains('reffo-home-card__unread--visible')).toBe(true)
    expect(container.querySelector('.reffo-home-card__loading-sticker--revealed')).not.toBeNull()

    act(() => {
      jest.advanceTimersByTime(1100)
    })

    expect(container.querySelector('.reffo-home-card__loading-sticker')).toBeNull()
    expect(container.querySelector('.reffo-home-card--sticker-revealed')).toBeNull()
    expect(container.querySelector('.reffo-home-card--unread')).not.toBeNull()
  })

  test('全屏生成阶段不渲染首页镭射层', () => {
    const {container} = render(
      <HomeScoreCard
        card={{...card, generationTaskId: undefined, generationStatus: undefined}}
        depth={0}
        active
        visualTier='basic'
        variant='generating'
      />,
    )

    expect(container.querySelector('.reffo-card-foil')).toBeNull()
    expect(container.querySelector('.reffo-home-card__generating')).not.toBeNull()
  })
})
