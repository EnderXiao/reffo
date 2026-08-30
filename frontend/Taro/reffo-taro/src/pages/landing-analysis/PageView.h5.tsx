import {View} from '@tarojs/components'
import GenerationStageH5 from '@/components/business/GenerationStageH5'
import {buildPendingGenerationState} from '../create/utils/generationState'
import LandingFlowHeader from '../create/components/LandingFlowHeader.h5'
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
      header={showLandingHeader ? (
        <LandingFlowHeader
          className='reffo-create__landing-header--analysis'
          onBack={handleClose}
          onSkip={handleLandingSkip}
          progressStep={2}
        />
      ) : null}
    />
  )

  return embedded
    ? generationStage
    : <View className='reffo-landing-analysis'>{generationStage}</View>
}
