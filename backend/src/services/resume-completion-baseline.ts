import {V5CheckpointRepository} from '@/repositories/v5-checkpoint-repository'
import {singleStepFingerprint} from '@/v5/single-step-fingerprint'
import {hasLinkedCompletion, isCompletionV4, validateCompletionDocument, type ResumeCompletionDocument} from '@/shared/resume-completion'
import {validateActionPlan} from '@/shared/resume-actions'
import type {SaveResumeHistoryInput} from '@/types'
import {ResumeCompletionSnapshotError} from './resume-completion-snapshot'

export const COMPLETION_BASELINE_PROTOCOL = 'resume-edit-baseline-v4'
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
export interface CompletionBaselineBundle {document: ResumeCompletionDocument; actionBaseline?: SaveResumeHistoryInput['action_baseline']}
const baselineFingerprint = (document: ResumeCompletionDocument) => isCompletionV4(document) ? COMPLETION_BASELINE_PROTOCOL
  : hasLinkedCompletion(document) ? 'resume-edit-baseline-v3' : singleStepFingerprint()

export async function saveCompletionBaseline(owner: string, document: ResumeCompletionDocument, actionBaseline?: SaveResumeHistoryInput['action_baseline']) {
  if (actionBaseline && validateActionPlan(actionBaseline.actionPlan, actionBaseline.resolvedPlan).length) throw new Error('INVALID_SERVER_ACTION_BASELINE')
  return new V5CheckpointRepository(baselineFingerprint(document)).save(owner, {kind: 'completion', document, actionBaseline})
}

/** Only an owned server generation record can establish the first-save trust boundary. */
export async function loadCompletionBaselineBundle(owner: string, processResult: unknown): Promise<CompletionBaselineBundle> {
  const result = object(processResult)
  const optimized = object(result?.optimized)
  const token = optimized?.completion_context ?? object(object(result?.matching)?.jd_structure)?._v5_context
  try {
    const submitted = validateCompletionDocument(optimized?.completion_document)
    if (!submitted.ok || submitted.document.schemaVersion === 'resume-completion-v1') throw new Error('invalid completion target')
    const repository = new V5CheckpointRepository(baselineFingerprint(submitted.document))
    const row = await repository.load(token, owner).catch(async error => {
      if (!optimized?.completion_context) throw error
      return repository.claimGuestCompletion(token, owner, submitted.document.documentId)
    })
    const payload = object(row.payload)
    const generated = object(payload?.generated)
    const raw = payload?.kind === 'completion' ? payload.document : generated?.completionDocument
    const checked = validateCompletionDocument(raw)
    if (checked.ok && checked.document.schemaVersion === submitted.document.schemaVersion && checked.document.revision === 0
      && checked.document.documentId === submitted.document.documentId) {
      const actionBaseline = (payload?.actionBaseline ?? (generated?.actionPlan && generated.resolvedActionPlan
        ? {actionPlan: generated.actionPlan, resolvedPlan: generated.resolvedActionPlan, review: generated.actionReview, changeManifest: generated.changeManifest, identityState: generated.identityState, deliveryState: generated.deliveryState, interviewBasis: generated} : undefined)) as SaveResumeHistoryInput['action_baseline']
      if (hasLinkedCompletion(checked.document) && (!actionBaseline || validateActionPlan(actionBaseline.actionPlan, actionBaseline.resolvedPlan).length)) throw new Error('missing action baseline')
      return {document: checked.document, ...(actionBaseline ? {actionBaseline} : {})}
    }
  } catch { /* Return a recoverable error without leaking private checkpoint contents. */ }
  throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_MISMATCH', '生成基准不可用或已过期，请从已保存的生成记录恢复后再保存')
}
export async function loadCompletionBaseline(owner: string, processResult: unknown) {
  return (await loadCompletionBaselineBundle(owner, processResult)).document
}
