import {useMemo, type ReactNode} from 'react'
import {View} from '@tarojs/components'
import classNames from 'classnames'
import type {VisualTier} from '@/utils'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import './index.h5.scss'

export type DeleteBreakCardPhase = 'idle' | 'laying' | 'waiting' | 'deleting' | 'settling' | 'breaking'

export interface DeleteBreakCardShardConfig {
  count?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  startSpread?: number
  minTravel?: number
  maxTravel?: number
  minDurationMs?: number
  maxDurationMs?: number
  maxDelayMs?: number
}

const DEFAULT_SHARD_CONFIG: Required<DeleteBreakCardShardConfig> = {
  count: 18,
  minWidth: 14,
  maxWidth: 32,
  minHeight: 2,
  maxHeight: 3,
  startSpread: 18,
  minTravel: 46,
  maxTravel: 118,
  minDurationMs: 300,
  maxDurationMs: 520,
  maxDelayMs: 80,
}

interface DeleteBreakCardProps {
  card: HomeCardItem
  phase: DeleteBreakCardPhase
  visualTier: VisualTier
  className?: string
  cardClassName?: string
  pieceCardClassName?: string
  front?: ReactNode
  paused?: boolean
  style?: Record<string, string | number>
  shardConfig?: DeleteBreakCardShardConfig
}

export default function DeleteBreakCard({
  card,
  phase,
  visualTier,
  className,
  cardClassName,
  pieceCardClassName,
  front,
  paused = false,
  style,
  shardConfig,
}: DeleteBreakCardProps) {
  const resolvedShardConfig: Required<DeleteBreakCardShardConfig> = {
    count: shardConfig?.count ?? DEFAULT_SHARD_CONFIG.count,
    minWidth: shardConfig?.minWidth ?? DEFAULT_SHARD_CONFIG.minWidth,
    maxWidth: shardConfig?.maxWidth ?? DEFAULT_SHARD_CONFIG.maxWidth,
    minHeight: shardConfig?.minHeight ?? DEFAULT_SHARD_CONFIG.minHeight,
    maxHeight: shardConfig?.maxHeight ?? DEFAULT_SHARD_CONFIG.maxHeight,
    startSpread: shardConfig?.startSpread ?? DEFAULT_SHARD_CONFIG.startSpread,
    minTravel: shardConfig?.minTravel ?? DEFAULT_SHARD_CONFIG.minTravel,
    maxTravel: shardConfig?.maxTravel ?? DEFAULT_SHARD_CONFIG.maxTravel,
    minDurationMs: shardConfig?.minDurationMs ?? DEFAULT_SHARD_CONFIG.minDurationMs,
    maxDurationMs: shardConfig?.maxDurationMs ?? DEFAULT_SHARD_CONFIG.maxDurationMs,
    maxDelayMs: shardConfig?.maxDelayMs ?? DEFAULT_SHARD_CONFIG.maxDelayMs,
  }
  const shards = useMemo(() => {
    const count = Math.max(0, Math.min(36, Math.round(resolvedShardConfig.count)))
    const randomBetween = (min: number, max: number) => min + Math.random() * (max - min)

    return Array.from({length: count}, (_, index) => {
      const startAngle = randomBetween(0, Math.PI * 2)
      const startRadius = randomBetween(0, resolvedShardConfig.startSpread)
      const travelAngle = randomBetween(0, Math.PI * 2)
      const travel = randomBetween(resolvedShardConfig.minTravel, resolvedShardConfig.maxTravel)
      const width = randomBetween(resolvedShardConfig.minWidth, resolvedShardConfig.maxWidth)
      const height = randomBetween(resolvedShardConfig.minHeight, resolvedShardConfig.maxHeight)

      return {
        id: `${index}-${Math.round(width * 10)}-${Math.round(height * 10)}`,
        shape: (index % 3) + 1,
        style: {
          '--delete-break-card-shard-width': `${width.toFixed(1)}px`,
          '--delete-break-card-shard-height': `${height.toFixed(1)}px`,
          '--delete-break-card-shard-pop-x': `${(Math.cos(startAngle) * startRadius).toFixed(1)}px`,
          '--delete-break-card-shard-pop-y': `${(Math.sin(startAngle) * startRadius).toFixed(1)}px`,
          '--delete-break-card-shard-end-x': `${(Math.cos(travelAngle) * travel).toFixed(1)}px`,
          '--delete-break-card-shard-end-y': `${(Math.sin(travelAngle) * travel).toFixed(1)}px`,
          '--delete-break-card-shard-rotate': `${randomBetween(-42, 42).toFixed(1)}deg`,
          '--delete-break-card-shard-scale': randomBetween(0.82, 1.18).toFixed(2),
          '--delete-break-card-shard-duration': `${randomBetween(
            resolvedShardConfig.minDurationMs,
            resolvedShardConfig.maxDurationMs,
          ).toFixed(0)}ms`,
          '--delete-break-card-shard-delay': `${randomBetween(0, resolvedShardConfig.maxDelayMs).toFixed(0)}ms`,
        } as Record<string, string | number>,
      }
    })
  }, [
    card.id,
    resolvedShardConfig.count,
    resolvedShardConfig.maxDelayMs,
    resolvedShardConfig.maxDurationMs,
    resolvedShardConfig.maxHeight,
    resolvedShardConfig.maxTravel,
    resolvedShardConfig.maxWidth,
    resolvedShardConfig.minDurationMs,
    resolvedShardConfig.minHeight,
    resolvedShardConfig.minTravel,
    resolvedShardConfig.minWidth,
    resolvedShardConfig.startSpread,
  ])

  const rootStyle = {
    '--delete-break-card-shard-color': card.primaryColor,
    ...style,
  } as Record<string, string | number>

  const wholeCard = front ? (
    <View className='reffo-delete-break-card__flipper'>
      <View className='reffo-delete-break-card__face reffo-delete-break-card__face--front'>
        {front}
      </View>
      <View className='reffo-delete-break-card__face reffo-delete-break-card__face--back'>
        <HomeScoreCard
          card={card}
          depth={0}
          active
          visualTier={visualTier}
          className={cardClassName}
        />
      </View>
    </View>
  ) : (
    <HomeScoreCard
      card={card}
      depth={0}
      active
      visualTier={visualTier}
      className={cardClassName}
    />
  )

  const renderPiece = (piece: 'top' | 'bottom') => (
    <View className={`reffo-delete-break-card__piece-fall reffo-delete-break-card__piece-fall--${piece}`}>
      <View className='reffo-delete-break-card__piece-plane'>
        <View className='reffo-delete-break-card__piece-direction'>
          <View className='reffo-delete-break-card__piece-diagonal'>
            <View className='reffo-delete-break-card__piece-pose'>
              <View className={`reffo-delete-break-card__piece reffo-delete-break-card__piece--${piece}`}>
                <View className='reffo-delete-break-card__piece-backface' />
                <View className='reffo-delete-break-card__piece-inner'>
                  <HomeScoreCard
                    card={card}
                    depth={0}
                    active
                    visualTier={visualTier}
                    className={classNames(cardClassName, pieceCardClassName)}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  )

  const renderShards = () => (
    <View className='reffo-delete-break-card__shard-layer' aria-hidden='true'>
      {shards.map(shard => (
        <View
          key={shard.id}
          className={`reffo-delete-break-card__shard reffo-delete-break-card__shard--shape-${shard.shape}`}
          style={shard.style}
        />
      ))}
    </View>
  )

  return (
    <View
      className={classNames(
        'reffo-delete-break-card',
        `reffo-delete-break-card--${phase}`,
        {
          'reffo-delete-break-card--paused': paused,
        },
        className,
      )}
      style={rootStyle}
    >
      <View className='reffo-delete-break-card__whole-plane'>
        <View className='reffo-delete-break-card__whole-direction'>
          <View className='reffo-delete-break-card__whole-diagonal'>
            <View className='reffo-delete-break-card__whole-pose'>
              <View className='reffo-delete-break-card__whole-card'>
                {wholeCard}
              </View>
            </View>
          </View>
        </View>
      </View>

      <View className='reffo-delete-break-card__break-layer' aria-hidden='true'>
        {renderPiece('top')}
        {renderPiece('bottom')}
      </View>
      {renderShards()}
    </View>
  )
}
