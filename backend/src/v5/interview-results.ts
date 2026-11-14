import type { EvidenceAtom } from '@/v5/types'
import {createHash} from 'node:crypto'
import {hasProvenSourceLayoutSeparator, isSourceLayoutWhitespace} from '@/v5/composition/source-continuation-proof'

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

const normalizedLiteral = (text: string) => text.replace(/\s/gu, '').replace(/[。；;]+$/u, '')
const DANGLING_QUANTITY = /\d[\d,.]*(?:\+)?$/u
const QUANTITY_TAIL = /^(?:小时|分钟|家|个|人|名|位|户|份|项|次|场|条|篇|款|套|类|种|台|所|校|店|组|批|座|间|年|月|周|天|秒|万|亿|元|%|％|倍|GB|TB)(?=\p{Script=Han}|[、，,]|$)/iu

function standaloneTailDeliverable(text: string, atom: EvidenceAtom, atoms: EvidenceAtom[], sourceText?: string) {
  if (!QUANTITY_TAIL.test(text) || !atom.verbatimText.trim().startsWith(text) || !usable(atom) || !intactSpan(atom)
    || atom.provenance?.kind === 'user_edit' || !atom.sourceDocumentHash.trim() || ordinal(atom) === null) return undefined
  const sameBlock = (candidate: EvidenceAtom, block: number) => candidate.sourceDocumentHash === atom.sourceDocumentHash
    && candidate.sourceScopeId === atom.sourceScopeId && ordinal(candidate) === block
  if (atoms.filter(candidate => sameBlock(candidate, ordinal(atom)!)).length !== 1
    || atoms.filter(candidate => candidate.evidenceId === atom.evidenceId).length !== 1) return undefined
  const predecessors = atoms.filter(candidate => sameBlock(candidate, ordinal(atom)! - 1))
  const previous = predecessors.length === 1 ? predecessors[0] : undefined
  if (!previous || !usable(previous) || !intactSpan(previous) || previous.provenance?.kind === 'user_edit'
    || atoms.filter(candidate => candidate.evidenceId === previous.evidenceId).length !== 1
    || !DANGLING_QUANTITY.test(previous.verbatimText.trim())) return undefined
  let proven = hasProvenSourceLayoutSeparator(previous, atom)
  if (!proven && sourceText !== undefined) {
    const source = sourceText.replace(/\r\n?/gu, '\n').normalize('NFC')
    const separator = source.slice(previous.sourceSpan.end, atom.sourceSpan.start)
    proven = createHash('sha256').update(source).digest('hex') === atom.sourceDocumentHash
      && source.slice(previous.sourceSpan.start, previous.sourceSpan.end) === previous.verbatimText
      && source.slice(atom.sourceSpan.start, atom.sourceSpan.end) === atom.verbatimText
      && (separator === '\n' || isSourceLayoutWhitespace(separator))
  }
  if (!proven) return undefined
  const match = /[，,]\s*((?:已)?(?:完成|形成|产出|提交|交付|编制|整理出|回收)[^。；;！？!?]*(?:报告|分析|材料|方案|原型|答卷|问卷|文档)[^。；;！？!?]*)$/u.exec(text)
  if (!match || /未|不|无|待|计划|预计|预期|目标|拟|将|假设|如果|可能/u.test(text.slice(0, match.index))) return undefined
  return match[1]!.trim()
}

/** A proven quantity-line fragment may display its own complete, literal deliverable clause. */
export function projectInterviewKnownResult(knownResult: string, evidenceIds: string[], atoms: EvidenceAtom[], sourceText?: string): string {
  const selected = new Set(evidenceIds)
  for (const atom of atoms) {
    if (!selected.has(atom.evidenceId)) continue
    const sentence = atom.verbatimText.split(/[。；;！？!?]/u)[0]?.trim()
    if (!sentence || normalizedLiteral(sentence) !== normalizedLiteral(knownResult)) continue
    const standalone = standaloneTailDeliverable(sentence, atom, atoms, sourceText)
    if (standalone) return standalone + (/[。；;]$/u.exec(knownResult.trim())?.[0] ?? '')
  }
  return knownResult
}

/** Literal completed artifacts survive a mixed action label; no inferred impact. */
export function interviewDeliveredArtifactOptions(atoms: EvidenceAtom[]) {
  return atoms.filter(atom => atom.claimType === 'action' && atom.status === 'source_supported'
    && usable(atom) && !atom.riskFlags.includes('uncertain') && !atom.qualifiers.length)
    .flatMap(atom => atom.verbatimText.split(/[。；;！？!?]/u).map(text => text.trim()).filter(text => (
      /(?:完成|形成|产出|提交|交付|编制|整理出|回收)[^。；;！？!?]{0,100}(?:报告|分析|材料|方案|原型|答卷|问卷|文档)/u.test(text)
      && !/未|不|无|待|计划|预计|预期|目标|希望|拟|将|假设|如果|争取|力争|可能|建议|准备|需(?:要)?/u.test(text)
    )).map(text => ({evidenceId: atom.evidenceId, sourceScopeId: atom.sourceScopeId,
      text: standaloneTailDeliverable(text, atom, atoms) ?? text})))
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
export function interviewResultEvidenceAtoms(evidenceIds: string[], atoms: EvidenceAtom[], knownResult?: string): EvidenceAtom[] {
  const selected = new Set(evidenceIds)
  const byId = new Map(atoms.map(atom => [atom.evidenceId, atom]))
  // A source result can combine a completed deliverable with planned next steps.
  // Keep its original boundaries; the stricter safety filter only proves tails.
  const supported = new Map(atoms.filter(atom => selected.has(atom.evidenceId) && atom.status !== 'excluded' && RESULT_TYPES.has(atom.claimType))
    .map(atom => [atom.evidenceId, atom]))
  // The extractor's primary action label does not erase a measured result in
  // the same source block. This exception admits only the complete literal
  // outcome quoted by this story, never a guessed paraphrase or a new metric.
  const literal = knownResult?.replace(/\s/gu, '').trim()
  if (knownResult) for (const option of interviewDeliveredArtifactOptions(atoms)) {
    if (selected.has(option.evidenceId) && normalizedLiteral(option.text) === normalizedLiteral(knownResult)) {
      supported.set(option.evidenceId, byId.get(option.evidenceId)!)
    }
  }
  if (literal && /(?:达到|降至|降到|升至|升到|提升至|提高至|降低至|减少至|降为|提升到|提高到|降低到|减少到)\d/u.test(literal)
    && !/计划|预计|预期|待验证|目标(?:为|是|达到)|将(?:达到|提高|降低)/u.test(literal)) {
    for (const atom of atoms) {
      if (selected.has(atom.evidenceId) && atom.claimType === 'action' && atom.status === 'source_supported'
        && usable(atom) && !atom.riskFlags.includes('uncertain') && !atom.qualifiers.length
        && atom.numericAtoms.length > 0 && atom.verbatimText.replace(/\s/gu, '').includes(literal)) supported.set(atom.evidenceId, atom)
    }
  }
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
