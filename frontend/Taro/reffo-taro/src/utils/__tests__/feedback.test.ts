import Taro from '@tarojs/taro'
import {feedback} from '../feedback'

const originalTaroEnv = process.env.TARO_ENV

describe('feedback H5 custom presentation', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    document.body.innerHTML = ''
    process.env.TARO_ENV = 'h5'
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    process.env.TARO_ENV = originalTaroEnv
  })

  test('renders success toast with design token classes and icon', () => {
    feedback.success('成功提醒成功提醒成功')

    const toast = document.querySelector('.reffo-feedback-toast')
    const icon = document.querySelector('.reffo-feedback-toast__icon') as HTMLImageElement | null
    const text = document.querySelector('.reffo-feedback-toast__text')

    expect(toast?.classList.contains('reffo-feedback-toast--success')).toBe(true)
    expect(icon?.src).toContain('test-file-stub')
    expect(text?.textContent).toBe('成功提醒成功提醒成功')
    expect(Taro.showToast).not.toHaveBeenCalled()
  })

  test('renders error toast with danger styling', () => {
    feedback.error('严重提醒严重提醒严重')

    const toast = document.querySelector('.reffo-feedback-toast')
    const text = document.querySelector('.reffo-feedback-toast__text')

    expect(toast?.classList.contains('reffo-feedback-toast--danger')).toBe(true)
    expect(text?.textContent).toBe('严重提醒严重提醒严重')
  })

  test('renders message toast as info styling', () => {
    feedback.message('一般提醒一般提醒一般')

    const toast = document.querySelector('.reffo-feedback-toast')
    const text = document.querySelector('.reffo-feedback-toast__text')

    expect(toast?.classList.contains('reffo-feedback-toast--info')).toBe(true)
    expect(text?.textContent).toBe('一般提醒一般提醒一般')
  })

  test('renders guide modal and runs confirm callback', () => {
    const onConfirm = jest.fn()

    feedback.modal({
      title: '弹窗标题',
      content: '这是弹窗文案这是弹窗文案这是弹窗文案。',
      cancelText: '次级 Action',
      confirmText: '引导 Action',
      tone: 'guide',
      onConfirm,
    })

    const modal = document.querySelector('.reffo-feedback-modal')
    const buttons = Array.from(document.querySelectorAll('.reffo-feedback-modal__button'))

    expect(modal).not.toBeNull()
    expect(document.querySelector('.reffo-feedback-modal__title')?.textContent).toBe('弹窗标题')
    expect(document.querySelector('.reffo-feedback-modal__content')?.textContent).toBe(
      '这是弹窗文案这是弹窗文案这是弹窗文案。'
    )
    expect(buttons[0].textContent).toBe('次级 Action')
    expect(buttons[1].textContent).toBe('引导 Action')
    expect(buttons[1].classList.contains('reffo-feedback-modal__button--guide')).toBe(true)

    buttons[1].dispatchEvent(new MouseEvent('click', {bubbles: true}))
    jest.advanceTimersByTime(220)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('renders danger modal and runs cancel callback', () => {
    const onCancel = jest.fn()

    feedback.modal({
      title: '弹窗标题',
      content: '这是弹窗文案',
      cancelText: '次级 Action',
      confirmText: '严重 Action',
      tone: 'danger',
      onCancel,
    })

    const buttons = Array.from(document.querySelectorAll('.reffo-feedback-modal__button'))

    expect(buttons[1].classList.contains('reffo-feedback-modal__button--danger')).toBe(true)

    buttons[0].dispatchEvent(new MouseEvent('click', {bubbles: true}))
    jest.advanceTimersByTime(220)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('feedback native fallback', () => {
  beforeEach(() => {
    process.env.TARO_ENV = 'rn'
    document.body.innerHTML = ''
    jest.clearAllMocks()
  })

  afterEach(() => {
    process.env.TARO_ENV = originalTaroEnv
  })

  test('keeps native toast options compatible outside H5', () => {
    feedback.error('错误')

    expect(Taro.showToast).toHaveBeenCalledWith({
      title: '错误',
      icon: 'none',
      duration: 2200,
    })
  })
})
