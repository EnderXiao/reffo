import {getTailExitPose} from '../tailExit.shared'

describe('tail exit motion', () => {
  test('继续沿滑出方向离场，而不是回收到牌堆中段', () => {
    const start = getTailExitPose(0, 180, 0)
    const middle = getTailExitPose(0.54, 180, 0)
    const end = getTailExitPose(1, 180, 0)

    expect(middle.left).toBeGreaterThan(start.left)
    expect(end.left).toBeGreaterThan(middle.left)
    expect(end.opacity).toBe(0)
    expect(end.scale).toBeLessThan(middle.scale)
  })

  test('无显式位移时默认按左侧离场', () => {
    const start = getTailExitPose(0, 0, 0)
    const end = getTailExitPose(1, 0, 0)

    expect(end.left).toBeLessThan(start.left)
    expect(end.opacity).toBe(0)
  })
})
