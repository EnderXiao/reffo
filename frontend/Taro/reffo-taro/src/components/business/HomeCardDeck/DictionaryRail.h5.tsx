/// <reference lib="dom" />
import {Text, View} from '@tarojs/components'
import classNames from 'classnames'
import {useMemo} from 'react'
import {buildDictionaryRailStops} from './dictionaryRailMath'
import type {DictionaryRailItem} from './useDictionaryRailMotion.h5'
import useDictionaryRailMotion from './useDictionaryRailMotion.h5'

interface DictionaryRailProps {
  items: DictionaryRailItem[]
  activeIndex: number
  disabled?: boolean
  onActiveIndexChange: (index: number) => void
  onFirstInteraction?: () => void
}

export default function DictionaryRail({
  items,
  activeIndex,
  disabled = false,
  onActiveIndexChange,
  onFirstInteraction,
}: DictionaryRailProps) {
  const railItems = useMemo(
    () => items.map(item => ({
      id: item.id,
      label: item.label,
      secondaryLabel: item.secondaryLabel,
      sourceIndex: item.sourceIndex,
    })),
    [items],
  )
  const {
    activeLabel,
    isFineMode,
    rootRef,
    trackRef,
    markerRef,
  } = useDictionaryRailMotion({
    items: railItems,
    activeIndex,
    disabled,
    onActiveIndexChange,
    onFirstInteraction,
  })
  const stops = useMemo(
    () => buildDictionaryRailStops(
      railItems.map(item => item.label),
      5,
      railItems.map(item => item.secondaryLabel || item.label),
    ),
    [railItems],
  )

  return (
    <View
      ref={rootRef as any}
      className={classNames('reffo-home-deck__rail', 'reffo-dictionary-rail', {
        'reffo-dictionary-rail--disabled': disabled,
        'reffo-dictionary-rail--fine': isFineMode,
      })}
      role='slider'
      aria-orientation='vertical'
      aria-valuemin={1}
      aria-valuemax={Math.max(1, railItems.length)}
      aria-valuenow={Math.min(Math.max(activeIndex + 1, 1), Math.max(1, railItems.length))}
      aria-valuetext={activeLabel}
      aria-label='首页字典轴'
      {...{tabIndex: disabled ? -1 : 0} as any}
    >
      <View ref={trackRef as any} className='reffo-dictionary-rail__track'>
        {stops.map(stop => (
          <View
            key={`${stop.kind}-${stop.majorIndex}-${stop.minorIndex}`}
            data-rail-stop={stop.kind}
            className={classNames('reffo-dictionary-rail__stop', `reffo-dictionary-rail__stop--${stop.kind}`)}
          >
            <View
              data-rail-tick={stop.kind}
              className='reffo-dictionary-rail__tick'
            />
            <Text
              data-rail-label={stop.kind}
              className={classNames('reffo-dictionary-rail__label', `reffo-dictionary-rail__label--${stop.kind}`)}
            >
              {stop.label}
            </Text>
          </View>
        ))}
      </View>
      <View ref={markerRef as any} className='reffo-dictionary-rail__marker'>
        <View className='reffo-dictionary-rail__cap' />
        <View className='reffo-dictionary-rail__cap reffo-dictionary-rail__cap--bottom' />
      </View>
    </View>
  )
}
