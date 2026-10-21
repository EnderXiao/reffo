import React from 'react'
import {act, fireEvent, render} from '@testing-library/react'
import ReferenceTimeline from '../ReferenceTimeline.h5'
import {REFERENCE_TIMELINE_ITEMS} from '../referenceTimelineData'

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
      <ReferenceTimeline
        items={REFERENCE_TIMELINE_ITEMS.slice(0, 3)}
        activeIndex={1}
        onActiveIndexChange={jest.fn()}
      />,
    )
    const rail = container.querySelector('.tl-zone')!

    expect(rail.getAttribute('role')).toBe('slider')
    expect(rail.getAttribute('aria-valuemin')).toBe('1')
    expect(rail.getAttribute('aria-valuemax')).toBe('3')
    expect(rail.getAttribute('aria-valuenow')).toBe('2')
    expect(rail.getAttribute('aria-valuetext')).toBe('1月 9日')
    expect(rail.querySelectorAll('[data-timeline-tick]')).toHaveLength(3)
  })

  test('方向键切换主刻度', () => {
    const onActiveIndexChange = jest.fn()
    const {container} = render(
      <ReferenceTimeline
        items={REFERENCE_TIMELINE_ITEMS.slice(0, 3)}
        activeIndex={0}
        onActiveIndexChange={onActiveIndexChange}
      />,
    )
    const rail = container.querySelector('.tl-zone')!

    fireEvent.keyDown(rail, {key: 'ArrowRight'})
    fireEvent.keyDown(rail, {key: 'End'})

    expect(onActiveIndexChange).toHaveBeenNthCalledWith(1, 1)
    expect(onActiveIndexChange).toHaveBeenNthCalledWith(2, 2)
  })

  test('触摸长按进入细分模式', () => {
    jest.useFakeTimers()
    const {container} = render(
      <ReferenceTimeline
        items={REFERENCE_TIMELINE_ITEMS.slice(0, 3)}
        activeIndex={0}
        onActiveIndexChange={jest.fn()}
      />,
    )
    const rail = container.querySelector('.tl-zone')!

    fireEvent.pointerDown(rail, {
      button: 0,
      clientY: 220,
      pointerId: 1,
      pointerType: 'touch',
    })
    act(() => {
      jest.advanceTimersByTime(900)
    })

    expect(rail.classList.contains('fine')).toBe(true)
    jest.useRealTimers()
  })

  test('二级刻度使用月份与日期标签并禁用右键菜单', () => {
    const {container} = render(
      <ReferenceTimeline
        items={[
          {id: 'january', timestamp: new Date(2026, 0, 1).getTime(), label: '1月', fineLabel: '3', group: '1'},
          {id: 'february', timestamp: new Date(2026, 1, 1).getTime(), label: '2月', fineLabel: '9', group: '2'},
        ]}
        activeIndex={0}
        onActiveIndexChange={jest.fn()}
      />,
    )
    const rail = container.querySelector('.tl-zone')!
    const labels = [...rail.querySelectorAll('[data-timeline-label]')].map(element => element.textContent)
    const contextMenu = new Event('contextmenu', {bubbles: true, cancelable: true})

    rail.dispatchEvent(contextMenu)

    expect(labels).toContain('3')
    expect(contextMenu.defaultPrevented).toBe(true)
  })

  test('内置数据覆盖一月至十二月', () => {
    const {container} = render(
      <ReferenceTimeline
        items={REFERENCE_TIMELINE_ITEMS}
        activeIndex={0}
      />,
    )
    const rail = container.querySelector('.tl-zone')!

    expect(rail.querySelectorAll('[data-timeline-tick]')).toHaveLength(60)
    expect(rail.querySelectorAll('[data-timeline-month-label]')).toHaveLength(12)
    expect(rail.querySelector('[data-timeline-date]')?.textContent).toContain('1月')
    expect(rail.querySelector('[data-timeline-date]')?.textContent).toContain('3')
  })
})
