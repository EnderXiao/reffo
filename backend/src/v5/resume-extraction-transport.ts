import { z } from 'zod'
import { canonicalSourceDocumentSchema, resumeExtractionCandidateSchema } from '@/v5/schemas'
import type { CanonicalSourceDocument } from '@/v5/types'

/** Read only server envelope slots; never infer source from a repair draft. */
export function resumeDocumentFromEnvelope(value: unknown, depth = 0): CanonicalSourceDocument | null {
  if (depth > 8 || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of ['originalEnvelope', 'payload'] as const) {
    const found = resumeDocumentFromEnvelope(record[key], depth + 1)
    if (found) return found
  }
  const parsed = canonicalSourceDocumentSchema.strip().safeParse(record.canonicalSourceDocument)
  return parsed.success ? parsed.data : null
}

/** Source text, offsets and numeric indexes are deterministic, not model output. */
export function resumeExtractionTransportSchema(document: CanonicalSourceDocument) {
  const sourceIds = document.blocks.map(block => block.sourceBlockId)
  const factSchema = resumeExtractionCandidateSchema.shape.factCandidates.element.omit({
    blockRelativeSpan: true, verbatimText: true, normalizedClaim: true, numericAtoms: true,
  }).extend({
    sourceBlockId: sourceIds.length > 0
      ? z.enum(sourceIds as [string, ...string[]])
      : z.string(),
  }).strict()
  return resumeExtractionCandidateSchema.extend({
    factCandidates: z.array(factSchema).max(document.blocks.length),
  }).strict()
}

export function materializeResumeExtractionTransport(value: unknown, document: CanonicalSourceDocument) {
  const parsed = resumeExtractionTransportSchema(document).safeParse(value)
  if (!parsed.success) return parsed
  const candidate = parsed.data
  const seen = new Set<string>()
  const duplicates: z.ZodIssue[] = []
  candidate.factCandidates.forEach((fact, index) => {
    if (seen.has(fact.sourceBlockId)) duplicates.push({
      code: 'custom', path: ['factCandidates', index, 'sourceBlockId'],
      message: 'Compact extraction permits one complete annotation per source block',
    })
    seen.add(fact.sourceBlockId)
  })
  if (duplicates.length > 0) return { success: false as const, error: new z.ZodError(duplicates) }
  const blocks = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  return resumeExtractionCandidateSchema.safeParse({
    ...candidate,
    factCandidates: candidate.factCandidates.map(fact => {
      const block = blocks.get(fact.sourceBlockId)!
      return {
        ...fact,
        blockRelativeSpan: { start: 0, end: block.text.length },
        verbatimText: block.text,
        normalizedClaim: block.text,
        // The existing evidence validator rebuilds numeric atoms from verbatimText.
        numericAtoms: [],
      }
    }),
  })
}
