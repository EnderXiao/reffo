import {createDigest} from '@/harness/run-context'
import type {InterviewPresentation} from '@/types'
import type {EvidenceAtom, ResumeEvidenceBundle} from '@/v5/types'

const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** This is user-authored material from one interview revision, not independent verification. */
export function interviewUserFactSnapshot(resume: ResumeEvidenceBundle, usedIds: string[], reference?: InterviewPresentation['basedOnDocument']): InterviewPresentation['userFactSnapshot'] {
  if (!reference) return undefined
  const ids = new Set(usedIds)
  const facts = resume.evidenceAtoms.filter(atom => ids.has(atom.evidenceId) && atom.status !== 'excluded'
    && atom.provenance?.kind === 'user_edit' && atom.provenance.documentId === reference.documentId && atom.provenance.revision === reference.revision)
    .map(atom => ({evidenceId: atom.evidenceId, sourceScopeId: atom.sourceScopeId, sourceBlockId: atom.sourceBlockId, text: atom.verbatimText}))
  return facts.length ? {documentId: reference.documentId, revision: reference.revision, facts} : undefined
}

/** Restore only the old interview's own user facts, never facts from the newer draft. */
export function restoreInterviewUserFacts(resume: ResumeEvidenceBundle, presentation: unknown, reference?: InterviewPresentation['basedOnDocument']): ResumeEvidenceBundle {
  const snapshot = object(object(presentation)?.userFactSnapshot)
  if (!reference || snapshot?.documentId !== reference.documentId || snapshot.revision !== reference.revision || !Array.isArray(snapshot.facts)) return resume
  const scopes = new Set([...resume.timeline.map(item => item.scopeId), ...resume.evidenceAtoms.map(atom => atom.sourceScopeId)])
  const existing = new Set(resume.evidenceAtoms.map(atom => atom.evidenceId))
  const additions: EvidenceAtom[] = []
  for (const value of snapshot.facts) {
    const fact = object(value)
    if (!fact || typeof fact.evidenceId !== 'string' || typeof fact.sourceScopeId !== 'string' || !scopes.has(fact.sourceScopeId)
      || typeof fact.sourceBlockId !== 'string' || !fact.sourceBlockId.trim() || typeof fact.text !== 'string' || !fact.text.trim() || existing.has(fact.evidenceId)
      || fact.evidenceId !== `user:${createDigest([reference.documentId, reference.revision, fact.sourceBlockId, fact.text]).slice(0, 20)}`) continue
    existing.add(fact.evidenceId)
    const sourceScopeId = fact.sourceScopeId
    additions.push({evidenceId: fact.evidenceId, sourceScopeId: fact.sourceScopeId, sourceBlockId: fact.sourceBlockId,
      sourceDocumentHash: createDigest([reference.documentId, reference.revision]), sourceSpan: {start: 0, end: fact.text.length},
      verbatimText: fact.text, normalizedClaim: fact.text, claimType: 'other', status: 'source_qualified', attributionLevel: 'unspecified',
      sourceActionVerb: null, qualifiers: ['用户本次补充，未经外部核验'], riskFlags: [],
      numericAtoms: (fact.text.match(/\d+(?:[,.]\d+)*(?:%|％)?/gu) ?? []).map(raw => ({raw, valueText: raw, unit: null, qualifier: '用户提供', period: null, ownerScope: sourceScopeId})),
      provenance: {kind: 'user_edit', documentId: reference.documentId, revision: reference.revision}})
  }
  return additions.length ? {...resume, evidenceAtoms: [...resume.evidenceAtoms, ...additions]} : resume
}
