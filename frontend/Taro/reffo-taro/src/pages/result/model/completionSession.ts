import type {OptimizedResume, ProcessResult, ResumeHistory} from '@/types'
import type {LatestResultSession} from '@/utils/result-session'

export function historyCompletionBaseline(history: ResumeHistory): NonNullable<LatestResultSession['baseHistorySnapshot']> {
  return {
    optimizedContent: history.optimizedContent,
    completionDocument: history.processResult?.optimized?.completion_document,
    updatedAt: history.updatedAt,
    resolvedDigest: history.processResult?.optimized?.resolved_action_plan?.resolvedDigest,
  }
}

// 本地缓存可能来自旧版本，字段可能缺失；比较必须容忍 undefined，否则详情页会整体抛错。
export function sameCompletionState(
  left: Pick<OptimizedResume, 'optimized_resume' | 'completion_document'> | undefined | null,
  right: Pick<OptimizedResume, 'optimized_resume' | 'completion_document'> | undefined | null,
) {
  return (left?.optimized_resume ?? '') === (right?.optimized_resume ?? '')
    && JSON.stringify(left?.completion_document ?? null) === JSON.stringify(right?.completion_document ?? null)
}

export function resultSnapshotKey(result: ProcessResult) {
  const {completion_edit: _pending, action_review: _review, change_manifest: _manifest, identity_state: _identity,
    delivery_state: _delivery, changes_summary: _summary, ...optimized} = result.optimized ?? {}
  return JSON.stringify({...result, optimized})
}

export function resolveHistorySession(
  history: ResumeHistory,
  historyResult: ProcessResult,
  session: LatestResultSession | null,
): 'history' | 'session' | 'conflict' {
  const sessionOptimized = session?.result?.optimized
  if (!session || session.originHistoryId !== history.id || !session.baseHistorySnapshot || !sessionOptimized) return 'history'
  const current = {...(historyResult.optimized ?? {}), optimized_resume: history.optimizedContent}
  if (sameCompletionState(current, sessionOptimized)) return 'history'

  const baseline = session.baseHistorySnapshot
  const baselineContent = {
    optimized_resume: baseline.optimizedContent,
    completion_document: baseline.completionDocument,
  }
  if (sameCompletionState(baselineContent, session.result.optimized)) return 'history'

  const currentDocumentId = current.completion_document?.documentId
  const baselineDocumentId = baseline.completionDocument?.documentId
  const sessionDocumentId = sessionOptimized.completion_document?.documentId
  // 旧稿首次迁移会产生 ID；身份比较以用户开始编辑时的历史基线为准。
  if (baselineDocumentId && (currentDocumentId !== baselineDocumentId || sessionDocumentId !== baselineDocumentId)) {
    return 'conflict'
  }
  return sameCompletionState(current, baselineContent) ? 'session' : 'conflict'
}
