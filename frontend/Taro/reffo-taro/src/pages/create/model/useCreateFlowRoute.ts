import {useCallback, useEffect, useState} from 'react'
import {runViewTransition, type ViewTransitionKind} from '@/shared/motion'
import type {CreateStepId} from '../types'
import {preloadCreateStep} from './lazyCreateSteps'

interface CreateFlowRoute {
  step: CreateStepId
  navigationId: number
}

interface CreateFlowRouteOptions {
  preloadInitialStep?: boolean
}

export function useCreateFlowRoute(
  initialStep: CreateStepId,
  {preloadInitialStep = true}: CreateFlowRouteOptions = {},
) {
  const [route, setRoute] = useState<CreateFlowRoute>(() => ({
    step: initialStep,
    navigationId: 0,
  }))

  useEffect(() => {
    if (!preloadInitialStep) {
      return
    }

    void preloadCreateStep(initialStep).catch(error => {
      console.warn('[useCreateFlowRoute] Failed to preload initial step:', error)
    })
  }, [initialStep, preloadInitialStep])

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
