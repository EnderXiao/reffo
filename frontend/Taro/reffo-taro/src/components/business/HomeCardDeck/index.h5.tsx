/// <reference lib="dom" />
import {Text, View} from '@tarojs/components'
import classNames from 'classnames'
import {useEffect, useState} from 'react'
import {
  H5_RAIL_ITEM_HEIGHT,
  H5_RAIL_MINOR_MARK_COUNT,
  resolveH5CardScale,
} from './motion.h5'
import HomeScoreCard from './HomeScoreCard.h5'
import type {HomeCardDeckProps} from './shared'
import useHomeCardDeckMotion from './useHomeCardDeckMotion.h5'

const CREATE_MODE_STACK_GAP_X = 24

function buildCreateModeStackCardStyle(depth: number) {
  const shiftedDepth = depth + 1

  return {
    '--card-left': `${CREATE_MODE_STACK_GAP_X * shiftedDepth}px`,
    '--card-top': `${Math.min(2 + shiftedDepth * 2, 10)}px`,
    '--card-rotate': `${shiftedDepth * 3.8}deg`,
    '--card-depth-scale': String(1 - shiftedDepth * 0.018),
    '--card-opacity': String(1 - shiftedDepth * 0.035),
    zIndex: 32 - shiftedDepth,
  }
}

function useResponsiveCardScale() {
  const [scale, setScale] = useState(resolveH5CardScale)

  useEffect(() => {
    let frameId = 0
    const refresh = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        setScale(resolveH5CardScale())
      })
    }

    refresh()
    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    window.visualViewport?.addEventListener('resize', refresh)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
    }
  }, [])

  return scale
}

export default function HomeCardDeck({
  cards,
  initialIndex,
  enteringCardId,
  isCreateMode = false,
  onCreateCardPress,
  onCardChange,
  onFirstInteraction,
}: HomeCardDeckProps) {
  const cardScale = useResponsiveCardScale()
  const {
    activeCard,
    activeRailIndex,
    dragState,
    dragVars,
    handleDeckPointerDown,
    handleDeckPointerEnd,
    handleDeckPointerMove,
    handleRailTouchStart,
    isDeckInteractive,
    isRailAnimating,
    orderedCardEntries,
    railItems,
    railRef,
    railTranslateY,
    stackRef,
    visualCapability,
  } = useHomeCardDeckMotion({
    cards,
    initialIndex,
    cardScale,
    isCreateMode,
    onCardChange,
    onFirstInteraction,
  })
  const stackPointerHandlers = {
    onPointerDown: handleDeckPointerDown,
    onPointerMove: handleDeckPointerMove,
    onPointerUp: handleDeckPointerEnd,
    onPointerCancel: handleDeckPointerEnd,
  } as any

  return (
    <View
      className={classNames('reffo-home-deck-wrap', `reffo-home-deck-wrap--${visualCapability.tier}`)}
      style={{'--card-responsive-scale': cardScale} as any}
    >
      <View className='reffo-home-deck'>
        <View
          ref={stackRef as any}
          className={classNames('reffo-home-deck__stack', {
            'reffo-home-deck__stack--dragging': dragState.phase === 'dragging',
            'reffo-home-deck__stack--settling': dragState.phase === 'settling',
            'reffo-home-deck__stack--exiting': dragState.phase === 'exiting',
            'reffo-home-deck__stack--create-mode': isCreateMode,
          })}
          style={dragVars as any}
          {...stackPointerHandlers}
        >
          {orderedCardEntries.map(({card, depth, isRecycling, isTailEntering}) => {
            const isActive = !isRecycling && card.id === activeCard?.id
            return (
              <HomeScoreCard
                key={card.id}
                card={card}
                depth={depth}
                active={isActive}
                visualTier={visualCapability.tier}
                style={isCreateMode ? buildCreateModeStackCardStyle(depth) : undefined}
                className={classNames({
                  'reffo-home-card--draggable': isActive && isDeckInteractive,
                  'reffo-home-card--preview': !isActive && !isRecycling && isDeckInteractive,
                  'reffo-home-card--tail-enter': isTailEntering,
                  'reffo-home-card--recycling': isRecycling,
                  'reffo-home-card--new-entry': card.id === enteringCardId,
                })}
              />
            )
          })}
          {isCreateMode ? (
            <HomeScoreCard
              key='create-draft-card'
              depth={0}
              active
              visualTier={visualCapability.tier}
              variant='create'
              className='reffo-home-card--create-draft'
              style={{zIndex: 48}}
              onClick={onCreateCardPress}
            />
          ) : null}
        </View>
        <View
          ref={railRef as any}
          className='reffo-home-deck__rail'
          onTouchStart={handleRailTouchStart}
        >
          <View
            className={classNames('reffo-home-deck__rail-wheel', {
              'reffo-home-deck__rail-wheel--animating': isRailAnimating,
            })}
            style={{transform: `translateY(${railTranslateY}px)`} as any}
          >
            {railItems.map(({card, virtualIndex}) => {
              const distance = Math.min(4, Math.abs(virtualIndex - activeRailIndex))
              const isActive = virtualIndex === activeRailIndex

              return (
                <View
                  key={`${card.id}-${virtualIndex}`}
                  className={classNames(
                    'reffo-home-deck__rail-item',
                    `reffo-home-deck__rail-item--d${distance}`,
                    {
                      'reffo-home-deck__rail-item--active': isActive,
                    },
                  )}
                >
                  <View className='reffo-home-deck__rail-major'>
                    <Text className='reffo-home-deck__rail-label'>{card.indexLabel}</Text>
                    <View className='reffo-home-deck__rail-tick reffo-home-deck__rail-tick--major' />
                  </View>
                  {Array.from({length: H5_RAIL_MINOR_MARK_COUNT}, (_, tickIndex) => (
                    <View
                      key={tickIndex}
                      className='reffo-home-deck__rail-minor'
                      style={{top: `${(tickIndex + 1) * (H5_RAIL_ITEM_HEIGHT / (H5_RAIL_MINOR_MARK_COUNT + 1))}px`} as any}
                    >
                      <View className='reffo-home-deck__rail-tick reffo-home-deck__rail-tick--minor' />
                    </View>
                  ))}
                </View>
              )
            })}
          </View>
        </View>
      </View>
    </View>
  )
}
