import {useEffect, useMemo, useState} from 'react'
import {Text, View} from '@tarojs/components'
import type {ReactNode} from 'react'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {
  deriveCardPalette,
  deriveSeedColorFromString,
} from '@/components/business/HomeCardDeck/palette'
import {useVisualTier} from '@/utils'

export interface GenerationStageState {
  resumeTitle: string
  companyName: string
  positionName: string
  baseLocation: string
  monogram: string
  cardSeed?: string
  phase: 'analyzing' | 'matching' | 'generating'
}

export interface GenerationStageH5Props {
  state: GenerationStageState
  onCancelGeneration: () => void
  onContinueInBackground?: () => void | Promise<void>
  header?: ReactNode
}

export default function GenerationStageH5({
  state,
  onCancelGeneration,
  onContinueInBackground,
  header,
}: GenerationStageH5Props) {
  const {tier: visualTier} = useVisualTier({benchmark: false})
  const titleReelItems = useMemo(() => {
    const items = [
      state.resumeTitle.trim() || '源简历',
      state.companyName.trim() || '目标公司',
      state.positionName.trim() || '目标岗位',
      state.baseLocation.trim() || '目标城市',
    ]

    return Array.from(new Set(items))
  }, [state.baseLocation, state.companyName, state.positionName, state.resumeTitle])
  const [titleReelIndex, setTitleReelIndex] = useState(0)
  useEffect(() => {
    if (titleReelItems.length < 2) {
      setTitleReelIndex(0)
      return undefined
    }
    const timer = window.setInterval(() => {
      setTitleReelIndex(index => (index + 1) % titleReelItems.length)
    }, 2400)
    return () => window.clearInterval(timer)
  }, [titleReelItems.length])
  const card = useMemo<HomeCardItem>(() => {
    const company = state.companyName.trim() || state.resumeTitle || 'Reffo'
    const role = state.positionName.trim() || '相契简历'
    const seed = state.cardSeed || [
      state.resumeTitle.trim(),
      company,
      role,
      state.baseLocation.trim(),
    ].filter(Boolean).join('|')
    const palette = deriveCardPalette(deriveSeedColorFromString(seed))

    return {
      id: `generation-${company}-${role}`,
      company,
      indexLabel: state.monogram,
      location: state.baseLocation.trim() || '智能生成中',
      role,
      dateLabel: '今天',
      score: 88,
      primaryColor: palette.primaryColor,
      surfaceColor: palette.surfaceColor,
      stackColor: palette.stackColor,
      logoColor: palette.logoColor,
      borderColor: palette.borderColor,
      tone: palette.tone,
      strategyBody: '',
    }
  }, [state.baseLocation, state.cardSeed, state.companyName, state.monogram, state.positionName, state.resumeTitle])

  return (
    <View className='reffo-create-generation' data-testid='create-analysis-stage' aria-busy='true' aria-live='polite'>
      <View className='reffo-create-generation__backdrop' />
      {header}
      <View className='reffo-create-generation__content'>
        <View className='reffo-create-generation__main'>
          <View className='reffo-create-generation__card-stage reffo-home-deck-wrap--enhanced'>
            <HomeScoreCard
              card={card}
              depth={0}
              active
              visualTier={visualTier}
              variant='generating'
              className='reffo-create-generation__home-card'
            />
          </View>
          <View className='reffo-create-generation__copy'>
            <View className='reffo-create-generation__title'>
              <Text className='reffo-create-generation__title-accent'>正在分析 </Text>
              <View className='reffo-create-generation__title-reel' aria-hidden='true'>
                {titleReelItems.map((item, index) => (
                  <Text
                    key={`${item}-${index}`}
                    className={`reffo-create-generation__title-main ${index === titleReelIndex ? 'reffo-create-generation__title-main--active' : ''}`}
                  >
                    {item}
                  </Text>
                ))}
              </View>
            </View>
            <Text className='reffo-create-generation__detail'>
              正在为你的目标岗位量身定做相契简历……
            </Text>
            <View className='reffo-create-generation__steps' aria-hidden='true'>
              {(['analyzing', 'matching', 'generating'] as const).map((phase, index) => (
                <View key={phase} className={`reffo-create-generation__step ${state.phase === phase ? 'reffo-create-generation__step--active' : ''} ${index < ['analyzing', 'matching', 'generating'].indexOf(state.phase) ? 'reffo-create-generation__step--done' : ''}`}>
                  <View className='reffo-create-generation__step-dot' /><Text>{['分析源简历', '匹配目标岗位', '生成相契简历'][index]}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View className='reffo-create-generation__actions'>
          {onContinueInBackground ? <View
            className='reffo-create-generation__background-action'
            onClick={() => void onContinueInBackground()}
            role='button'
            data-testid='analysis-background-action'
          >
            <Text className='reffo-create-generation__background-arrow'>↗</Text>
            <Text>后台继续生成</Text>
          </View> : null}
          <View className='reffo-create-generation__cancel' onClick={onCancelGeneration} data-testid='analysis-cancel-action'>
            <Text>× 取消生成</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
