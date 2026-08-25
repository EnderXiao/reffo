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

export interface ResumeWorkspaceState {
  sourceResume: string
  jobDescription: string
  analysis: ResumeAnalysis | null
  matching: MatchingResult | null
  optimizedResume: OptimizedResume | null
  interview: InterviewSuggestions | null
  generationStatus: GenerationStatus
  error: string | null
  setSourceResume: (value: string) => void
  setJobDescription: (value: string) => void
  setAnalysis: (value: ResumeAnalysis | null) => void
  setMatching: (value: MatchingResult | null) => void
  setOptimizedResume: (value: OptimizedResume | null) => void
  setInterview: (value: InterviewSuggestions | null) => void
  setGenerationStatus: (value: GenerationStatus) => void
  setError: (value: string | null) => void
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
  error: null,
}

export const useResumeWorkspaceStore = create<ResumeWorkspaceState>(set => ({
  ...initialResumeWorkspaceState,
  setSourceResume: sourceResume => set({sourceResume}),
  setJobDescription: jobDescription => set({jobDescription}),
  setAnalysis: analysis => set({analysis}),
  setMatching: matching => set({matching}),
  setOptimizedResume: optimizedResume => set({optimizedResume}),
  setInterview: interview => set({interview}),
  setGenerationStatus: generationStatus => set({generationStatus}),
  setError: error => set({error}),
  reset: () => set(initialResumeWorkspaceState),
}))

// Imperative entry point for page commands. Pages should read state through selectors.
export const resumeWorkspaceActions = {
  setSourceResume: (value: string) => useResumeWorkspaceStore.getState().setSourceResume(value),
  setJobDescription: (value: string) => useResumeWorkspaceStore.getState().setJobDescription(value),
  setAnalysis: (value: ResumeAnalysis | null) => useResumeWorkspaceStore.getState().setAnalysis(value),
  setMatching: (value: MatchingResult | null) => useResumeWorkspaceStore.getState().setMatching(value),
  setOptimizedResume: (value: OptimizedResume | null) => useResumeWorkspaceStore.getState().setOptimizedResume(value),
  setInterview: (value: InterviewSuggestions | null) => useResumeWorkspaceStore.getState().setInterview(value),
  setGenerationStatus: (value: GenerationStatus) => useResumeWorkspaceStore.getState().setGenerationStatus(value),
  setError: (value: string | null) => useResumeWorkspaceStore.getState().setError(value),
  reset: () => useResumeWorkspaceStore.getState().reset(),
}
