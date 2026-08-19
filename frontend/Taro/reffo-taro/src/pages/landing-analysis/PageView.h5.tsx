import {View} from '@tarojs/components'
import GenerationStageH5, {buildPendingGenerationState} from '../create/components/GenerationStageH5'
import type {CreatePageViewModel} from '../create/usePageModel'
import '../index/index.h5.scss'
import '../create/index.h5.scss'
import './index.h5.scss'

type LandingAnalysisPageViewProps = CreatePageViewModel & {
  embedded?: boolean
  showLandingHeader?: boolean
}

export default function LandingAnalysisPageView({
  generationState,
  resumeSummaryState,
  jobDescriptionState,
  handleCancelGeneration,
  handleClose,
  handleLandingSkip,
  embedded = false,
  showLandingHeader = true,
}: LandingAnalysisPageViewProps) {
  const visibleGenerationState = generationState || buildPendingGenerationState({
    resumeSummaryState,
    jobDescriptionState,
  })

  const handleCancel = () => {
    handleCancelGeneration()
    handleClose()
  }

  const generationStage = (
    <GenerationStageH5
      state={visibleGenerationState}
      onCancelGeneration={handleCancel}
      isLandingFlow={showLandingHeader}
      onLandingBack={handleClose}
      onLandingSkip={handleLandingSkip}
    />
  )

  return embedded
    ? generationStage
    : <View className='reffo-landing-analysis'>{generationStage}</View>
}
