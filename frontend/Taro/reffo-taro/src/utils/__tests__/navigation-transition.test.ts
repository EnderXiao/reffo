import Taro from '@tarojs/taro'
import {
  initializeNavigationTransitions,
  runWithNavigationTransition,
} from '../navigation-transition'

const mockMatchMedia = (matches = false) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches,
      media: '',
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
}

describe('navigation-transition', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })

    ;(Taro as typeof Taro & {ENV_TYPE?: {WEB: string}; getEnv?: jest.Mock}).ENV_TYPE = {
      WEB: 'WEB',
    }
    ;(Taro as typeof Taro & {getEnv?: jest.Mock}).getEnv = jest.fn(() => 'WEB')

    mockMatchMedia(false)
    window.history.replaceState({}, '', '/')
    window.sessionStorage.clear()
    document.documentElement.className = ''
    document.getElementById('reffo-navigation-transition-style')?.remove()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
    window.sessionStorage.clear()
    document.documentElement.className = ''
    document.getElementById('reffo-navigation-transition-style')?.remove()
  })

  test('runs H5 navigation directly and injects Taro page fade styles', async () => {
    const action = jest.fn(async () => {
      window.history.pushState({}, '', '#/pages/create/index')
      return 'done'
    })

    await expect(runWithNavigationTransition(action, {kind: 'forward'})).resolves.toBe('done')
    expect(action).toHaveBeenCalledTimes(1)

    const style = document.getElementById('reffo-navigation-transition-style')
    expect(style?.textContent).toContain('.taro_router .taro_page')
    expect(style?.textContent).toContain('opacity 280ms cubic-bezier(0.16, 1, 0.3, 1)')
    expect(document.documentElement.className).toBe('')
  })

  test('uses View Transition API when available', async () => {
    const startViewTransition = jest.fn(async callback => {
      await callback()
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: jest.fn(),
      }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: startViewTransition,
    })
    const action = jest.fn(async () => {
      window.history.pushState({}, '', '#/pages/create/index')
      return 'done'
    })

    await expect(runWithNavigationTransition(action, {kind: 'forward'})).resolves.toBeUndefined()
    expect(action).toHaveBeenCalledTimes(1)
    expect(startViewTransition).toHaveBeenCalledTimes(1)
  })

  test('initializes Taro page fade styles once', () => {
    initializeNavigationTransitions()
    initializeNavigationTransitions()

    expect(document.querySelectorAll('#reffo-navigation-transition-style')).toHaveLength(1)
  })

  test('keeps reduced motion controlled by CSS media query', async () => {
    mockMatchMedia(true)
    const action = jest.fn(async () => 'done')

    await expect(runWithNavigationTransition(action, {kind: 'forward'})).resolves.toBe('done')

    expect(action).toHaveBeenCalledTimes(1)
    expect(document.getElementById('reffo-navigation-transition-style')?.textContent).toContain(
      'prefers-reduced-motion: reduce',
    )
  })
})
