import { describe, expect, test } from 'bun:test'
import { materializeResumeExtractionTransport, resumeDocumentFromEnvelope, resumeExtractionTransportSchema } from '@/v5/resume-extraction-transport'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { validateResumeExtractionCandidate } from '@/v5/evidence'
import { runV5StructuredStage } from '@/v5/stage-runner'
import type { ResumeExtractionCandidate } from '@/v5/types'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { normalizeResumeExtractionChunkCandidate, splitResumeDocument } from '@/v5/chunked-resume-extraction'
import { createResumeFixture } from './fixtures'

function compactFixture() {
  const { document, candidate } = createResumeFixture()
  const compact = { ...candidate, factCandidates: candidate.factCandidates.map(({
    blockRelativeSpan, verbatimText, normalizedClaim, numericAtoms, ...annotation
  }) => annotation) }
  return { document, candidate, compact }
}

describe('P01 compact source-bound transport', () => {
  test('retains an undated source project without manufacturing employer or dates', () => {
    const document = canonicalizeSourceDocument('## 客服知识平台项目\n关键动作：设计检索流程与验证原型。').canonicalDocument
    const chunk = splitResumeDocument(document)[0]
    const { candidate } = createResumeFixture()
    candidate.identityCandidates = []
    candidate.timelineCandidates = []
    candidate.sectionCandidates = []
    candidate.factCandidates = document.blocks.map((block, i) => ({
      ...candidate.factCandidates[2], factLocalId: block.sourceBlockId, sourceBlockId: block.sourceBlockId,
      verbatimText: block.text, normalizedClaim: block.text, blockRelativeSpan: { start: 0, end: block.text.length },
      sourceScopeLocalId: 'model_scope', claimType: i ? 'action' : 'other', numericAtoms: [], qualifiers: [],
    }))
    candidate.coverageClaim = { mappedSourceBlockIds: document.blocks.map(b => b.sourceBlockId), unmappedSourceBlockIds: [] }
    candidate.qualityAssessment.strengths = []
    candidate.qualityAssessment.weaknesses = []
    candidate.qualityAssessment.suggestions = []
    const normalized = normalizeResumeExtractionChunkCandidate(chunk, candidate)
    expect(normalized.timelineCandidates).toHaveLength(1)
    expect(normalized.timelineCandidates[0]).toMatchObject({ kind: 'project', title: '客服知识平台项目', organization: null, start: null, end: null })
    expect(validateResumeExtractionCandidate(chunk, normalized).passed).toBe(true)
    expect(normalized.factCandidates.map(f => f.proposedStatus)).toEqual(candidate.factCandidates.map(f => f.proposedStatus))
  })
  test('runs compact P01 and P01R responses through the real stage adapter', async () => {
    const { document, compact } = compactFixture()
    for (const component of ['P01', 'P01R'] as const) {
      const originalEnvelope = { payload: { canonicalSourceDocument: document } }
      const result = await runV5StructuredStage<ResumeExtractionCandidate>({
        component,
        envelope: component === 'P01' ? originalEnvelope : { payload: { originalEnvelope, currentOutput: compact } },
        options: { provider: { complete: async request => {
          expect(request.structuredOutput?.schema.safeParse(compact).success).toBe(true)
          return { provider: 'fixture', model: 'fixture', content: JSON.stringify(compact), finishReason: 'stop', latencyMs: 1 }
        } } },
      })
      expect(result.value.factCandidates[2].verbatimText).toBe(document.blocks[2].text)
      expect(result.outputAudit.normalizationApplied).toBe(true)
      expect(result.outputAudit.rawOutputDigest).not.toBe(result.outputAudit.validatedOutputDigest)
    }
  })
  test('materializes exact full-block text and validates with the existing evidence gate', () => {
    const { document, compact } = compactFixture()
    const result = materializeResumeExtractionTransport(compact, document)
    expect(result.success).toBe(true)
    if (!result.success) return
    result.data.factCandidates.forEach((fact, index) => {
      expect(fact.verbatimText).toBe(document.blocks[index].text)
      expect(fact.normalizedClaim).toBe(fact.verbatimText)
      expect(fact.blockRelativeSpan).toEqual({ start: 0, end: fact.verbatimText.length })
    })
    const validated = validateResumeExtractionCandidate(document, result.data)
    expect(validated.passed).toBe(true)
    expect(validated.value?.factCandidates[2].numericAtoms.length).toBeGreaterThan(0)
  })

  test('rejects unknown targets, duplicate targets and injected derived fields', () => {
    for (const mutation of ['unknown', 'duplicate', 'quote'] as const) {
      const { document, compact } = compactFixture()
      if (mutation === 'unknown') compact.factCandidates[0].sourceBlockId = 'B9999'
      if (mutation === 'duplicate') compact.factCandidates[1].sourceBlockId = compact.factCandidates[0].sourceBlockId
      if (mutation === 'quote') Object.assign(compact.factCandidates[0], { verbatimText: '虚构原文' })
      expect(materializeResumeExtractionTransport(compact, document).success).toBe(false)
    }
  })

  test('does not use model repair output as canonical source; preserves rich internal schema', () => {
    const { document, compact, candidate } = compactFixture()
    expect(resumeDocumentFromEnvelope({ currentOutput: { canonicalSourceDocument: document } })).toBeNull()
    const envelope = { payload: { originalEnvelope: { payload: { canonicalSourceDocument: document } } } }
    expect(resumeDocumentFromEnvelope(envelope)?.sha256).toBe(document.sha256)
    const compiled = compileV5Prompt({ component: 'P01R', envelope })
    expect(compiled.schema.safeParse(candidate).success).toBe(true)
    expect(compiled.providerSchema.safeParse(compact).success).toBe(true)
    expect(compiled.providerSchema.safeParse(candidate).success).toBe(false)
    expect(resumeExtractionTransportSchema(document).safeParse(compact).success).toBe(true)
  })

  test('code can only lower inconsistent risk status, never elevate it', () => {
    const { document, candidate } = createResumeFixture()
    candidate.factCandidates[2].riskFlags = ['conflicting']
    const conflict = validateResumeExtractionCandidate(document, candidate)
    expect(conflict.value?.factCandidates[2].proposedStatus).toBe('excluded')
    expect(conflict.issues.some(issue => issue.code === 'UNSAFE_EVIDENCE_STATUS')).toBe(false)
    candidate.factCandidates[2].riskFlags = ['future_or_planned']
    expect(validateResumeExtractionCandidate(document, candidate).value?.factCandidates[2].proposedStatus).toBe('excluded')
  })
})
