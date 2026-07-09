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

let styleInjected = false
let shouldSuppressNextTransition = false

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

    html[data-reffo-skip-route-transition] .taro_router .taro_page {
      transition: none !important;
    }

    html[data-reffo-view-transition]::view-transition-group(root) {
      animation-duration: ${VIEW_TRANSITION_DURATION}ms;
      animation-timing-function: ${ROUTE_FADE_EASING};
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

    @media (prefers-reduced-motion: reduce) {
      .taro_router .taro_page {
        transition: none !important;
      }

      html[data-reffo-view-transition]::view-transition-old(root),
      html[data-reffo-view-transition]::view-transition-new(root) {
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

function waitForNextPaint() {
  if (typeof window === 'undefined') {
    return Promise.resolve()
  }

  return new Promise<void>(resolve => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
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
      await action()
      await waitForNextPaint()
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

  root.dataset.reffoViewTransition = options.kind

  try {
    const transition = startViewTransition?.(async () => {
      actionStarted = true
      await action()
      await waitForNextPaint()
    })

    if (!transition) {
      return action()
    }

    await transition.finished
    return undefined
  } catch (error) {
    if (actionStarted) {
      throw error
    }

    return action()
  } finally {
    delete root.dataset.reffoViewTransition
  }
}
