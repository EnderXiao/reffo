import Taro from '@tarojs/taro'

type ToastIcon = 'success' | 'error' | 'loading' | 'none'

export interface FeedbackToastOptions {
  title: string
  icon?: ToastIcon
  duration?: number
  mask?: boolean
}

export interface FeedbackModalOptions {
  title?: string
  content: string
  confirmText?: string
  cancelText?: string
  showCancel?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastStyleInjected = false
const TOAST_EXIT_DURATION = 260

function canUseCustomH5Toast() {
  const envType = Taro.ENV_TYPE ?? {
    WEB: 'WEB',
  }
  const env = typeof Taro.getEnv === 'function' ? Taro.getEnv() : null

  return (
    typeof document !== 'undefined' &&
    (env === envType.WEB || process.env.TARO_ENV === 'h5')
  )
}

function injectToastStyle() {
  if (toastStyleInjected || typeof document === 'undefined') {
    return
  }

  const style = document.createElement('style')
  style.id = 'reffo-feedback-toast-style'
  style.textContent = `
    .reffo-feedback-toast {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 54px);
      left: 50%;
      z-index: 2147483647;
      max-width: min(312px, calc(100vw - 48px));
      min-height: 44px;
      padding: 11px 16px;
      border: 1px solid rgba(255, 255, 255, 0.42);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 16px 38px rgba(28, 47, 78, 0.18);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      color: #233652;
      display: flex;
      align-items: center;
      gap: 9px;
      box-sizing: border-box;
      transform: translate(-50%, -8px);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 240ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
      will-change: opacity, transform;
    }

    .reffo-feedback-toast--visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    .reffo-feedback-toast--leaving {
      opacity: 0;
      transform: translate(-50%, -6px) scale(0.98);
      transition:
        opacity ${TOAST_EXIT_DURATION}ms cubic-bezier(0.4, 0, 1, 1),
        transform ${TOAST_EXIT_DURATION}ms cubic-bezier(0.4, 0, 1, 1);
    }

    .reffo-feedback-toast__icon {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      flex: 0 0 auto;
      position: relative;
      box-sizing: border-box;
    }

    .reffo-feedback-toast__icon--success {
      background: #1683ff;
    }

    .reffo-feedback-toast__icon--success::after {
      content: "";
      position: absolute;
      left: 5px;
      top: 3px;
      width: 5px;
      height: 8px;
      border-right: 2px solid #ffffff;
      border-bottom: 2px solid #ffffff;
      transform: rotate(42deg);
    }

    .reffo-feedback-toast__icon--error {
      background: #ff3b3b;
    }

    .reffo-feedback-toast__icon--error::before,
    .reffo-feedback-toast__icon--error::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 7px;
      width: 8px;
      height: 2px;
      border-radius: 1px;
      background: #ffffff;
    }

    .reffo-feedback-toast__icon--error::before {
      transform: rotate(45deg);
    }

    .reffo-feedback-toast__icon--error::after {
      transform: rotate(-45deg);
    }

    .reffo-feedback-toast__icon--loading {
      border: 2px solid rgba(22, 131, 255, 0.22);
      border-top-color: #1683ff;
      animation: reffo-feedback-toast-spin 820ms linear infinite;
    }

    .reffo-feedback-toast__text {
      min-width: 0;
      color: #233652;
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
      word-break: break-word;
    }

    @keyframes reffo-feedback-toast-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .reffo-feedback-toast {
        transition: opacity 160ms cubic-bezier(0.16, 1, 0.3, 1);
        transform: translate(-50%, 0);
      }

      .reffo-feedback-toast--leaving {
        transform: translate(-50%, 0);
      }

      .reffo-feedback-toast__icon--loading {
        animation: none;
      }
    }
  `
  document.head.appendChild(style)
  toastStyleInjected = true
}

function getToastElement() {
  injectToastStyle()

  const existingToast = document.querySelector('.reffo-feedback-toast')
  if (existingToast) {
    return existingToast as HTMLDivElement
  }

  const toast = document.createElement('div')
  toast.className = 'reffo-feedback-toast'
  document.body.appendChild(toast)
  return toast
}

function showCustomH5Toast(options: FeedbackToastOptions) {
  const {title, icon = 'none', duration = 2200} = options
  const toast = getToastElement()
  const iconMarkup =
    icon === 'none'
      ? ''
      : `<span class="reffo-feedback-toast__icon reffo-feedback-toast__icon--${icon}"></span>`

  if (toastTimer) {
    clearTimeout(toastTimer)
  }

  toast.innerHTML = `${iconMarkup}<span class="reffo-feedback-toast__text"></span>`
  toast.classList.remove('reffo-feedback-toast--visible', 'reffo-feedback-toast--leaving')
  const textElement = toast.querySelector('.reffo-feedback-toast__text')
  if (textElement) {
    textElement.textContent = title
  }

  requestAnimationFrame(() => {
    toast.classList.add('reffo-feedback-toast--visible')
  })

  toastTimer = setTimeout(() => {
    toast.classList.remove('reffo-feedback-toast--visible')
    toast.classList.add('reffo-feedback-toast--leaving')
    toastTimer = setTimeout(() => {
      toast.remove()
      toastTimer = null
    }, TOAST_EXIT_DURATION)
  }, duration)
}

export const feedback = {
  toast(options: FeedbackToastOptions | string) {
    const normalizedOptions =
      typeof options === 'string' ? {title: options, icon: 'none' as const} : options

    if (canUseCustomH5Toast()) {
      showCustomH5Toast(normalizedOptions)
      return
    }

    const toastOptions: {
      title: string
      icon: 'success' | 'loading' | 'none'
      duration?: number
      mask?: boolean
    } = {
      title: normalizedOptions.title,
      icon: normalizedOptions.icon === 'error' ? 'none' : normalizedOptions.icon || 'none',
    }

    if (normalizedOptions.duration !== undefined) {
      toastOptions.duration = normalizedOptions.duration
    }

    if (normalizedOptions.mask !== undefined) {
      toastOptions.mask = normalizedOptions.mask
    }

    Taro.showToast(toastOptions)
  },

  message(title: string, options?: Omit<FeedbackToastOptions, 'title' | 'icon'>) {
    feedback.toast({
      title,
      icon: 'none',
      ...options,
    })
  },

  success(title: string, options?: Omit<FeedbackToastOptions, 'title' | 'icon'>) {
    feedback.toast({
      title,
      icon: 'success',
      duration: 1500,
      ...options,
    })
  },

  error(title: string, options?: Omit<FeedbackToastOptions, 'title' | 'icon'>) {
    feedback.toast({
      title,
      icon: 'error',
      duration: 2200,
      ...options,
    })
  },

  loading(title: string, options?: {mask?: boolean}) {
    Taro.showLoading({
      title,
      mask: options?.mask,
    })
  },

  hideLoading() {
    Taro.hideLoading()
  },

  modal(options: FeedbackModalOptions) {
    const modalOptions: {
      title: string
      content: string
      confirmText: string
      cancelText?: string
      showCancel?: boolean
      success: (result: {confirm?: boolean; cancel?: boolean}) => void
    } = {
      title: options.title || '提示',
      content: options.content,
      confirmText: options.confirmText || '确定',
      showCancel: options.showCancel,
      success: result => {
        if (result.confirm) {
          options.onConfirm?.()
          return
        }

        if (result.cancel) {
          options.onCancel?.()
        }
      },
    }

    if (options.cancelText !== undefined) {
      modalOptions.cancelText = options.cancelText
    }

    Taro.showModal(modalOptions)
  },
}

export type Feedback = typeof feedback
