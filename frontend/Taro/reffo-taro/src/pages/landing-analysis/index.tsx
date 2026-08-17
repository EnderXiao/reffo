import {useCallback, useEffect, useState} from 'react'
import {flushSync} from 'react-dom'
import {View} from '@tarojs/components'
import type {LatestResultSession} from '@/utils/result-session'
import AnalysisPageView from './PageView'
import ResultPageView from '../result/PageView'
import {usePageModel as useCreatePageModel} from '../create/usePageModel'
import {usePageModel as useResultPageModel} from '../result/usePageModel'

type LandingAnalysisPhase =
  | {kind: 'analysis'}
  | {kind: 'result'; session: LatestResultSession}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>
  }
}

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
  const [phase, setPhase] = useState<LandingAnalysisPhase>({kind: 'analysis'})
  const handleGenerationComplete = useCallback(async (session: LatestResultSession) => {
    const showResult = () => {
      setPhase({kind: 'result', session})
    }

    if (
      typeof document === 'undefined'
      || typeof (document as DocumentWithViewTransition).startViewTransition !== 'function'
    ) {
      showResult()
      onPhaseChange?.('result')
      return
    }

    const root = document.documentElement
    root.dataset.reffoViewTransition = 'forward'
    const transition = (document as DocumentWithViewTransition).startViewTransition?.(() => {
      flushSync(showResult)
    })

    if (!transition) {
      delete root.dataset.reffoViewTransition
      showResult()
      onPhaseChange?.('result')
      return
    }

    await transition.finished.catch(() => undefined)
    delete root.dataset.reffoViewTransition
    onPhaseChange?.('result')
  }, [onPhaseChange])
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
