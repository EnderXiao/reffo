import type {StoreApi, UseBoundStore} from 'zustand'
import {useResumeWorkspaceStore} from './resumeWorkspaceStore'
import type {ResumeState} from './types'

function mapResumeState(state: ReturnType<typeof useResumeWorkspaceStore.getState>): ResumeState {
  return {
    resumeContent: state.sourceResume,
    analysis: state.analysis,
    loading: {
      isLoading: state.generationStatus !== 'idle' && state.generationStatus !== 'completed' && state.generationStatus !== 'failed',
      error: state.error,
    },
    setResumeContent: state.setSourceResume,
    setAnalysis: state.setAnalysis,
    setLoading: isLoading => state.setGenerationStatus(isLoading ? 'analyzing' : 'idle'),
    setError: state.setError,
    reset: state.reset,
  }
}

type ResumeStore = UseBoundStore<StoreApi<ResumeState>>

export const useResumeStore = Object.assign(
  (selector?: (state: ResumeState) => unknown) => useResumeWorkspaceStore(state => {
    const mapped = mapResumeState(state)
    return selector ? selector(mapped) : mapped
  }),
  {
    getState: () => mapResumeState(useResumeWorkspaceStore.getState()),
    setState: () => undefined,
    subscribe: (listener: (state: ResumeState, previous: ResumeState) => void) => (
      useResumeWorkspaceStore.subscribe((state, previous) => listener(mapResumeState(state), mapResumeState(previous)))
    ),
  },
) as unknown as ResumeStore
