import type { EvidenceAtom, ResumeEvidenceBundle } from '@/v5/types'

/** Prefer additional education information over repeating the server-rendered heading. */
export function educationDetailPriority(atom: EvidenceAtom, scope: ResumeEvidenceBundle['timeline'][number]) {
  if (atom.claimType !== 'education') return 0
  if (/本科|学士|硕士|博士|专科|学位|bachelor|master|doctor|\b(?:BSc|MSc|MBA|PhD)\b/iu.test(atom.verbatimText)) return 3
  const signature = (value: string) => value.toLowerCase().replace(/[#|｜\s]/gu, '')
  const heading = signature([scope.organization, scope.title].filter(Boolean).join(''))
  if (signature(atom.verbatimText) === heading) return 0
  return 1
}

/** A degree and a compact academic distinction may share one education item. */
export function educationCompanion(primary: EvidenceAtom, candidates: EvidenceAtom[]) {
  if (primary.claimType !== 'education') return undefined
  const signature = (text: string) => text.toLowerCase().replace(/[\s|｜；;。]/gu, '')
  return candidates.find(atom => atom.evidenceId !== primary.evidenceId
    && atom.sourceScopeId === primary.sourceScopeId && atom.sourceDocumentHash === primary.sourceDocumentHash
    && atom.claimType === 'education' && atom.status === 'source_supported' && !atom.riskFlags.length
    && /均分|GPA|排名|前\s*\d|奖学金|scholarship|distinction|honou?rs|\btop\s+\d/iu.test(atom.verbatimText)
    && !signature(primary.verbatimText).includes(signature(atom.verbatimText)))
}
