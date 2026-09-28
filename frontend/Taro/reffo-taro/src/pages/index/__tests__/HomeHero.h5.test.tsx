import {act, fireEvent, render, screen} from '@testing-library/react'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {HomeHeroH5} from '../PageView.h5'

jest.mock('@/components/business/HomeCardDeck', () => ({__esModule: true, default: () => null}))
jest.mock('@/components/business/HomeCardDeck/HomeScoreCard.h5', () => ({__esModule: true, default: () => null}))
jest.mock('@/utils', () => ({useVisualTier: () => 'basic'}))
jest.mock('@/shared/routing', () => ({preloadCreateRoute: jest.fn(), routePaths: {}, useRouteTransition: jest.fn()}))
jest.mock('@/store/authStore', () => ({useAuthStore: jest.fn()}))

function card(overrides: Partial<HomeCardItem> = {}): HomeCardItem {
  return {
    id: 'current-resume', company: '测试公司', indexLabel: '01', location: '上海', role: '产品经理',
    dateLabel: '2026.09.27', score: 80, primaryColor: '#000', surfaceColor: '#fff', stackColor: '#fff',
    logoColor: '#000', borderColor: '#ddd', tone: 'soft', strategyTitle: '这份简历的重点',
    strategyBody: '项目经历：参与用户访谈并整理需求。\n工作经历：推进模块验收，保留本人参与范围。',
    ...overrides,
  }
}

const heroProps = {isCreateMode: false, isStrategyVisible: true, logoSource: '/test-logo.svg'}

describe('首页简历重点', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('显示简历重点与实际正文，标题和正文均可打开对应详情', () => {
    const onStrategyClick = jest.fn()
    render(<HomeHeroH5 {...heroProps} currentCard={card()} onStrategyClick={onStrategyClick} />)

    expect(screen.getByText('这份简历的重点')).toBeTruthy()
    expect(screen.getByText('项目经历：参与用户访谈并整理需求。')).toBeTruthy()
    expect(screen.getByText('工作经历：推进模块验收，保留本人参与范围。')).toBeTruthy()
    const entries = screen.getAllByRole('button', {name: '查看简历重点与对应正文'})
    entries.forEach(entry => fireEvent.click(entry))
    expect(onStrategyClick).toHaveBeenCalledTimes(2)
  })

  test('切换旧记录后，标题和正文在过渡结束时一起变更', () => {
    const current = card()
    const legacy = card({id: 'legacy', strategyTitle: undefined, strategyBody: '补充项目的职责范围与交付结果。'})
    const onStrategyClick = jest.fn()
    const {rerender} = render(<HomeHeroH5 {...heroProps} currentCard={current} onStrategyClick={onStrategyClick} />)

    rerender(<HomeHeroH5 {...heroProps} currentCard={legacy} onStrategyClick={onStrategyClick} />)
    act(() => jest.advanceTimersByTime(159))
    expect(screen.getByText('这份简历的重点')).toBeTruthy()
    expect(screen.getByText('项目经历：参与用户访谈并整理需求。')).toBeTruthy()
    expect(screen.queryByText('优化建议')).toBeNull()
    expect(screen.queryByText(legacy.strategyBody)).toBeNull()

    act(() => jest.advanceTimersByTime(1))
    expect(screen.getByText('优化建议')).toBeTruthy()
    expect(screen.getByText(legacy.strategyBody)).toBeTruthy()
    expect(screen.queryByText('这份简历的重点')).toBeNull()
    expect(screen.queryByText('项目经历：参与用户访谈并整理需求。')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', {name: '查看完整优化建议'})[0])
    expect(onStrategyClick).toHaveBeenCalledTimes(1)
  })

  test('正文相同但来源变为旧建议时仍更新标题和查看入口', () => {
    const current = card({strategyBody: '参与用户访谈并整理需求。'})
    const {rerender} = render(<HomeHeroH5 {...heroProps} currentCard={current} onStrategyClick={jest.fn()} />)
    rerender(<HomeHeroH5 {...heroProps} currentCard={{...current, id: 'legacy', strategyTitle: '优化建议'}} onStrategyClick={jest.fn()} />)

    expect(screen.getByText('这份简历的重点')).toBeTruthy()
    expect(screen.getByText(current.strategyBody)).toBeTruthy()
    act(() => jest.advanceTimersByTime(160))
    expect(screen.getByText('优化建议')).toBeTruthy()
    expect(screen.getByText(current.strategyBody)).toBeTruthy()
    expect(screen.queryByText('这份简历的重点')).toBeNull()
    expect(screen.getAllByRole('button', {name: '查看完整优化建议'})).toHaveLength(2)
  })

  test('连续切换时不混用中间卡片的标题与最后卡片的正文', () => {
    const {rerender} = render(<HomeHeroH5 {...heroProps} currentCard={card()} />)
    rerender(<HomeHeroH5 {...heroProps} currentCard={card({id: 'legacy', strategyTitle: '优化建议', strategyBody: '旧建议内容'})} />)
    act(() => jest.advanceTimersByTime(80))
    rerender(<HomeHeroH5 {...heroProps} currentCard={card({id: 'last', strategyBody: '项目经历：完成交付验收。'})} />)
    act(() => jest.advanceTimersByTime(160))

    expect(screen.getByText('这份简历的重点')).toBeTruthy()
    expect(screen.getByText('项目经历：完成交付验收。')).toBeTruthy()
    expect(screen.queryByText('优化建议')).toBeNull()
    expect(screen.queryByText('旧建议内容')).toBeNull()
  })
})
