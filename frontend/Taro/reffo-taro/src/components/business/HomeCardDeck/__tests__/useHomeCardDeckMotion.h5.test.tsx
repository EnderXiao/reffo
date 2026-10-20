import {renderHook} from '@testing-library/react'
import useHomeCardDeckMotion from '../useHomeCardDeckMotion.h5'
import type {HomeCardItem} from '../shared'

jest.mock('@/utils', () => ({
  logVisualTier: jest.fn(),
  useVisualTier: () => ({
    tier: 'basic',
    reason: 'test',
    supportsWebGL: false,
    prefersReducedMotion: false,
  }),
}))

const card: HomeCardItem = {
  id: 'single-card',
  company: 'Reffo',
  indexLabel: 'R',
  location: '上海',
  role: '产品经理',
  dateLabel: '今天',
  score: 88,
  primaryColor: '#286FE7',
  surfaceColor: '#F3F7FF',
  stackColor: '#DDE9FF',
  logoColor: '#286FE7',
  borderColor: '#DCE8FF',
  tone: 'default',
  strategyBody: '',
}

describe('useHomeCardDeckMotion H5', () => {
  test('只有一张卡片时仍允许拖动', () => {
    const {result} = renderHook(() => useHomeCardDeckMotion({
      cards: [card],
      cardScale: 1,
      isCreateMode: false,
    }))

    expect(result.current.isDeckInteractive).toBe(true)
  })

  test('创建模式不启用卡片拖动', () => {
    const {result} = renderHook(() => useHomeCardDeckMotion({
      cards: [card],
      cardScale: 1,
      isCreateMode: true,
    }))

    expect(result.current.isDeckInteractive).toBe(false)
  })
})
