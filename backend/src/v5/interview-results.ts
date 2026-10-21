import type { EvidenceAtom } from '@/v5/types'

const RESULT_TYPES = new Set<EvidenceAtom['claimType']>(['result', 'deliverable'])
const UNSAFE_FLAGS = new Set<EvidenceAtom['riskFlags'][number]>(['conflicting', 'future_or_planned', 'sensitive_pii', 'prompt_injection_like_text'])
const DANGLING_COMPARISON = /(?:提升|提高|增长|增加|下降|降低|减少|上升|升|增|降|减)(?:至|到)$|(?:达到|达至)$/u
const NUMBER_START = /^(?:约|近|超过|至少|不低于|不超过)?\s*[$¥￥]?\s*\d/u

export interface InterviewResultContinuation {
  resultEvidenceId: string
  previousEvidenceId: string
  tailEvidenceId: string
}

function usable(atom: EvidenceAtom) {
  return atom.status !== 'excluded' && !atom.riskFlags.some(flag => UNSAFE_FLAGS.has(flag))
}

function ordinal(atom: EvidenceAtom) {
  const match = /^B(\d+)$/u.exec(atom.sourceBlockId)
  return match ? Number(match[1]) : null
}

function intactSpan(atom: EvidenceAtom) {
  return Number.isSafeInteger(atom.sourceSpan.start) && atom.sourceSpan.start >= 0
    && atom.sourceSpan.end - atom.sourceSpan.start === atom.verbatimText.length
}

/** Return original evidence links only; never stitch or rewrite source contents. */
export function findInterviewResultContinuations(atoms: EvidenceAtom[]): InterviewResultContinuation[] {
  const idCounts = new Map<string, number>(), byBlock = new Map<string, EvidenceAtom[]>()
  const blockKey = (atom: EvidenceAtom, blockOrdinal = ordinal(atom)) => `${atom.sourceDocumentHash}|${atom.sourceScopeId}|${blockOrdinal}`
  for (const atom of atoms) {
    idCounts.set(atom.evidenceId, (idCounts.get(atom.evidenceId) ?? 0) + 1)
    const key = blockKey(atom)
    byBlock.set(key, [...(byBlock.get(key) ?? []), atom])
  }
  const unambiguous = (atom: EvidenceAtom) => usable(atom) && intactSpan(atom)
    && Boolean(atom.sourceDocumentHash.trim() && atom.sourceScopeId.trim()) && ordinal(atom) !== null
    && idCounts.get(atom.evidenceId) === 1 && byBlock.get(blockKey(atom))?.length === 1
  const result: InterviewResultContinuation[] = []
  for (const root of atoms.filter(atom => RESULT_TYPES.has(atom.claimType) && unambiguous(atom))) {
    let previous = root
    while (DANGLING_COMPARISON.test(previous.verbatimText.trim())) {
      const candidates = byBlock.get(blockKey(previous, ordinal(previous)! + 1)) ?? []
      const tail = candidates.length === 1 ? candidates[0] : undefined
      if (!tail || !unambiguous(tail) || !['other', 'result', 'deliverable'].includes(tail.claimType)
        || !NUMBER_START.test(tail.verbatimText.trim())) break
      // Canonical full text blocks may be separated by one newline or one blank
      // line. Larger source distances are not evidence of a numeric continuation.
      const gap = tail.sourceSpan.start - previous.sourceSpan.end
      if (gap !== 1 && gap !== 2) break
      result.push({ resultEvidenceId: root.evidenceId, previousEvidenceId: previous.evidenceId, tailEvidenceId: tail.evidenceId })
      previous = tail
    }
  }
  return result
}

/** Other-type numeric tails support results only when the entire source chain is cited. */
export function interviewResultEvidenceAtoms(evidenceIds: string[], atoms: EvidenceAtom[]): EvidenceAtom[] {
  const selected = new Set(evidenceIds)
  const byId = new Map(atoms.map(atom => [atom.evidenceId, atom]))
  // A source result can combine a completed deliverable with planned next steps.
  // Keep its original boundaries; the stricter safety filter only proves tails.
  const supported = new Map(atoms.filter(atom => selected.has(atom.evidenceId) && atom.status !== 'excluded' && RESULT_TYPES.has(atom.claimType))
    .map(atom => [atom.evidenceId, atom]))
  for (const continuation of findInterviewResultContinuations(atoms)) {
    if (selected.has(continuation.resultEvidenceId) && supported.has(continuation.previousEvidenceId)
      && selected.has(continuation.tailEvidenceId)) {
      supported.set(continuation.tailEvidenceId, byId.get(continuation.tailEvidenceId)!)
    }
  }
  return [...supported.values()]
}

/** A comparison without its endpoint is not a deliverable knownResult. */
export function hasIncompleteInterviewResult(text: string) {
  return /(?:原文|文本|内容)(?:已|被)?截断|截断处|原文(?:不全|缺失)|待补全|待补(?:充)?(?:数值|数字)/u.test(text)
    || /(?:(?:提升|提高|增长|增加|下降|降低|减少|上升|升|增|降|减)(?:至|到)|达到|达至)\s*(?:(?:未知|未提供|待确认|待补充)(?=[，,。；;！？!?]|$)|(?=[，,。；;！？!?]|$))/u.test(text)
    || /\d+(?:\.\s*\d+)?\s*(?:%|％|个百分点|万元|万|元|分钟|秒|倍)?\s*(?:至|到|→|->)\s*(?:(?:未知|未提供|待确认|待补充)(?=[，,。；;！？!?]|$)|(?=[，,。；;！？!?]|$))/u.test(text)
}
