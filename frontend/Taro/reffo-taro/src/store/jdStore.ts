import type {StoreApi, UseBoundStore} from 'zustand'
import {useResumeWorkspaceStore} from './resumeWorkspaceStore'
import type {JDState} from './types'

function mapJDState(state: ReturnType<typeof useResumeWorkspaceStore.getState>): JDState {
  return {
    jdContent: state.jobDescription,
    matching: state.matching,
    loading: {
      isLoading: state.generationStatus !== 'idle' && state.generationStatus !== 'completed' && state.generationStatus !== 'failed',
      error: state.error,
    },
    setJDContent: state.setJobDescription,
    setMatching: state.setMatching,
    setLoading: isLoading => state.setGenerationStatus(isLoading ? 'matching' : 'idle'),
    setError: state.setError,
    reset: state.reset,
  }
}

type JDStore = UseBoundStore<StoreApi<JDState>>

export const useJDStore = Object.assign(
  (selector?: (state: JDState) => unknown) => useResumeWorkspaceStore(state => {
    const mapped = mapJDState(state)
    return selector ? selector(mapped) : mapped
  }),
  {
    getState: () => mapJDState(useResumeWorkspaceStore.getState()),
    setState: () => undefined,
    subscribe: (listener: (state: JDState, previous: JDState) => void) => (
      useResumeWorkspaceStore.subscribe((state, previous) => listener(mapJDState(state), mapJDState(previous)))
    ),
  },
) as unknown as JDStore
