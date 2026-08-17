import presets from '../config/presets.json'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'

export interface LandingPresetResume {
  id: string
  title: string
  markdown: string
}

export interface LandingResumeCardConfig extends Pick<
  HomeCardItem,
  'id' | 'company' | 'indexLabel' | 'location' | 'role' | 'dateLabel' | 'score' | 'strategyBody' | 'queueCardKind' | 'resumeProfile'
> {
  seedKey: string
}

// Content lives in JSON so a future config service can replace this data source.
export const LANDING_PRESET_RESUMES = presets.presetResumes as Record<string, LandingPresetResume>
export const LANDING_RESUME_CARD_CONFIGS = presets.resumeCards as LandingResumeCardConfig[]

export function getLandingPresetResume(id: string) {
  return LANDING_PRESET_RESUMES[id] ?? null
}
