import type {ReactNode} from 'react'
import {useMemo} from 'react'
import {View} from '@tarojs/components'
import classNames from 'classnames'
import ReffoGlyph from './ReffoGlyph.h5'
import type {HomeCardItem} from './shared'

import './CardMaterial.h5.scss'

type CardTextureMode = 'single' | 'repeat'

export type CardTextureSource = Pick<HomeCardItem, 'id' | 'company' | 'role' | 'tone'>

interface CardTextureProps {
  source: CardTextureSource
  color: string
  className?: string
  mode?: CardTextureMode
  columns?: number
  rows?: number
  tileWidth?: number
  tileHeight?: number
  gapX?: number
  gapY?: number
}

interface CardGlassProps {
  children: ReactNode
  className?: string
}

function hashSeed(seed: string) {
  return seed
    .split('')
    .reduce((value, char) => ((value * 33) + char.charCodeAt(0)) >>> 0, 17)
}

function resolveGlyphStyle(source: CardTextureSource) {
  const hash = hashSeed(`${source.id}:${source.company}:${source.role}`)
  const isSoft = source.tone === 'soft'
  const isDark = source.tone === 'dark'
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

function resolveTextureMode(source: CardTextureSource) {
  const hash = hashSeed(`${source.id}:${source.company}:texture`)
  return hash % 3 === 0 ? 'repeat' : 'single'
}

function buildRepeatTiles(
  source: CardTextureSource,
  options: Required<Pick<CardTextureProps, 'columns' | 'rows' | 'tileWidth' | 'tileHeight' | 'gapX' | 'gapY'>>,
) {
  const hash = hashSeed(`${source.id}:${source.company}:${source.role}:tiles`)
  const offsetX = -18 + (hash % 18)
  const offsetY = -10 + ((hash >> 6) % 18)

  return Array.from({length: options.columns * options.rows}, (_, index) => {
    const row = Math.floor(index / options.columns)
    const column = index % options.columns
    const flipX = (row + column) % 2 === 1
    const flipY = (row + column + ((hash >> 12) % 2)) % 3 === 0

    return {
      key: `${row}-${column}`,
      style: {
        width: `${options.tileWidth}px`,
        height: `${options.tileHeight}px`,
        left: `${offsetX + column * (options.tileWidth + options.gapX)}px`,
        top: `${offsetY + row * (options.tileHeight + options.gapY)}px`,
        transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
      },
    }
  })
}

export function CardTexture({
  source,
  color,
  className,
  mode,
  columns = 5,
  rows = 4,
  tileWidth = source.tone === 'dark' ? 49 : 56,
  tileHeight = source.tone === 'dark' ? 48 : 55,
  gapX = source.tone === 'dark' ? 6 : 10,
  gapY = source.tone === 'dark' ? 10 : 14,
}: CardTextureProps) {
  const textureMode = mode || resolveTextureMode(source)
  const glyphStyle = useMemo(() => resolveGlyphStyle(source), [source])
  const repeatTiles = useMemo(() => buildRepeatTiles(source, {
    columns,
    rows,
    tileWidth,
    tileHeight,
    gapX,
    gapY,
  }), [columns, gapX, gapY, rows, source, tileHeight, tileWidth])

  return (
    <View
      className={classNames(
        'reffo-card-texture',
        'reffo-home-card__texture',
        `reffo-card-texture--${textureMode}`,
        `reffo-home-card__texture--${textureMode}`,
        className,
      )}
      aria-hidden='true'
    >
      {textureMode === 'repeat' ? (
        <View className='reffo-card-texture__repeat reffo-home-card__logo-repeat'>
          {repeatTiles.map(tile => (
            <View
              key={tile.key}
              className='reffo-card-texture__tile reffo-home-card__logo-tile'
              style={tile.style}
            >
              <ReffoGlyph color={color} />
            </View>
          ))}
        </View>
      ) : (
        <View
          className='reffo-card-texture__mark reffo-home-card__logo-mark'
          style={glyphStyle}
        >
          <ReffoGlyph color={color} />
        </View>
      )}
      <View className='reffo-card-texture__wash reffo-home-card__theme-wash' />
    </View>
  )
}

export function CardGlass({children, className}: CardGlassProps) {
  return (
    <View className={classNames('reffo-card-glass', 'reffo-home-card__glass', className)}>
      {children}
    </View>
  )
}
