import type { ResumeEvidenceBundle, V5ResumePlan } from '@/v5/types'
import { hasEditorialSourceText, hasIncompleteMetricValue } from '@/v5/composition/source-display'

export const WRITING_CONTEXT_VERSION = 'writing-context-v1' as const
export interface WritingContext {
  anchorEvidenceId: string
  evidenceId: string
  role: 'problem' | 'constraint' | 'stage'
}

/** A narrow source-structure association, not semantic inference from company names. */
export function deriveWritingContexts(resume: ResumeEvidenceBundle, plan: V5ResumePlan, includeSelectedContext = false): WritingContext[] {
  const selected = new Set(plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds))
  const businessScopes = new Set(resume.timeline.filter(scope => ['experience', 'internship', 'project', 'research'].includes(scope.kind)).map(scope => scope.scopeId))
  const atoms = [...resume.evidenceAtoms].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start)
  const result: WritingContext[] = []
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index]
    if (atom.claimType !== 'other' || atom.status !== 'source_supported' || atom.riskFlags.length
      || !businessScopes.has(atom.sourceScopeId) || (!includeSelectedContext && selected.has(atom.evidenceId))
      || atom.sourceDocumentHash !== resume.sourceDocument.sha256
      || atom.sourceSpan.end - atom.sourceSpan.start !== atom.verbatimText.length
      || hasEditorialSourceText(atom.verbatimText) || hasIncompleteMetricValue(atom.verbatimText)) continue
    const text = atom.verbatimText.trim().replace(/^(?:[-*•]|#{1,6})\s+/u, '')
    if (!/[。.!！?？]$/u.test(text)) continue
    const role = /^(?:问题|痛点|业务背景|项目背景|背景)(?:[:：\s]|(?=\p{Script=Han}))|^(?:problem|background|challenge)\s*:/iu.test(text) ? 'problem'
      : /^(?:约束|限制条件)\s*[:：]|^(?:constraint|limitation)\s*:/iu.test(text) ? 'constraint'
      : /^(?:项目阶段|当前阶段)\s*[:：]|^(?:project stage|status)\s*:/iu.test(text) ? 'stage' : null
    if (!role) continue
    // Problem/constraint labels introduce the next action; stage labels qualify the preceding one.
    const anchor = atoms[index + (role === 'stage' ? -1 : 1)]
    if (!anchor || !selected.has(anchor.evidenceId) || !['action', 'responsibility', 'deliverable'].includes(anchor.claimType)
      || anchor.status === 'excluded' || anchor.sourceScopeId !== atom.sourceScopeId
      || anchor.sourceDocumentHash !== atom.sourceDocumentHash) continue
    const [left, right] = role === 'stage' ? [anchor, atom] : [atom, anchor]
    if (!/^B\d+$/u.test(left.sourceBlockId) || !/^B\d+$/u.test(right.sourceBlockId)
      || Number(right.sourceBlockId.slice(1)) !== Number(left.sourceBlockId.slice(1)) + 1
      || right.sourceSpan.start <= left.sourceSpan.end || right.sourceSpan.start - left.sourceSpan.end > 4
      || atoms.filter(other => other.sourceBlockId === atom.sourceBlockId || other.sourceSpan.start === atom.sourceSpan.start).length !== 1) continue
    result.push({ anchorEvidenceId: anchor.evidenceId, evidenceId: atom.evidenceId, role })
  }
  return result
}
