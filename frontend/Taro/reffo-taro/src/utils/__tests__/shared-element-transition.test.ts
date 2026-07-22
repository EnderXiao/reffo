import {
  clearSharedElementSnapshot,
  createFallbackSharedElementSnapshot,
  createSharedElementSnapshot,
  readSharedElementSnapshot,
  scaleSharedElementSnapshot,
  writeSharedElementSnapshot,
  type SharedElementSnapshot,
} from '../shared-element-transition'

describe('shared-element-transition', () => {
  const storageKey = 'reffo.testSharedElement'

  beforeEach(() => {
    window.sessionStorage.clear()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 360,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 732,
    })
  })

  test('写入、读取和清理共享元素快照', () => {
    const snapshot = createSharedElementSnapshot(
      {left: 12, top: 34, width: 56, height: 78},
      {cardId: 'JD2026072000001'},
    )

    writeSharedElementSnapshot(storageKey, snapshot, '测试元素')

    expect(readSharedElementSnapshot<SharedElementSnapshot & {cardId: string}>(
      storageKey,
      '测试元素',
    )).toEqual({
      cardId: 'JD2026072000001',
      left: 12,
      top: 34,
      width: 56,
      height: 78,
      viewportWidth: 360,
      viewportHeight: 732,
    })

    clearSharedElementSnapshot(storageKey, '测试元素')

    expect(readSharedElementSnapshot(storageKey, '测试元素')).toBeNull()
  })

  test('无元素时可创建居中兜底快照', () => {
    expect(createFallbackSharedElementSnapshot(160, 42)).toEqual({
      left: 100,
      top: 345,
      width: 160,
      height: 42,
      viewportWidth: 360,
      viewportHeight: 732,
    })
  })

  test('按当前 viewport 缩放历史快照', () => {
    const snapshot: SharedElementSnapshot = {
      left: 100,
      top: 200,
      width: 160,
      height: 40,
      viewportWidth: 320,
      viewportHeight: 640,
    }

    expect(scaleSharedElementSnapshot(snapshot, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    })).toEqual({
      left: 112.5,
      top: 228.75,
      width: 180,
      height: 45.75,
      viewportWidth: 360,
      viewportHeight: 732,
    })
  })
})
