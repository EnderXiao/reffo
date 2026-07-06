import type {ProcessResult} from '@/types'
import {getJSON, setJSON} from './storage'

const LATEST_RESULT_SESSION_KEY = 'latest_result_session'

export interface LatestResultSessionContext {
  company: string
  position: string
  resumeContent: string
  jdContent: string
}

export type ResultStepStatus = 'pending' | 'generating' | 'done' | 'failed'

export interface LatestResultSessionProgress {
  analysis: ResultStepStatus
  matching: ResultStepStatus
  optimized: ResultStepStatus
  interview?: ResultStepStatus
}

export interface LatestResultSession {
  result: ProcessResult
  context: LatestResultSessionContext
  progress?: LatestResultSessionProgress
}

export async function saveLatestResultSession(session: LatestResultSession) {
  await setJSON(LATEST_RESULT_SESSION_KEY, session)
}

export async function getLatestResultSession() {
  return getJSON<LatestResultSession>(LATEST_RESULT_SESSION_KEY)
}
