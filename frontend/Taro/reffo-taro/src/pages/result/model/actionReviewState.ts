import type {OptimizedResume} from '@/types'
import {resumeTextFingerprint} from '@/shared/resume-strategy'

/** 审阅只补丁当前文档的侧链；旧请求的正文、能力判断与分数不能覆盖新编辑。 */
export function mergeAuthoritativeReview(current: OptimizedResume, remote: OptimizedResume): OptimizedResume {
  const document = current.completion_document
  const received = remote.completion_document
  if (!document || !received || document.documentId !== received.documentId || document.revision !== received.revision
    || current.optimized_resume !== remote.optimized_resume
    || current.resolved_action_plan?.resolvedDigest !== remote.resolved_action_plan?.resolvedDigest) return current
  const review = remote.action_review
  const validReview = review && review.documentId === document.documentId && review.revision === document.revision
    && review.resumeFingerprint === resumeTextFingerprint(current.optimized_resume)
    && review.resolvedDigest === current.resolved_action_plan?.resolvedDigest
    && review.reviewRevision >= (current.action_review?.reviewRevision ?? -1)
  return {...current,
    ...(validReview ? {action_review: review, change_manifest: remote.change_manifest, changes_summary: remote.changes_summary} : {}),
    ...(remote.identity_state ? {identity_state: remote.identity_state} : {}),
    ...(remote.delivery_state ? {delivery_state: remote.delivery_state} : {}),
  }
}
