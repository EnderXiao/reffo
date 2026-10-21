import React from 'react'
import {act, fireEvent, render} from '@testing-library/react'
import DictionaryRail from '../DictionaryRail.h5'

jest.mock('@tarojs/components', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  const View = ReactModule.forwardRef<HTMLDivElement, any>(({children, ...props}, ref) => (
    <div ref={ref} {...props}>{children}</div>
  ))

  return {
    View,
    Text: ({children, ...props}: any) => <span {...props}>{children}</span>,
  }
})

describe('DictionaryRail H5', () => {
  test('渲染主次刻度并暴露滑块语义', () => {
    const {container} = render(
      <DictionaryRail
        items={[
          {id: 'a', label: 'A'},
          {id: 'b', label: 'B'},
          {id: 'c', label: 'C'},
        ]}
        activeIndex={1}
        onActiveIndexChange={jest.fn()}
      />,
    )
    const rail = container.querySelector('.reffo-dictionary-rail')!

    expect(rail.getAttribute('role')).toBe('slider')
    expect(rail.getAttribute('aria-valuemin')).toBe('1')
    expect(rail.getAttribute('aria-valuemax')).toBe('3')
    expect(rail.getAttribute('aria-valuenow')).toBe('2')
    expect(rail.getAttribute('aria-valuetext')).toBe('B')
    expect(rail.querySelectorAll('[data-rail-stop]')).toHaveLength(13)
  })

  test('方向键切换主刻度', () => {
    const onActiveIndexChange = jest.fn()
    const {container} = render(
      <DictionaryRail
        items={[
          {id: 'a', label: 'A'},
          {id: 'b', label: 'B'},
          {id: 'c', label: 'C'},
        ]}
        activeIndex={0}
        onActiveIndexChange={onActiveIndexChange}
      />,
    )
    const rail = container.querySelector('.reffo-dictionary-rail')!

    fireEvent.keyDown(rail, {key: 'ArrowDown'})
    fireEvent.keyDown(rail, {key: 'End'})

    expect(onActiveIndexChange).toHaveBeenNthCalledWith(1, 1)
    expect(onActiveIndexChange).toHaveBeenNthCalledWith(2, 2)
  })

  test('触摸长按进入细分模式', () => {
    jest.useFakeTimers()
    const {container} = render(
      <DictionaryRail
        items={[
          {id: 'a', label: 'A'},
          {id: 'b', label: 'B'},
          {id: 'c', label: 'C'},
        ]}
        activeIndex={0}
        onActiveIndexChange={jest.fn()}
      />,
    )
    const rail = container.querySelector('.reffo-dictionary-rail')!

    fireEvent.pointerDown(rail, {
      button: 0,
      clientY: 220,
      pointerId: 1,
      pointerType: 'touch',
    })
    act(() => {
      jest.advanceTimersByTime(900)
    })

    expect(rail.classList.contains('reffo-dictionary-rail--fine')).toBe(true)
    jest.useRealTimers()
  })

  test('二级刻度使用名称标签并禁用右键菜单', () => {
    const {container} = render(
      <DictionaryRail
        items={[
          {id: 'pin', label: 'P', secondaryLabel: 'Pi'},
          {id: 'test', label: 'C', secondaryLabel: 'Ci'},
        ]}
        activeIndex={0}
        onActiveIndexChange={jest.fn()}
      />,
    )
    const rail = container.querySelector('.reffo-dictionary-rail')!
    const labels = [...rail.querySelectorAll('[data-rail-label]')].map(element => element.textContent)
    const contextMenu = new Event('contextmenu', {bubbles: true, cancelable: true})

    rail.dispatchEvent(contextMenu)

    expect(labels).toContain('Pi')
    expect(contextMenu.defaultPrevented).toBe(true)
  })
})
