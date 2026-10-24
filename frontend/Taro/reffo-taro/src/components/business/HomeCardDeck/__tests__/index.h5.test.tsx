import React from 'react'
import {act, fireEvent, render} from '@testing-library/react'
import HomeCardDeck from '../index.h5'
import useHomeCardDeckMotion from '../useHomeCardDeckMotion.h5'
import type {HomeCardItem} from '../shared'

jest.mock('@tarojs/components', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  const View = ReactModule.forwardRef<HTMLDivElement, any>(({children, ...props}, ref) => (
    <div ref={ref} {...props}>{children}</div>
  ))

  return {
    View,
    Text: ({children, ...props}: any) => <span {...props}>{children}</span>,
  }
})
jest.mock('../useHomeCardDeckMotion.h5')
jest.mock('../HomeScoreCard.h5', () => ({
  __esModule: true,
  default: ({card, className, onClick}: any) => (
    <div data-home-card-id={card.id} className={className} onClick={onClick}>
      <div className='reffo-home-card__surface' />
    </div>
  ),
}))

const mockUseHomeCardDeckMotion = useHomeCardDeckMotion as jest.MockedFunction<
  typeof useHomeCardDeckMotion
>

const card: HomeCardItem = {
  id: 'history-1',
  company: 'Reffo',
  indexLabel: '01',
  location: '北京',
  role: '前端工程师',
  dateLabel: '2026-09-08',
  score: 92,
  primaryColor: '#286fe7',
  surfaceColor: '#ffffff',
  stackColor: '#eef4ff',
  logoColor: '#286fe7',
  borderColor: '#dce8ff',
  tone: 'default',
  strategyBody: '优化项目经历',
}

describe('HomeCardDeck H5', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    mockUseHomeCardDeckMotion.mockReturnValue({
      activeCard: card,
      activeRailIndex: 0,
      dragState: {x: 0, y: 0, phase: 'idle'},
      dragVars: {},
      handleDeckPointerDown: jest.fn(),
      handleDeckPointerEnd: jest.fn(),
      handleDeckPointerMove: jest.fn(),
      handleRailTouchStart: jest.fn(),
      isDeckInteractive: false,
      isRailAnimating: false,
      orderedCardEntries: [{
        card,
        depth: 0,
        isRecycling: false,
        isTailEntering: false,
      }],
      railItems: [{card, virtualIndex: 0}],
      railRef: {current: null},
      railTranslateY: 0,
      stackRef: {current: null},
      visualCapability: {
        tier: 'basic',
        reason: 'test',
        supportsWebGL: false,
        prefersReducedMotion: false,
      },
    } as ReturnType<typeof useHomeCardDeckMotion>)
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
    document.querySelectorAll('.reffo-home-card-open-overlay, .reffo-home-card--opening-clone')
      .forEach(element => element.remove())
  })

  test('轻点当前卡片只触发一次打开回调', async () => {
    const onCardPress = jest.fn(async () => undefined)
    const {container} = render(<HomeCardDeck cards={[card]} onCardPress={onCardPress} />)
    const cardElement = container.querySelector('[data-home-card-id="history-1"]')!

    fireEvent.pointerDown(cardElement, {clientX: 20, clientY: 20, pointerId: 1})
    fireEvent.pointerMove(cardElement, {clientX: 23, clientY: 22, pointerId: 1})
    fireEvent.pointerUp(cardElement, {clientX: 23, clientY: 22, pointerId: 1})
    fireEvent.click(cardElement)
    fireEvent.click(cardElement)

    expect(onCardPress).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(440)
      await Promise.resolve()
    })

    expect(onCardPress).toHaveBeenCalledTimes(1)
    expect(onCardPress).toHaveBeenCalledWith(card)
  })
})
