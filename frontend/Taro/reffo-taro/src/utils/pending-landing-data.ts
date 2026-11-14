import type {OptimizedResume, ResumeHistory, SourceResumeSummary} from '@/types'
import {replayCompletionOperation, validateCompletionDocument, type CompletionOperation} from '@/shared/resume-completion'
import {resumeTextFingerprint} from '@/shared/resume-strategy'
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

function sameDraft(left: ResumeHistory, right: ResumeHistory) {
  return left.optimizedContent === right.optimizedContent
    && JSON.stringify(left.processResult?.optimized.completion_document ?? null)
      === JSON.stringify(right.processResult?.optimized.completion_document ?? null)
}

function documentId(history: ResumeHistory) {
  return history.processResult?.optimized.completion_document?.documentId
}

function sameBaseSnapshot(history: ResumeHistory, baseline: LatestResultSession['baseHistorySnapshot']) {
  return baseline?.optimizedContent === history.optimizedContent
    && JSON.stringify(baseline.completionDocument ?? null) === JSON.stringify(history.processResult?.optimized.completion_document ?? null)
}

function hasCommonJournalPrefix(base: ResumeHistory, next: ResumeHistory) {
  const prior = base.processResult?.optimized.completion_edit
  const journal = next.processResult?.optimized.completion_edit
  return Boolean(prior && journal && prior.documentId === journal.documentId && prior.baseRevision === journal.baseRevision
    && JSON.stringify(prior.operations) === JSON.stringify(journal.operations.slice(0, prior.operations.length)))
}

function isGeneratedBase(history: ResumeHistory) {
  const document = history.processResult?.optimized.completion_document
  return Boolean(document && document.schemaVersion !== 'resume-completion-v1' && document.revision === 0)
}

function continuation(base: ResumeHistory, next: ResumeHistory): OptimizedResume | undefined {
  const original = base.processResult?.optimized.completion_document
  const target = next.processResult?.optimized.completion_document
  const optimized = next.processResult?.optimized
  const journal = optimized?.completion_edit
  if (!original || !target || !optimized || !journal || original.schemaVersion === 'resume-completion-v1'
    || !validateCompletionDocument(original, base.optimizedContent).ok || !validateCompletionDocument(target, next.optimizedContent).ok
    || original.documentId !== target.documentId || journal.documentId !== original.documentId
    || journal.baseRevision > original.revision) return undefined
  const revision = (operation: CompletionOperation) => operation.kind === 'gap' ? operation.command.baseRevision : operation.baseRevision
  const start = journal.operations.findIndex(operation => revision(operation) === original.revision)
  if (start < 0) return undefined
  const operations = journal.operations.slice(start)
  let replayed = original
  for (const operation of operations) {
    const result = replayCompletionOperation(replayed, operation)
    if (!result.ok) return undefined
    replayed = result.document
  }
  if (JSON.stringify(replayed) !== JSON.stringify(target)) return undefined
  return {...optimized, completion_edit: {documentId: original.documentId, baseRevision: original.revision, operations}}
}

function mergeSessionHistory(history: ResumeHistory, session: ResumeHistory, baseline: LatestResultSession['baseHistorySnapshot']): ResumeHistory | undefined {
  if (!sameDraft(history, session) && !isGeneratedBase(history)
    && !sameBaseSnapshot(history, baseline) && !hasCommonJournalPrefix(history, session)) return undefined
  const extended = sameDraft(history, session) ? session.processResult?.optimized : continuation(history, session)
  if (!extended || !session.processResult) return undefined
  const prior = history.processResult?.optimized.completion_edit
  const suffix = extended.completion_edit
  const optimized = sameDraft(history, session)
    ? {...extended, ...(prior ? {completion_edit: prior} : {})}
    : {...extended, ...(prior && suffix ? {completion_edit: {...prior, operations: [...prior.operations, ...suffix.operations]}}
      : session.processResult.optimized.completion_edit ? {completion_edit: session.processResult.optimized.completion_edit} : {})}
  return {...history, ...session, id: history.id, createdAt: history.createdAt,
    cardColor: history.cardColor, cardPattern: history.cardPattern,
    processResult: {...session.processResult, optimized}}
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
  const historiesToSync = [...(pendingHistories || []), ...(cachedHistories || [])
    .filter(history => !pendingHistories?.some(pending => pending.id === history.id))]
  const blockedIds = new Set<string>()
  let sessionHistoryId: string | undefined
  if (sessionHistory && latestSession) {
    sessionHistory.resultContext = {...sessionHistory.resultContext, ...latestSession.context}
    sessionHistory.progress = latestSession.progress ?? sessionHistory.progress
    const indexByOrigin = latestSession.originHistoryId
      ? historiesToSync.findIndex(history => history.id === latestSession.originHistoryId) : -1
    const index = indexByOrigin >= 0 ? indexByOrigin : historiesToSync.findIndex(history =>
      documentId(sessionHistory) && documentId(history) === documentId(sessionHistory))
    if (index >= 0) {
      const previous = historiesToSync[index]
      const merged = mergeSessionHistory(previous, sessionHistory, latestSession.baseHistorySnapshot)
      if (merged) {historiesToSync[index] = merged; sessionHistoryId = merged.id}
      else if ((isGeneratedBase(sessionHistory) || hasCommonJournalPrefix(sessionHistory, previous))
        && continuation(sessionHistory, previous)) sessionHistoryId = previous.id
      else blockedIds.add(previous.id)
    } else {
      sessionHistory.id = latestSession.originHistoryId || `landing-${documentId(sessionHistory) || resumeTextFingerprint(JSON.stringify(latestSession))}`
      historiesToSync.push(sessionHistory)
      sessionHistoryId = sessionHistory.id
    }
  }

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
          ...(sourceToSync.parseId ? {parse_id: sourceToSync.parseId} : {}),
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
    const confirmedIds = new Set<string>()
    const remotePresetIds = new Set(
      remoteHistories
        .map(history => history.resultContext?.presetJdId)
        .filter((id): id is string => Boolean(id)),
    )
    const missingHistories = historiesToSync.flatMap(history => {
      if (blockedIds.has(history.id)) return []
      const remote = remoteHistories.find(item => item.id === history.id
        || documentId(history) && documentId(item) === documentId(history))
      if (remote) {
        if (sameDraft(remote, history)) {confirmedIds.add(history.id); return []}
        const knownBase = isGeneratedBase(remote) || [...(pendingHistories || []), ...(cachedHistories || [])].some(local => sameDraft(local, remote))
          || sameBaseSnapshot(remote, latestSession?.baseHistorySnapshot)
        const optimized = knownBase ? continuation(remote, history) : undefined
        return optimized && history.processResult ? [{localId: history.id, history: {...history, id: remote.id, createdAt: remote.createdAt,
          processResult: {...history.processResult, optimized}}}] : []
      }
      const presetJdId = history.resultContext?.presetJdId
      return !presetJdId || !remotePresetIds.has(presetJdId) ? [{localId: history.id, history}] : []
    })

    if (missingHistories.length > 0) {
      const shouldSync = await confirmSync(
        '同步生成记录？',
        `检测到 ${missingHistories.length} 份本地生成简历。是否同步到当前账号？`,
      )
      if (shouldSync) {
        for (const item of missingHistories) {
          await resumeHistoryApi.saveHistory(item.history)
          confirmedIds.add(item.localId)
        }
      }
    }
    for (const [key, original] of [[PENDING_LANDING_HISTORIES_KEY, pendingHistories], [HISTORY_STORAGE_KEY, cachedHistories]] as const) {
      const current = await getJSON<ResumeHistory[]>(key)
      if (!current) continue
      const remaining = current.filter(history => !confirmedIds.has(history.id)
        || !original?.some(before => before.id === history.id && JSON.stringify(before) === JSON.stringify(history)))
      if (remaining.length) await setJSON(key, remaining)
      else await storage.removeItem(key)
    }
    if (sessionHistoryId && confirmedIds.has(sessionHistoryId)
      && JSON.stringify(await getJSON<LatestResultSession>(LATEST_RESULT_SESSION_KEY)) === JSON.stringify(latestSession)) {
      await storage.removeItem(LATEST_RESULT_SESSION_KEY)
    }
  }
}
