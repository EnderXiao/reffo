import Taro from '@tarojs/taro'
import {
  initializeNavigationTransitions,
  runWithNavigationTransition,
  startResultCardReturnTransition,
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
    const startViewTransition = jest.fn(callback => {
      const updateCallbackDone = Promise.resolve().then(callback)
      return {
        ready: Promise.resolve(),
        finished: updateCallbackDone.then(() => undefined),
        updateCallbackDone,
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

  test('treats skipped or timed-out View Transitions as visual fallback', async () => {
    const abortError = new DOMException('Transition was skipped', 'AbortError')
    const timeoutError = new DOMException('Transition timed out', 'TimeoutError')
    const action = jest.fn(async () => 'done')
    const startViewTransition = jest.fn(callback => {
      const actionDone = Promise.resolve().then(callback)
      return {
        ready: Promise.reject(abortError),
        finished: Promise.reject(abortError),
        updateCallbackDone: actionDone.then(() => Promise.reject(timeoutError)),
        skipTransition: jest.fn(),
      }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: startViewTransition,
    })

    await expect(runWithNavigationTransition(action, {kind: 'forward'})).resolves.toBeUndefined()
    expect(action).toHaveBeenCalledTimes(1)
  })

  test('still rejects when navigation action fails', async () => {
    const navigationError = new Error('navigateTo failed')
    const action = jest.fn(async () => {
      throw navigationError
    })
    const startViewTransition = jest.fn(callback => {
      const updateCallbackDone = Promise.resolve().then(callback)
      return {
        ready: Promise.resolve(),
        finished: updateCallbackDone.then(() => undefined),
        updateCallbackDone,
        skipTransition: jest.fn(),
      }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: startViewTransition,
    })

    await expect(runWithNavigationTransition(action, {kind: 'forward'})).rejects.toBe(navigationError)
    expect(action).toHaveBeenCalledTimes(1)
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

  test('starts result card return View Transition and suppresses nested route transition', async () => {
    let finishTransition!: () => void
    const transition = {
      ready: Promise.resolve(),
      finished: new Promise<void>(resolve => {
        finishTransition = resolve
      }),
      updateCallbackDone: Promise.resolve(),
      skipTransition: jest.fn(),
    }
    const startViewTransition = jest.fn(callback => {
      void callback()
      return transition
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: startViewTransition,
    })
    const sourceElement = document.createElement('div')
    document.body.appendChild(sourceElement)
    const nestedAction = jest.fn(async () => 'done')
    const action = jest.fn(() => runWithNavigationTransition(nestedAction, {kind: 'back'}))

    expect(startResultCardReturnTransition(action, sourceElement)).toBe(true)

    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
    expect(nestedAction).toHaveBeenCalledTimes(1)
    expect(sourceElement.style.getPropertyValue('view-transition-name')).toBe('reffo-result-card-return')
    expect(document.documentElement.dataset.reffoCardReturnTransition).toBe('1')
    expect(document.documentElement.dataset.reffoViewTransition).toBeUndefined()

    finishTransition()
    await transition.finished
    await Promise.resolve()

    expect(sourceElement.style.getPropertyValue('view-transition-name')).toBe('')
    expect(document.documentElement.dataset.reffoCardReturnTransition).toBeUndefined()
  })

  test('does not start result card return transition without View Transition support', () => {
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    const action = jest.fn()
    const sourceElement = document.createElement('div')

    expect(startResultCardReturnTransition(action, sourceElement)).toBe(false)
    expect(action).not.toHaveBeenCalled()
  })
})
