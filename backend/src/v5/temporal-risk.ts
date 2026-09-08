import type { CanonicalSourceDocument, ResumeExtractionCandidate } from '@/v5/types'
import type { ResumeExtractionChunk } from '@/v5/chunked-resume-extraction'

type Fact = ResumeExtractionCandidate['factCandidates'][number]
export const TEMPORAL_RISK_POLICY_VERSION = 'source-sentence-temporal-risk-v2' as const
type Observation = { code: 'TEMPORAL_RISK_LOCALIZED' | 'TEMPORAL_RISK_SCOPE_UNRESOLVED'; factIndex: number }

// Deliberately narrow recognizers, not a universal temporal/semantic classifier.
// The quote identifies a disputed unit, not proof that the model's risk is true.
// Neither splitting nor an approval keyword promotes that unit to an achievement.
const FORWARD_OR_DEPENDENT = /(?:计划|规划|拟|将|预计|预期|未来|即将|待|尚未|未获|未批|未通过|有望|希望|如果|假如|假设|若|一旦|否则|才会|届时|上述|前述|以下|该计划|\b(?:will|would|may|might|plan(?:ned|ning)?|pending|proposed|expected|if|unless|once|then)\b)/iu
const CURRENT_OR_COMPLETED = /^(?:目前(?:负责|担任)|当前(?:负责|担任)|负责|参与|协助|已(?:完成|交付|上线|建立|实现)|currently\s+(?:responsible|leading|working)|(?:completed|delivered|launched)\b)/iu
const LOCAL_STATE = /(?:计划|拟|将|预计|预期|未来|即将|待|尚未|未获|未批|有望|已(?:经|获|获得)?批准|\b(?:will|planned|pending|proposed|expected|approved)\b)/iu
const RETRACTION_OR_BACK_REFERENCE = /(?:上述|前述|以上|这些|该(?:成果|工作|职责|项目)|此项|前[一两二三]?句|那(?:些|项)|实际未|并未|没有|不属实|否认|撤销|撤回|取消|作废|失效|更正|而非|不代表|并不|尚未完成|仍未完成|仅为|只是|假设|假想|虚构|模拟|设想|属实与否|\b(?:retract|withdraw|cancel|not actually|not completed|above|previous|former|this|these|those|it|hypothetical|fictional|imaginary|simulation)\b)/iu

/** Every character belongs to one complete sentence; never split commas or decimals. */
function completeSentences(text: string) {
  const pieces = [...text.matchAll(/[^。！？!?\r\n]+[。！？!?]|[^\r\n]+?(?:\.(?=\s+[A-Z]|$))/gu)]
  if (pieces.length < 2 || pieces.length > 3 || pieces.map(p => p[0]).join('') !== text) return null
  return pieces.map(piece => ({ text: piece[0], start: piece.index!, end: piece.index! + piece[0].length }))
}

/** Isolates a model-cited unit from independent current duties, never clearing its risk. */
export function localizeTemporalRisk(document: CanonicalSourceDocument, candidate: ResumeExtractionCandidate, maxFacts: number) {
  const blocks = new Map(document.blocks.map(b => [b.sourceBlockId, b]))
  const blockFactCounts = new Map<string, number>()
  for (const fact of candidate.factCandidates) blockFactCounts.set(fact.sourceBlockId, (blockFactCounts.get(fact.sourceBlockId) ?? 0) + 1)
  const ids = new Set(candidate.factCandidates.map(f => f.factLocalId))
  const observations: Observation[] = []
  const aliases = new Map<string, string[]>()
  let headroom = Math.max(0, maxFacts - candidate.factCandidates.length)
  const facts = candidate.factCandidates.flatMap((fact, factIndex): Fact[] => {
    if (!fact.riskFlags.includes('future_or_planned') || fact.proposedStatus === 'excluded') return [fact]
    const unresolved = () => {
      observations.push({ code: 'TEMPORAL_RISK_SCOPE_UNRESOLVED', factIndex })
      return [fact]
    }
    const block = blocks.get(fact.sourceBlockId)
    // Do not rehabilitate excluded evidence or override injection/conflict/PII flags.
    if (!block || block.inputRiskFlags.length
      || blockFactCounts.get(fact.sourceBlockId) !== 1
      || (block.sectionHint !== null && FORWARD_OR_DEPENDENT.test(block.sectionHint))
      || (document as ResumeExtractionChunk).extractionScopeContext?.blocks.some(b => FORWARD_OR_DEPENDENT.test(b.text))
      || fact.riskFlags.some(r => r !== 'future_or_planned' && r !== 'team_attribution')
      || fact.verbatimText !== block.text || fact.blockRelativeSpan.start !== 0 || fact.blockRelativeSpan.end !== block.text.length
      || !fact.temporalRiskQuote || candidate.conflicts.some(c => c.factLocalIds.includes(fact.factLocalId))) return unresolved()
    const sentences = completeSentences(block.text)
    const riskIndex = sentences?.findIndex(s => s.text === fact.temporalRiskQuote) ?? -1
    if (!sentences || riskIndex < 0 || sentences.filter(s => s.text === fact.temporalRiskQuote).length !== 1
      || !LOCAL_STATE.test(sentences[riskIndex].text) || RETRACTION_OR_BACK_REFERENCE.test(sentences[riskIndex].text)
      || headroom < sentences.length - 1) return unresolved()
    const safeSentences = sentences.filter((_, i) => i !== riskIndex)
    if (safeSentences.some(s => !CURRENT_OR_COMPLETED.test(s.text.trim())
      || FORWARD_OR_DEPENDENT.test(s.text) || RETRACTION_OR_BACK_REFERENCE.test(s.text))) return unresolved()
    // A quoted approval may be wrongly marked future. Do not require that
    // mistake to be correct before protecting an independent current duty.
    // The cited tail remains quarantined, even when its risk is a false positive.
    // A leading qualification could govern later duties, so only isolate a tail.
    if (riskIndex !== sentences.length - 1) return unresolved()
    const derivedIds = sentences.map((_, i) => i === 0 ? fact.factLocalId : `${fact.factLocalId}__temporal_${i}`)
    if (derivedIds.slice(1).some(id => ids.has(id))) return unresolved()
    derivedIds.slice(1).forEach(id => ids.add(id))
    headroom -= sentences.length - 1
    aliases.set(fact.factLocalId, derivedIds)
    observations.push({ code: 'TEMPORAL_RISK_LOCALIZED', factIndex })
    return sentences.map((sentence, i) => ({
      ...fact, factLocalId: derivedIds[i], blockRelativeSpan: { start: sentence.start, end: sentence.end },
      verbatimText: sentence.text, normalizedClaim: sentence.text, numericAtoms: [],
      claimType: i === riskIndex ? 'other' : fact.claimType,
      // Retained current material is still qualified, never promoted to supported.
      proposedStatus: i === riskIndex ? 'excluded' : 'source_qualified',
      sourceActionVerb: fact.sourceActionVerb && sentence.text.includes(fact.sourceActionVerb) ? fact.sourceActionVerb : null,
      qualifiers: fact.qualifiers.filter(q => sentence.text.includes(q)),
      riskFlags: i === riskIndex ? fact.riskFlags : fact.riskFlags.filter(r => r !== 'future_or_planned'),
      temporalRiskQuote: i === riskIndex ? fact.temporalRiskQuote : null,
    }))
  })
  if (!aliases.size) return { candidate, observations }
  const remap = (references: string[]) => [...new Set(references.flatMap(id => aliases.get(id) ?? [id]))]
  return { observations, candidate: {
    ...candidate, factCandidates: facts,
    identityCandidates: candidate.identityCandidates.map(c => ({ ...c, factLocalIds: remap(c.factLocalIds) })),
    timelineCandidates: candidate.timelineCandidates.map(c => ({ ...c, factLocalIds: remap(c.factLocalIds) })),
    sectionCandidates: candidate.sectionCandidates.map(c => ({ ...c, factLocalIds: remap(c.factLocalIds) })),
    qualityAssessment: { ...candidate.qualityAssessment,
      strengths: candidate.qualityAssessment.strengths.map(c => ({ ...c, factLocalIds: remap(c.factLocalIds) })),
      weaknesses: candidate.qualityAssessment.weaknesses.map(c => ({ ...c, factLocalIds: remap(c.factLocalIds) })),
    },
  } }
}
