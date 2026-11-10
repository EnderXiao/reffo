import type { V5WorkflowResult } from '@/v5/types'
import { serializeDraft, validateCompletionDocument } from '@/shared/resume-completion'

/** Keep the original display snapshot for response and checkpoint identity. */
export function deliveredResumeMarkdown(result: Pick<V5WorkflowResult, 'artifact' | 'deliveryMarkdown' | 'completionDocument'>): string {
  if (result.completionDocument) {
    const validation = validateCompletionDocument(result.completionDocument, result.deliveryMarkdown)
    if (!validation.ok) throw new Error('COMPLETION_DOCUMENT_OUT_OF_SYNC')
    return serializeDraft(validation.document)
  }
  return result.deliveryMarkdown ?? result.artifact.markdown
}
