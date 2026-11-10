import type {
  ProcessResult,
  OptimizedResume,
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
  sessionSequence?: number
  originHistoryId?: string
  baseHistorySnapshot?: {
    optimizedContent: string
    completionDocument?: OptimizedResume['completion_document']
    updatedAt?: string
  }
}

export function getResultSessionStorageKey() {
  return getUserStorageKey(LATEST_RESULT_SESSION_KEY, useAuthStore.getState().session?.user.id)
}

export async function saveLatestResultSession(session: LatestResultSession, storageKey = getResultSessionStorageKey()) {
  await setJSON(storageKey, session)
}

export async function getLatestResultSession() {
  return getJSON<LatestResultSession>(getResultSessionStorageKey())
}

export async function clearLatestResultSession() {
  await storage.removeItem(getResultSessionStorageKey())
}
