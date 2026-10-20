import {clearH5DeckDragCardStyles, resolveH5CardScale} from '../motion.h5'

function setViewport(width: number, height: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: height,
  })
}

describe('resolveH5CardScale', () => {
  test('保留首页默认放大比例', () => {
    setViewport(393, 852)

    expect(resolveH5CardScale()).toBeCloseTo(1.08)
  })

  test('Landing 可复用同一套视口计算而不放大卡片', () => {
    setViewport(393, 852)

    expect(resolveH5CardScale({amplification: 1})).toBeCloseTo(0.88)
  })

  test('桌面宽屏保持最大比例约束', () => {
    setViewport(1440, 900)

    expect(resolveH5CardScale({amplification: 1})).toBeCloseTo(0.98)
  })
})

describe('clearH5DeckDragCardStyles', () => {
  test('清理换卡后遗留的拖拽内联样式', () => {
    const previousCard = document.createElement('div')
    const currentCard = document.createElement('div')

    ;[previousCard, currentCard].forEach(card => {
      card.style.setProperty('--card-drag-x', '80px')
      card.style.setProperty('--card-highlight-strength', '1')
      card.style.transition = 'none'
      card.style.transform = 'translate3d(80px, 0, 0)'
      card.style.filter = 'drop-shadow(8px 8px 8px rgba(0, 0, 0, 0.2))'
    })

    clearH5DeckDragCardStyles(previousCard)
    clearH5DeckDragCardStyles(currentCard)

    ;[previousCard, currentCard].forEach(card => {
      expect(card.style.getPropertyValue('--card-highlight-strength')).toBe('')
      expect(card.style.transition).toBe('')
      expect(card.style.transform).toBe('')
      expect(card.style.filter).toBe('')
    })
  })
})
