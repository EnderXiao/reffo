import Taro from '@tarojs/taro'

type NavigationTransitionKind = 'forward' | 'back' | 'replace' | 'root'

interface NavigationTransitionOptions {
  kind: NavigationTransitionKind
}

type NavigationAction = () => Promise<unknown>

const NAVIGATION_STYLE_ID = 'reffo-navigation-transition-style'
const ROUTE_FADE_DURATION = 280
const ROUTE_FADE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'

let styleInjected = false

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

    @media (prefers-reduced-motion: reduce) {
      .taro_router .taro_page {
        transition: none !important;
      }
    }
  `

  document.head.appendChild(style)
  styleInjected = true
}

export function initializeNavigationTransitions() {
  if (!isH5NavigationEnvironment()) {
    return
  }

  injectNavigationTransitionStyle()
}

export async function runWithNavigationTransition(
  action: NavigationAction,
  _options: NavigationTransitionOptions,
) {
  if (!isH5NavigationEnvironment()) {
    return action()
  }

  injectNavigationTransitionStyle()

  return action()
}
