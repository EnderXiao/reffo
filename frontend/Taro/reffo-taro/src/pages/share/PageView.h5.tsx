import {useCallback, useEffect, useRef, useState, type ComponentType} from 'react'
import {Image, Text, View} from '@tarojs/components'
import BACK_ICON from '@/assets/common/refo-back.svg'
import DOWN_ARROW_ICON from '@/assets/share/down_arrow.svg'
import SHARE_ICON from '@/assets/share/share.svg'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import {useVisualTier} from '@/utils'
import '@/pages/index/index.h5.scss'
import '@/styles/responsive-layout.scss'
import PhysicsBadge from './PhysicsBadge.h5'
import ShareBlankCard from './ShareBlankCard.h5'
import {useShareAction} from './useShareAction.h5'
import type {ShareContentMode} from '@/types/share'
import type {SharePageViewModel} from './usePageModel'
import './index.h5.scss'

const GestureView = View as unknown as ComponentType<any>
const MODE_SWITCH_EXIT_DURATION_MS = 360
const MODE_SWITCH_ENTER_DURATION_MS = 360
const STRAP_GRADIENT_JOB: readonly [string, string] = ['#b8efd3', '#f2fff9']
const STRAP_GRADIENT_BLANK: readonly [string, string] = ['#bdd8fc', '#f2f8ff']

interface ModeTransition {
  from: ShareContentMode
  to: ShareContentMode
  direction: 'left' | 'right'
  phase: 'exit' | 'enter'
}

function readTouchX(event: any) {
  return event.touches?.[0]?.clientX
    ?? event.changedTouches?.[0]?.clientX
    ?? event.detail?.x
    ?? event.clientX
    ?? event.pageX
    ?? 0
}

export default function PageView({
  card,
  historyId,
  loading,
  mode,
  jobAvailable,
  captureOnMount,
  isReturning,
  handleModeChange,
  handleBack,
}: SharePageViewModel) {
  const visualCapability = useVisualTier({benchmark: true})
  const strategyParagraphs = card?.strategyBody
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 2) || []
  const shareAction = useShareAction({
    historyId,
    mode,
  })
  const touchStartRef = useRef(0)
  const swipeActiveRef = useRef(false)
  const cardDraggingRef = useRef(false)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [modeTransition, setModeTransition] = useState<ModeTransition | null>(null)

  const requestModeChange = useCallback((nextMode: ShareContentMode, direction: 'left' | 'right') => {
    if (
      nextMode === mode
      || (nextMode === 'job' && !jobAvailable)
      || cardDraggingRef.current
      || modeTransition
      || isReturning
    ) return
    setModeTransition({from: mode, to: nextMode, direction, phase: 'exit'})
    handleModeChange(nextMode)
  }, [handleModeChange, isReturning, jobAvailable, mode, modeTransition])

  const handleCardDragStateChange = useCallback((dragging: boolean) => {
    cardDraggingRef.current = dragging
    if (dragging) {
      swipeActiveRef.current = false
      setSwipeOffset(0)
    }
  }, [])

  const handleTouchStart = (event: any) => {
    const target = event.target as HTMLElement | null
    if (
      isReturning
      || modeTransition
      || cardDraggingRef.current
      || target?.closest?.('[data-share-card-surface], [data-share-no-swipe]')
    ) {
      return
    }
    swipeActiveRef.current = true
    touchStartRef.current = readTouchX(event)
    setSwipeOffset(0)
  }

  const handleTouchMove = (event: any) => {
    if (!swipeActiveRef.current || cardDraggingRef.current) return
    const delta = readTouchX(event) - touchStartRef.current
    setSwipeOffset(Math.max(-120, Math.min(120, delta)))
  }

  const handleTouchEnd = (event: any) => {
    if (!swipeActiveRef.current || cardDraggingRef.current) return
    swipeActiveRef.current = false
    const delta = readTouchX(event) - touchStartRef.current
    if (Math.abs(delta) > 52) {
      if (delta < 0) requestModeChange('blank', 'left')
      if (delta > 0 && jobAvailable) requestModeChange('job', 'right')
    }
    setSwipeOffset(0)
  }

  const handleKeyDown = (event: any) => {
    if (event.key === 'ArrowRight') requestModeChange('blank', 'left')
    if (event.key === 'ArrowLeft' && jobAvailable) requestModeChange('job', 'right')
  }

  useEffect(() => {
    if (!modeTransition) return
    const timer = setTimeout(() => {
      setModeTransition(current => current?.phase === 'exit'
        ? {...current, phase: 'enter'}
        : null)
    }, modeTransition.phase === 'exit'
      ? MODE_SWITCH_EXIT_DURATION_MS
      : MODE_SWITCH_ENTER_DURATION_MS)
    return () => clearTimeout(timer)
  }, [modeTransition])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => handleTouchStart(event)
    const onPointerMove = (event: PointerEvent) => handleTouchMove(event)
    const onPointerUp = (event: PointerEvent) => handleTouchEnd(event)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [handleModeChange, isReturning, jobAvailable, requestModeChange])

  const renderModeCard = (targetMode: ShareContentMode) => {
    if (targetMode === 'blank') {
      return <ShareBlankCard />
    }

    return loading || !card ? (
      <View className='share-page__card-skeleton' />
    ) : (
      <View className='share-badge__card-frame'>
        <HomeScoreCard
          card={card}
          depth={0}
          active
          visualTier={visualCapability.tier}
          className='share-badge__home-card'
        />
      </View>
    )
  }

  const modeTransitionStyle = {
    '--mode-switch-exit-x': modeTransition?.direction === 'left' ? '-280px' : '280px',
    '--mode-switch-enter-x': modeTransition?.direction === 'left' ? '280px' : '-280px',
  } as any

  return (
    <GestureView
      className={`share-page share-page--${mode} ${modeTransition ? 'share-page--mode-switching' : ''} ${captureOnMount ? 'share-page--direct-entry' : 'share-page--handoff-entry'} ${isReturning ? 'share-page--returning' : ''} reffo-responsive-page`}
      data-share-export-source='true'
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <View className={`share-page__mode-backdrop share-page__mode-backdrop--job ${mode === 'job' ? 'is-active' : ''}`} aria-hidden='true' />
      <View className={`share-page__mode-backdrop share-page__mode-backdrop--blank ${mode === 'blank' ? 'is-active' : ''}`} aria-hidden='true' />
      <View className='share-page__atmosphere' aria-hidden='true' />
      <View className='share-page__back' data-share-no-swipe='true' onClick={handleBack}>
        <Image className='share-page__back-icon' src={BACK_ICON} mode='aspectFit' />
      </View>
      <Text className='share-page__watermark'>新工牌</Text>
      <View className='share-page__side-stage' data-share-card-surface='true' aria-hidden='true'>
        <View
          className='share-page__side-preview share-page__side-preview--left'
          data-share-card-surface='true'
          onClick={() => requestModeChange('job', 'right')}
        >
          {mode === 'blank' && card ? (
            <View className='share-page__side-home-frame'>
              <HomeScoreCard
                card={card}
                depth={0}
                active={false}
                visualTier={visualCapability.tier}
                className='share-page__side-home-card'
              />
            </View>
          ) : null}
        </View>
        <View
          className='share-page__side-preview share-page__side-preview--right'
          data-share-card-surface='true'
          onClick={() => requestModeChange('blank', 'left')}
        >
          {mode === 'job' ? <ShareBlankCard /> : null}
        </View>
      </View>

      <View className='share-page__content-shell reffo-responsive-page__frame'>
        <View className='share-page__badge-stage'>
          <PhysicsBadge
            strapGradient={mode === 'blank' ? STRAP_GRADIENT_BLANK : STRAP_GRADIENT_JOB}
            strapWidth={1}
            gravity={1.2}
            damping={0.78}
            elasticity={0.08}
            breeze={0.08}
            captureOnMount={captureOnMount}
            releaseActive={Boolean(modeTransition)}
            onDragStateChange={handleCardDragStateChange}
            interactive={!modeTransition}
          >
            <View
              className={`share-mode-card ${modeTransition ? `share-mode-card--${modeTransition.phase}` : ''}`}
              style={modeTransitionStyle}
              data-share-card-surface='true'
              data-share-card-source={(modeTransition?.phase === 'exit' ? modeTransition.from : mode) === 'blank' ? 'blank' : 'job'}
              data-share-transition-role='card'
            >
              {renderModeCard(modeTransition?.phase === 'exit' ? modeTransition.from : mode)}
            </View>
          </PhysicsBadge>
        </View>

        <GestureView
          data-share-swipe-surface='true'
          className='share-page__copy'
          style={{transform: `translate3d(${swipeOffset * 0.14}px, 0, 0)`}}
        >
          <View className='share-page__copy-content'>
            {mode === 'job' ? (
              <>
                <Text className='share-page__lead'>
                  用 <Text className='share-page__accent'>reffo</Text> 榨干了
                  <Text className='share-page__source-reference'>我的简历</Text>
                  和
                  <Text className='share-page__source-reference'>目标岗位描述</Text>
                  ，我得到了：
                </Text>
                {(strategyParagraphs.length > 0 ? strategyParagraphs : ['岗位分析、相契简历和面试建议已经准备就绪。']).map(paragraph => (
                  <Text key={paragraph} className='share-page__paragraph'>{paragraph}</Text>
                ))}
              </>
            ) : (
              <>
                <Text className='share-page__lead'>
                  用 <Text className='share-page__accent'>reffo</Text> 量身定制你的新简历
                </Text>
                <Text className='share-page__paragraph'>
                  智能弥合简历和工作岗位之间的差距，提高在就业市场的竞争力。
                </Text>
              </>
            )}
          </View>

          <View className='share-page__actions'>
            <View
              className='share-page__action share-page__action--download'
              data-share-no-swipe='true'
              aria-disabled={Boolean(shareAction.busyChannel)}
              onClick={() => {
                if (!shareAction.busyChannel) void shareAction.shareImage()
              }}
            >
              <Image className='share-page__action-icon' src={DOWN_ARROW_ICON} mode='aspectFit' />
              <Text>{shareAction.busyChannel === 'image' ? '生成中...' : '下载分享图'}</Text>
            </View>
            <View
              className='share-page__action share-page__action--share'
              data-share-no-swipe='true'
              aria-disabled={Boolean(shareAction.busyChannel)}
              onClick={() => {
                if (!shareAction.busyChannel) void shareAction.shareLink()
              }}
            >
              <Image className='share-page__share-icon' src={SHARE_ICON} mode='aspectFit' />
              <Text>{shareAction.busyChannel === 'link' ? '创建中...' : '分享'}</Text>
            </View>
          </View>
        </GestureView>
      </View>
    </GestureView>
  )
}
