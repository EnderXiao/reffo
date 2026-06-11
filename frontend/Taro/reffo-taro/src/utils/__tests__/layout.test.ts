import {beforeAll, describe, expect, jest, test} from '@jest/globals'

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getSystemInfoSync: () => ({}),
  },
}))

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  StatusBar: {currentHeight: 24},
  useWindowDimensions: () => ({width: 393, height: 852}),
}))

let layout: typeof import('../layout')

beforeAll(async () => {
  layout = await import('../layout')
})

describe('Layout Utils', () => {
  test('resolveStatusBarHeight should clamp invalid values', () => {
    expect(layout.resolveStatusBarHeight(undefined)).toBe(0)
    expect(layout.resolveStatusBarHeight(-12)).toBe(0)
    expect(layout.resolveStatusBarHeight(24)).toBe(24)
  })

  test('resolveBottomInset should fall back safely', () => {
    expect(layout.resolveBottomInset(undefined, 780, 760)).toBe(0)
    expect(layout.resolveBottomInset(800, 780, 760)).toBe(20)
    expect(layout.resolveBottomInset(800, undefined, 780)).toBe(20)
  })

  test('getBottomInset should read safe area bottom', () => {
    expect(
      layout.getBottomInset({
        screenHeight: 800,
        windowHeight: 780,
        safeArea: {bottom: 788},
      }),
    ).toBe(12)
  })

  test('getFloatingTopInset should account for status bar height', () => {
    expect(
      layout.getFloatingTopInset(layout.DEFAULT_FLOATING_TOP_OFFSET, 0, 10),
    ).toBe(layout.DEFAULT_FLOATING_TOP_OFFSET)
    expect(
      layout.getFloatingTopInset(layout.DEFAULT_FLOATING_TOP_OFFSET, 26, 10),
    ).toBe(36)
  })

  test('getTopNavigationHeight should include status bar and nav bar', () => {
    expect(layout.getTopNavigationHeight(24, layout.DEFAULT_NAV_BAR_HEIGHT)).toBe(78)
  })

  test('getPageBottomPadding should include bottom inset', () => {
    expect(
      layout.getPageBottomPadding(layout.DEFAULT_PAGE_BOTTOM_PADDING, 16),
    ).toBe(46)
  })

  test('page width helpers should clamp to max width and compute side inset', () => {
    expect(layout.getPageContentWidth(360, layout.DEFAULT_PAGE_MAX_WIDTH)).toBe(360)
    expect(layout.getPageContentWidth(430, layout.DEFAULT_PAGE_MAX_WIDTH)).toBe(
      layout.DEFAULT_PAGE_MAX_WIDTH,
    )
    expect(layout.getPageSideInset(430, layout.DEFAULT_PAGE_MAX_WIDTH)).toBe(18.5)
  })
})
