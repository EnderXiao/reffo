import {DEFAULT_DECK_WIDTH, createDeckLayoutMetrics} from '../shared'

describe('deck layout metrics', () => {
  test('首张卡片应明显高于后续卡片', () => {
    const metrics = createDeckLayoutMetrics(5, DEFAULT_DECK_WIDTH)

    expect(metrics.layouts[0].top).toBeLessThan(metrics.layouts[1].top)
    expect(metrics.layouts[1].top).toBeLessThan(metrics.layouts[4].top)
  })

  test('可见卡片较少时应自动拉大间距占满剩余宽度', () => {
    const denseMetrics = createDeckLayoutMetrics(5, DEFAULT_DECK_WIDTH)
    const sparseMetrics = createDeckLayoutMetrics(3, DEFAULT_DECK_WIDTH)

    expect(sparseMetrics.layouts[1].left).toBeGreaterThan(denseMetrics.layouts[1].left)
    expect(sparseMetrics.layouts[2].left).toBeGreaterThan(denseMetrics.layouts[2].left)
  })
})
