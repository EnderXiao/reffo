import presets from '../config/presets.json'

export interface LandingJobDescription {
  id: 'custom' | 'software' | 'product' | 'data' | 'operations'
  title: string
  company: string
  location: string
  experience: string
  salary?: string
  summary: string
  responsibilities: string[]
  requirements?: string[]
  bonus?: string
  cardSummary?: string
  keywords?: string[]
  accent: string
}

// Keep page code dependent on a stable data contract. Content can later come from a config API.
export const LANDING_JOB_DESCRIPTIONS = presets.jobDescriptions as LandingJobDescription[]
export const LANDING_PRESET_JOB_DESCRIPTIONS = LANDING_JOB_DESCRIPTIONS.filter(job => job.id !== 'custom')
export const LANDING_ONBOARDING_JOB_DESCRIPTIONS = LANDING_PRESET_JOB_DESCRIPTIONS.slice(0, 3)

export function formatLandingJobDescription(job: LandingJobDescription) {
  return [
    `岗位名称：${job.title}`,
    `公司：${job.company}`,
    `地点：${job.location}`,
    `经验要求：${job.experience}`,
    '',
    `岗位目标：${job.summary}`,
    '',
    '岗位职责：',
    ...job.responsibilities.map(item => `- ${item}`),
    ...(job.requirements?.length ? ['', '基本要求：', ...job.requirements.map(item => `- ${item}`)] : []),
    ...(job.bonus ? ['', `加分项：${job.bonus}`] : []),
  ].join('\n')
}
