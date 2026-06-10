import type { ProcessResult } from '../../types/mvp'

const STORAGE_KEY_RESUME = 'reffo_resume_markdown'
const STORAGE_KEY_JD = 'reffo_jd_text'
const STORAGE_KEY_RESULT = 'reffo_last_result'

export interface MvpStoredState {
  resumeMarkdown: string
  jdText: string
  result: ProcessResult | null
}

export function loadMvpStoredState(): MvpStoredState {
  return {
    resumeMarkdown: readString(STORAGE_KEY_RESUME),
    jdText: readString(STORAGE_KEY_JD),
    result: readJson<ProcessResult>(STORAGE_KEY_RESULT),
  }
}

export function saveMvpInputs(resumeMarkdown: string, jdText: string) {
  writeString(STORAGE_KEY_RESUME, resumeMarkdown)
  writeString(STORAGE_KEY_JD, jdText)
}

export function saveMvpResult(result: ProcessResult) {
  writeString(STORAGE_KEY_RESULT, JSON.stringify(result))
}

export function clearMvpStoredState() {
  removeItem(STORAGE_KEY_RESUME)
  removeItem(STORAGE_KEY_JD)
  removeItem(STORAGE_KEY_RESULT)
}

function readString(key: string) {
  try {
    return localStorage.getItem(key) || ''
  } catch (error) {
    console.error(`Failed to read localStorage key ${key}:`, error)
    return ''
  }
}

function readJson<T>(key: string) {
  const value = readString(key)

  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch (error) {
    console.error(`Failed to parse localStorage key ${key}:`, error)
    return null
  }
}

function writeString(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    console.error(`Failed to write localStorage key ${key}:`, error)
  }
}

function removeItem(key: string) {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.error(`Failed to remove localStorage key ${key}:`, error)
  }
}
