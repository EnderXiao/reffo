beforeAll(() => { if (!globalThis.structuredClone) globalThis.structuredClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T })
import {createPlainCompletionDocument, serializeDraft} from '@/shared/resume-completion'
import {freezeActionPlan, freezeResolvedActionPlan, reconcileEditorialActions} from '@/shared/resume-actions'
import {mergeAuthoritativeReview} from '../model/actionReviewState'
import {completionResult} from './completionFixture'

function optimized() {
  const document = createPlainCompletionDocument('- 参与调研', {documentId: 'review-document'})
  const plan = freezeActionPlan({planId: 'plan', sourceRevision: 'source', judgmentRevision: 'judgment', actions: []})
  const resolved = freezeResolvedActionPlan({resolvedPlanId: 'resolved', revision: 0, basePlanId: plan.planId,
    baseDigest: plan.baseDigest, actions: [], bindings: []})
  return {...completionResult(document).optimized, action_plan: plan, resolved_action_plan: resolved,
    action_review: reconcileEditorialActions({resolvedPlan: resolved, document})}
}

test('审阅回包只接当前 revision 与 digest，不覆盖更新后的稿件', () => {
  const current = optimized()
  const newer = {...current, completion_document: {...current.completion_document!, revision: 1}}
  newer.optimized_resume = serializeDraft(newer.completion_document)
  expect(mergeAuthoritativeReview(newer, current)).toBe(newer)
  const foreign = {...current, action_review: {...current.action_review, resolvedDigest: 'foreign', reviewRevision: 4}, changes_summary: ['外部稿']}
  expect(mergeAuthoritativeReview(current, foreign).changes_summary).toEqual(current.changes_summary)
  const fresh = {...current, action_review: {...current.action_review, reviewRevision: 4}, changes_summary: ['已核对正文']}
  const merged = mergeAuthoritativeReview(current, fresh)
  expect(merged.action_review!.reviewRevision).toBe(4)
  expect(merged.changes_summary).toEqual(['已核对正文'])
  expect(mergeAuthoritativeReview(merged, current).action_review!.reviewRevision).toBe(4)
})
