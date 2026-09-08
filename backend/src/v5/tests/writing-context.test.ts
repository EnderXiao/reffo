import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { deriveWritingContexts } from '@/v5/writing/context'
import { buildWritingPlan } from '@/v5/writing/plan'
import { compileWritingArtifact } from '@/v5/writing/compiler'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import type { EvidenceAtom } from '@/v5/types'
import { buildEntryWritingPlan, compileEntryWriting, ENTRY_WRITING_POLICY } from '@/v5/writing/entries'

function fixture() {
  const result = createV5ResultFixture(), t = createTargetingFixture()
  const resume = result.resumeEvidenceBundle
  const anchor = resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  const source = canonicalizeSourceDocument(`问题：需求理解存在偏差。\n${anchor.verbatimText}`, 'synthetic-context').canonicalDocument
  const [problemBlock, actionBlock] = source.blocks
  const background: EvidenceAtom = { ...anchor, evidenceId: 'context:problem', claimType: 'other', status: 'source_supported',
    attributionLevel: 'unspecified', riskFlags: [], numericAtoms: [], qualifiers: [], sourceActionVerb: null,
    verbatimText: problemBlock.text, normalizedClaim: problemBlock.text, sourceBlockId: 'B0090',
    sourceSpan: { start: 500, end: 500 + problemBlock.text.length } }
  anchor.sourceBlockId = 'B0091'
  anchor.sourceSpan = { start: 500 + actionBlock.canonicalStart, end: 500 + actionBlock.canonicalEnd }
  resume.evidenceAtoms.push(background)
  const input = { resume, plan: result.resumePlan, policy: result.generationPolicy,
    job: result.jobRequirementBundle, match: result.matchAnalysis,
    targeting: { profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit } }
  return { input, background, anchor }
}

describe('source-linked context, not another personal achievement', () => {
  test('entry context survives selected-context rendering and may precede its action in another paragraph', () => {
    const { input, background, anchor } = fixture()
    const base = buildWritingPlan({ ...input, editorialPolicy: 'document-editorial-v1' })
    const entryPlan = buildEntryWritingPlan({ ...input, base })
    const entry = entryPlan.entries.find(e => e.slot.kind === 'business_bullet' && e.facts.some(f => f.evidenceId === background.evidenceId))!
    expect(entryPlan.renderingPlan.scopePlans.flatMap(s => s.selectedEvidenceIds)).toContain(background.evidenceId)
    const output = { contractVersion: ENTRY_WRITING_POLICY, entries: [{ entryId: entry.entryId, paragraphs: [
      { role: 'problem', text: '需求理解存在偏差。', evidenceIds: [background.evidenceId] },
      { role: 'contribution', text: '参与团队产品迭代并交付3个功能。', evidenceIds: [anchor.evidenceId] },
    ] }] }
    const compile = () => compileEntryWriting({ ...input, entryPlan, output, previewEntryId: entry.entryId })
    expect(() => compile()).not.toThrow()
    const full = compileEntryWriting({ ...input, entryPlan, output: { ...output, entries: entryPlan.entries.map(brief => {
      if (brief.entryId === entry.entryId) return output.entries[0]
      const fact = brief.facts.find(f => brief.coreEvidenceIds.includes(f.evidenceId)) ?? brief.facts[0]
      return {entryId:brief.entryId, paragraphs:[{role:'detail', text:fact.text, evidenceIds:[fact.evidenceId]}]}
    }) } })
    const check = (resume = input.resume) => validateGeneratedResumeArtifact({ ...input, resume, artifact:full.artifact,
      plan:full.renderingPlan, gateMode:'relaxed_release', textPolicy:'supported_writing_v1',
      skillPolicy:base.skillPolicy, entryParagraphPaths:full.entryParagraphPaths })
    expect(check().issues.filter(i => i.severity === 'error')).toEqual([])
    const unsafe = structuredClone(input.resume)
    unsafe.evidenceAtoms.find(a => a.evidenceId === background.evidenceId)!.riskFlags = ['uncertain']
    expect(check(unsafe).issues.some(i => i.code === 'BUSINESS_SCOPE_EVIDENCE_MISMATCH')).toBe(true)
    output.entries[0].paragraphs.pop()
    expect(compile).toThrow()
    expect(input.plan.scopePlans.flatMap(s => s.selectedEvidenceIds)).not.toContain(background.evidenceId)
  })

  test('keeps an intact adjacent problem as optional context without changing evidence or bullet counts', () => {
    const { input, background, anchor } = fixture(), before = structuredClone(input)
    expect(deriveWritingContexts(input.resume, input.plan)).toEqual([
      { anchorEvidenceId: anchor.evidenceId, evidenceId: background.evidenceId, role: 'problem' },
    ])
    const plan = buildWritingPlan(input)
    expect(plan.facts.find(fact => fact.evidenceId === background.evidenceId)).toMatchObject({
      claimType: 'other', contextForEvidenceId: anchor.evidenceId, contextRole: 'problem', requiredNumbers: [],
    })
    expect(plan.blueprint.requiredBodyEvidenceIds).not.toContain(background.evidenceId)
    expect(input).toEqual(before)
  })

  test.each(['different_scope', 'unselected_action', 'distant', 'unlabelled', 'uncertain', 'excluded', 'truncated', 'duplicate_coordinate'])(
    'does not silently attach %s context', mutation => {
      const { input, background } = fixture()
      if (mutation === 'different_scope') background.sourceScopeId = 'another-project'
      if (mutation === 'unselected_action') input.plan.scopePlans.forEach(scope => { scope.selectedEvidenceIds = [] })
      if (mutation === 'distant') background.sourceSpan.start -= 20
      if (mutation === 'unlabelled') background.verbatimText = '沟通能力强，业务理解力优秀。'
      if (mutation === 'uncertain') background.riskFlags = ['uncertain']
      if (mutation === 'excluded') background.status = 'excluded'
      if (mutation === 'truncated') background.verbatimText = '问题：完成率从30%提升至'
      if (mutation === 'duplicate_coordinate') input.resume.evidenceAtoms.push({ ...background, evidenceId: 'duplicate' })
      expect(deriveWritingContexts(input.resume, input.plan)).toEqual([])
    })

  test('context and action compile together through both Writer and final artifact validation', () => {
    const { input, background, anchor } = fixture()
    const writingPlan = buildWritingPlan(input)
    const composition = { contractVersion: 'p06-composition-v1', blocks: writingPlan.blueprint.slots.map(slot => {
      const id = writingPlan.coreEvidenceIdsBySlot[slot.slotId]?.[0] ?? slot.allowedEvidenceIds[0]
      const withContext = slot.kind === 'business_bullet' && slot.allowedEvidenceIds.includes(background.evidenceId)
      return { slotId: slot.slotId, evidenceIds: withContext ? [anchor.evidenceId, background.evidenceId] : [id],
        text: slot.kind === 'summary' ? '具有团队产品交付实践。'
          : withContext ? '针对需求理解偏差，参与团队产品迭代并交付3个功能。'
          : writingPlan.facts.find(fact => fact.evidenceId === id)!.text }
    }) }
    const compiled = compileWritingArtifact({ ...input, writingPlan, composition })
    const checked = validateGeneratedResumeArtifact({ ...input, artifact: compiled.artifact,
      gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1' })
    expect(checked.issues.filter(issue => issue.severity === 'error')).toEqual([])
    const block = composition.blocks.find(block => block.evidenceIds.includes(background.evidenceId))!
    block.evidenceIds = [background.evidenceId]
    expect(() => compileWritingArtifact({ ...input, writingPlan, composition })).toThrow()
  })
})
