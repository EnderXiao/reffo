import Taro from '@tarojs/taro'

type NavigationTransitionKind = 'forward' | 'back' | 'replace' | 'root'

interface NavigationTransitionOptions {
  kind: NavigationTransitionKind
}

type NavigationAction = () => Promise<unknown>
type ViewTransitionUpdateCallback = () => Promise<void> | void

interface ViewTransitionLike {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition: () => void
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: ViewTransitionUpdateCallback) => ViewTransitionLike
}

const NAVIGATION_STYLE_ID = 'reffo-navigation-transition-style'
const ROUTE_FADE_DURATION = 280
const ROUTE_FADE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const VIEW_TRANSITION_DURATION = 420
const RESULT_CARD_RETURN_DURATION = 860
const RESULT_CARD_RETURN_TRANSITION_NAME = 'reffo-result-card-return'
const RESULT_CARD_RETURN_TARGET_SELECTOR = '.reffo-home__return-card-stage--view-transition'

let styleInjected = false
let shouldSuppressNextTransition = false
let activeRouteTransition: ViewTransitionLike | undefined

function getH5EnvType() {
  return Taro.ENV_TYPE ?? {
    WEB: 'WEB',
  }
}

function isH5NavigationEnvironment() {
  const envType = getH5EnvType()
  const env = typeof Taro.getEnv === 'function' ? Taro.getEnv() : null
  const isH5 = env === envType.WEB || process.env.TARO_ENV === 'h5'

  if (!isH5 || typeof document === 'undefined') {
    return false
  }

  return true
}

function injectNavigationTransitionStyle() {
  if (typeof document === 'undefined') {
    return
  }

  if (styleInjected && document.getElementById(NAVIGATION_STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = NAVIGATION_STYLE_ID
  style.textContent = `
    html,
    body,
    #app,
    .taro_router {
      background: #f8f9fb;
    }

    .taro_router > div {
      width: 100%;
      height: 100%;
    }

    .taro_router .taro_page {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: #f8f9fb;
      opacity: 0;
      transform: none !important;
      transition: opacity ${ROUTE_FADE_DURATION}ms ${ROUTE_FADE_EASING} !important;
      z-index: 0;
      will-change: opacity;
    }

    .taro_router .taro_page.taro_page_show {
      opacity: 1;
      transform: none !important;
      z-index: 1;
    }

    .taro_router .taro_page.taro_page_show.taro_page_stationed {
      opacity: 1;
      transform: none !important;
    }

    .taro_router .taro_page.taro_page_shade {
      display: block !important;
      opacity: 1;
      pointer-events: none;
      z-index: 0;
    }

    html[data-reffo-view-transition] .taro_router .taro_page {
      transition: none !important;
    }

    html[data-reffo-view-transition] .taro_router .taro_page:not(.taro_page_show) *,
    html[data-reffo-view-transition] .taro_router .taro_page.taro_page_shade *,
    html[data-reffo-card-return-transition] .taro_router .taro_page:not(.taro_page_show) *,
    html[data-reffo-card-return-transition] .taro_router .taro_page.taro_page_shade * {
      view-transition-name: none !important;
    }

    html[data-reffo-skip-route-transition] .taro_router .taro_page {
      transition: none !important;
    }

    html[data-reffo-view-transition]::view-transition-group(root) {
      animation-duration: ${VIEW_TRANSITION_DURATION}ms;
      animation-timing-function: ${ROUTE_FADE_EASING};
    }

    html[data-reffo-card-return-transition]::view-transition-old(root) {
      opacity: 0;
      animation: none;
      mix-blend-mode: normal;
    }

    html[data-reffo-card-return-transition]::view-transition-new(root) {
      opacity: 1;
      animation: none;
      mix-blend-mode: normal;
    }

    html[data-reffo-card-return-transition]::view-transition-group(${RESULT_CARD_RETURN_TRANSITION_NAME}) {
      overflow: clip;
      animation-duration: ${RESULT_CARD_RETURN_DURATION}ms;
      animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
    }

    html[data-reffo-card-return-transition]::view-transition-old(${RESULT_CARD_RETURN_TRANSITION_NAME}),
    html[data-reffo-card-return-transition]::view-transition-new(${RESULT_CARD_RETURN_TRANSITION_NAME}) {
      height: 100%;
      mix-blend-mode: normal;
      animation-duration: ${RESULT_CARD_RETURN_DURATION}ms;
      animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
    }

    html[data-reffo-card-return-transition]::view-transition-old(${RESULT_CARD_RETURN_TRANSITION_NAME}) {
      animation-name: reffo-result-card-return-old;
    }

    html[data-reffo-card-return-transition]::view-transition-new(${RESULT_CARD_RETURN_TRANSITION_NAME}) {
      animation-name: reffo-result-card-return-new;
    }

    html[data-reffo-view-transition]::view-transition-old(root),
    html[data-reffo-view-transition]::view-transition-new(root) {
      height: 100%;
      mix-blend-mode: normal;
      animation-duration: ${VIEW_TRANSITION_DURATION}ms;
      animation-timing-function: ${ROUTE_FADE_EASING};
    }

    html[data-reffo-view-transition="forward"]::view-transition-old(root),
    html[data-reffo-view-transition="replace"]::view-transition-old(root),
    html[data-reffo-view-transition="root"]::view-transition-old(root) {
      animation-name: reffo-route-old-forward;
    }

    html[data-reffo-view-transition="forward"]::view-transition-new(root),
    html[data-reffo-view-transition="replace"]::view-transition-new(root),
    html[data-reffo-view-transition="root"]::view-transition-new(root) {
      animation-name: reffo-route-new-forward;
    }

    html[data-reffo-view-transition="back"]::view-transition-old(root) {
      animation-name: reffo-route-old-back;
    }

    html[data-reffo-view-transition="back"]::view-transition-new(root) {
      animation-name: reffo-route-new-back;
    }

    @keyframes reffo-route-old-forward {
      from {
        opacity: 1;
        transform: scale(1) translate3d(0, 0, 0);
      }

      to {
        opacity: 0;
        transform: scale(1.006) translate3d(0, -4px, 0);
      }
    }

    @keyframes reffo-route-new-forward {
      from {
        opacity: 0;
        transform: scale(0.99) translate3d(0, 12px, 0);
      }

      to {
        opacity: 1;
        transform: scale(1) translate3d(0, 0, 0);
      }
    }

    @keyframes reffo-route-old-back {
      from {
        opacity: 1;
        transform: scale(1) translate3d(0, 0, 0);
      }

      to {
        opacity: 0;
        transform: scale(0.992) translate3d(0, 10px, 0);
      }
    }

    @keyframes reffo-route-new-back {
      from {
        opacity: 0;
        transform: scale(1.006) translate3d(0, -8px, 0);
      }

      to {
        opacity: 1;
        transform: scale(1) translate3d(0, 0, 0);
      }
    }

    @keyframes reffo-result-card-return-old {
      0% {
        opacity: 1;
        filter: none;
      }

      58% {
        opacity: 0.74;
        filter: none;
      }

      100% {
        opacity: 0;
        filter: blur(5PX);
      }
    }

    @keyframes reffo-result-card-return-new {
      0%,
      30% {
        opacity: 0;
        filter: blur(4PX);
      }

      64% {
        opacity: 0.82;
        filter: blur(0);
      }

      100% {
        opacity: 1;
        filter: blur(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .taro_router .taro_page {
        transition: none !important;
      }

      html[data-reffo-view-transition]::view-transition-old(root),
      html[data-reffo-view-transition]::view-transition-new(root),
      html[data-reffo-card-return-transition]::view-transition-old(root),
      html[data-reffo-card-return-transition]::view-transition-new(root),
      html[data-reffo-card-return-transition]::view-transition-old(${RESULT_CARD_RETURN_TRANSITION_NAME}),
      html[data-reffo-card-return-transition]::view-transition-new(${RESULT_CARD_RETURN_TRANSITION_NAME}) {
        animation: none !important;
      }
    }
  `

  document.head.appendChild(style)
  styleInjected = true
}

function supportsViewTransition() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return false
  }

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return false
  }

  return typeof (document as DocumentWithViewTransition).startViewTransition === 'function'
}

async function navigateUntilPageVisible(action: NavigationAction, onTimeout?: () => void) {
  const router = document.querySelector('.taro_router')
  const previousUrl = window.location.href
  const previousPages = Taro.getCurrentPages()
  const previousPath = (previousPages[previousPages.length - 1] as {path?: string} | undefined)?.path
  await action()
  if (!router || window.location.href === previousUrl) return

  // Taro 的 Promise 只代表 history 更新，页面 chunk、React 挂载和 show 类名仍是异步的。
  // View Transition 回调中不能等待绘制帧：浏览器此时暂停了绘制。
  await new Promise<void>(resolve => {
    const cleanup = () => {
      observer.disconnect()
      window.clearTimeout(timer)
      resolve()
    }
    const check = () => {
      const pages = Taro.getCurrentPages()
      const current = pages[pages.length - 1] as {path?: string} | undefined
      if (current?.path === previousPath) return
      const page = current?.path ? document.getElementById(current.path) : null
      if (page?.classList.contains('taro_page_show')
        && !page.classList.contains('taro_page_shade')) cleanup()
    }
    const observer = new MutationObserver(check)
    // 慢网或路由失败时及时恢复绘制，后续页面继续由 Taro 正常加载。
    const timer = window.setTimeout(() => {
      onTimeout?.()
      cleanup()
    }, 1200)
    observer.observe(router, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']})
    check()
  })
}

// 卡片返回转场必须等首页返回卡片挂载后再放行新状态捕获，否则共享元素动效
// 会退化成旧页面原地淡出。View Transition 回调中绘制被暂停，只能用
// MutationObserver 等待；超时立即跳过转场，避免页面长时间冻结在旧快照上。
function waitForElement(selector: string, onTimeout?: () => void) {
  return new Promise<void>(resolve => {
    const cleanup = () => {
      observer.disconnect()
      window.clearTimeout(timer)
      resolve()
    }
    const check = () => {
      if (document.querySelector(selector)) cleanup()
    }
    const observer = new MutationObserver(check)
    const timer = window.setTimeout(() => {
      onTimeout?.()
      cleanup()
    }, 1200)
    observer.observe(document.documentElement, {childList: true, subtree: true})
    check()
  })
}

export function initializeNavigationTransitions() {
  if (!isH5NavigationEnvironment()) {
    return
  }

  injectNavigationTransitionStyle()
}

export function suppressNextNavigationTransition() {
  shouldSuppressNextTransition = true
}

export async function runWithNavigationTransition(
  action: NavigationAction,
  options: NavigationTransitionOptions,
) {
  if (!isH5NavigationEnvironment()) {
    return action()
  }

  injectNavigationTransitionStyle()

  if (shouldSuppressNextTransition) {
    shouldSuppressNextTransition = false
    document.documentElement.dataset.reffoSkipRouteTransition = '1'

    try {
      await navigateUntilPageVisible(action)
      return undefined
    } finally {
      delete document.documentElement.dataset.reffoSkipRouteTransition
    }
  }

  if (!supportsViewTransition()) {
    return action()
  }

  const root = document.documentElement
  const startViewTransition = (document as DocumentWithViewTransition).startViewTransition
  let actionStarted = false
  let actionPromise: Promise<unknown> | null = null

  activeRouteTransition?.skipTransition()
  root.dataset.reffoViewTransition = options.kind
  let transition: ViewTransitionLike | undefined

  try {
    transition = startViewTransition?.call(document, async () => {
      actionStarted = true
      actionPromise = navigateUntilPageVisible(action, () => transition?.skipTransition())
      await actionPromise
    })
    activeRouteTransition = transition

    if (!transition) {
      return action()
    }

    const ready = transition.ready.catch(() => undefined)
    const updateCallbackDone = transition.updateCallbackDone.catch(() => undefined)
    void transition.finished.catch(() => undefined).finally(() => {
      if (activeRouteTransition === transition) {
        activeRouteTransition = undefined
        delete root.dataset.reffoViewTransition
      }
    })

    void ready
    await updateCallbackDone

    if (!actionStarted) {
      return action()
    }

    await actionPromise
    return undefined
  } catch (error) {
    if (actionStarted) {
      if (actionPromise) {
        await actionPromise
        return undefined
      }

      throw error
    }

    return action()
  } finally {
    if (!transition) delete root.dataset.reffoViewTransition
  }
}

export function startResultCardReturnTransition(
  action: NavigationAction,
  sourceElement: HTMLElement | null,
) {
  if (!isH5NavigationEnvironment() || !sourceElement || !supportsViewTransition()) {
    return false
  }

  injectNavigationTransitionStyle()

  const root = document.documentElement
  const startViewTransition = (document as DocumentWithViewTransition).startViewTransition
  const previousViewTransitionName = sourceElement.style.getPropertyValue('view-transition-name')
  let actionStarted = false

  if (!startViewTransition) {
    return false
  }

  root.dataset.reffoCardReturnTransition = '1'
  sourceElement.style.setProperty('view-transition-name', RESULT_CARD_RETURN_TRANSITION_NAME)

  try {
    const transition = startViewTransition.call(document, async () => {
      actionStarted = true
      shouldSuppressNextTransition = true
      await action()
      await waitForElement(RESULT_CARD_RETURN_TARGET_SELECTOR, () => transition?.skipTransition())
    })

    void transition.ready.catch(() => undefined)
    void transition.updateCallbackDone.catch(() => undefined)

    transition.finished
      .catch(error => {
        console.warn('结果页返回首页 View Transition 失败:', error)
      })
      .finally(() => {
        if (previousViewTransitionName) {
          sourceElement.style.setProperty('view-transition-name', previousViewTransitionName)
        } else {
          sourceElement.style.removeProperty('view-transition-name')
        }
        delete root.dataset.reffoCardReturnTransition
        shouldSuppressNextTransition = false
      })

    return true
  } catch (error) {
    if (previousViewTransitionName) {
      sourceElement.style.setProperty('view-transition-name', previousViewTransitionName)
    } else {
      sourceElement.style.removeProperty('view-transition-name')
    }
    delete root.dataset.reffoCardReturnTransition
    shouldSuppressNextTransition = false

    if (actionStarted) {
      console.warn('结果页返回首页 View Transition 中断:', error)
      return true
    }

    return false
  }
}
