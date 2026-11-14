import type {InterviewPresentation, InterviewSuggestions, ResumeHistoryRecord} from '@/types'
import {currentInterviewSnapshot, savedInterviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {buildLegacyInterviewPresentation} from '@/v5/interview-presentation'
import {jobRequirementBundleSchema, resumeEvidenceBundleSchema} from '@/v5/schemas'
import {restoreInterviewUserFacts} from '@/v5/interview-user-facts'

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined

/** Owned history is projected on read; its durable source and generated text are never rewritten. */
export function projectHistoryInterviewPresentation(history: ResumeHistoryRecord): ResumeHistoryRecord {
  const result = record(history.process_result), raw = record(result?.interview)
  if (!result || !raw || !Array.isArray(raw.questions) || !Array.isArray(raw.story_recommendations)) return history
  const suggestions: InterviewSuggestions = {
    ...raw, questions: raw.questions.filter((value): value is string => typeof value === 'string'),
    story_recommendations: raw.story_recommendations.filter((value): value is InterviewSuggestions['story_recommendations'][number] => {
      const item = record(value)
      return Boolean(item && typeof item.title === 'string' && typeof item.background === 'string' && typeof item.result === 'string'
        && Array.isArray(item.storytelling_approach) && (!item.source_references || Array.isArray(item.source_references)
          && item.source_references.every(value => {const ref = record(value); return ref && typeof ref.evidence_id === 'string'
            && typeof ref.source_scope_id === 'string' && typeof ref.source_quote === 'string' && ['source_resume', 'user_fact'].includes(String(ref.source_kind))})))
    }),
    follow_up_questions: Array.isArray(raw.follow_up_questions) ? raw.follow_up_questions.filter((value): value is string => typeof value === 'string') : [],
  }
  const reference = record(raw.based_on_document) ?? record(record(raw.presentation)?.basedOnDocument)
  const basedOnDocument: InterviewPresentation['basedOnDocument'] = reference && typeof reference.documentId === 'string'
    && Number.isInteger(reference.revision) && Number(reference.revision) >= 0
    ? {documentId: reference.documentId, revision: Number(reference.revision),
      ...(typeof reference.resolvedDigest === 'string' ? {resolvedDigest: reference.resolvedDigest} : {})} : undefined
  const storedBasis = savedInterviewGenerationBasis(history)
  let basis = storedBasis && resumeEvidenceBundleSchema.safeParse(storedBasis.resumeEvidenceBundle).success
    && jobRequirementBundleSchema.safeParse(storedBasis.jobRequirementBundle).success ? storedBasis : undefined
  const document = record(record(result.optimized)?.completion_document)
  if (basis && basedOnDocument && basedOnDocument.documentId === document?.documentId && basedOnDocument.revision === document?.revision) {
    // User additions belong to the saved revision; do not relabel a newer draft as the basis for an old interview.
    try { basis = currentInterviewSnapshot(basis, history) } catch { /* Historical drafts can predate completion documents. */ }
  }
  if (basis) basis = {...basis, resumeEvidenceBundle: restoreInterviewUserFacts(basis.resumeEvidenceBundle, raw.presentation, basedOnDocument)}
  const presentation = buildLegacyInterviewPresentation(suggestions, basis,
    {sourceText: history.resume_content, basedOnDocument})
  return {...history, process_result: {...result, interview: {...suggestions, presentation}}}
}
