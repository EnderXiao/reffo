import {describe, expect, test} from '@jest/globals'
import {appendRouteParams, readRouteBoolean, readRouteNumber, readRouteString} from '../routeParams'

describe('routeParams', () => {
  const params = {
    id: 'history-1',
    enabled: 'true',
    legacyEnabled: '1',
    count: '42',
    invalid: 'nope',
  }

  test('读取字符串、布尔值和数字参数', () => {
    expect(readRouteString(params, 'id')).toBe('history-1')
    expect(readRouteBoolean(params, 'enabled')).toBe(true)
    expect(readRouteBoolean(params, 'legacyEnabled')).toBe(true)
    expect(readRouteNumber(params, 'count')).toBe(42)
    expect(readRouteNumber(params, 'invalid')).toBeNull()
  })

  test('忽略空值并正确追加、编码查询参数', () => {
    expect(appendRouteParams('/pages/result/index', {
      id: '简历 1',
      fromCard: true,
      missing: undefined,
    })).toBe('/pages/result/index?id=%E7%AE%80%E5%8E%86%201&fromCard=true')
    expect(appendRouteParams('/pages/result/index?existing=1', {id: 2}))
      .toBe('/pages/result/index?existing=1&id=2')
  })
})
