import type {
  ProcessResult,
  ResultSessionContext,
  ResultSessionProgress,
  ResultStepStatus,
} from '@/types'
import {useAuthStore} from '@/store/authStore'
import {getJSON, setJSON, storage} from './storage'
import {getUserStorageKey, LATEST_RESULT_SESSION_KEY} from './user-data-storage'

export type {ResultStepStatus}
export type LatestResultSessionContext = ResultSessionContext
export type LatestResultSessionProgress = ResultSessionProgress

export interface LatestResultSession {
  result: ProcessResult
  context: LatestResultSessionContext
  progress?: LatestResultSessionProgress
}

function getResultSessionStorageKey() {
  return getUserStorageKey(LATEST_RESULT_SESSION_KEY, useAuthStore.getState().session?.user.id)
}

export async function saveLatestResultSession(session: LatestResultSession) {
  await setJSON(getResultSessionStorageKey(), session)
}

export async function getLatestResultSession() {
  return getJSON<LatestResultSession>(getResultSessionStorageKey())
}

export async function clearLatestResultSession() {
  await storage.removeItem(getResultSessionStorageKey())
}
