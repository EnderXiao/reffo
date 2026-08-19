import presets from '../config/presets.json'

export interface LandingJobDescription {
  id: 'custom' | 'software' | 'product' | 'data' | 'design' | 'operations'
  title: string
  company: string
  location: string
  experience: string
  salary: string
  summary: string
  responsibilities: string[]
  accent: string
}

// Keep page code dependent on a stable data contract. Content can later come from a config API.
export const LANDING_JOB_DESCRIPTIONS = presets.jobDescriptions as LandingJobDescription[]
export const LANDING_PRESET_JOB_DESCRIPTIONS = LANDING_JOB_DESCRIPTIONS.filter(job => job.id !== 'custom')
