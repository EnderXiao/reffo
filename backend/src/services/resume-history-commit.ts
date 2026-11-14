import {createCanonicalDigest} from '@/harness/run-context'
import {completionDocumentFromSnapshot} from '@/services/resume-completion-snapshot'
import type {ResumeHistoryRecord, SaveResumeHistoryInput} from '@/types'

export class ResumeHistoryCommitError extends Error {
  readonly status = 409
  constructor(readonly code: 'RESUME_COMMIT_CONFLICT' | 'RESUME_VERSION_CONFLICT', message: string) {super(message); this.name = 'ResumeHistoryCommitError'}
}

export function historyCommitDigest(input: SaveResumeHistoryInput) {
  const {completion_baseline: _baseline, action_baseline: _action, commit_id: _commit, ...request} = input
  return createCanonicalDigest(request)
}

export function historyDocumentRef(processResult: unknown) {
  const document = completionDocumentFromSnapshot(processResult)
  const result = processResult as {optimized?: {resolved_action_plan?: {resolvedDigest?: string}}} | undefined
  return {documentId: document?.documentId ?? null, revision: document?.revision ?? null,
    resolvedDigest: result?.optimized?.resolved_action_plan?.resolvedDigest ?? null}
}

export function historyCommitAck(input: SaveResumeHistoryInput, history: ResumeHistoryRecord) {
  const ref = historyDocumentRef(history.process_result)
  return input.commit_id ? {commit_id: input.commit_id, document_id: ref.documentId,
    revision: ref.revision, resolved_digest: ref.resolvedDigest} : undefined
}

export function assertExpectedHistory(input: SaveResumeHistoryInput, previous: ResumeHistoryRecord | null) {
  if (!input.expected_document) return
  const actual = historyDocumentRef(previous?.process_result)
  const expected = input.expected_document as {documentId: string; revision: number; resolvedDigest?: string}
  if (!previous || expected.documentId !== actual.documentId || expected.revision !== actual.revision
    || (expected.resolvedDigest !== undefined && expected.resolvedDigest !== actual.resolvedDigest)) {
    throw new ResumeHistoryCommitError('RESUME_VERSION_CONFLICT', '当前稿已更新，本地修改已保留，请重新核对版本')
  }
}
