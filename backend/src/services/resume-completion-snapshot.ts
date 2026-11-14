import {validateActionPlan, reconcileEditorialActions, buildChangeManifest, changeManifestDescriptions, type ResumeChangeManifest, type ResumeActionPlan, type ResolvedResumeActionPlan, type ResumeActionReview} from '@/shared/resume-actions'
import {collectGaps, completionIdentityName, completionVersion, hasLinkedCompletion} from '@/shared/resume-completion'
import {replayCompletionOperation, serializeDraft, validateCompletionDocument, validateOmissionSafety,
  type CompletionOperation, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {SaveResumeHistoryInput} from '@/types'
import {assessResumeDelivery} from './resume-delivery-assessment'
import type {ResumeIdentityState} from '@/shared/resume-actions'

export class ResumeCompletionSnapshotError extends Error {
  constructor(readonly code: 'RESUME_COMPLETION_INVALID' | 'RESUME_COMPLETION_MISMATCH', message: string) {
    super(message)
    this.name = 'ResumeCompletionSnapshotError'
  }

  get status() { return this.code === 'RESUME_COMPLETION_MISMATCH' ? 409 : 422 }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

export function completionDocumentFromSnapshot(value: unknown): ResumeCompletionDocument | undefined {
  const raw = record(record(value)?.optimized)?.completion_document
  if (raw === undefined) return undefined
  const checked = validateCompletionDocument(raw)
  if (!checked.ok) throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_INVALID', '填写结构需要恢复，请重新打开有效版本')
  return checked.document
}

export function withoutPendingCompletionEdits(value: unknown): unknown {
  const result = record(value)
  const optimized = record(result?.optimized)
  if (!result || !optimized || (!('completion_edit' in optimized) && !('completion_context' in optimized))) return value
  const {completion_edit: _pending, completion_context: _context, ...savedOptimized} = optimized
  return {...result, optimized: savedOptimized}
}

function assertReplay(input: Pick<SaveResumeHistoryInput, 'completion_edit'>, base: ResumeCompletionDocument, target: ResumeCompletionDocument) {
  if (JSON.stringify(base) === JSON.stringify(target)) return
  if (base.schemaVersion !== target.schemaVersion || base.documentId !== target.documentId) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '填写文档身份已改变，请重新打开当前简历后保存')
  }
  const journal = record(input.completion_edit)
  if (!journal || journal.documentId !== base.documentId || journal.baseRevision !== base.revision
    || !Array.isArray(journal.operations) || !journal.operations.length) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '填写基准已更新或操作记录缺失，请重新打开当前简历后保存')
  }
  if (JSON.stringify(journal).length > 2_000_000) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_INVALID', '本次编辑记录超出处理范围，请先保存较少的修改后再继续')
  }
  let replayed = base
  for (const operation of journal.operations) {
    const result = replayCompletionOperation(replayed, operation as CompletionOperation)
    if (!result.ok) throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', result.issues[0]?.message || '填写操作无法核对')
    replayed = result.document
  }
  if (JSON.stringify(replayed) !== JSON.stringify(target)) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '填写快照与编辑操作不一致，请恢复完整编辑状态后保存')
  }
}

/** Validate the merged snapshot before persistence, including partial history updates. */
export function assertResumeCompletionSnapshot(
  input: Pick<SaveResumeHistoryInput, 'optimized_content' | 'process_result' | 'completion_edit' | 'completion_baseline' | 'expected_document'>,
  previous?: Pick<SaveResumeHistoryInput, 'process_result'> | null,
) {
  const optimized = record(record(input.process_result)?.optimized)
  const previousOptimized = record(record(previous?.process_result)?.optimized)
  if (previousOptimized?.completion_document !== undefined) {
    completionDocumentFromSnapshot(previous?.process_result)
  }
  if (previousOptimized?.completion_document !== undefined && optimized?.completion_document === undefined) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '当前记录包含填写状态，请重新打开后保存，避免丢失已填写内容')
  }
  if (!optimized || optimized.completion_document === undefined) return

  if (typeof optimized.optimized_resume !== 'string' || optimized.optimized_resume !== input.optimized_content) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '正文与填写状态不一致，请重新打开当前编辑稿后保存')
  }
  const validation = validateCompletionDocument(optimized.completion_document)
  if (!validation.ok) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_INVALID', '填写文档无法完整校验，请处理标记或恢复提示后再保存')
  }
  if (serializeDraft(validation.document) !== input.optimized_content) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '正文与填写状态不一致，请重新打开当前编辑稿后保存')
  }
  if (validateOmissionSafety(validation.document).length) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_INVALID', '有补充分句无法安全省略，请检查对应行后再保存')
  }
  const priorDocument = previousOptimized?.completion_document
  const priorVersion = String(record(priorDocument)?.schemaVersion ?? '')
  if (completionVersion(validation.document) < completionVersion(priorVersion)) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '当前填写文档不能降级，请重新打开后保存')
  }
  if (validation.document.schemaVersion === 'resume-completion-v1') return
  if (previous === undefined) return
  const base = previous ? completionDocumentFromSnapshot(previous.process_result) : input.completion_baseline
  if (!base || !validateCompletionDocument(base).ok) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '未找到服务端生成基准，请恢复生成记录后保存')
  }
  if (hasLinkedCompletion(validation.document) && previous) {
    if (!input.expected_document || input.expected_document.documentId !== base.documentId || input.expected_document.revision !== base.revision) {
      throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '当前稿已更新，请保留本地修改并核对版本')
    }
  }
  assertReplay(input, base, validation.document)
}

/** Recompute trusted editorial state after replay; clients cannot certify their own changes. */
export function prepareResumeHistorySnapshot(input: SaveResumeHistoryInput, previous?: import('@/types').ResumeHistoryRecord | null): SaveResumeHistoryInput {
  assertResumeCompletionSnapshot(input, previous)
  const rawResult = record(input.process_result)
  const {server_interview_basis: _clientBasis, server_completion_upgrade_archive: _clientArchive, ...publicResult} = rawResult ?? {}
  const trustedArchive = record(previous?.process_result)?.server_completion_upgrade_archive
  const result = rawResult ? publicResult : undefined
  const optimized = record(result?.optimized)
  const document = completionDocumentFromSnapshot(input.process_result)
  if (!result || !optimized || !document || !hasLinkedCompletion(document)) {
    if (!result) return input
    const previousBasis = record(previous?.process_result)?.server_interview_basis
    return {...input, process_result: {...result, ...(previousBasis ? {server_interview_basis: previousBasis} : {}),
      ...(trustedArchive ? {server_completion_upgrade_archive: trustedArchive} : {})}}
  }
  const oldResult = record(previous?.process_result)
  const oldOptimized = record(oldResult?.optimized)
  const trusted = previous ? {actionPlan: oldOptimized?.action_plan, resolvedPlan: oldOptimized?.resolved_action_plan,
    review: oldOptimized?.action_review, changeManifest: oldOptimized?.change_manifest, identityState: oldOptimized?.identity_state, deliveryState: oldOptimized?.delivery_state, interviewBasis: record(oldResult?.server_interview_basis)?.result, matching: oldResult?.matching} : input.action_baseline
  if (!trusted?.actionPlan || !trusted.resolvedPlan || validateActionPlan(trusted.actionPlan as ResumeActionPlan, trusted.resolvedPlan as ResolvedResumeActionPlan).length) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '优化行动基准不可用，请重新打开有效稿件')
  }
  const resolved = trusted.resolvedPlan as ResolvedResumeActionPlan
  if (previous && input.expected_document?.resolvedDigest !== resolved.resolvedDigest) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '优化方案版本已更新，请保留本地修改并重新核对')
  }
  const actionReview = reconcileEditorialActions({resolvedPlan: resolved, document, previousReview: trusted.review as ResumeActionReview | undefined})
  const changeManifest = buildChangeManifest(actionReview, resolved, {previous: trusted.changeManifest as ResumeChangeManifest | undefined, document})
  const identityGap = collectGaps(document).find(gap => gap.kind === 'identity_gap')
  const identityState = identityGap ? {...record(trusted.identityState), name: completionIdentityName(document) ? 'user_provided' : 'missing'}
    : trusted.identityState ?? {name: 'known'}
  const deliveryState = assessResumeDelivery({document, identity: identityState as ResumeIdentityState,
    review: actionReview, resolvedPlan: resolved, changeManifest, previous: trusted.deliveryState})
  const preparationTopics = record(trusted.interviewBasis)?.preparationTopics ?? oldOptimized?.preparation_topics
  const {server_interview_basis: _untrustedInterviewBasis, ...safeResult} = result
  return {...input, name: completionIdentityName(document) ?? input.name, process_result: {...safeResult,
    ...(trusted.interviewBasis ? {server_interview_basis: {version: 'interview-generation-basis-v1', result: trusted.interviewBasis}} : {}),
    ...(trustedArchive ? {server_completion_upgrade_archive: trustedArchive} : {}),
    ...(trusted.matching ? {matching: trusted.matching} : {}),
    ...(record(safeResult.interview) ? {interview: {...record(safeResult.interview), preparation_topics: preparationTopics}} : {}),
    optimized: {...optimized, action_plan: trusted.actionPlan, resolved_action_plan: resolved,
      action_review: actionReview, change_manifest: changeManifest, changes_summary: changeManifestDescriptions(changeManifest), identity_state: identityState, delivery_state: deliveryState,
      preparation_topics: preparationTopics}}}
}
