import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { validateResumeExtractionCandidate } from '@/v5/evidence'
import { normalizeResumeExtractionChunkCandidate } from '@/v5/chunked-resume-extraction'
import { materializeResumeExtractionTransport } from '@/v5/resume-extraction-transport'
import { measureP01Retention, sanitizeP01ValidationObservation, P01_VALIDATION_OBSERVATION_VERSION } from '@/v5/p01-validation-diagnostics'
import { createResumeFixture } from './fixtures'

// Synthetic source and scripted model annotations test code behavior, not LLM accuracy.
function fixture(text: string) {
  const document = canonicalizeSourceDocument(text).canonicalDocument
  const base = createResumeFixture().candidate
  const candidate = {
    ...base, identityCandidates: [], timelineCandidates: [], sectionCandidates: [],
    conflicts: [], unmappedFragments: [],
    qualityAssessment: { ...base.qualityAssessment, strengths: [], weaknesses: [], suggestions: [] },
    factCandidates: document.blocks.map(block => ({
      ...base.factCandidates[0], factLocalId: block.sourceBlockId, sourceBlockId: block.sourceBlockId,
      verbatimText: block.text, normalizedClaim: block.text,
      blockRelativeSpan: { start: 0, end: block.text.length }, claimType: 'other' as const,
      sourceScopeLocalId: 'summary', sourceActionVerb: null, numericAtoms: [], qualifiers: [],
      proposedStatus: 'source_qualified' as const, riskFlags: ['uncertain' as const],
    })),
    coverageClaim: { mappedSourceBlockIds: document.blocks.map(b => b.sourceBlockId), unmappedSourceBlockIds: [] },
  }
  return { document, candidate }
}

describe('P01 source retention, not candidate truth certification', () => {
  test('keeps self-reports, metric fragments and before/after values without code inventing conflicts', () => {
    for (const text of [
      '个人材料：工单响应率由 71% 提升至 88%。',
      '业务规模概览\n12,000+\n覆盖服务网点的客户数量',
      '故障率从 8% 降至 3%\n本季度\n约 3%',
      '回收问卷 240 份，其中有效 216 份。',
    ]) {
      const { document, candidate } = fixture(text)
      const compact = { ...candidate, factCandidates: candidate.factCandidates.map(({
        verbatimText, normalizedClaim, blockRelativeSpan, numericAtoms, ...annotation
      }) => annotation) }
      const restored = materializeResumeExtractionTransport(compact, document)
      expect(restored.success).toBe(true)
      if (!restored.success) throw restored.error
      const checked = validateResumeExtractionCandidate(document, normalizeResumeExtractionChunkCandidate(document, restored.data))
      expect(checked.passed).toBe(true)
      expect(checked.value?.factCandidates.map(f => f.verbatimText)).toEqual(document.blocks.map(b => b.text))
      expect(checked.value?.conflicts).toEqual([])
      expect(checked.value?.unmappedFragments).toEqual([])
      expect(checked.value?.factCandidates.every(f => f.proposedStatus === 'source_qualified')).toBe(true)
      expect(checked.value?.factCandidates.some(f => f.riskFlags.includes('conflicting'))).toBe(false)
      expect(checked.value?.timelineCandidates).toEqual([])
    }
  })

  test('still prevents explicitly conflicting or injected material becoming supported evidence', () => {
    for (const risk of ['conflicting', 'prompt_injection_like_text'] as const) {
      const { document, candidate } = fixture('统计记录待核对。')
      const unsafe = { ...candidate, factCandidates: candidate.factCandidates.map(f => ({
        ...f, proposedStatus: 'source_supported' as const, riskFlags: [risk],
      })) }
      const checked = validateResumeExtractionCandidate(document, unsafe)
      expect(checked.value?.factCandidates[0].proposedStatus === 'source_supported' && checked.passed).toBe(false)
      expect(checked.value?.factCandidates[0].riskFlags).toContain(risk)
    }
  })

  test('distinguishes raw loss and unmapped material from code-completed coverage', () => {
    const { document, candidate } = fixture('材料概览\n响应率概述\n约 88%')
    const raw = { ...candidate,
      factCandidates: candidate.factCandidates.slice(0, 1),
      unmappedFragments: [{ sourceBlockId: document.blocks[1].sourceBlockId, text: document.blocks[1].text,
        reason: '信息未关联', importance: 'low' as const }],
      conflicts: [{ conflictLocalId: 'test', factLocalIds: ['not-a-fact'], description: '不应引用不存在的事实', proposedResolution: 'exclude_conflicting_claim' as const }],
    }
    const final = { ...raw, factCandidates: [...raw.factCandidates,
      { ...candidate.factCandidates[2], proposedStatus: 'excluded' as const }] }
    const counts = measureP01Retention(document, raw, final)
    expect(counts).toMatchObject({ targetBlocks: 3, rawFactBlocks: 1, rawUnmappedBlocks: 1, rawMissingBlocks: 1,
      finalAccountedBlocks: 3, serverAddedFactBlocks: 1, finalUnmappedBlocks: 1,
      finalExcludedFacts: 1, retainedBusinessClassFacts: 0, rawInvalidConflictReferences: 1 })
    const event = { version: P01_VALIDATION_OBSERVATION_VERSION, shardIndex: 0, shardCount: 1,
      component: 'P01', attempt: 0, layer: 'domain', outcome: 'passed', issueBuckets: [] }
    const safe = sanitizeP01ValidationObservation({ ...event, retention: { ...counts, secret: 'PII_CANARY' } })
    expect(safe?.retention).toEqual(counts)
    expect(JSON.stringify(safe)).not.toContain('PII_CANARY')
    expect(sanitizeP01ValidationObservation(event)).not.toHaveProperty('retention')
    expect(sanitizeP01ValidationObservation({ ...event, retention: { ...counts, targetBlocks: -1 } })).not.toHaveProperty('retention')
    expect(sanitizeP01ValidationObservation({ ...event, retention: { ...counts, rawMissingBlocks: 4 } })).not.toHaveProperty('retention')
  })
})
