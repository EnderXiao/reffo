import type {
  ProcessResult,
  ResultSessionContext,
  ResultSessionProgress,
  ResultStepStatus,
} from '@/types'
import {getJSON, setJSON} from './storage'

const LATEST_RESULT_SESSION_KEY = 'latest_result_session'

export type {ResultStepStatus}
export type LatestResultSessionContext = ResultSessionContext
export type LatestResultSessionProgress = ResultSessionProgress

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
