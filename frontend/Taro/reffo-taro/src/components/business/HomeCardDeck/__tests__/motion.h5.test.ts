import {resolveH5CardScale} from '../motion.h5'

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
