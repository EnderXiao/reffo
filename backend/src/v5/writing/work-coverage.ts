import type { ResumeEvidenceBundle } from '@/v5/types'
import { hasEditorialSourceText, hasIncompleteMetricValue } from '@/v5/composition/source-display'

/** A source-listed work scope is useful context, not a new achievement. Only
 * copy a short, unqualified list from this exact job; never borrow a project.
 */
export function workScopeBrief(resume: ResumeEvidenceBundle, scopeId: string) {
  const timeline = resume.timeline.find(item => item.scopeId === scopeId)
  if (!timeline || !['experience', 'internship'].includes(timeline.kind)) return null
  const atoms = resume.evidenceAtoms.filter(atom => atom.sourceScopeId === scopeId)
    .sort((a, b) => a.sourceSpan.start - b.sourceSpan.start)
  const atom = atoms.find(item => !['identity', 'timeline'].includes(item.claimType))
  if (!atom || atom.claimType !== 'other' || atom.status !== 'source_supported' || atom.riskFlags.length) return null
  const text = atom.verbatimText.trim()
  if (text.length < 8 || text.length > 160 || /[\r\n\d。！？!?；;#<>]|(?:待确认|待补充|熟悉|精通|擅长|目标|愿景|未|没有)/u.test(text)
    || !/[、，,]/u.test(text) || /[、，,：:]$/u.test(text)
    || hasEditorialSourceText(text) || hasIncompleteMetricValue(text)) return null
  return { evidenceId: atom.evidenceId, text: `工作范围：${text}。` }
}

export function isExactWorkScopeBrief(resume: ResumeEvidenceBundle, scopeId: string, evidenceIds: string[], text: string) {
  const brief = workScopeBrief(resume, scopeId)
  return !!brief && evidenceIds.length === 1 && evidenceIds[0] === brief.evidenceId
    && text.replace(/^\s*[-*+]\s+/u, '').trim() === brief.text
}
