import {Text, View} from '@tarojs/components'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import ShareEntryButton from '@/components/business/share/ShareEntryButton.h5'
import {useVisualTier} from '@/utils'
import '@/pages/index/index.h5.scss'
import '@/pages/share/index.h5.scss'
import PhysicsBadge from '../share/PhysicsBadge.h5'
import type {CompletePageViewModel} from './usePageModel'
import './index.h5.scss'

const CONFETTI_COLORS = ['#14c972', '#007aff', '#ff4f5e', '#f9b400', '#ef4b9a', '#9b59b6']

const CONFETTI_PIECES = Array.from({length: 52}, (_, index) => {
  const column = index % 13
  const row = Math.floor(index / 13)
  const left = 3 + column * 8 + (row % 2) * 3
  const drift = (index % 2 === 0 ? 1 : -1) * (22 + (index % 5) * 10)
  const delay = -((index * 137) % 1700)
  const duration = 3200 + (index % 7) * 260
  const size = 7 + (index % 4) * 2

  return {
    key: `confetti-${index}`,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    style: {
      '--confetti-left': `${left}%`,
      '--confetti-drift': `${drift}px`,
      '--confetti-mid-drift': `${Math.round(drift * -0.35)}px`,
      '--confetti-delay': `${delay}ms`,
      '--confetti-duration': `${duration}ms`,
      '--confetti-size': `${size}px`,
      '--confetti-height': `${Math.round(size * 1.72)}px`,
      '--confetti-wide-size': `${Math.round(size * 1.52)}px`,
      '--confetti-flat-height': `${Math.round(size * 0.86)}px`,
      '--confetti-color': CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      '--confetti-rotate': `${(index * 29) % 180}deg`,
    },
  }
})

export default function PageView({
  card,
  loading,
  hasInitialEntryAnimation,
  isShareReturnEntry,
  isSharingTransition,
  handleShare,
  handleContinue,
}: CompletePageViewModel) {
  const visualCapability = useVisualTier({benchmark: true})

  return (
    <View
      className={`reffo-complete reffo-responsive-page ${hasInitialEntryAnimation ? 'reffo-complete--initial-entry' : 'reffo-complete--steady-entry'} ${isShareReturnEntry ? 'reffo-complete--share-return-entry' : ''} ${isSharingTransition ? 'reffo-complete--sharing-exit' : ''}`}
      onClick={event => {
        const target = event.target as unknown as (EventTarget & {closest?: (selector: string) => unknown}) | null
        if (target?.closest?.('[data-share-surface]')) return
        handleContinue()
      }}
    >
      <View className='reffo-responsive-page__frame reffo-complete__frame'>
      <View className='reffo-complete__screen-fold'>
        <View className='reffo-complete__fold-orb' />
        <View className='reffo-complete__fold-header'>
          <Text className='reffo-complete__fold-title'>最佳简历</Text>
          <Text className='reffo-complete__fold-spark'>✦</Text>
        </View>
        <View className='reffo-complete__fold-lines'>
          <View className='reffo-complete__fold-line reffo-complete__fold-line--wide' />
          <View className='reffo-complete__fold-line' />
          <View className='reffo-complete__fold-line reffo-complete__fold-line--short' />
        </View>
      </View>

      <View className='reffo-complete__confetti' aria-hidden='true'>
        {CONFETTI_PIECES.map(piece => (
          <View
            key={piece.key}
            className='reffo-complete__confetti-piece'
            style={piece.style as any}
          />
        ))}
      </View>

      <View className='reffo-complete__card-slot'>
        <View className={`reffo-complete__badge-stage ${isSharingTransition ? 'reffo-complete__badge-stage--sharing-exit' : ''}`}>
          <View className='reffo-complete__badge-reveal'>
            <PhysicsBadge
              strapColor='#dff9ea'
              strapWidth={1}
              gravity={1.2}
              damping={0.78}
              elasticity={0.08}
              breeze={0.08}
              interactive={false}
              captureOnMount={false}
            >
              {card ? (
                <View className='share-badge__card-frame' data-share-card-source='job' data-share-transition-role='card'>
                  <HomeScoreCard
                    card={card}
                    depth={0}
                    active
                    visualTier={visualCapability.tier}
                    className='share-badge__home-card reffo-complete__card'
                  />
                </View>
              ) : (
                <View className='share-badge__card-frame reffo-complete__card-placeholder' data-share-transition-role='card'>
                  <Text className='reffo-complete__card-placeholder-text'>Reffo</Text>
                </View>
              )}
            </PhysicsBadge>
          </View>
        </View>
      </View>

      <View className={`reffo-complete__copy ${isSharingTransition ? 'reffo-complete__copy--sharing-exit' : ''}`}>
        <Text className='reffo-complete__title'>{loading ? '正在准备...' : '恭喜你！'}</Text>
        <Text className='reffo-complete__subtitle'>新申请目标岗位的简历已经准备就绪！</Text>
        <Text className='reffo-complete__hint'>轻触屏幕进入首页</Text>
      </View>
      </View>
      {card && !loading ? (
        <ShareEntryButton onClick={handleShare} exiting={isSharingTransition} />
      ) : null}
    </View>
  )
}
