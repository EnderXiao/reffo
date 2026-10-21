import {useCallback, useEffect, useState} from 'react'
import {runViewTransition, type ViewTransitionKind} from '@/shared/motion'
import type {CreateStepId} from '../types'
import {preloadCreateStep} from './lazyCreateSteps'

interface CreateFlowRoute {
  step: CreateStepId
  navigationId: number
}

export function useCreateFlowRoute(initialStep: CreateStepId) {
  const [route, setRoute] = useState<CreateFlowRoute>(() => ({
    step: initialStep,
    navigationId: 0,
  }))

  useEffect(() => {
    void preloadCreateStep(initialStep)
  }, [initialStep])

  const transitionToStep = useCallback(async (
    step: CreateStepId,
    kind: ViewTransitionKind = 'forward',
    update?: () => void,
  ) => {
    await preloadCreateStep(step)
    await runViewTransition(kind, () => {
      update?.()
      setRoute(current => current.step === step
        ? current
        : {step, navigationId: current.navigationId + 1})
    })
  }, [])

  const replaceStep = useCallback(async (step: CreateStepId, update?: () => void) => {
    await transitionToStep(step, 'replace', update)
  }, [transitionToStep])

  return {
    currentStep: route.step,
    routeKey: route.navigationId,
    transitionToStep,
    replaceStep,
  }
}
