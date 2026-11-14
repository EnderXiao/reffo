import {act, fireEvent, render, screen} from '@testing-library/react'
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

  test('预设求职者详情保留完整内容且阅读手势不触发卡片和页面交互', () => {
    const onPageGesture = jest.fn()
    const onCardClick = jest.fn()
    const summary = '有内容、社群和活动经验，日常工作写得较散。'
    const experience = '负责公众号内容和学习社群。\n整理报名、到场和用户反馈。\n希望转向用户运营岗位。'

    render(
      <div
        onTouchStart={onPageGesture}
        onTouchMove={onPageGesture}
        onTouchEnd={onPageGesture}
        onTouchCancel={onPageGesture}
        onMouseDown={onPageGesture}
        onMouseUp={onPageGesture}
      >
        <HomeScoreCard
          card={{
            ...card,
            generationTaskId: undefined,
            generationStatus: undefined,
            queueCardKind: 'resume',
            resumeProfile: {
              name: '小陈',
              summary,
              tags: ['内容与活动执行'],
              avatarPrimary: '#f27695',
              avatarAccent: '#f6ccd6',
              avatarVariant: 2,
            },
            strategyBody: experience,
          }}
          depth={0}
          active={false}
          visualTier='basic'
          presentation='queue3d'
          onClick={onCardClick}
        />
      </div>,
    )

    const detail = screen.getByRole('region', {name: '小陈的详细说明'})
    expect(detail.tabIndex).toBe(0)
    expect(detail.querySelector('.reffo-home-card__resume-detail-summary')?.textContent).toBe(summary)
    expect(detail.querySelector('.reffo-home-card__resume-detail-experience')?.textContent).toBe(experience)

    fireEvent.touchStart(detail, {touches: [{clientX: 150, clientY: 500}]})
    expect(fireEvent.touchMove(detail, {touches: [{clientX: 150, clientY: 420}]})).toBe(true)
    fireEvent.touchEnd(detail, {changedTouches: [{clientX: 150, clientY: 420}]})
    fireEvent.touchCancel(detail)
    fireEvent.mouseDown(detail)
    fireEvent.mouseUp(detail)
    fireEvent.click(detail)

    expect(onPageGesture).not.toHaveBeenCalled()
    expect(onCardClick).not.toHaveBeenCalled()
  })
})
