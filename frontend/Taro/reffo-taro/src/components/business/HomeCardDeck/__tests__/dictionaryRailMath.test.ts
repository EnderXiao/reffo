import {
  buildDictionaryRailStops,
  majorIndexFromPosition,
  majorPosition,
  positionFromRatio,
  ratioFromPosition,
  rubberBand,
} from '../dictionaryRailMath'

describe('dictionaryRailMath', () => {
  test('按主刻度和五个细分刻度构建稳定顺序', () => {
    const stops = buildDictionaryRailStops(['A', 'B', 'C'], 5, ['Ai', 'Bi', 'Ci'])

    expect(stops.map(stop => `${stop.kind}:${stop.label}`)).toEqual([
      'major:A',
      'minor:Ai',
      'minor:Ai',
      'minor:Ai',
      'minor:Ai',
      'minor:Ai',
      'major:B',
      'minor:Bi',
      'minor:Bi',
      'minor:Bi',
      'minor:Bi',
      'minor:Bi',
      'major:C',
    ])
    expect(stops.filter(stop => stop.kind === 'major').map(stop => stop.position)).toEqual([0, 6, 12])
  })

  test('细分刻度使用名称的拼音二级标签', () => {
    const stops = buildDictionaryRailStops(['P', 'C'], 5, ['Pi', 'Ci'])

    expect(stops.filter(stop => stop.kind === 'minor').slice(0, 5).map(stop => stop.label)).toEqual(Array(5).fill('Pi'))
  })

  test('位置可以往返映射并解析主索引', () => {
    expect(positionFromRatio(0, 3, 5)).toBe(0)
    expect(positionFromRatio(0.5, 3, 5)).toBe(6)
    expect(positionFromRatio(1, 3, 5)).toBe(12)
    expect(ratioFromPosition(6, 3, 5)).toBe(0.5)
    expect(majorIndexFromPosition(7, 3, 5)).toBe(1)
    expect(majorPosition(2, 5)).toBe(12)
  })

  test('端点提供有限橡皮筋回弹', () => {
    expect(rubberBand(2, 0, 10)).toBe(2)
    expect(rubberBand(12, 0, 10)).toBeCloseTo(10.64)
    expect(rubberBand(-3, 0, 10)).toBeCloseTo(-0.96)
  })
})
