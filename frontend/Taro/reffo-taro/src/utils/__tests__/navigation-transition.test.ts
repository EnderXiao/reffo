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
    document.body.innerHTML = ''
    Object.defineProperty(document, 'startViewTransition', {configurable: true, writable: true, value: undefined})
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

  test.each(['forward', 'back'] as const)('waits for the %s page to be visible, not just the URL', async kind => {
    document.body.innerHTML = '<div class="taro_router"><div id="old" class="taro_page taro_page_show"></div></div>'
    let pages = [{path: 'old'}]
    jest.spyOn(Taro, 'getCurrentPages').mockImplementation(() => pages as ReturnType<typeof Taro.getCurrentPages>)
    let finish!: () => void
    let updated = false
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: jest.fn(callback => {
        const updateCallbackDone = Promise.resolve().then(callback).then(() => { updated = true })
        return {
          ready: updateCallbackDone,
          updateCallbackDone,
          finished: new Promise<void>(resolve => { finish = resolve }),
          skipTransition: jest.fn(),
        }
      }),
    })
    const target = document.createElement('div')
    target.id = 'target'
    target.className = 'taro_page taro_page_shade'
    // 返回时目标节点已经缓存；前进时目标节点仍在异步加载。
    if (kind === 'back') document.querySelector('.taro_router')?.appendChild(target)
    const navigation = runWithNavigationTransition(async () => {
      window.history.pushState({}, '', '#/pages/target/index')
    }, {kind})
    await jest.advanceTimersByTimeAsync(100)
    expect(updated).toBe(false)
    pages = [{path: 'target'}]
    document.querySelector('.taro_router')?.appendChild(target)
    await jest.advanceTimersByTimeAsync(30)
    expect(updated).toBe(false)
    target.className = 'taro_page taro_page_show'
    await navigation
    expect(updated).toBe(true)
    // 导航就绪即可解除业务按钮的 loading，样式保留至动画真正结束。
    expect(document.documentElement.dataset.reffoViewTransition).toBe(kind)
    finish()
    await jest.advanceTimersByTimeAsync(0)
    expect(document.documentElement.dataset.reffoViewTransition).toBeUndefined()
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  test('releases the snapshot on slow page loading without repeating navigation', async () => {
    document.body.innerHTML = '<div class="taro_router"></div>'
    jest.spyOn(Taro, 'getCurrentPages').mockReturnValue([])
    const skipTransition = jest.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: jest.fn(callback => {
        const updateCallbackDone = Promise.resolve().then(callback)
        return {ready: updateCallbackDone, updateCallbackDone, finished: updateCallbackDone, skipTransition}
      }),
    })
    const action = jest.fn(async () => { window.history.pushState({}, '', '#/pages/slow/index') })
    const navigation = runWithNavigationTransition(action, {kind: 'forward'})
    await jest.advanceTimersByTimeAsync(1200)
    await navigation
    expect(skipTransition).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
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
    const nestedAction = jest.fn(async () => {
      const target = document.createElement('div')
      target.className = 'reffo-home__return-card-stage--view-transition'
      document.body.appendChild(target)
      return 'done'
    })
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

  test('waits for the home return card before finishing the update callback', async () => {
    let updateResolved = false
    const transition = {
      ready: Promise.resolve(),
      finished: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      skipTransition: jest.fn(),
    }
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: jest.fn(callback => {
        void Promise.resolve().then(callback).then(() => {
          updateResolved = true
        })
        return transition
      }),
    })
    const sourceElement = document.createElement('div')
    document.body.appendChild(sourceElement)
    const action = jest.fn(async () => 'done')

    expect(startResultCardReturnTransition(action, sourceElement)).toBe(true)

    await jest.advanceTimersByTimeAsync(30)
    expect(updateResolved).toBe(false)
    expect(transition.skipTransition).not.toHaveBeenCalled()

    const target = document.createElement('div')
    target.className = 'reffo-home__return-card-stage--view-transition'
    document.body.appendChild(target)

    await jest.advanceTimersByTimeAsync(0)
    expect(updateResolved).toBe(true)
    expect(transition.skipTransition).not.toHaveBeenCalled()
  })

  test('skips the card return transition when the home return card never mounts', async () => {
    const skipTransition = jest.fn()
    const transition = {
      ready: Promise.resolve(),
      finished: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      skipTransition,
    }
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: jest.fn(callback => {
        void Promise.resolve().then(callback)
        return transition
      }),
    })
    const sourceElement = document.createElement('div')
    document.body.appendChild(sourceElement)
    const action = jest.fn(async () => 'done')

    expect(startResultCardReturnTransition(action, sourceElement)).toBe(true)

    await jest.advanceTimersByTimeAsync(1200)
    expect(skipTransition).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
  })

  test('strips view transition names from hidden pages during card return transition', () => {
    initializeNavigationTransitions()

    const style = document.getElementById('reffo-navigation-transition-style')
    expect(style?.textContent).toContain(
      'html[data-reffo-card-return-transition] .taro_router .taro_page:not(.taro_page_show) *',
    )
    expect(style?.textContent).toContain(
      'html[data-reffo-card-return-transition] .taro_router .taro_page.taro_page_shade *',
    )
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
