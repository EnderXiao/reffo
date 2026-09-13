import type { EvidenceAtom, ResumeEvidenceBundle } from '@/v5/types'
import { findInterviewResultContinuations } from '@/v5/interview-results'

export interface InterviewCaseGroup {
  caseGroupId: string
  sourceScopeId: string
  title: string
  titleEvidenceId: string
  evidenceIds: string[]
}

function usable(atom: EvidenceAtom) {
  return atom.status !== 'excluded' && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag))
}

/** Recognize only explicit, ordered 问题 → 关键动作 → 结果/边界 cards within a source scope. */
export function deriveInterviewCaseGroups(resume: ResumeEvidenceBundle): InterviewCaseGroup[] {
  const groups: InterviewCaseGroup[] = []
  const continuations = findInterviewResultContinuations(resume.evidenceAtoms)
  const byScope = new Map<string, EvidenceAtom[]>()
  for (const atom of resume.evidenceAtoms) {
    if (atom.riskFlags.includes('prompt_injection_like_text')) continue
    byScope.set(atom.sourceScopeId, [...(byScope.get(atom.sourceScopeId) ?? []), atom])
  }
  for (const [scopeId, unordered] of byScope) {
    const atoms = [...unordered].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || a.evidenceId.localeCompare(b.evidenceId))
    let previousEnd = -1
    for (let index = 0; index < atoms.length; index += 1) {
      if (!/^\s*(?:[-*]\s*)?问题/u.test(atoms[index]!.verbatimText)) continue
      let action = -1, end = -1
      for (let cursor = index + 1; cursor < Math.min(atoms.length, index + 9); cursor += 1) {
        const text = atoms[cursor]!.verbatimText.trim()
        if (/^(?:问题|#{1,6}\s)/u.test(text)) break
        if (/^关键动作/u.test(text)) action = cursor
        if (action > index && /^结果\s*[/／、与及]\s*边界/u.test(text)) { end = cursor; break }
      }
      if (end < 0) continue
      let first = Math.max(previousEnd + 1, index - 4)
      for (let cursor = first; cursor < index; cursor += 1) {
        if (/^#{1,6}\s/u.test(atoms[cursor]!.verbatimText)) first = cursor + 1
      }
      const titleIndex = atoms.findIndex((atom, cursor) => cursor >= first && cursor < index && usable(atom)
        && atom.verbatimText.trim().length >= 4 && atom.verbatimText.trim().length <= 80
        && !/[。；;！？!?]/u.test(atom.verbatimText)
        && !/^(?:[A-D]\s*[|｜]|CASE\s+BANK|关键动作|结果|问题|\d{4}\s*[-./])/iu.test(atom.verbatimText.trim()))
      if (titleIndex < 0) continue
      const title = atoms[titleIndex]!
      const units = atoms.slice(titleIndex, end + 1)
      if (units.some((atom, position) => {
        if (!/^B\d+$/u.test(atom.sourceBlockId)) return true
        if (position === 0) return false
        const previous = units[position - 1]!
        const blockGap = Number(atom.sourceBlockId.slice(1)) - Number(previous.sourceBlockId.slice(1))
        return atom.sourceDocumentHash !== previous.sourceDocumentHash || blockGap < 0 || blockGap > 1
          || atom.sourceSpan.start < previous.sourceSpan.end || atom.sourceSpan.start - previous.sourceSpan.end > 2
      })) continue
      const members = units.map(atom => atom.evidenceId)
      members.push(...continuations.filter(link => link.resultEvidenceId === atoms[end]!.evidenceId).map(link => link.tailEvidenceId))
      groups.push({ caseGroupId: `case:${scopeId}:${title.sourceBlockId}`, sourceScopeId: scopeId,
        title: title.verbatimText, titleEvidenceId: title.evidenceId, evidenceIds: members })
      previousEnd = end
      index = end
    }
  }
  return groups
}
