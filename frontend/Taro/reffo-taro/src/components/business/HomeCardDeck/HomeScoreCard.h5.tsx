import {Text, View} from '@tarojs/components'
import type {VisualTier} from '@/utils'
import type {HomeCardItem} from './shared'
import {deriveCardPalette} from './palette'
import classNames from 'classnames'
import {lazy, Suspense, useMemo} from 'react'
import {HOME_PAGE_CONTENT} from '@/pages/index/constants/content'
import ReffoGlyph from './ReffoGlyph.h5'

const PremiumCardEffect = lazy(() => import('./PremiumCardEffect.h5'))
const CREATE_CARD_PALETTE = deriveCardPalette('#1C77EB')
const CREATE_CARD_ITEM: HomeCardItem = {
  id: 'create-draft-card',
  company: '',
  indexLabel: '',
  location: '',
  role: '',
  dateLabel: '',
  score: 88,
  primaryColor: CREATE_CARD_PALETTE.primaryColor,
  surfaceColor: CREATE_CARD_PALETTE.surfaceColor,
  stackColor: CREATE_CARD_PALETTE.stackColor,
  logoColor: CREATE_CARD_PALETTE.logoColor,
  borderColor: '#1c77eb',
  tone: CREATE_CARD_PALETTE.tone,
  strategyBody: '',
}

interface HomeScoreCardProps {
  card?: HomeCardItem
  depth: number
  active: boolean
  visualTier: VisualTier
  variant?: 'score' | 'create'
  className?: string
  style?: Record<string, string | number>
  onClick?: () => void
}

function getScoreGrade(score: number) {
  if (score >= 88) {
    return 'A'
  }

  if (score >= 72) {
    return 'B'
  }

  return 'C'
}

function hashSeed(seed: string) {
  return seed
    .split('')
    .reduce((value, char) => ((value * 33) + char.charCodeAt(0)) >>> 0, 17)
}

function resolveGlyphStyle(card: HomeCardItem) {
  const hash = hashSeed(`${card.id}:${card.company}:${card.role}`)
  const isSoft = card.tone === 'soft'
  const isDark = card.tone === 'dark'
  const width = isDark ? 220 + (hash % 48) : isSoft ? 342 + (hash % 54) : 286 + (hash % 62)
  const height = Math.round(width * 0.98)
  const left = isSoft ? -154 + (hash % 34) : 72 + (hash % 54)
  const top = isSoft ? -122 + ((hash >> 6) % 36) : -34 + ((hash >> 6) % 46)
  const opacity = isDark ? 0.26 : isSoft ? 0.28 : 0.24

  return {
    width: `${width}px`,
    height: `${height}px`,
    left: `${left}px`,
    top: `${top}px`,
    opacity,
  }
}

function resolveTextureMode(card: HomeCardItem) {
  const hash = hashSeed(`${card.id}:${card.company}:texture`)

  return hash % 3 === 0 ? 'repeat' : 'single'
}

function buildRepeatTiles(card: HomeCardItem) {
  const hash = hashSeed(`${card.id}:${card.company}:${card.role}:tiles`)
  const columns = 5
  const rows = 4
  const tileWidth = card.tone === 'dark' ? 49 : 56
  const tileHeight = card.tone === 'dark' ? 48 : 55
  const gapX = card.tone === 'dark' ? 6 : 10
  const gapY = card.tone === 'dark' ? 10 : 14
  const offsetX = -18 + (hash % 18)
  const offsetY = -10 + ((hash >> 6) % 18)

  return Array.from({length: columns * rows}, (_, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const flipX = (row + column) % 2 === 1
    const flipY = (row + column + ((hash >> 12) % 2)) % 3 === 0

    return {
      key: `${row}-${column}`,
      style: {
        width: `${tileWidth}px`,
        height: `${tileHeight}px`,
        left: `${offsetX + column * (tileWidth + gapX)}px`,
        top: `${offsetY + row * (tileHeight + gapY)}px`,
        transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
      },
    }
  })
}

function resolveDeckStepX(depth: number) {
  if (depth <= 0) {
    return 0
  }

  return 36 + (depth - 1) * 24
}

function resolveDeckStepY(depth: number) {
  if (depth <= 0) {
    return 0
  }

  return Math.min((2 + (depth - 1)) * 2, 10)
}

export default function HomeScoreCard({
  card: inputCard,
  depth,
  active,
  visualTier,
  variant = 'score',
  className,
  style,
  onClick,
}: HomeScoreCardProps) {
  const card = variant === 'create' ? CREATE_CARD_ITEM : inputCard

  if (!card) {
    return null
  }

  const isDark = card.tone === 'dark'
  const isCreate = variant === 'create'
  const scoreGrade = getScoreGrade(card.score)
  const glyphStyle = useMemo(() => resolveGlyphStyle(card), [card])
  const textureMode = useMemo(() => resolveTextureMode(card), [card])
  const repeatTiles = useMemo(() => buildRepeatTiles(card), [card])
  const cssVars = {
    '--card-left': `${resolveDeckStepX(depth)}px`,
    '--card-top': `${resolveDeckStepY(depth)}px`,
    '--card-rotate': `${depth * 3.8}deg`,
    '--card-depth-scale': String(1 - depth * 0.018),
    '--card-bg': card.surfaceColor,
    '--card-accent': card.primaryColor,
    '--card-logo': card.logoColor,
    '--card-border': card.borderColor,
    '--card-opacity': String(1 - depth * 0.035),
    zIndex: 20 - depth,
    ...style,
  } as any

  return (
    <View
      data-home-card-id={card.id}
      className={classNames(
        'reffo-home-card',
        `reffo-home-card--grade-${scoreGrade.toLowerCase()}`,
        {
          'reffo-home-card--dark': isDark,
          'reffo-home-card--active': active,
          'reffo-home-card--create': isCreate,
        },
        className,
      )}
      style={cssVars}
      onClick={onClick}
    >
      <View className='reffo-home-card__surface'>
        {visualTier === 'premium' ? (
          <Suspense fallback={null}>
            <PremiumCardEffect
              tone={isDark ? 'dark' : 'light'}
              accentColor={card.primaryColor}
              surfaceColor={card.surfaceColor}
            />
          </Suspense>
        ) : null}
        <View className='reffo-home-card__handle' />
        <View className={classNames('reffo-home-card__texture', `reffo-home-card__texture--${textureMode}`)}>
          {textureMode === 'repeat' ? (
            <View className='reffo-home-card__logo-repeat'>
              {repeatTiles.map(tile => (
                <View key={tile.key} className='reffo-home-card__logo-tile' style={tile.style}>
                  <ReffoGlyph color={card.logoColor} />
                </View>
              ))}
            </View>
          ) : (
            <View className='reffo-home-card__logo-mark' style={glyphStyle}>
              <ReffoGlyph color={card.logoColor} />
            </View>
          )}
          <View className='reffo-home-card__theme-wash' />
        </View>
        {isCreate ? (
          <>
            <Text className='reffo-home-card__create-title'>{HOME_PAGE_CONTENT.createCard.title}</Text>
            <View className='reffo-home-card__glass reffo-home-card__glass--create'>
              <Text className='reffo-home-card__create-copy'>
                {HOME_PAGE_CONTENT.createCard.promptPrefix}
                {HOME_PAGE_CONTENT.createCard.promptAccent}
              </Text>
            </View>
          </>
        ) : (
          <>
            <View className='reffo-home-card__score'>
              <Text className='reffo-home-card__grade-letter'>{scoreGrade}</Text>
              <Text className='reffo-home-card__grade-meta'>评级</Text>
            </View>
            <View className='reffo-home-card__glass'>
              <View className='reffo-home-card__field'>
                <Text className='reffo-home-card__label'>公司</Text>
                <Text className='reffo-home-card__value reffo-home-card__company'>{card.company}</Text>
              </View>
              <View className='reffo-home-card__field'>
                <Text className='reffo-home-card__label'>岗位</Text>
                <Text className='reffo-home-card__value'>{card.role}</Text>
              </View>
              <View className='reffo-home-card__field'>
                <Text className='reffo-home-card__label'>工作地</Text>
                <Text className='reffo-home-card__value'>{card.location}</Text>
              </View>
              <View className='reffo-home-card__date-row'>
                <Text className='reffo-home-card__date-label'>生成日期</Text>
                <Text className='reffo-home-card__date'>{card.dateLabel}</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  )
}
