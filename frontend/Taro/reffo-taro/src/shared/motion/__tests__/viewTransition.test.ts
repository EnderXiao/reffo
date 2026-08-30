import {afterEach, beforeEach, describe, expect, jest, test} from '@jest/globals'
import {runViewTransition} from '../viewTransition'

describe('runViewTransition', () => {
  let originalTransitionDescriptor: PropertyDescriptor | undefined
  let originalMatchMediaDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    originalTransitionDescriptor = Object.getOwnPropertyDescriptor(document, 'startViewTransition')
    originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    })
  })

  afterEach(() => {
    if (originalTransitionDescriptor) {
      Object.defineProperty(document, 'startViewTransition', originalTransitionDescriptor)
    } else {
      delete (document as Document & {startViewTransition?: unknown}).startViewTransition
    }

    if (originalMatchMediaDescriptor) {
      Object.defineProperty(window, 'matchMedia', originalMatchMediaDescriptor)
    } else {
      delete (window as Window & {matchMedia?: unknown}).matchMedia
    }
  })

  test('没有 View Transition API 时直接更新并清理标记', async () => {
    const update = jest.fn()

    await runViewTransition('forward', update)

    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.reffoViewTransition).toBeUndefined()
  })

  test('消费过渡 promise 拒绝并清理标记', async () => {
    const update = jest.fn()
    const startViewTransition = jest.fn((callback: () => void) => {
      callback()
      return {
        ready: Promise.reject(new Error('ready failed')),
        updateCallbackDone: Promise.reject(new Error('update failed')),
        finished: Promise.reject(new Error('finished failed')),
      }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })

    await runViewTransition('replace', update)

    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.reffoViewTransition).toBeUndefined()
  })

  test('reduced-motion 下跳过 API 但仍更新内容', async () => {
    const update = jest.fn()
    const startViewTransition = jest.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({matches: true})),
    })

    await runViewTransition('back', update)

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.reffoViewTransition).toBeUndefined()
  })

  test('API 同步异常时回退更新并清理标记', async () => {
    const update = jest.fn()
    const startViewTransition = jest.fn(() => {
      throw new Error('start failed')
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })

    await runViewTransition('root', update)

    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.reffoViewTransition).toBeUndefined()
  })
})
