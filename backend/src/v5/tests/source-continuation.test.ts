import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildResumeEvidenceBundle } from '@/v5/evidence'
import { buildEvidencePlanningCatalog } from '@/v5/evidence-routing'
import { areCanonicalAdjacentSourceAtoms, businessSourceContinuationGroups } from '@/v5/composition/source-continuation'
import { bindSourceLineContinuations } from '@/v5/composition/source-continuation-proof'
import { canonicalSourceDocumentSchema, resumeEvidenceBundleSchema, resumeExtractionCandidateSchema, v5MatchAnalysisSchema } from '@/v5/schemas'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import { materializeDslComposition, p06DslOutputSchema } from '@/v5/composition/dsl'
import { compileCompositionArtifact } from '@/v5/composition/compiler'
import { buildDeterministicV5ResumePlan, validateGeneratedResumeArtifact } from '@/v5/validators'
import type { ResumeExtractionCandidate } from '@/v5/types'
import { createMatchFixture, createResumeFixture } from './fixtures'

function continuationFixture(left: string, separator: string, right: string) {
  const { candidate: base } = createResumeFixture()
  const document = canonicalizeSourceDocument(`示例企业｜业务专员｜2022-至今\n${left}${separator}${right}`, 'continuation-fixture').canonicalDocument
  const facts: ResumeExtractionCandidate['factCandidates'] = document.blocks.map((block, index) => ({
    factLocalId: `fact_${index}`,
    sourceBlockId: block.sourceBlockId,
    blockRelativeSpan: { start: 0, end: block.text.length },
    verbatimText: block.text,
    normalizedClaim: block.text,
    claimType: index === 0 ? 'timeline' : 'action',
    sourceScopeLocalId: 'work',
    proposedStatus: 'source_supported',
    attributionLevel: 'unspecified',
    sourceActionVerb: null,
    qualifiers: [], numericAtoms: [], riskFlags: [],
  }))
  const candidate: ResumeExtractionCandidate = {
    ...base,
    identityCandidates: [],
    timelineCandidates: [{ scopeLocalId: 'work', kind: 'experience', organization: '示例企业', title: '业务专员', start: '2022', end: '至今', factLocalIds: facts.map(fact => fact.factLocalId) }],
    sectionCandidates: [{ sectionLocalId: 'work', type: 'experience', title: '工作经历', scopeLocalIds: ['work'], factLocalIds: facts.map(fact => fact.factLocalId) }],
    factCandidates: facts,
    unmappedFragments: [], conflicts: [],
    coverageClaim: { mappedSourceBlockIds: document.blocks.map(block => block.sourceBlockId), unmappedSourceBlockIds: [] },
    qualityAssessment: { ...base.qualityAssessment, strengths: [], weaknesses: [], suggestions: [] },
  }
  const bundle = buildResumeEvidenceBundle(document, candidate)
  return { document, candidate, bundle, atoms: bundle.evidenceAtoms.filter(atom => atom.claimType === 'action') }
}

describe('trusted source line continuations', () => {
  test.each([
    ['customer research', '访谈12', '名客户并形成需求分析报告。'],
    ['finance operations', '核对账目并形成财务流程', '的异常处理清单。'],
    ['engineering operations', '优化维护流程，成功率达到', '98%。'],
  ])('recovers %s across verified padding and blank lines', (_role, left, right) => {
    for (const separator of ['\n  ', '\r\n  ', ' \n\n  ']) {
      const { bundle, atoms } = continuationFixture(left, separator, right)
      expect(areCanonicalAdjacentSourceAtoms(atoms)).toBe(true)
      expect(businessSourceContinuationGroups([...atoms].reverse()).map(group => group.map(atom => atom.evidenceId)))
        .toEqual([atoms.map(atom => atom.evidenceId)])
      expect(buildEvidencePlanningCatalog(bundle).businessAnchorEvidenceIds).toEqual([atoms[0].evidenceId])
    }
  })

  test('does not extend legacy evidence without canonical source proof', () => {
    const padded = continuationFixture('访谈12', '\n  ', '名客户并形成需求分析报告。')
    const withoutProof = structuredClone(padded.atoms)
    withoutProof.forEach(atom => { delete atom.sourceContinuation })
    expect(areCanonicalAdjacentSourceAtoms(withoutProof)).toBe(false)
    const legacy = continuationFixture('访谈12', '\n', '名客户并形成需求分析报告。')
    expect(areCanonicalAdjacentSourceAtoms(structuredClone(legacy.atoms))).toBe(true)
  })

  test('JSON and strict schema round trips preserve deterministic source proofs', () => {
    const input = continuationFixture('访谈12', '\r\n\r\n  ', '名客户并形成需求分析报告。')
    const document = canonicalSourceDocumentSchema.parse(JSON.parse(JSON.stringify(input.document)))
    const restored = buildResumeEvidenceBundle(document, input.candidate)
    const bundle = resumeEvidenceBundleSchema.parse(JSON.parse(JSON.stringify(restored)))
    expect(areCanonicalAdjacentSourceAtoms(bundle.evidenceAtoms.filter(atom => atom.claimType === 'action'))).toBe(true)
    expect(bundle).toEqual(input.bundle)
  })

  test('candidate output cannot supply source continuation proofs and prompts do not transmit them', () => {
    const input = continuationFixture('访谈12', '\n  ', '名客户并形成需求分析报告。')
    const injected = structuredClone(input.candidate)
    Object.assign(injected.factCandidates[1], { sourceContinuation: input.atoms[1].sourceContinuation })
    expect(resumeExtractionCandidateSchema.safeParse(injected).success).toBe(false)
    const envelope = { payload: { canonicalSourceDocument: input.document, resume: input.bundle } }
    const before = structuredClone(envelope)
    for (const component of ['P01', 'P01R', 'P03', 'P05', 'P06C', 'P06D'] as const) {
      const compiled = compileV5Prompt({ component, envelope })
      const text = compiled.messages.map(message => message.content).join('\n')
      expect(text).not.toContain('sourceLineContinuations')
      expect(text).not.toContain('sourceContinuation')
      expect(text).not.toContain(input.atoms[1].sourceContinuation!.binding)
    }
    expect(envelope).toEqual(before)
    expect(v5MatchAnalysisSchema.safeParse({ ...createMatchFixture().match, sourceContinuation: input.atoms[1].sourceContinuation }).success).toBe(false)
    expect(p06DslOutputSchema.safeParse({ contractVersion: 'p06-dsl-v1', blocks: [{ slotId: 'slot',
      operations: [{ op: 'emit_atom', evidenceId: input.atoms[1].evidenceId, sourceContinuation: input.atoms[1].sourceContinuation }], joiner: 'none',
    }] }).success).toBe(false)
  })

  test.each(['scope', 'document', 'quote', 'span', 'block', 'id', 'proof'] as const)(
    'rejects a proof after %s changes', change => {
      const { atoms } = continuationFixture('访谈12', '\n  ', '名客户并形成需求分析报告。')
      if (change === 'scope') atoms.forEach(atom => { atom.sourceScopeId = 'another-scope' })
      if (change === 'document') atoms.forEach(atom => { atom.sourceDocumentHash = 'other-document' })
      if (change === 'quote') atoms[0].verbatimText = atoms[0].verbatimText.replace('12', '18')
      if (change === 'span') atoms[0].sourceSpan.start += 1
      if (change === 'block') atoms[1].sourceBlockId = 'B0999'
      if (change === 'id') atoms[0].evidenceId = 'different-id'
      if (change === 'proof') atoms[1].sourceContinuation!.binding = '0'.repeat(64)
      expect(areCanonicalAdjacentSourceAtoms(atoms)).toBe(false)
      expect(businessSourceContinuationGroups(atoms)).toEqual([])
    }
  )

  test.each(['conflicting', 'future_or_planned', 'sensitive_pii', 'prompt_injection_like_text'] as const)(
    'does not concatenate a %s member', risk => {
      const { atoms } = continuationFixture('访谈12', '\n  ', '名客户并形成需求分析报告。')
      atoms[1].riskFlags.push(risk)
      expect(areCanonicalAdjacentSourceAtoms(atoms)).toBe(false)
      expect(businessSourceContinuationGroups(atoms)).toEqual([])
    }
  )

  test('rejects duplicated IDs or blocks, and does not reorder an explicitly reversed join', () => {
    const { atoms } = continuationFixture('访谈12', '\n  ', '名客户并形成需求分析报告。')
    expect(areCanonicalAdjacentSourceAtoms([...atoms].reverse())).toBe(false)
    expect(businessSourceContinuationGroups([...atoms, structuredClone(atoms[1])])).toEqual([])
    expect(businessSourceContinuationGroups([...atoms, { ...structuredClone(atoms[0]), evidenceId: 'duplicate-block' }])).toEqual([])
  })

  test('invalid source coordinates and empty source identities cannot form a legacy group', () => {
    for (const invalid of ['scope', 'document', 'span'] as const) {
      const { atoms } = continuationFixture('访谈12', '\n', '名客户并形成需求分析报告。')
      if (invalid === 'scope') atoms.forEach(atom => { atom.sourceScopeId = '' })
      if (invalid === 'document') atoms.forEach(atom => { atom.sourceDocumentHash = '' })
      if (invalid === 'span') atoms.forEach(atom => { atom.sourceSpan = { start: Infinity, end: Infinity } })
      expect(areCanonicalAdjacentSourceAtoms(atoms)).toBe(false)
      expect(businessSourceContinuationGroups(atoms)).toEqual([])
    }
  })

  test('rejects a whole maximal continuation rather than dropping its unsafe or oversized tail', () => {
    const input = continuationFixture('访谈12', '\n  ', '名客户并整理20\n  个问题，形成处理流程\n  的实施方案。')
    expect(input.atoms).toHaveLength(4)
    expect(businessSourceContinuationGroups(input.atoms)).toEqual([])
    const three = input.atoms.slice(0, 3)
    three[2].riskFlags.push('uncertain')
    expect(businessSourceContinuationGroups(three)).toEqual([])
  })

  test.each(['\n但未\n', '\n|\n', '\n\t', '\n\f', '\n\u200b', '\n# 另一项目\n'])(
    'does not infer layout-only adjacency from separator %j', separator => {
      const { document, atoms } = continuationFixture('访谈12', separator, '名客户并形成需求分析报告。')
      expect(document.sourceLineContinuations).toBeUndefined()
      expect(areCanonicalAdjacentSourceAtoms([atoms[0], atoms.at(-1)!])).toBe(false)
    }
  )

  test.each([
    ['年度客户表 | 12', '名客户'],
    ['年度客户表\t12', '名客户'],
    ['访谈12', '- 名客户'],
    ['访谈12', '名客户 | 日期'],
    ['访谈12。', '名客户'],
  ])('does not join table, list or sentence boundaries: %s', (left, right) => {
    const { document, atoms } = continuationFixture(left, '\n  ', right)
    expect(document.sourceLineContinuations).toBeUndefined()
    expect(areCanonicalAdjacentSourceAtoms(atoms)).toBe(false)
  })

  test('a partial quote cannot inherit a full-block continuation proof', () => {
    const input = continuationFixture('核对凭证，访谈12', '\n  ', '名客户并形成需求分析报告。')
    const fact = input.candidate.factCandidates[1]
    fact.verbatimText = '访谈12'; fact.normalizedClaim = fact.verbatimText
    fact.blockRelativeSpan.start = '核对凭证，'.length
    const bundle = buildResumeEvidenceBundle(input.document, input.candidate)
    expect(areCanonicalAdjacentSourceAtoms(bundle.evidenceAtoms.filter(atom => atom.claimType === 'action'))).toBe(false)
  })

  test('canonical proof tampering does not bind evidence, even if the separator length stays unchanged', () => {
    const input = continuationFixture('访谈12', '\n  ', '名客户并形成需求分析报告。')
    const atoms = structuredClone(input.atoms)
    atoms.forEach(atom => { delete atom.sourceContinuation })
    input.document.sourceLineContinuations![0].separator = ' \n '
    bindSourceLineContinuations(input.document, atoms)
    expect(atoms[1].sourceContinuation).toBeUndefined()
  })

  test('planned DSL assembly and final validation preserve a padded continuation including negation', () => {
    const source = continuationFixture('参与设计维护流程', '\r\n\r\n  ', '的验证原型；未上线。')
    const original = createMatchFixture()
    original.match.requirementMatches = [{ ...original.match.requirementMatches[0], evidenceIds: [source.atoms[0].evidenceId] }]
    const input = { ...original, resume: source.bundle }
    const strategy = buildAdaptiveStrategy(input)
    const plan = buildDeterministicV5ResumePlan({ ...input, ...strategy })
    const blueprint = buildCompositionBlueprint({ ...input, plan, policy: strategy.policy })
    const composition = materializeDslComposition({ ...input, plan, blueprint,
      dsl: { contractVersion: 'p06-dsl-v1', blocks: blueprint.slots.map(slot => ({ slotId: slot.slotId,
        operations: [{ op: 'emit_atom', evidenceId: slot.allowedEvidenceIds[0] }], joiner: 'none',
      })) },
    })
    expect(composition.passed).toBe(true)
    const { artifact } = compileCompositionArtifact({ ...input, blueprint, plan, policy: strategy.policy, composition: composition.value })
    expect(artifact.markdown).toContain('参与设计维护流程的验证原型；未上线。')
    expect(validateGeneratedResumeArtifact({ ...input, plan, policy: strategy.policy, artifact }).passed).toBe(true)
    artifact.markdown = artifact.markdown.replaceAll('未上线', '已上线')
    artifact.claims.forEach(claim => { claim.outputText = claim.outputText.replaceAll('未上线', '已上线') })
    expect(validateGeneratedResumeArtifact({ ...input, plan, policy: strategy.policy, artifact }).passed).toBe(false)
  })
})
