import {serializeDraft, validateCompletionDocument, validateOmissionSafety} from '@/shared/resume-completion'
import type {SaveResumeHistoryInput} from '@/types'

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

/** Validate the merged snapshot before persistence, including partial history updates. */
export function assertResumeCompletionSnapshot(
  input: Pick<SaveResumeHistoryInput, 'optimized_content' | 'process_result'>,
  previous?: Pick<SaveResumeHistoryInput, 'process_result'> | null,
) {
  const optimized = record(record(input.process_result)?.optimized)
  const previousOptimized = record(record(previous?.process_result)?.optimized)
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
}
