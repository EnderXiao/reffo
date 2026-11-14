import type {ReactNode} from 'react'
import {fireEvent, render, screen} from '@testing-library/react'
import {beforeEach, expect, jest, test} from '@jest/globals'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {toHistorySummaryCardItem} from '@/pages/index/model/homeCardData'
import PageView from '../PageView.h5'
import type {CompletePageViewModel} from '../usePageModel'

jest.mock('@/utils', () => ({useVisualTier: () => ({tier: 'basic'})}))
jest.mock('@/pages/index/index.h5.scss', () => ({}))
jest.mock('@/pages/share/index.h5.scss', () => ({}))
jest.mock('@/components/business/HomeCardDeck/HomeScoreCard.h5', () => ({
  __esModule: true,
  default: ({card}: {card: HomeCardItem}) => <div>{card.company} · {card.role}</div>,
}))
jest.mock('../../share/PhysicsBadge.h5', () => ({
  __esModule: true,
  default: ({children}: {children: ReactNode}) => <div>{children}</div>,
}))

const model: CompletePageViewModel = {
  card: toHistorySummaryCardItem({id: 'generated-history', name: '测试用户', company: '目标公司',
    position: '产品经理', createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z',
    qualityScore: 88, tags: ['产品设计'], location: '北京', strategyBody: '突出产品交付经验', matchScore: 86}),
  historyId: 'generated-history',
  loading: false,
  error: null,
  hasInitialEntryAnimation: false,
  isShareReturnEntry: false,
  isSharingTransition: false,
  handleShare: jest.fn(),
  handleContinue: jest.fn(),
  handleRetry: jest.fn(),
}

beforeEach(() => { jest.clearAllMocks() })

test('完成页展示本次生成的卡片和分享入口，点击分享不触发返回首页', () => {
  render(<PageView {...model} />)
  expect(screen.getByText('目标公司 · 产品经理')).toBeTruthy()
  expect(screen.getByText('恭喜你！')).toBeTruthy()
  expect(screen.queryByText('Reffo')).toBeNull()
  fireEvent.click(screen.getByText('分享你的新工牌'))
  expect(model.handleShare).toHaveBeenCalledTimes(1)
  expect(model.handleContinue).not.toHaveBeenCalled()
})

test('卡片加载失败时不展示成功内容、彩带或分享入口，可以重试且不触发返回', () => {
  const {container} = render(<PageView {...model} card={null} error='简历卡加载失败，请重试或返回首页查看。' />)
  expect(screen.queryByText('恭喜你！')).toBeNull()
  expect(screen.queryByText('新申请目标岗位的简历已经准备就绪！')).toBeNull()
  expect(screen.queryByText('分享你的新工牌')).toBeNull()
  expect(container.querySelector('.reffo-complete__confetti')).toBeNull()
  fireEvent.click(screen.getByText('点击重试'))
  expect(model.handleRetry).toHaveBeenCalledTimes(1)
  expect(model.handleContinue).not.toHaveBeenCalled()
})
