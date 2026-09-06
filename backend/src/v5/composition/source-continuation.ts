import type { EvidenceAtom } from '@/v5/types'

const BUSINESS_CLAIM_TYPES = new Set<EvidenceAtom['claimType']>([
  'responsibility',
  'action',
  'deliverable',
  'result',
])

const SOURCE_CONCAT_DISALLOWED_RISK_FLAGS = new Set<EvidenceAtom['riskFlags'][number]>([
  'conflicting',
  'future_or_planned',
  'sensitive_pii',
  'prompt_injection_like_text',
])

const SOURCE_SENTENCE_END = /[。！？.!?；;：:]$/u
const SOURCE_DANGLING_QUANTITY = /(?:约|近|超|超过|至少|不低于|累计)?\d[\d,.]*(?:\+)?$/u
const SOURCE_CONTINUATION_UNIT = /^(?:门店|小时|分钟|人民币|美元|家|个|人|名|位|户|份|项|次|场|条|篇|款|套|类|种|台|所|校|店|组|批|座|间|年|月|周|天|秒|万|亿|元|%|％|倍|GB|TB)(?:$|\b|(?=\p{Script=Han}))/iu
const SOURCE_DANGLING_METRIC_CUE = /(?:提升(?:至|到)?|增长(?:至|到)?|降低(?:至|到)?|下降(?:至|到)?|减少(?:至|到)?|节省(?:至|到)?|达到|覆盖|转化率|成功率|完成率|准确率|替代率|效率|营收|销售额|GMV|DAU|MAU|ROI|NPS|累计|日均|月均|年均)$/iu
const SOURCE_CONTINUATION_NUMBER = /^(?:约|近|超|超过|至少|不低于)?(?:[$¥￥]|人民币|美元)?\d/iu

function sourceBlockOrdinal(sourceBlockId: string) {
  const match = /^B(\d+)$/.exec(sourceBlockId)
  return match ? Number(match[1]) : null
}

function normalizeSourceContinuationText(value: string) {
  return value.trim().replace(/^(?:#{1,6}|[-*+])\s+/, '').trim()
}

/**
 * Newline adjacency is structural evidence only. Removing that newline also
 * requires a conservative lexical boundary proof so table columns and nearby
 * metadata cannot be silently fused into a new claim.
 */
export function isLexicallyProvenSourceContinuation(left: string, right: string) {
  const previous = normalizeSourceContinuationText(left)
  const current = normalizeSourceContinuationText(right)
  if (!previous || !current || SOURCE_SENTENCE_END.test(previous)) return false
  return (
    SOURCE_DANGLING_QUANTITY.test(previous) && SOURCE_CONTINUATION_UNIT.test(current)
  ) || (
    SOURCE_DANGLING_METRIC_CUE.test(previous) && SOURCE_CONTINUATION_NUMBER.test(current)
  ) || (
    // A genitive continuation cannot stand alone; retain both complete source
    // pieces in their original order, including any qualifiers on the left.
    /^的[\p{L}\p{N}]/u.test(current) && /[\p{L}\p{N}]$/u.test(previous)
  )
}

export function businessSourceContinuationGroups(atoms: EvidenceAtom[]) {
  const ordered = [...atoms].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || a.evidenceId.localeCompare(b.evidenceId))
  const groups: EvidenceAtom[][] = []
  let run: EvidenceAtom[] = []
  const flush = () => { if (run.length >= 2 && run.length <= 3) groups.push(run); run = [] }
  for (const atom of ordered) {
    const previous = run.at(-1)
    if (atom.riskFlags.length > 0 || atom.status === 'excluded' || !BUSINESS_CLAIM_TYPES.has(atom.claimType)) {
      flush()
      continue
    }
    if (previous && !areCanonicalAdjacentSourceAtoms([previous, atom])) flush()
    run.push(atom)
  }
  flush()
  return groups
}

/**
 * A delimiter-free join is safe only for business facts split by canonical
 * hard line breaks whose text boundary is independently provable. Physical
 * adjacency alone is intentionally insufficient because it also describes
 * table cells, timeline fields, and prompt-like input.
 */
export function areCanonicalAdjacentSourceAtoms(atoms: EvidenceAtom[]) {
  if (atoms.length < 2) return false
  const sourceScopeId = atoms[0]?.sourceScopeId
  const sourceDocumentHash = atoms[0]?.sourceDocumentHash
  if (!sourceScopeId || !sourceDocumentHash) return false
  if (atoms.some(atom => (
    atom.sourceScopeId !== sourceScopeId
    || atom.sourceDocumentHash !== sourceDocumentHash
    || atom.status === 'excluded'
    || !BUSINESS_CLAIM_TYPES.has(atom.claimType)
    || atom.riskFlags.some(flag => SOURCE_CONCAT_DISALLOWED_RISK_FLAGS.has(flag))
  ))) return false

  for (let index = 1; index < atoms.length; index += 1) {
    const previous = atoms[index - 1]
    const current = atoms[index]
    const previousOrdinal = sourceBlockOrdinal(previous.sourceBlockId)
    const currentOrdinal = sourceBlockOrdinal(current.sourceBlockId)
    if (
      previousOrdinal === null
      || currentOrdinal === null
      || currentOrdinal !== previousOrdinal + 1
      || current.sourceSpan.start !== previous.sourceSpan.end + 1
      || !isLexicallyProvenSourceContinuation(previous.verbatimText, current.verbatimText)
    ) return false
  }
  return true
}
