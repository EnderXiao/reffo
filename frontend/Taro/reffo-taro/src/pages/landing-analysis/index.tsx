import {useCallback, useEffect} from 'react'
import {View} from '@tarojs/components'
import type {LatestResultSession} from '@/utils/result-session'
import AnalysisPageView from './PageView.h5'
import ResultPageView from '../result/PageView.h5'
import {usePageModel as useCreatePageModel} from '../create/usePageModel'
import {usePageModel as useResultPageModel} from '../result/usePageModel'
import {usePageStateRoute} from '@/shared/routing'

type LandingAnalysisPhase =
  | {kind: 'analysis'}
  | {kind: 'result'; session: LatestResultSession}

function LandingInlineResult({
  session,
  hideLandingHeader,
  onCompleteReady,
  onCompletionChange,
}: {
  session: LatestResultSession
  hideLandingHeader: boolean
  onCompleteReady?: (handler: (() => void) | null) => void
  onCompletionChange?: (isComplete: boolean) => void
}) {
  const model = useResultPageModel({
    enteredFromLanding: true,
    initialSession: session,
  })

  useEffect(() => {
    onCompleteReady?.(() => {
      void model.handleComplete()
    })

    return () => {
      onCompleteReady?.(null)
    }
  }, [model.handleComplete, onCompleteReady])

  useEffect(() => {
    onCompletionChange?.(model.progress.interview === 'done')
  }, [model.progress.interview, onCompletionChange])

  useEffect(() => () => {
    onCompletionChange?.(false)
  }, [onCompletionChange])

  return <ResultPageView {...model} hideLandingHeader={hideLandingHeader} />
}

interface LandingAnalysisPageProps {
  onExit?: () => void
  useSharedHeader?: boolean
  onPhaseChange?: (phase: 'analysis' | 'result') => void
  onResultCompleteReady?: (handler: (() => void) | null) => void
  onResultCompletionChange?: (isComplete: boolean) => void
}

export default function LandingAnalysisPage({
  onExit,
  useSharedHeader = false,
  onPhaseChange,
  onResultCompleteReady,
  onResultCompletionChange,
}: LandingAnalysisPageProps) {
  const {state: phase, transitionTo} = usePageStateRoute<LandingAnalysisPhase>({kind: 'analysis'})
  const handleGenerationComplete = useCallback(async (session: LatestResultSession) => {
    await transitionTo({kind: 'result', session}, 'forward')
    onPhaseChange?.('result')
  }, [onPhaseChange, transitionTo])
  const model = useCreatePageModel({
    autoGenerateLanding: true,
    onLandingGenerationComplete: handleGenerationComplete,
  })

  return (
    <View className='reffo-landing-analysis'>
      {phase.kind === 'result' ? (
        <LandingInlineResult
          session={phase.session}
          hideLandingHeader={useSharedHeader}
          onCompleteReady={onResultCompleteReady}
          onCompletionChange={onResultCompletionChange}
        />
      ) : (
        <AnalysisPageView
          {...model}
          handleClose={onExit ?? model.handleClose}
          embedded
          showLandingHeader={!useSharedHeader}
        />
      )}
    </View>
  )
}
