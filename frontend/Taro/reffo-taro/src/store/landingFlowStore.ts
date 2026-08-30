import {create} from 'zustand'

export interface LandingJobDraft {
  id?: string
  content: string
  companyName: string
  positionName: string
  baseLocation: string
}

export interface LandingResumeSelection {
  source: 'preset' | 'upload'
  id: string
  title: string
  markdown: string
  fileName?: string
}

interface LandingFlowState {
  source: 'landing' | null
  selectedJob: LandingJobDraft | null
  selectedResume: LandingResumeSelection | null
  startJobDescription: (job: LandingJobDraft) => void
  selectResume: (resume: LandingResumeSelection) => void
  clearResume: () => void
  clear: () => void
}

export const useLandingFlowStore = create<LandingFlowState>(set => ({
  source: null,
  selectedJob: null,
  selectedResume: null,
  startJobDescription: selectedJob => set({
    source: 'landing',
    selectedJob,
  }),
  selectResume: selectedResume => set({
    source: 'landing',
    selectedResume,
  }),
  clearResume: () => set({selectedResume: null}),
  clear: () => set({
    source: null,
    selectedJob: null,
    selectedResume: null,
  }),
}))
