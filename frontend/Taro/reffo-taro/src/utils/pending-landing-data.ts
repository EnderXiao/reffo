import type {ResumeHistory, SourceResumeSummary} from '@/types'
import {resumeHistoryApi} from '@/services/resumeHistory'
import {sourceResumeApi} from '@/services/sourceResume'
import {feedback} from './feedback'
import {getJSON, setJSON, storage} from './storage'
import {LATEST_RESULT_SESSION_KEY} from './user-data-storage'
import {HISTORY_STORAGE_KEY, SOURCE_RESUME_STORAGE_KEY} from './user-data-storage'
import type {LatestResultSession} from './result-session'
import {createHistoryFromResult} from './history-helper'

export const PENDING_LANDING_SOURCE_RESUME_KEY = 'reffo.landing.pendingSourceResume'
export const PENDING_LANDING_HISTORIES_KEY = 'reffo.landing.pendingHistories'

export interface PendingLandingSourceResume extends SourceResumeSummary {
  sourcePath?: string
  sizeBytes?: number
}

function confirmSync(title: string, content: string) {
  return new Promise<boolean>(resolve => {
    feedback.modal({
      title,
      content,
      confirmText: '同步',
      cancelText: '不同步',
      tone: 'guide',
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

export async function savePendingLandingSourceResume(resume: PendingLandingSourceResume) {
  await setJSON(PENDING_LANDING_SOURCE_RESUME_KEY, resume)
}

export async function savePendingLandingHistory(history: ResumeHistory) {
  const histories = await getJSON<ResumeHistory[]>(PENDING_LANDING_HISTORIES_KEY) || []
  const historyWithId = {
    ...history,
    id: history.id || `landing-${Date.now()}`,
  }
  await setJSON(PENDING_LANDING_HISTORIES_KEY, [
    historyWithId,
    ...histories.filter(item => item.id !== historyWithId.id),
  ])
  return historyWithId.id
}

export async function syncPendingLandingData() {
  const [pendingSource, pendingHistories, cachedSource, cachedHistories, latestSession] = await Promise.all([
    getJSON<PendingLandingSourceResume>(PENDING_LANDING_SOURCE_RESUME_KEY),
    getJSON<ResumeHistory[]>(PENDING_LANDING_HISTORIES_KEY),
    getJSON<PendingLandingSourceResume>(SOURCE_RESUME_STORAGE_KEY),
    getJSON<ResumeHistory[]>(HISTORY_STORAGE_KEY),
    getJSON<LatestResultSession>(LATEST_RESULT_SESSION_KEY),
  ])

  const sourceToSync = pendingSource || cachedSource
  const sessionHistory = latestSession?.result.optimized.optimized_resume.trim()
    ? createHistoryFromResult(
      latestSession.result,
      latestSession.context.resumeContent,
      latestSession.context.jdContent,
    )
    : null
  if (sessionHistory && latestSession.context.presetJdId) {
    sessionHistory.resultContext = {
      ...sessionHistory.resultContext,
      presetJdId: latestSession.context.presetJdId,
    }
  }
  const historiesToSync = pendingHistories?.length
    ? pendingHistories
    : [...(cachedHistories || []), ...(sessionHistory ? [sessionHistory] : [])]

  if (!sourceToSync && !historiesToSync.length) {
    return
  }

  const [remoteSource, remoteHistories] = await Promise.all([
    sourceResumeApi.getLatestSourceResume(),
    resumeHistoryApi.getHistories(),
  ])

  if (sourceToSync) {
    if (!remoteSource) {
      const shouldSync = await confirmSync(
        '同步本地简历？',
        '检测到 Landing 流程上传的源简历。是否同步到当前账号？',
      )
      if (shouldSync) {
        await sourceResumeApi.saveSourceResume({
          title: sourceToSync.title,
          resume_markdown: sourceToSync.resumeMarkdown,
          source_type: sourceToSync.sourceType,
          original_file_name: sourceToSync.originalFileName,
        })
      }
    }
    await Promise.all([
      storage.removeItem(PENDING_LANDING_SOURCE_RESUME_KEY),
      storage.removeItem(SOURCE_RESUME_STORAGE_KEY),
    ])
  }

  if (historiesToSync.length) {
    const remoteIds = new Set(remoteHistories.map(history => history.id))
    const remotePresetIds = new Set(
      remoteHistories
        .map(history => history.resultContext?.presetJdId)
        .filter((id): id is string => Boolean(id)),
    )
    const missingHistories = historiesToSync.filter(history => {
      const presetJdId = history.resultContext?.presetJdId
      return !remoteIds.has(history.id) && (!presetJdId || !remotePresetIds.has(presetJdId))
    })

    if (missingHistories.length > 0) {
      const shouldSync = await confirmSync(
        '同步生成记录？',
        `检测到 ${missingHistories.length} 份本地生成简历。是否同步到当前账号？`,
      )
      if (shouldSync) {
        for (const history of missingHistories) {
          await resumeHistoryApi.saveHistory(history)
        }
      }
    }
    await Promise.all([
      storage.removeItem(PENDING_LANDING_HISTORIES_KEY),
      storage.removeItem(HISTORY_STORAGE_KEY),
    ])
  }

  await storage.removeItem(LATEST_RESULT_SESSION_KEY)
}
