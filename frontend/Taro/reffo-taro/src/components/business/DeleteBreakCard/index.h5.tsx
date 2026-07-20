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
  count: 30,
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

const SHARD_DIRECTIONS = [
  180,
  0,
  225,
  135,
  315,
  45,
].map(angle => angle * Math.PI / 180)

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
    const count = Math.max(0, Math.min(48, Math.round(resolvedShardConfig.count)))
    const randomBetween = (min: number, max: number) => min + Math.random() * (max - min)
    const directionCount = SHARD_DIRECTIONS.length
    const laneCount = Math.max(1, Math.ceil(count / directionCount))
    const startBand = Math.max(10, resolvedShardConfig.startSpread * 1.28)
    const startDepth = Math.max(5, resolvedShardConfig.startSpread * 0.34)

    return Array.from({length: count}, (_, index) => {
      const directionIndex = index % directionCount
      const laneIndex = Math.floor(index / directionCount)
      const laneRatio = laneCount === 1 ? 0.5 : laneIndex / (laneCount - 1)
      const baseAngle = SHARD_DIRECTIONS[directionIndex]
      const laneAngleNudge = ((laneIndex % 3) - 1) * 0.045
      const travelAngle = baseAngle + laneAngleNudge + randomBetween(-0.035, 0.035)
      const travelRatio = (laneIndex + 0.35 + randomBetween(0, 0.5)) / (laneCount + 0.65)
      const travelRange = resolvedShardConfig.maxTravel - resolvedShardConfig.minTravel
      const travel = resolvedShardConfig.minTravel + travelRange * Math.min(1, travelRatio)
      const width = randomBetween(resolvedShardConfig.minWidth, resolvedShardConfig.maxWidth)
      const height = randomBetween(resolvedShardConfig.minHeight, resolvedShardConfig.maxHeight)
      const normalAngle = baseAngle + Math.PI / 2
      const normalOffset = (laneRatio - 0.5) * startBand + randomBetween(-1.4, 1.4)
      const tangentOffset = randomBetween(-startDepth, startDepth)
      const popX = Math.cos(normalAngle) * normalOffset + Math.cos(baseAngle) * tangentOffset
      const popY = Math.sin(normalAngle) * normalOffset + Math.sin(baseAngle) * tangentOffset
      const endX = Math.cos(travelAngle) * travel + Math.cos(normalAngle) * normalOffset * 0.22
      const endY = Math.sin(travelAngle) * travel + Math.sin(normalAngle) * normalOffset * 0.22
      const rotate = travelAngle * 180 / Math.PI + randomBetween(-6, 6)

      return {
        id: `${index}-${Math.round(width * 10)}-${Math.round(height * 10)}`,
        shape: (index % 3) + 1,
        style: {
          '--delete-break-card-shard-width': `${width.toFixed(1)}px`,
          '--delete-break-card-shard-height': `${height.toFixed(1)}px`,
          '--delete-break-card-shard-pop-x': `${popX.toFixed(1)}px`,
          '--delete-break-card-shard-pop-y': `${popY.toFixed(1)}px`,
          '--delete-break-card-shard-end-x': `${endX.toFixed(1)}px`,
          '--delete-break-card-shard-end-y': `${endY.toFixed(1)}px`,
          '--delete-break-card-shard-rotate': `${rotate.toFixed(1)}deg`,
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
