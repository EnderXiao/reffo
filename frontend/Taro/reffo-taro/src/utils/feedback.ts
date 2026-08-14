import Taro from '@tarojs/taro'
import alertIcon from '@/assets/message/alert.svg'
import infoIcon from '@/assets/message/info.svg'
import successIcon from '@/assets/message/success.svg'

type ToastIcon = 'success' | 'error' | 'info' | 'loading' | 'none'
type FeedbackTone = 'danger' | 'guide'
type ToastTone = 'danger' | 'success' | 'info'

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
  tone?: FeedbackTone
  onConfirm?: () => void
  onCancel?: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastStyleInjected = false
let modalRoot: HTMLDivElement | null = null
const TOAST_EXIT_DURATION = 260
const MODAL_EXIT_DURATION = 220

const toastIconMap = {
  success: successIcon,
  error: alertIcon,
  info: infoIcon,
} satisfies Partial<Record<ToastIcon, string>>

function canUseCustomH5Feedback() {
  const envType = Taro.ENV_TYPE ?? {
    WEB: 'WEB',
  }
  const env = typeof Taro.getEnv === 'function' ? Taro.getEnv() : null

  return (
    typeof document !== 'undefined' &&
    (env === envType.WEB || process.env.TARO_ENV === 'h5')
  )
}

function requestFrame(callback: () => void) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
    return
  }

  setTimeout(callback, 0)
}

function getToastTone(icon: ToastIcon | undefined): ToastTone {
  if (icon === 'success') {
    return 'success'
  }

  if (icon === 'error') {
    return 'danger'
  }

  return 'info'
}

function injectToastStyle() {
  if (toastStyleInjected || typeof document === 'undefined') {
    return
  }

  const style = document.createElement('style')
  style.id = 'reffo-feedback-style'
  style.textContent = `
    .reffo-feedback-toast {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 20px);
      left: 50%;
      z-index: 2147483647;
      width: min(335px, calc(100vw - 28px));
      min-height: 48px;
      padding: 14px 18px;
      border-radius: 24px;
      border: 0;
      display: flex;
      align-items: center;
      gap: 18px;
      box-sizing: border-box;
      transform: translate(-50%, -8px);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 240ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
      will-change: opacity, transform;
    }

    .reffo-feedback-toast--success {
      background: #e7f9ef;
    }

    .reffo-feedback-toast--danger {
      background: #fde5ef;
    }

    .reffo-feedback-toast--info {
      background: #f4f4f5;
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
      width: 20px;
      height: 20px;
      flex: 0 0 auto;
      display: block;
    }

    .reffo-feedback-toast__spinner {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid rgba(0, 0, 0, 0.14);
      border-top-color: #111111;
      box-sizing: border-box;
      animation: reffo-feedback-toast-spin 820ms linear infinite;
      flex: 0 0 auto;
    }

    .reffo-feedback-toast__text {
      min-width: 0;
      color: #222831;
      font-size: 17px;
      line-height: 22px;
      font-weight: 700;
      word-break: break-word;
    }

    .reffo-feedback-toast--success .reffo-feedback-toast__text {
      color: #16c463;
    }

    .reffo-feedback-toast--danger .reffo-feedback-toast__text {
      color: #ff383c;
    }

    .reffo-feedback-modal-layer {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 22px 12px;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.18);
      opacity: 0;
      pointer-events: none;
      transition: opacity 180ms ease-out;
    }

    .reffo-feedback-modal-layer--visible {
      opacity: 1;
      pointer-events: auto;
    }

    .reffo-feedback-modal-layer--leaving {
      opacity: 0;
      transition: opacity ${MODAL_EXIT_DURATION}ms ease-in;
    }

    .reffo-feedback-modal {
      width: min(343px, calc(100vw - 24px));
      min-height: 204px;
      padding: 22px 17px 12px;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
      box-sizing: border-box;
      transform: translateY(10px) scale(0.98);
      transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .reffo-feedback-modal-layer--visible .reffo-feedback-modal {
      transform: translateY(0) scale(1);
    }

    .reffo-feedback-modal__title {
      margin: 0;
      color: #202833;
      font-size: 20px;
      line-height: 28px;
      font-weight: 800;
      letter-spacing: 0;
    }

    .reffo-feedback-modal__content {
      margin-top: 19px;
      min-height: 72px;
      color: #2f343b;
      font-size: 16px;
      line-height: 24px;
      font-weight: 500;
      letter-spacing: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .reffo-feedback-modal__actions {
      margin-top: 12px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
    }

    .reffo-feedback-modal__actions--single {
      grid-template-columns: 1fr;
      justify-items: stretch;
    }

    .reffo-feedback-modal__button {
      height: 40px;
      border: 0;
      border-radius: 20px;
      padding: 0 16px;
      color: #000000;
      font-size: 14px;
      line-height: 40px;
      font-weight: 500;
      text-align: center;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .reffo-feedback-modal__button:active {
      transform: scale(0.98);
    }

    .reffo-feedback-modal__button--secondary {
      background: #d1d1d6;
    }

    .reffo-feedback-modal__button--danger {
      background: #f7145f;
    }

    .reffo-feedback-modal__button--guide {
      background: #17c964;
    }

    @keyframes reffo-feedback-toast-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .reffo-feedback-toast,
      .reffo-feedback-toast--leaving {
        transition: opacity 160ms ease-out;
        transform: translate(-50%, 0);
      }

      .reffo-feedback-modal-layer,
      .reffo-feedback-modal-layer--leaving {
        transition: opacity 160ms ease-out;
      }

      .reffo-feedback-modal {
        transition: opacity 160ms ease-out;
        transform: none;
      }

      .reffo-feedback-toast__spinner {
        animation: none;
      }
    }
  `
  document.head.appendChild(style)
  toastStyleInjected = true
}

function getToastElement(tone: ToastTone) {
  injectToastStyle()

  const existingToast = document.querySelector('.reffo-feedback-toast')
  if (existingToast) {
    existingToast.className = `reffo-feedback-toast reffo-feedback-toast--${tone}`
    return existingToast as HTMLDivElement
  }

  const toast = document.createElement('div')
  toast.className = `reffo-feedback-toast reffo-feedback-toast--${tone}`
  document.body.appendChild(toast)
  return toast
}

function buildToastIcon(icon: ToastIcon) {
  if (icon === 'none') {
    return null
  }

  if (icon === 'loading') {
    const spinner = document.createElement('span')
    spinner.className = 'reffo-feedback-toast__spinner'
    return spinner
  }

  const iconSrc = toastIconMap[icon]
  if (!iconSrc) {
    return null
  }

  const image = document.createElement('img')
  image.className = 'reffo-feedback-toast__icon'
  image.src = iconSrc
  image.alt = ''
  image.setAttribute('aria-hidden', 'true')
  return image
}

function showCustomH5Toast(options: FeedbackToastOptions) {
  const {title, icon = 'info', duration = 2200} = options
  const tone = getToastTone(icon)
  const toast = getToastElement(tone)
  const iconElement = buildToastIcon(icon)
  const textElement = document.createElement('span')

  if (toastTimer) {
    clearTimeout(toastTimer)
  }

  toast.replaceChildren()
  toast.classList.remove('reffo-feedback-toast--visible', 'reffo-feedback-toast--leaving')
  textElement.className = 'reffo-feedback-toast__text'
  textElement.textContent = title

  if (iconElement) {
    toast.appendChild(iconElement)
  }
  toast.appendChild(textElement)

  requestFrame(() => {
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

function closeCustomModal(callback?: () => void) {
  if (!modalRoot) {
    callback?.()
    return
  }

  const currentRoot = modalRoot
  currentRoot.classList.remove('reffo-feedback-modal-layer--visible')
  currentRoot.classList.add('reffo-feedback-modal-layer--leaving')
  modalRoot = null

  setTimeout(() => {
    currentRoot.remove()
    callback?.()
  }, MODAL_EXIT_DURATION)
}

function showCustomH5Modal(options: FeedbackModalOptions) {
  injectToastStyle()
  closeCustomModal()

  const showCancel = options.showCancel !== false
  const tone = options.tone || 'guide'
  const layer = document.createElement('div')
  const modal = document.createElement('section')
  const title = document.createElement('h2')
  const content = document.createElement('div')
  const actions = document.createElement('div')
  const confirmButton = document.createElement('button')

  layer.className = 'reffo-feedback-modal-layer'
  layer.setAttribute('role', 'presentation')
  modal.className = 'reffo-feedback-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  title.className = 'reffo-feedback-modal__title'
  title.textContent = options.title || '提示'
  content.className = 'reffo-feedback-modal__content'
  content.textContent = options.content
  actions.className = showCancel
    ? 'reffo-feedback-modal__actions'
    : 'reffo-feedback-modal__actions reffo-feedback-modal__actions--single'
  confirmButton.className = `reffo-feedback-modal__button reffo-feedback-modal__button--${tone}`
  confirmButton.type = 'button'
  confirmButton.textContent = options.confirmText || '确定'
  confirmButton.addEventListener('click', () => {
    closeCustomModal(options.onConfirm)
  })

  if (showCancel) {
    const cancelButton = document.createElement('button')
    cancelButton.className = 'reffo-feedback-modal__button reffo-feedback-modal__button--secondary'
    cancelButton.type = 'button'
    cancelButton.textContent = options.cancelText || '取消'
    cancelButton.addEventListener('click', () => {
      closeCustomModal(options.onCancel)
    })
    actions.appendChild(cancelButton)
  }

  actions.appendChild(confirmButton)
  modal.append(title, content, actions)
  layer.appendChild(modal)
  document.body.appendChild(layer)
  modalRoot = layer

  requestFrame(() => {
    layer.classList.add('reffo-feedback-modal-layer--visible')
  })
}

export const feedback = {
  toast(options: FeedbackToastOptions | string) {
    const normalizedOptions =
      typeof options === 'string' ? {title: options, icon: 'info' as const} : options

    if (canUseCustomH5Feedback()) {
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
      icon:
        normalizedOptions.icon === 'error' || normalizedOptions.icon === 'info'
          ? 'none'
          : normalizedOptions.icon || 'none',
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
      icon: 'info',
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
    if (canUseCustomH5Feedback()) {
      showCustomH5Modal(options)
      return
    }

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
      cancelText: options.cancelText,
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

    Taro.showModal(modalOptions)
  },
}

export type Feedback = typeof feedback
