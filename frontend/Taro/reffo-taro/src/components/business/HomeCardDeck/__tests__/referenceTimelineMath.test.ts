import {
  clampEndpointTargets,
  interpolateIndex,
  rubberBand,
  samplePositions,
  visibleRatio,
} from '../referenceTimelineMath'

describe('referenceTimelineMath', () => {
  test('压缩端点目标并保持首尾覆盖', () => {
    const targets = [-80, -20, 120, 320, 520]
    clampEndpointTargets(targets, 400)

    expect(targets[0]).toBe(0)
    expect(targets[1]).toBeGreaterThanOrEqual(0)
    expect(targets[3]).toBeLessThanOrEqual(400)
    expect(targets[4]).toBe(400)
  })

  test('支持位置与滚动值互换', () => {
    const targets = [0, 100, 220]
    expect(interpolateIndex(targets, 150)).toBeCloseTo(1.4167)
    expect(samplePositions(targets, 1.4167)).toBeCloseTo(150)
  })

  test('提供端点阻力与可视比例', () => {
    expect(rubberBand(20, 14)).toBeCloseTo(6.16)
    expect(visibleRatio(100, 200, 50, 300)).toBe(1)
  })
})
