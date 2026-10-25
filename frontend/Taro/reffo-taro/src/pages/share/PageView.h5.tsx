import {useRef, useState, type ComponentType} from 'react'
import {Text, View} from '@tarojs/components'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import {useVisualTier} from '@/utils'
import PhysicsBadge from './PhysicsBadge.h5'
import ShareBlankCard from './ShareBlankCard.h5'
import {useShareAction} from './useShareAction.h5'
import type {SharePageViewModel} from './usePageModel'
import '@/pages/index/index.h5.scss'
import '@/styles/responsive-layout.scss'
import './index.h5.scss'

const GestureView = View as unknown as ComponentType<any>

function readTouchX(event: any) {
  return event.touches?.[0]?.clientX ?? event.changedTouches?.[0]?.clientX ?? 0
}

export default function PageView({
  card,
  historyId,
  loading,
  mode,
  jobAvailable,
  handleModeChange,
  handleBack,
}: SharePageViewModel) {
  const visualCapability = useVisualTier({benchmark: true})
  const shareAction = useShareAction({historyId, mode})
  const touchStartRef = useRef(0)
  const [swipeOffset, setSwipeOffset] = useState(0)

  const handleTouchStart = (event: any) => {
    touchStartRef.current = readTouchX(event)
    setSwipeOffset(0)
  }

  const handleTouchMove = (event: any) => {
    const delta = readTouchX(event) - touchStartRef.current
    setSwipeOffset(Math.max(-120, Math.min(120, delta)))
  }

  const handleTouchEnd = (event: any) => {
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

  const strategyParagraphs = card?.strategyBody
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 2) || []

  return (
    <GestureView
      className={`share-page share-page--${mode} reffo-responsive-page`}
      tabIndex={0}
      style={{'--share-swipe-offset': `${swipeOffset * 0.14}px`} as any}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onKeyDown={handleKeyDown}
    >
      <View className='share-page__atmosphere' aria-hidden='true' />
      <View className='share-page__back' onClick={handleBack}>
        <Text>‹</Text>
      </View>
      <Text className='share-page__watermark'>新工牌</Text>
      <Text className='share-page__mode-label'>{mode === 'job' ? '岗位信息分享' : '空白分享'}</Text>

      <View
        className='share-page__content-shell reffo-responsive-page__frame'
        style={{transform: `translate3d(${swipeOffset * 0.14}px, 0, 0)`}}
      >
        <View className='share-page__badge-stage'>
          <PhysicsBadge>
            {loading || !card ? (
              <View className='share-page__card-skeleton' />
            ) : mode === 'job' ? (
              <View className='share-badge__card-frame'>
                <HomeScoreCard
                  card={card}
                  depth={0}
                  active
                  visualTier={visualCapability.tier}
                  className='share-badge__home-card'
                />
              </View>
            ) : (
              <ShareBlankCard />
            )}
          </PhysicsBadge>
        </View>

        <View className='share-page__copy'>
          {mode === 'job' ? (
            <>
              <Text className='share-page__lead'>
                用 <Text className='share-page__accent'>reffo</Text> 榨干了我的简历和目标岗位描述，我得到了：
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

          <View className='share-page__actions'>
            <View
              className='share-page__action share-page__action--secondary'
              aria-disabled={Boolean(shareAction.busyChannel)}
              onClick={() => {
                if (!shareAction.busyChannel) void shareAction.shareImage()
              }}
            >
              <Text>{shareAction.busyChannel === 'image' ? '生成中...' : '保存图片分享'}</Text>
            </View>
            <View
              className='share-page__action share-page__action--primary'
              aria-disabled={Boolean(shareAction.busyChannel)}
              onClick={() => {
                if (!shareAction.busyChannel) void shareAction.shareLink()
              }}
            >
              <Text>{shareAction.busyChannel === 'link' ? '创建中...' : '分享链接'}</Text>
            </View>
          </View>

          <View className='share-page__mode-track' aria-hidden='true'>
            <Text className={`share-page__mode-dot ${mode === 'job' ? 'share-page__mode-dot--active' : ''}`} />
            <Text className={`share-page__mode-dot ${mode === 'blank' ? 'share-page__mode-dot--active' : ''}`} />
          </View>
          <Text className='share-page__swipe-hint'>左右滑动切换分享内容 · 拖转工卡查看物理效果</Text>
        </View>
      </View>
    </GestureView>
  )
}
