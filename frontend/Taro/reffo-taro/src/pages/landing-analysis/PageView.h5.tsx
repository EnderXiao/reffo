import {Text, View} from '@tarojs/components'
import GenerationStageH5 from '@/components/business/GenerationStageH5'
import CreatePrimaryActionH5 from '../create/components/CreatePrimaryActionH5'
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
  generationError,
  resumeSummaryState,
  jobDescriptionState,
  handleCancelGeneration,
  handleClose,
  handleLandingSkip,
  handlePrimaryAction,
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

  const header = showLandingHeader ? (
    <LandingFlowHeader
      className='reffo-create__landing-header--analysis'
      onBack={handleClose}
      onSkip={handleLandingSkip}
      progressStep={2}
    />
  ) : null

  const generationStage = generationError ? (
    <View className='reffo-landing-analysis__failure' role='alert'>
      {header}
      <View className='reffo-landing-analysis__failure-copy'>
        <Text className='reffo-landing-analysis__failure-title'>生成暂时中断</Text>
        <Text className='reffo-landing-analysis__failure-message'>{generationError}</Text>
        <CreatePrimaryActionH5 label='重新生成' onClick={() => void handlePrimaryAction()} />
        <View className='reffo-landing-analysis__failure-back' role='button' onClick={handleClose}>返回岗位</View>
      </View>
    </View>
  ) : (
    <GenerationStageH5
      state={visibleGenerationState}
      onCancelGeneration={handleCancel}
      header={header}
    />
  )

  return embedded
    ? generationStage
    : <View className='reffo-landing-analysis'>{generationStage}</View>
}
