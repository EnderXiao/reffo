import {Image, Text, View} from '@tarojs/components'
import type {VisualTier} from '@/utils'
import {resolveResumeGrade} from '@/utils/score-grade'
import type {HomeCardItem} from './shared'
import {deriveCardPalette} from './palette'
import classNames from 'classnames'
import {lazy, Suspense, useEffect, useMemo, useState} from 'react'
import {HOME_PAGE_CONTENT} from '@/pages/index/constants/content'
import ResumeUploadIcon, {
  type ResumeUploadIconStatus,
} from '@/components/business/ResumeUploadIcon/index.h5'
import {CardGlass, CardTexture} from './CardMaterial.h5'

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
  variant?: 'score' | 'create' | 'generating'
  presentation?: 'default' | 'queue3d'
  className?: string
  style?: Record<string, string | number>
  onClick?: () => void
  uploadStatus?: ResumeUploadIconStatus
  uploadFile?: {
    name: string
    sizeLabel: string
    extension: string
  } | null
  uploadProgress?: number
  uploadRemoving?: boolean
  onUploadRemove?: () => void
}

function resolveGeneratingMark(card: HomeCardItem) {
  const source = card.indexLabel || card.company || card.role || 'J'
  return source.trim().slice(0, 1).toUpperCase() || 'J'
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

function isLikelyWrappedCompanyName(company: string) {
  return Array.from(company.trim()).length > 8
}

function estimateCompactTextUnits(value: string) {
  return Array.from(value.trim()).reduce((total, char) => total + (/^[\x00-\x7F]$/.test(char) ? 0.58 : 1), 0)
}

function shouldAutoScrollValue(value: string) {
  return estimateCompactTextUnits(value) > 9.5
}

function renderCardValue(value: string, className: string, isMarqueeActive: boolean) {
  const shouldScroll = shouldAutoScrollValue(value)

  if (!shouldScroll) {
    return (
      <Text className={classNames('reffo-home-card__value', className)}>
        {value}
      </Text>
    )
  }

  return (
    <View
      className={classNames(
        'reffo-home-card__value reffo-home-card__value--marquee',
        {
          'reffo-home-card__value--marquee-active': isMarqueeActive,
        },
        className,
      )}
    >
      <View className='reffo-home-card__value-marquee-track'>
        <Text className='reffo-home-card__value-marquee-text'>{value}</Text>
        <Text className='reffo-home-card__value-marquee-text reffo-home-card__value-marquee-text--clone'>
          {value}
        </Text>
      </View>
    </View>
  )
}

function buildQueueAvatarSrc(card: HomeCardItem) {
  const profile = card.resumeProfile

  if (!profile) {
    return ''
  }

  const hairVariants = [
    'M54 62c0-22 18-38 42-38s42 16 42 38v20H54V62Z',
    'M50 68c2-26 20-45 46-45s43 19 46 45c-12-9-22-13-46-13s-34 4-46 13Z',
    'M58 60c4-23 17-36 38-36 22 0 36 13 40 36l-13 17H71L58 60Z',
  ]
  const hair = hairVariants[profile.avatarVariant % hairVariants.length]
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
      <defs>
        <linearGradient id="bg" x1="34" y1="18" x2="160" y2="176" gradientUnits="userSpaceOnUse">
          <stop stop-color="${profile.avatarPrimary}"/>
          <stop offset="1" stop-color="${profile.avatarAccent}"/>
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="96" fill="url(#bg)"/>
      <circle cx="96" cy="88" r="42" fill="#ffe3d0"/>
      <path d="${hair}" fill="#273142"/>
      <circle cx="81" cy="92" r="5" fill="#263344"/>
      <circle cx="111" cy="92" r="5" fill="#263344"/>
      <path d="M82 114c8 8 20 8 28 0" fill="none" stroke="#bd6f66" stroke-width="5" stroke-linecap="round"/>
      <path d="M43 166c10-28 29-42 53-42s43 14 53 42" fill="#ffffff" opacity=".86"/>
      <path d="M57 157c9-16 22-24 39-24s30 8 39 24" fill="${card.primaryColor}" opacity=".9"/>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export default function HomeScoreCard({
  card: inputCard,
  depth,
  active,
  visualTier,
  variant = 'score',
  presentation = 'default',
  className,
  style,
  onClick,
  uploadStatus = 'idle',
  uploadFile,
  uploadProgress = 0,
  uploadRemoving = false,
  onUploadRemove,
}: HomeScoreCardProps) {
  const [isValueMarqueeReady, setIsValueMarqueeReady] = useState(false)
  const card = variant === 'create' ? CREATE_CARD_ITEM : inputCard

  useEffect(() => {
    setIsValueMarqueeReady(false)

    if (!active || depth !== 0 || variant !== 'score') {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setIsValueMarqueeReady(true)
    }, 500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [active, depth, variant, card?.id])

  if (!card) {
    return null
  }

  const isDark = card.tone === 'dark'
  const isCreate = variant === 'create'
  const isGenerating = variant === 'generating'
  const isQueue3d = presentation === 'queue3d'
  const isQueueUpload = isQueue3d && card.queueCardKind === 'upload'
  const isQueueUploadComplete = isQueueUpload && uploadStatus === 'success' && Boolean(uploadFile)
  const normalizedUploadProgress = Math.max(0, Math.min(100, uploadProgress))
  const isQueueResume = isQueue3d && card.queueCardKind === 'resume' && card.resumeProfile
  const hasWrappedCompanyName = !isCreate && !isGenerating && isLikelyWrappedCompanyName(card.company)
  const scoreGrade = resolveResumeGrade(card.score)
  const scoreGradeClass = scoreGrade === 'A+' ? 'a' : scoreGrade.toLowerCase()
  const generatingMark = isGenerating ? resolveGeneratingMark(card) : ''
  const queueAvatarSrc = useMemo(() => buildQueueAvatarSrc(card), [card])
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
  const renderQueueResumeGlassTexture = () => (
    <CardTexture
      source={card}
      color={card.logoColor}
      className='reffo-home-card__resume-glass-texture'
    />
  )

  return (
    <View
      data-home-card-id={card.id}
      className={classNames(
        'reffo-home-card',
        `reffo-home-card--grade-${scoreGradeClass}`,
        {
          'reffo-home-card--dark': isDark,
          'reffo-home-card--active': active,
          'reffo-home-card--create': isCreate,
          'reffo-home-card--generating': isGenerating,
          'reffo-home-card--queue3d': isQueue3d,
          'reffo-home-card--queue-upload': isQueueUpload,
          'reffo-home-card--queue-resume': isQueueResume,
          'reffo-home-card--company-wrap': hasWrappedCompanyName,
        },
        className,
      )}
      style={cssVars}
      onClick={onClick}
    >
      {isQueue3d ? (
        <View className='reffo-home-card__thickness' aria-hidden='true'>
          <View className='reffo-home-card__thickness-plate reffo-home-card__thickness-plate--solid' />
          <View className='reffo-home-card__thickness-plate reffo-home-card__thickness-plate--outline' />
          <View className='reffo-home-card__thickness-foreground-shadow' />
          <View className='reffo-home-card__thickness-surface-shadow' />
        </View>
      ) : null}
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
        <CardTexture source={card} color={card.logoColor} />
        {isQueueUpload ? (
          <View className='reffo-home-card__queue-face-stack'>
            <View className='reffo-home-card__queue-face reffo-home-card__queue-face--front reffo-home-card__upload-front'>
              <Text className='reffo-home-card__upload-title'>新的申请</Text>
              <View className='reffo-home-card__upload-copy'>
                <Text className='reffo-home-card__upload-subtitle'>上传我自己的简历</Text>
                <Text className='reffo-home-card__upload-action'>开始</Text>
              </View>
            </View>
            <View
              className={classNames(
                'reffo-home-card__queue-face',
                'reffo-home-card__queue-face--back',
                'reffo-home-card__upload-back',
                {
                  'reffo-home-card__upload-back--uploading': uploadStatus === 'uploading',
                  'reffo-home-card__upload-back--complete': isQueueUploadComplete,
                  'reffo-home-card__upload-back--removing': uploadRemoving,
                },
              )}
              style={{
                '--queue-upload-blob-scale': String(
                  isQueueUploadComplete ? 1 : 0.42 + (normalizedUploadProgress * 0.0058),
                ),
              } as any}
            >
              <View
                className={classNames('reffo-home-card__upload-ambient', {
                  'reffo-home-card__upload-ambient--visible':
                    uploadStatus === 'uploading' || isQueueUploadComplete || uploadRemoving,
                  'reffo-home-card__upload-ambient--settled': isQueueUploadComplete,
                  'reffo-home-card__upload-ambient--removing': uploadRemoving,
                })}
                aria-hidden='true'
              >
                <View className='reffo-home-card__upload-ambient-blob'>
                  <View className='reffo-home-card__upload-ambient-color' />
                </View>
                <View className='reffo-home-card__upload-ambient-glass' />
              </View>
              <View
                className={classNames('reffo-home-card__upload-loading', {
                  'reffo-home-card__upload-loading--active': uploadStatus !== 'success' && !uploadRemoving,
                  'reffo-home-card__upload-loading--leaving': isQueueUploadComplete || uploadRemoving,
                })}
              >
                <ResumeUploadIcon
                  status={uploadStatus === 'error' ? 'error' : 'uploading'}
                  extension={uploadFile?.extension}
                  className='reffo-home-card__upload-pending-icon'
                />
                <Text className='reffo-home-card__upload-back-copy'>
                  {uploadStatus === 'uploading' ? `上传中 ${normalizedUploadProgress}%` : '上传文件'}
                </Text>
              </View>
              {uploadFile ? (
                <View className={classNames('reffo-home-card__upload-complete', {
                  'reffo-home-card__upload-complete--visible': isQueueUploadComplete || uploadRemoving,
                  'reffo-home-card__upload-complete--removing': uploadRemoving,
                })}>
                  <ResumeUploadIcon
                    status='success'
                    extension={uploadFile.extension}
                    className='reffo-home-card__upload-complete-icon'
                  />
                  <View className='reffo-home-card__upload-complete-copy'>
                    <Text className='reffo-home-card__upload-complete-name'>{uploadFile.name}</Text>
                    <Text className='reffo-home-card__upload-complete-size'>{uploadFile.sizeLabel}</Text>
                  </View>
                  <View
                    className='reffo-home-card__upload-complete-remove'
                    role='button'
                    aria-label='删除已上传简历'
                    onTouchStart={event => event.stopPropagation?.()}
                    onTouchEnd={event => event.stopPropagation?.()}
                    onClick={event => {
                      event.stopPropagation?.()
                      if (!uploadRemoving) {
                        onUploadRemove?.()
                      }
                    }}
                  >
                    <Text>删除</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ) : isGenerating ? (
          <View className='reffo-home-card__generating'>
            <View className='reffo-home-card__generating-flipper'>
              <View className='reffo-home-card__generating-face reffo-home-card__generating-face--front'>
                <View className='reffo-home-card__generating-handle reffo-home-card__generating-handle--front' />
                <View className='reffo-home-card__generating-mark'>
                  <Text className='reffo-home-card__generating-letter'>{generatingMark}</Text>
                </View>
                <View className='reffo-home-card__generating-bar reffo-home-card__generating-bar--wide' />
                <View className='reffo-home-card__generating-bar reffo-home-card__generating-bar--short' />
              </View>
              <View className='reffo-home-card__generating-face reffo-home-card__generating-face--back'>
                <View className='reffo-home-card__generating-handle reffo-home-card__generating-handle--back' />
                <View className='reffo-home-card__generating-spark-ring'>
                  <Text className='reffo-home-card__generating-spark reffo-home-card__generating-spark--main'>✦</Text>
                  <Text className='reffo-home-card__generating-spark reffo-home-card__generating-spark--small'>✦</Text>
                </View>
                <View className='reffo-home-card__generating-bar reffo-home-card__generating-bar--back-wide' />
                <View className='reffo-home-card__generating-bar reffo-home-card__generating-bar--back-short' />
              </View>
            </View>
          </View>
        ) : isCreate ? (
          <>
            <Text className='reffo-home-card__create-title'>{HOME_PAGE_CONTENT.createCard.title}</Text>
            <CardGlass className='reffo-home-card__glass--create'>
              <Text className='reffo-home-card__create-copy'>
                {HOME_PAGE_CONTENT.createCard.promptPrefix}
                {HOME_PAGE_CONTENT.createCard.promptAccent}
              </Text>
            </CardGlass>
          </>
        ) : (
          <>
            {isQueueResume && card.resumeProfile ? (
              <View className='reffo-home-card__queue-face-stack'>
                <View className='reffo-home-card__queue-face reffo-home-card__queue-face--front'>
                  <View className='reffo-home-card__score reffo-home-card__resume-score'>
                    <Image className='reffo-home-card__resume-avatar' src={queueAvatarSrc} mode='aspectFill' />
                    <View className='reffo-home-card__resume-person'>
                      <Text className='reffo-home-card__resume-name'>{card.resumeProfile.name}</Text>
                      <Text className='reffo-home-card__resume-meta'>
                        {card.resumeProfile.age}岁 · {card.resumeProfile.gender}
                      </Text>
                    </View>
                  </View>
                  <CardGlass className='reffo-home-card__resume-glass'>
                    {renderQueueResumeGlassTexture()}
                    <View className='reffo-home-card__resume-tags'>
                      {card.resumeProfile.tags.map(tag => (
                        <Text key={tag} className='reffo-home-card__resume-tag'>{tag}</Text>
                      ))}
                    </View>
                  </CardGlass>
                </View>
                <View className='reffo-home-card__queue-face reffo-home-card__queue-face--back reffo-home-card__queue-face--resume-back'>
                  <View className='reffo-home-card__score reffo-home-card__resume-score'>
                    <Image className='reffo-home-card__resume-avatar' src={queueAvatarSrc} mode='aspectFill' />
                    <View className='reffo-home-card__resume-person'>
                      <Text className='reffo-home-card__resume-name'>{card.resumeProfile.name}</Text>
                      <Text className='reffo-home-card__resume-meta'>
                        {card.resumeProfile.age}岁 · {card.resumeProfile.gender}
                      </Text>
                    </View>
                  </View>
                  <CardGlass className='reffo-home-card__resume-glass reffo-home-card__resume-glass--detail'>
                    {renderQueueResumeGlassTexture()}
                    <View className='reffo-home-card__resume-detail-copy'>
                      <Text className='reffo-home-card__resume-detail-summary'>
                        {card.resumeProfile.summary}
                      </Text>
                      <Text className='reffo-home-card__resume-detail-experience'>
                        {card.strategyBody}
                      </Text>
                    </View>
                  </CardGlass>
                </View>
              </View>
            ) : (
              <>
                <View className='reffo-home-card__score'>
                  <Text className='reffo-home-card__grade-letter'>{scoreGrade}</Text>
                  <Text className='reffo-home-card__grade-meta'>评级</Text>
                </View>
                <CardGlass>
                  <View className='reffo-home-card__field'>
                    <Text className='reffo-home-card__label'>公司</Text>
                    <Text className='reffo-home-card__value reffo-home-card__company'>{card.company}</Text>
                  </View>
                  <View className='reffo-home-card__field'>
                    <Text className='reffo-home-card__label'>岗位</Text>
                    {renderCardValue(card.role, 'reffo-home-card__role', isValueMarqueeReady)}
                  </View>
                  <View className='reffo-home-card__field'>
                    <Text className='reffo-home-card__label'>工作地</Text>
                    {renderCardValue(card.location, 'reffo-home-card__location', isValueMarqueeReady)}
                  </View>
                  <View className='reffo-home-card__date-row'>
                    <Text className='reffo-home-card__date-label'>生成日期</Text>
                    <Text className='reffo-home-card__date'>{card.dateLabel}</Text>
                  </View>
                </CardGlass>
              </>
            )}
          </>
        )}
      </View>
    </View>
  )
}
