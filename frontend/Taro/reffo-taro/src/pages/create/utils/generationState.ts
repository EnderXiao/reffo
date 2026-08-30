import type {
  CreateGenerationState,
  JobDescriptionStepState,
  ResumeSummaryStepState,
} from '../types'

export function buildPendingGenerationState({
  resumeSummaryState,
  jobDescriptionState,
}: {
  resumeSummaryState: ResumeSummaryStepState | null
  jobDescriptionState: JobDescriptionStepState
}): CreateGenerationState {
  const companyName = jobDescriptionState.companyName.trim()
  const positionName = jobDescriptionState.positionName.trim()
  const baseLocation = jobDescriptionState.baseLocation.trim()
  const resumeTitle = resumeSummaryState?.title || resumeSummaryState?.fileName || '源简历'
  const resumeMonogram = resumeTitle.trim().match(/[A-Za-z0-9\u4e00-\u9fa5]/u)?.[0] || 'R'
  const monogram = /[A-Za-z]/.test(resumeMonogram) ? resumeMonogram.toUpperCase() : resumeMonogram

  return {
    resumeTitle,
    companyName,
    positionName,
    baseLocation,
    monogram,
    detailItems: [],
  }
}
