import {create} from 'zustand'
import type {
  MatchingResult,
  OptimizedResume,
  ResumeAnalysis,
  InterviewSuggestions,
} from '@/types'

export type GenerationStatus =
  | 'idle'
  | 'analyzing'
  | 'matching'
  | 'optimizing'
  | 'interviewing'
  | 'completed'
  | 'failed'

export type ActiveGenerationStatus = Exclude<GenerationStatus, 'idle' | 'completed' | 'failed'>

const GENERATION_SEQUENCE: ActiveGenerationStatus[] = [
  'analyzing',
  'matching',
  'optimizing',
  'interviewing',
]

export interface ResumeWorkspaceState {
  sourceResume: string
  jobDescription: string
  analysis: ResumeAnalysis | null
  matching: MatchingResult | null
  optimizedResume: OptimizedResume | null
  interview: InterviewSuggestions | null
  generationStatus: GenerationStatus
  generationRunId: number
  error: string | null
  setSourceResume: (value: string) => void
  setJobDescription: (value: string) => void
  setAnalysis: (value: ResumeAnalysis | null) => void
  setMatching: (value: MatchingResult | null) => void
  setOptimizedResume: (value: OptimizedResume | null) => void
  setInterview: (value: InterviewSuggestions | null) => void
  startGeneration: (initialStatus?: ActiveGenerationStatus) => number
  transitionGeneration: (runId: number, nextStatus: ActiveGenerationStatus) => boolean
  completeGeneration: (runId: number) => boolean
  failGeneration: (runId: number, error: string) => boolean
  cancelGeneration: (runId: number) => boolean
  markGenerationCompleted: () => void
  reset: () => void
}

export const initialResumeWorkspaceState = {
  sourceResume: '',
  jobDescription: '',
  analysis: null,
  matching: null,
  optimizedResume: null,
  interview: null,
  generationStatus: 'idle' as GenerationStatus,
  generationRunId: 0,
  error: null,
}

export const useResumeWorkspaceStore = create<ResumeWorkspaceState>((set, get) => ({
  ...initialResumeWorkspaceState,
  setSourceResume: sourceResume => set({sourceResume}),
  setJobDescription: jobDescription => set({jobDescription}),
  setAnalysis: analysis => set({analysis}),
  setMatching: matching => set({matching}),
  setOptimizedResume: optimizedResume => set({optimizedResume}),
  setInterview: interview => set({interview}),
  startGeneration: (initialStatus = 'analyzing') => {
    const generationRunId = get().generationRunId + 1
    set({generationRunId, generationStatus: initialStatus, error: null})
    return generationRunId
  },
  transitionGeneration: (runId, nextStatus) => {
    const state = get()
    if (state.generationRunId !== runId) return false

    const currentIndex = GENERATION_SEQUENCE.indexOf(state.generationStatus as ActiveGenerationStatus)
    const nextIndex = GENERATION_SEQUENCE.indexOf(nextStatus)
    if (currentIndex < 0 || (nextIndex !== currentIndex && nextIndex !== currentIndex + 1)) {
      return false
    }

    set({generationStatus: nextStatus, error: null})
    return true
  },
  completeGeneration: runId => {
    const state = get()
    if (state.generationRunId !== runId || state.generationStatus !== 'interviewing') {
      return false
    }
    set({generationStatus: 'completed', error: null})
    return true
  },
  failGeneration: (runId, error) => {
    const state = get()
    if (state.generationRunId !== runId || !GENERATION_SEQUENCE.includes(state.generationStatus as ActiveGenerationStatus)) {
      return false
    }
    set({generationStatus: 'failed', error})
    return true
  },
  cancelGeneration: runId => {
    const state = get()
    if (state.generationRunId !== runId || !GENERATION_SEQUENCE.includes(state.generationStatus as ActiveGenerationStatus)) {
      return false
    }
    set({
      generationRunId: state.generationRunId + 1,
      generationStatus: 'idle',
      error: null,
    })
    return true
  },
  markGenerationCompleted: () => set(state => ({
    generationRunId: state.generationRunId + 1,
    generationStatus: 'completed',
    error: null,
  })),
  reset: () => set(state => ({
    ...initialResumeWorkspaceState,
    generationRunId: state.generationRunId + 1,
  })),
}))

// Imperative entry point for page commands. Pages should read state through selectors.
export const resumeWorkspaceActions = {
  setSourceResume: (value: string) => useResumeWorkspaceStore.getState().setSourceResume(value),
  setJobDescription: (value: string) => useResumeWorkspaceStore.getState().setJobDescription(value),
  setAnalysis: (value: ResumeAnalysis | null) => useResumeWorkspaceStore.getState().setAnalysis(value),
  setMatching: (value: MatchingResult | null) => useResumeWorkspaceStore.getState().setMatching(value),
  setOptimizedResume: (value: OptimizedResume | null) => useResumeWorkspaceStore.getState().setOptimizedResume(value),
  setInterview: (value: InterviewSuggestions | null) => useResumeWorkspaceStore.getState().setInterview(value),
  startGeneration: (initialStatus?: ActiveGenerationStatus) => useResumeWorkspaceStore.getState().startGeneration(initialStatus),
  transitionGeneration: (runId: number, nextStatus: ActiveGenerationStatus) => useResumeWorkspaceStore.getState().transitionGeneration(runId, nextStatus),
  completeGeneration: (runId: number) => useResumeWorkspaceStore.getState().completeGeneration(runId),
  failGeneration: (runId: number, error: string) => useResumeWorkspaceStore.getState().failGeneration(runId, error),
  cancelGeneration: (runId: number) => useResumeWorkspaceStore.getState().cancelGeneration(runId),
  markGenerationCompleted: () => useResumeWorkspaceStore.getState().markGenerationCompleted(),
  reset: () => useResumeWorkspaceStore.getState().reset(),
}
