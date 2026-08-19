import {useMemo} from 'react'
import {Text, View} from '@tarojs/components'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {deriveCardPalette} from '@/components/business/HomeCardDeck/palette'
import {useVisualTier} from '@/utils'
import type {
  CreateGenerationState,
  JobDescriptionStepState,
  ResumeSummaryStepState,
} from '../types'
import type {CreatePageViewModel} from '../usePageModel'
import LandingFlowHeader from './LandingFlowHeader.h5'

const GENERATION_CARD_PALETTE = deriveCardPalette('#FF6A43')

export function buildPendingGenerationState({
  resumeSummaryState,
  jobDescriptionState,
}: {
  resumeSummaryState: ResumeSummaryStepState | null
  jobDescriptionState: JobDescriptionStepState
}): CreateGenerationState {
  const companyName = jobDescriptionState.companyName.trim()
  const positionName = jobDescriptionState.positionName.trim()
  const baseLocation = jobDescriptionState.baseLocation.trim()
  const resumeTitle = resumeSummaryState?.title || resumeSummaryState?.fileName || '源简历'
  const resumeMonogram = resumeTitle.trim().match(/[A-Za-z0-9\u4e00-\u9fa5]/u)?.[0] || 'R'
  const monogram = /[A-Za-z]/.test(resumeMonogram) ? resumeMonogram.toUpperCase() : resumeMonogram

  return {
    resumeTitle,
    companyName,
    positionName,
    baseLocation,
    monogram,
    detailItems: [],
  }
}

interface GenerationStageH5Props {
  state: CreateGenerationState
  onCancelGeneration: CreatePageViewModel['handleCancelGeneration']
  isLandingFlow?: boolean
  onLandingBack?: () => void
  onLandingSkip?: () => Promise<void>
}

export default function GenerationStageH5({
  state,
  onCancelGeneration,
  isLandingFlow = false,
  onLandingBack,
  onLandingSkip,
}: GenerationStageH5Props) {
  const {tier: visualTier} = useVisualTier({benchmark: false})
  const titleReelItems = useMemo(() => {
    const items = [
      state.resumeTitle.trim() || '源简历',
      state.companyName.trim() || '目标公司',
      state.positionName.trim() || '目标岗位',
      state.baseLocation.trim() || '目标城市',
    ]

    return [...items, items[0]]
  }, [state.baseLocation, state.companyName, state.positionName, state.resumeTitle])
  const card = useMemo<HomeCardItem>(() => {
    const company = state.companyName.trim() || state.resumeTitle || 'Reffo'
    const role = state.positionName.trim() || '最佳匹配简历'

    return {
      id: `generation-${company}-${role}`,
      company,
      indexLabel: state.monogram,
      location: state.baseLocation.trim() || '智能生成中',
      role,
      dateLabel: '今天',
      score: 88,
      primaryColor: GENERATION_CARD_PALETTE.primaryColor,
      surfaceColor: GENERATION_CARD_PALETTE.surfaceColor,
      stackColor: GENERATION_CARD_PALETTE.stackColor,
      logoColor: GENERATION_CARD_PALETTE.logoColor,
      borderColor: GENERATION_CARD_PALETTE.borderColor,
      tone: GENERATION_CARD_PALETTE.tone,
      strategyBody: '',
    }
  }, [state.baseLocation, state.companyName, state.monogram, state.positionName, state.resumeTitle])

  return (
    <View className='reffo-create-generation'>
      <View className='reffo-create-generation__backdrop' />
      {isLandingFlow && onLandingBack && onLandingSkip ? (
        <LandingFlowHeader
          className='reffo-create__landing-header--analysis'
          onBack={onLandingBack}
          onSkip={onLandingSkip}
          progressStep={2}
        />
      ) : null}
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
                <View className='reffo-create-generation__title-reel-track'>
                  {titleReelItems.map((item, index) => (
                    <Text key={`${item}-${index}`} className='reffo-create-generation__title-main'>
                      {item}
                    </Text>
                  ))}
                </View>
              </View>
            </View>
            <Text className='reffo-create-generation__detail'>
              正在为你的目标岗位量身定做最佳匹配简历……
            </Text>
          </View>
        </View>
        <View className='reffo-create-generation__cancel' onClick={onCancelGeneration}>
          <Text>× 取消生成</Text>
        </View>
      </View>
    </View>
  )
}
