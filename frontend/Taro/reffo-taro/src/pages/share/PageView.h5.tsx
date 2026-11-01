import {useEffect, useRef, useState, type ComponentType} from 'react'
import {Image, Text, View} from '@tarojs/components'
import DOWN_ARROW_ICON from '@/assets/share/down_arrow.svg'
import SHARE_ICON from '@/assets/share/share.svg'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import {useVisualTier} from '@/utils'
import '@/pages/index/index.h5.scss'
import '@/styles/responsive-layout.scss'
import PhysicsBadge from './PhysicsBadge.h5'
import ShareBlankCard from './ShareBlankCard.h5'
import {useShareAction} from './useShareAction.h5'
import type {SharePageViewModel} from './usePageModel'
import './index.h5.scss'

const GestureView = View as unknown as ComponentType<any>

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
  const shareAction = useShareAction({historyId, mode})
  const touchStartRef = useRef(0)
  const swipeActiveRef = useRef(false)
  const copyRef = useRef<any>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)

  const handleTouchStart = (event: any) => {
    swipeActiveRef.current = true
    touchStartRef.current = readTouchX(event)
    setSwipeOffset(0)
  }

  const handleTouchMove = (event: any) => {
    if (!swipeActiveRef.current) return
    const delta = readTouchX(event) - touchStartRef.current
    setSwipeOffset(Math.max(-120, Math.min(120, delta)))
  }

  const handleTouchEnd = (event: any) => {
    swipeActiveRef.current = false
    const delta = readTouchX(event) - touchStartRef.current
    if (Math.abs(delta) > 52) {
      if (delta < 0) handleModeChange('blank')
      if (delta > 0 && jobAvailable) handleModeChange('job')
    }
    setSwipeOffset(0)
  }

  const handleKeyDown = (event: any) => {
    if (event.key === 'ArrowRight') handleModeChange('blank')
    if (event.key === 'ArrowLeft' && jobAvailable) handleModeChange('job')
  }

  useEffect(() => {
    const element = copyRef.current as HTMLElement | null
    if (!element) return

    const onPointerDown = (event: PointerEvent) => handleTouchStart(event)
    const onPointerMove = (event: PointerEvent) => handleTouchMove(event)
    const onPointerUp = (event: PointerEvent) => handleTouchEnd(event)
    element.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [handleModeChange, jobAvailable])

  const strategyParagraphs = card?.strategyBody
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 2) || []

  return (
    <GestureView
      className={`share-page share-page--${mode} ${captureOnMount ? 'share-page--direct-entry' : 'share-page--handoff-entry'} ${isReturning ? 'share-page--returning' : ''} reffo-responsive-page`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <View className='share-page__atmosphere' aria-hidden='true' />
      <View className='share-page__back' onClick={handleBack}>
        <Text>‹</Text>
      </View>
      <Text className='share-page__watermark'>新工牌</Text>
      <View className='share-page__side-stage' aria-hidden='true'>
        <View className='share-page__side-preview share-page__side-preview--left'>
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
        <View className='share-page__side-preview share-page__side-preview--right'>
          {mode === 'job' ? <ShareBlankCard /> : null}
        </View>
      </View>

      <View className='share-page__content-shell reffo-responsive-page__frame'>
        <View className='share-page__badge-stage'>
          <PhysicsBadge
            strapColor={mode === 'job' ? '#dff9ea' : '#e2edff'}
            strapWidth={1}
            gravity={1.2}
            damping={0.78}
            elasticity={0.08}
            breeze={0.08}
            captureOnMount={captureOnMount}
          >
            {mode === 'blank' ? (
              <View data-share-card-source='blank' data-share-transition-role='card'>
                <ShareBlankCard />
              </View>
            ) : loading || !card ? (
              <View className='share-page__card-skeleton' data-share-transition-role='card' />
            ) : (
                <View className='share-badge__card-frame' data-share-card-source='job' data-share-transition-role='card'>
                <HomeScoreCard
                  card={card}
                  depth={0}
                  active
                  visualTier={visualCapability.tier}
                  className='share-badge__home-card'
                />
              </View>
            )}
          </PhysicsBadge>
        </View>

        <GestureView
          ref={copyRef}
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
