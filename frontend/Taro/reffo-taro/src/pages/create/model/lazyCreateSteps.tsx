import {useEffect, useState} from 'react'
import type {ComponentType} from 'react'
import type {CreateStepId} from '../types'
import CreateStepLoading from '../components/CreateStepLoading.h5'
import type {ResumeUploadStepH5Props} from '../components/ResumeUploadStepH5'
import type {ResumeSummaryStepH5Props} from '../components/ResumeSummaryStepH5'
import type {JobDescriptionFormH5Props} from '../components/JobDescriptionFormH5'
import type {GenerationStageH5Props} from '@/components/business/GenerationStageH5'
import type {DeleteBreakCardProps} from '@/components/business/DeleteBreakCard/index.h5'

function createComponentStore<Props>(
  loader: () => Promise<{default: ComponentType<Props>}>,
) {
  let component: ComponentType<Props> | null = null
  let loadingPromise: Promise<ComponentType<Props>> | null = null
  const listeners = new Set<() => void>()

  const preload = () => {
    if (component) {
      return Promise.resolve(component)
    }

    if (!loadingPromise) {
      loadingPromise = loader()
        .then(module => {
          component = module.default
          listeners.forEach(listener => listener())
          return component
        })
        .catch(error => {
          loadingPromise = null
          throw error
        })
    }

    return loadingPromise
  }

  const useComponent = () => {
    const [loadedComponent, setLoadedComponent] = useState<ComponentType<Props> | null>(() => component)

    useEffect(() => {
      const listener = () => setLoadedComponent(() => component)
      listeners.add(listener)
      listener()
      void preload().catch(() => undefined)

      return () => {
        listeners.delete(listener)
      }
    }, [])

    return loadedComponent
  }

  return {preload, useComponent}
}

const resumeUploadStep = createComponentStore<ResumeUploadStepH5Props>(
  () => import('../components/ResumeUploadStepH5'),
)
const resumeSummaryStep = createComponentStore<ResumeSummaryStepH5Props>(
  () => import('../components/ResumeSummaryStepH5'),
)
const jobDescriptionStep = createComponentStore<JobDescriptionFormH5Props>(
  () => import('../components/JobDescriptionFormH5'),
)
const generationStage = createComponentStore<GenerationStageH5Props>(
  () => import('@/components/business/GenerationStageH5'),
)
const deleteBreakCard = createComponentStore<DeleteBreakCardProps>(
  () => import('@/components/business/DeleteBreakCard/index.h5'),
)

export function preloadCreateStep(step: CreateStepId) {
  const store = step === 'resumeUpload'
    ? resumeUploadStep
    : step === 'resumeSummary'
      ? resumeSummaryStep
      : jobDescriptionStep
  return store.preload().then(() => undefined)
}

export function preloadGenerationStage() {
  return generationStage.preload().then(() => undefined)
}

export function preloadDeleteBreakCard() {
  return deleteBreakCard.preload().then(() => undefined)
}

export function ResumeUploadStepRoute(props: ResumeUploadStepH5Props) {
  const Component = resumeUploadStep.useComponent()
  return Component ? <Component {...props} /> : <CreateStepLoading />
}

export function ResumeSummaryStepRoute(props: ResumeSummaryStepH5Props) {
  const Component = resumeSummaryStep.useComponent()
  return Component ? <Component {...props} /> : <CreateStepLoading />
}

export function JobDescriptionStepRoute(props: JobDescriptionFormH5Props) {
  const Component = jobDescriptionStep.useComponent()
  return Component ? <Component {...props} /> : <CreateStepLoading />
}

export function GenerationStageRoute(props: GenerationStageH5Props) {
  const Component = generationStage.useComponent()
  return Component ? <Component {...props} /> : <CreateStepLoading />
}

export function DeleteBreakCardRoute(props: DeleteBreakCardProps) {
  const Component = deleteBreakCard.useComponent()
  return Component ? <Component {...props} /> : <CreateStepLoading />
}
