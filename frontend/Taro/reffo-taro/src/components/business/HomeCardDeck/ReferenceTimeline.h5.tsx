/// <reference lib="dom" />
import {Text, View} from '@tarojs/components'
import classNames from 'classnames'
import {useMemo} from 'react'
import './ReferenceTimeline.h5.scss'
import type {ReferenceTimelineItem} from './useReferenceTimeline.h5'
import useReferenceTimeline from './useReferenceTimeline.h5'

interface ReferenceTimelineProps {
  items: ReferenceTimelineItem[]
  activeIndex: number
  disabled?: boolean
  locale?: string
  onActiveIndexChange?: (index: number) => void
  onScroll?: (scrollLeft: number) => void
  onFirstInteraction?: () => void
}

export default function ReferenceTimeline({
  items,
  activeIndex,
  disabled = false,
  locale,
  onActiveIndexChange,
  onScroll,
  onFirstInteraction,
}: ReferenceTimelineProps) {
  const {
    activeFineLabel,
    isFineMode,
    rootRef,
  } = useReferenceTimeline({
    items,
    activeIndex,
    disabled,
    locale,
    onActiveIndexChange,
    onScroll,
    onFirstInteraction,
  })
  const separatorCount = useMemo(
    () => items.reduce((count, item, index) => (
      count + Number(index > 0 && Boolean(item.group) && item.group !== items[index - 1].group)
    ), 0),
    [items],
  )
  const monthLabels = useMemo(() => {
    const seen = new Set<string>()
    return items.reduce<Array<{key: string; label: string}>>((labels, item) => {
      const key = item.group || item.label
      if (!seen.has(key)) {
        seen.add(key)
        labels.push({key, label: item.label})
      }
      return labels
    }, [])
  }, [items])

  return (
    <View
      ref={rootRef as any}
      data-timeline-root=''
      className={classNames('tl-zone', {
        'fine': isFineMode,
        'is-fine': isFineMode,
        'is-disabled': disabled,
      })}
      role='slider'
      {...{tabIndex: disabled ? -1 : 0} as any}
      aria-label='时间轴'
      aria-orientation='horizontal'
      aria-valuemin={1}
      aria-valuemax={Math.max(1, items.length)}
      aria-valuenow={Math.min(Math.max(activeIndex + 1, 1), Math.max(1, items.length))}
      aria-valuetext={activeFineLabel}
    >
      {items.map((item, index) => (
        <View
          key={`tick-${item.id}`}
          data-timeline-tick={index}
          className='tl-tick'
        />
      ))}
      {Array.from({length: separatorCount}, (_, index) => (
        <View
          key={`separator-${index}`}
          data-timeline-separator={index}
          className='tl-sep'
        />
      ))}
      {items.map((item, index) => (
        <View
          key={`label-${item.id}`}
          data-timeline-label={index}
          className='tl-fine-label'
        >
          {item.fineLabel}
        </View>
      ))}
      {monthLabels.map(month => (
        <View
          key={`month-${month.key}`}
          data-timeline-month-label={month.key}
          className='tl-fine-label is-month'
        >
          {month.label}
        </View>
      ))}
      {Array.from({length: 2}, (_, index) => (
        <View
          key={`cap-${index}`}
          data-timeline-cap={index}
          className='tl-num-cap'
        />
      ))}
      <View data-timeline-date='' className='tl-date'>
        {Array.from({length: 4}, (_, index) => (
          <View
            key={`reel-${index}`}
            data-timeline-reel={index}
            className='tl-reel'
          >
            <Text />
          </View>
        ))}
      </View>
    </View>
  )
}
