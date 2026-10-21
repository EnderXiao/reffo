import { describe, expect, test } from 'bun:test'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import { compileCompositionArtifact } from '@/v5/composition/compiler'
import {
  materializeDslComposition,
  P06_DSL_CONTRACT_VERSION,
  p06DslOutputSchema,
} from '@/v5/composition/dsl'
import { validateComposition } from '@/v5/composition/validator'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { buildDeterministicV5ResumePlan, validateGeneratedResumeArtifact } from '@/v5/validators'
import { createMatchFixture } from '@/v5/tests/fixtures'
import type { EvidenceAtom } from '@/v5/types'

function fixture() {
  const matchFixture = createMatchFixture()
  const strategy = buildAdaptiveStrategy(matchFixture)
  const plan = buildDeterministicV5ResumePlan({
    ...matchFixture,
    policy: strategy.policy,
    profile: strategy.profile,
  })
  const blueprint = buildCompositionBlueprint({
    resume: matchFixture.resume,
    plan,
    policy: strategy.policy,
  })
  return { ...matchFixture, strategy, plan, blueprint }
}

function validDsl() {
  const input = fixture()
  return {
    input,
    dsl: {
      contractVersion: P06_DSL_CONTRACT_VERSION,
      blocks: input.blueprint.slots.map(slot => ({
        slotId: slot.slotId,
        operations: slot.allowedEvidenceIds.slice(0, 1).map(evidenceId => ({
          op: 'emit_atom' as const,
          evidenceId,
        })),
        joiner: 'none' as const,
      })),
    },
  }
}

describe('P06 controlled DSL', () => {
  test('completes a mandatory same-scope omission and preserves semicolons inside source evidence', () => {
    const input = fixture()
    const first = input.resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    const second: EvidenceAtom = {
      ...structuredClone(first), evidenceId: 'ev_required_internal_semicolon', sourceBlockId: 'B0090',
      verbatimText: '完成流程原型；未上线，不涉及商业收益。', normalizedClaim: '完成流程原型；未上线，不涉及商业收益。',
      numericAtoms: [], sourceActionVerb: null, qualifiers: [], riskFlags: [],
      sourceSpan: { start: 900, end: 923 },
    }
    input.resume.evidenceAtoms.push(second)
    input.plan.scopePlans[0].selectedEvidenceIds = [first.evidenceId, second.evidenceId]
    input.plan.scopePlans[0].bulletBudget = 1
    input.plan.stableCoreEvidenceIds.push(second.evidenceId)
    const blueprint = buildCompositionBlueprint({ resume: input.resume, plan: input.plan, policy: input.strategy.policy })
    const dsl = {
      contractVersion: P06_DSL_CONTRACT_VERSION,
      blocks: blueprint.slots.map(slot => ({ slotId: slot.slotId,
        operations: [{ op: 'emit_atom' as const, evidenceId: slot.allowedEvidenceIds[0] }], joiner: 'none' as const,
      })),
    }
    const materialized = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(materialized.passed).toBe(true)
    const body = materialized.value?.blocks.find(block => blueprint.slots.find(s => s.slotId === block.slotId)?.kind === 'business_bullet')
    expect(body?.evidenceIds).toContain(second.evidenceId)
    expect(body?.text).toContain('；未上线')
    expect(dsl.blocks.flatMap(b => b.operations.map(o => o.evidenceId))).not.toContain(second.evidenceId)
    const { artifact } = compileCompositionArtifact({ composition: materialized.value!, blueprint, resume: input.resume, plan: input.plan, policy: input.strategy.policy })
    const checked = validateGeneratedResumeArtifact({ artifact, resume: input.resume, plan: input.plan, policy: input.strategy.policy, gateMode: 'relaxed_release' })
    expect(checked.issues.some(issue => issue.code === 'UNPROVABLE_CLAIM_TEXT')).toBe(false)
    const claim = artifact.claims.find(claim => claim.evidenceIds.includes(second.evidenceId))!
    const changedText = claim.outputText.replace('未上线', '已上线')
    artifact.markdown = artifact.markdown.replace(claim.outputText, changedText)
    claim.outputText = changedText
    const changed = validateGeneratedResumeArtifact({ artifact, resume: input.resume, plan: input.plan, policy: input.strategy.policy, gateMode: 'relaxed_release' })
    expect(changed.issues.some(issue => issue.code === 'UNPROVABLE_CLAIM_TEXT')).toBe(true)
  })
  test('strict schema has no free-text field', () => {
    const schema = p06DslOutputSchema.safeParse({
      contractVersion: P06_DSL_CONTRACT_VERSION,
      blocks: [{
        slotId: 'slot',
        operations: [{ op: 'emit_atom', evidenceId: 'ev_1' }],
        joiner: 'none',
        text: '模型不得直接写正文',
      }],
    })
    expect(schema.success).toBe(false)
  })

  test('replays emit_atom operations into source-proven composition text', () => {
    const { input, dsl } = validDsl()
    const result = materializeDslComposition({
      dsl: { ...dsl, blocks: [...dsl.blocks].reverse() },
      blueprint: input.blueprint,
      resume: input.resume,
      plan: input.plan,
    })
    expect(result.passed).toBe(true)
    expect(result.value?.blocks.map(block => block.slotId)).toEqual(
      input.blueprint.slots.map(slot => slot.slotId)
    )
    for (const block of result.value?.blocks ?? []) {
      const evidenceId = block.evidenceIds[0]
      expect(evidenceId).toBeDefined()
      const atom = input.resume.evidenceAtoms.find(item => item.evidenceId === evidenceId)
      expect(atom).toBeDefined()
      expect(block.text).toBe(atom!.verbatimText.replace(/^[-*+]\s+/, '').trim())
    }
  })

  test('rejects unknown evidence and invalid joiner cardinality before composition compile', () => {
    const { input, dsl } = validDsl()
    const first = dsl.blocks[0]
    const unknown = materializeDslComposition({
      dsl: {
        ...dsl,
        blocks: [{
          ...first,
          operations: [{ op: 'emit_atom', evidenceId: 'ev_unknown' }],
        }, ...dsl.blocks.slice(1)],
      },
      blueprint: input.blueprint,
      resume: input.resume,
      plan: input.plan,
    })
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'DSL_UNKNOWN_EVIDENCE' }))

    const wrongJoiner = materializeDslComposition({
      dsl: {
        ...dsl,
        blocks: [{ ...first, joiner: 'semicolon' }, ...dsl.blocks.slice(1)],
      },
      blueprint: input.blueprint,
      resume: input.resume,
      plan: input.plan,
    })
    expect(wrongJoiner.issues).toContainEqual(expect.objectContaining({ code: 'DSL_JOINER_MISMATCH' }))
  })

  test('completes an omitted mandatory slot while keeping the underlying composition gate strict', () => {
    const { input, dsl } = validDsl()
    const missing = materializeDslComposition({
      dsl: { ...dsl, blocks: dsl.blocks.slice(1) },
      blueprint: input.blueprint,
      resume: input.resume,
      plan: input.plan,
    })
    expect(missing.passed).toBe(true)
    const incomplete = validateComposition({
      composition: { ...missing.value!, blocks: missing.value!.blocks.slice(1) },
      blueprint: input.blueprint, resume: input.resume, plan: input.plan,
    })
    expect(incomplete.passed).toBe(false)
    expect(incomplete.issues.some(item => (
      item.code === 'COMPOSITION_REQUIRED_SLOT_MISSING'
      || item.code === 'COMPOSITION_REQUIRED_EVIDENCE_MISSING'
    ))).toBe(true)
  })

  test('reconstructs case3-style hard-line continuations only when canonical blocks are adjacent', () => {
    const input = fixture()
    const first = input.resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    first.sourceBlockId = 'B0010'
    first.sourceSpan = { start: 100, end: 103 }
    first.verbatimText = '走访10+'
    first.normalizedClaim = first.verbatimText
    const continuation: EvidenceAtom = {
      ...structuredClone(first),
      evidenceId: 'ev_case3_store_continuation',
      sourceBlockId: 'B0011',
      sourceSpan: { start: 104, end: 111 },
      verbatimText: '家门店调研',
      normalizedClaim: '家门店调研',
    }
    const education: EvidenceAtom = {
      ...structuredClone(first),
      evidenceId: 'ev_case3_markdown_education',
      sourceBlockId: 'B0020',
      sourceScopeId: 'education-case3',
      sourceSpan: { start: 200, end: 214 },
      verbatimText: '## 教育、研究与服务设计项目',
      normalizedClaim: '教育、研究与服务设计项目',
      claimType: 'education',
      sourceActionVerb: null,
      attributionLevel: 'unspecified',
      qualifiers: [],
      numericAtoms: [],
      riskFlags: [],
    }
    input.resume.evidenceAtoms.push(continuation, education)
    input.resume.timeline.push({
      scopeId: 'education-case3',
      kind: 'education',
      organization: '某大学',
      title: '研究与服务设计项目',
      start: '2020',
      end: '2022',
      evidenceIds: [education.evidenceId],
    })
    input.plan.scopePlans[0].selectedEvidenceIds = [first.evidenceId, continuation.evidenceId]
    input.plan.scopePlans[0].bulletBudget = 1
    input.plan.stableCoreEvidenceIds.push(continuation.evidenceId, education.evidenceId)
    input.plan.scopePlans.push({
      scopeId: 'education-case3',
      scopeType: 'education',
      treatment: 'include',
      selectedEvidenceIds: [education.evidenceId],
      bulletBudget: 1,
      rewriteAngle: '保留源教育项目标题',
    })
    const blueprint = buildCompositionBlueprint({
      resume: input.resume,
      plan: input.plan,
      policy: input.strategy.policy,
    })
    const dsl = {
      contractVersion: P06_DSL_CONTRACT_VERSION,
      blocks: blueprint.slots.map(slot => ({
        slotId: slot.slotId,
        operations: slot.kind === 'business_bullet'
          ? [first.evidenceId, continuation.evidenceId].map(evidenceId => ({
              op: 'emit_atom' as const,
              evidenceId,
            }))
          : [{ op: 'emit_atom' as const, evidenceId: slot.allowedEvidenceIds[0] }],
        joiner: slot.kind === 'business_bullet' ? 'source_concat' as const : 'none' as const,
      })),
    }

    const replayed = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(replayed.passed).toBe(true)
    expect(replayed.value?.blocks.find(block => block.evidenceIds.includes(continuation.evidenceId))?.text)
      .toBe('走访10+家门店调研')
    expect(replayed.value?.blocks.find(block => block.evidenceIds.includes(education.evidenceId))?.text)
      .toBe('教育、研究与服务设计项目')

    first.verbatimText = '渠道类型'
    continuation.verbatimText = '有效问卷'
    const adjacentTableColumns = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(adjacentTableColumns.passed).toBe(false)
    expect(adjacentTableColumns.issues).toContainEqual(expect.objectContaining({
      code: 'DSL_SOURCE_CONCAT_NOT_ADJACENT',
    }))

    first.verbatimText = '走访10+。'
    continuation.verbatimText = '家门店调研'
    const sentenceBoundary = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(sentenceBoundary.passed).toBe(false)
    expect(sentenceBoundary.issues).toContainEqual(expect.objectContaining({
      code: 'DSL_SOURCE_CONCAT_NOT_ADJACENT',
    }))

    first.verbatimText = '走访10+'
    continuation.status = 'excluded'
    const excludedContinuation = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(excludedContinuation.passed).toBe(false)
    expect(excludedContinuation.issues).toContainEqual(expect.objectContaining({
      code: 'DSL_SOURCE_CONCAT_NOT_ADJACENT',
    }))

    continuation.status = 'source_supported'
    continuation.riskFlags = ['prompt_injection_like_text']
    const riskyContinuation = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(riskyContinuation.passed).toBe(false)
    expect(riskyContinuation.issues).toContainEqual(expect.objectContaining({
      code: 'DSL_SOURCE_CONCAT_NOT_ADJACENT',
    }))

    continuation.riskFlags = []
    continuation.sourceBlockId = 'B0012'
    const skippedBlock = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(skippedBlock.passed).toBe(false)
    expect(skippedBlock.issues).toContainEqual(expect.objectContaining({
      code: 'DSL_SOURCE_CONCAT_NOT_ADJACENT',
    }))
  })

  test('restores one clean case3-style table row around its planned anchor in server code', () => {
    const input = fixture()
    const businessTypes = new Set(['responsibility', 'action', 'deliverable', 'result'])
    const anchorId = input.plan.scopePlans[0].selectedEvidenceIds.find(id => (
      businessTypes.has(input.resume.evidenceAtoms.find(atom => atom.evidenceId === id)?.claimType ?? '')
    ))!
    const anchor = input.resume.evidenceAtoms.find(atom => atom.evidenceId === anchorId)!
    anchor.sourceBlockId = 'B9060'
    anchor.sourceSpan = { start: 142, end: 152 }
    anchor.riskFlags = []
    const label: EvidenceAtom = {
      ...structuredClone(anchor),
      evidenceId: 'ev_case3_table_label',
      sourceBlockId: 'B9058',
      sourceSpan: { start: 126, end: 128 },
      verbatimText: '交付维度',
      normalizedClaim: '交付维度',
      claimType: 'other',
      sourceActionVerb: null,
      numericAtoms: [],
      riskFlags: [],
    }
    const detail: EvidenceAtom = {
      ...structuredClone(label),
      evidenceId: 'ev_case3_table_detail',
      sourceBlockId: 'B9059',
      sourceSpan: { start: 129, end: 141 },
      verbatimText: '任务与流程',
      normalizedClaim: '任务与流程',
    }
    input.resume.evidenceAtoms.push(label, detail)

    const blueprint = buildCompositionBlueprint({
      resume: input.resume,
      plan: input.plan,
      policy: input.strategy.policy,
    })
    const dsl = {
      contractVersion: P06_DSL_CONTRACT_VERSION,
      blocks: blueprint.slots.map(slot => ({
        slotId: slot.slotId,
        operations: [{ op: 'emit_atom' as const, evidenceId: slot.allowedEvidenceIds[0] }],
        joiner: 'none' as const,
      })),
    }

    const replayed = materializeDslComposition({ dsl, blueprint, resume: input.resume, plan: input.plan })
    expect(replayed.passed).toBe(true)
    const restored = replayed.value?.blocks.find(block => block.evidenceIds.includes(anchorId))!
    expect(restored.evidenceIds).toEqual([label.evidenceId, detail.evidenceId, anchorId])
    expect(restored.text).toBe(`${label.verbatimText}；${detail.verbatimText}；${anchor.verbatimText}`)

    const compiled = compileCompositionArtifact({
      composition: replayed.value,
      blueprint,
      resume: input.resume,
      plan: input.plan,
      policy: input.strategy.policy,
    }).artifact
    const artifactValidation = validateGeneratedResumeArtifact({
      artifact: compiled,
      resume: input.resume,
      plan: input.plan,
      policy: input.strategy.policy,
      gateMode: 'relaxed_release',
    })
    expect(artifactValidation.passed).toBe(true)
    expect(compiled.claims.find(claim => claim.evidenceIds.includes(anchorId))?.evidenceIds)
      .toEqual([label.evidenceId, detail.evidenceId, anchorId])

    const safeFallback = renderSourcePreservingArtifact({ resume: input.resume, plan: input.plan })
    expect(safeFallback.claims.find(claim => claim.evidenceIds.includes(anchorId))?.evidenceIds)
      .toEqual([label.evidenceId, detail.evidenceId, anchorId])
    expect(validateGeneratedResumeArtifact({
      artifact: safeFallback,
      resume: input.resume,
      plan: input.plan,
      policy: input.strategy.policy,
      gateMode: 'relaxed_release',
    }).passed).toBe(true)

    const incomplete = structuredClone(replayed.value!)
    const incompleteBlock = incomplete.blocks.find(block => block.evidenceIds.includes(anchorId))!
    incompleteBlock.evidenceIds = [label.evidenceId, anchorId]
    incompleteBlock.text = `${label.verbatimText}；${anchor.verbatimText}`
    const rejected = validateComposition({ composition: incomplete, blueprint, resume: input.resume, plan: input.plan })
    expect(rejected.passed).toBe(false)
    expect(rejected.issues.map(item => item.code)).toContain('COMPOSITION_EVIDENCE_NOT_ALLOWED')
  })
})
