import {storage} from './storage'

export const HISTORY_STORAGE_KEY = 'resume_histories'
export const SOURCE_RESUME_STORAGE_KEY = 'latest_source_resume'
export const LATEST_RESULT_SESSION_KEY = 'latest_result_session'

export function getUserStorageKey(baseKey: string, userId?: string | null) {
  return userId ? `${baseKey}.${userId}` : baseKey
}

export async function clearPersistedUserData(userId?: string | null) {
  const keys = new Set([
    HISTORY_STORAGE_KEY,
    SOURCE_RESUME_STORAGE_KEY,
    LATEST_RESULT_SESSION_KEY,
    getUserStorageKey(HISTORY_STORAGE_KEY, userId),
    getUserStorageKey(SOURCE_RESUME_STORAGE_KEY, userId),
    getUserStorageKey(LATEST_RESULT_SESSION_KEY, userId),
  ])

  await Promise.all(Array.from(keys, key => storage.removeItem(key)))
}
