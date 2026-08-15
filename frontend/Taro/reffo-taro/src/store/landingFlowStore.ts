import {create} from 'zustand'

export interface LandingJobDraft {
  content: string
  companyName: string
  positionName: string
  baseLocation: string
}

interface LandingFlowState {
  source: 'landing' | null
  selectedJob: LandingJobDraft | null
  startJobDescription: (job: LandingJobDraft) => void
  clear: () => void
}

export const useLandingFlowStore = create<LandingFlowState>(set => ({
  source: null,
  selectedJob: null,
  startJobDescription: selectedJob => set({
    source: 'landing',
    selectedJob,
  }),
  clear: () => set({
    source: null,
    selectedJob: null,
  }),
}))
