import { describe, expect, test } from 'bun:test'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import {
  compileCompositionArtifact,
  CompositionCompileError,
} from '@/v5/composition/compiler'
import {
  P06_COMPOSITION_COMPILER_VERSION,
  P06_COMPOSITION_CONTRACT_VERSION,
  type CompositionBlueprint,
  type P06CompositionOutput,
} from '@/v5/composition/contract'
import {
  CompositionBlueprintFeasibilityError,
  validateComposition,
  validateCompositionBlueprintFeasibility,
} from '@/v5/composition/validator'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import type { EvidenceAtom, V5WorkflowResult } from '@/v5/types'
import {
  measureArtifactMarkdown,
  validateGeneratedResumeArtifact,
  validateV5ResumePlan,
} from '@/v5/validators'

function fixtureContext() {
  const result = createV5ResultFixture()
  const blueprint = buildCompositionBlueprint({
    resume: result.resumeEvidenceBundle,
    plan: result.resumePlan,
    policy: result.generationPolicy,
  })
  const evidence = new Map(result.resumeEvidenceBundle.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const composition: P06CompositionOutput = {
    contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
    blocks: blueprint.slots.map(slot => {
      const evidenceId = slot.allowedEvidenceIds[0]
      const atom = evidence.get(evidenceId)
      if (!atom) throw new Error(`missing fixture evidence ${evidenceId}`)
      return { slotId: slot.slotId, evidenceIds: [evidenceId], text: atom.verbatimText }
    }),
  }
  return { result, blueprint, composition }
}

function validate(input: {
  result: V5WorkflowResult
  blueprint: CompositionBlueprint
  composition: unknown
}) {
  return validateComposition({
    composition: input.composition,
    blueprint: input.blueprint,
    resume: input.result.resumeEvidenceBundle,
    plan: input.result.resumePlan,
  })
}

function issueCodes(result: ReturnType<typeof validate>) {
  return result.issues.map(item => item.code)
}

function captureBlueprintFailure(build: () => unknown) {
  try {
    build()
  } catch (error) {
    if (error instanceof CompositionBlueprintFeasibilityError) return error
    throw error
  }
  throw new Error('expected CompositionBlueprintFeasibilityError')
}

function case3ShapedEducationContext() {
  const result = createV5ResultFixture()
  const resume = structuredClone(result.resumeEvidenceBundle)
  const plan = structuredClone(result.resumePlan)
  const template = resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  const educationAtom: EvidenceAtom = {
    ...structuredClone(template),
    evidenceId: 'ev_case3_education_heading',
    sourceBlockId: 'B0020',
    sourceScopeId: 'education-case3',
    sourceSpan: { start: 200, end: 214 },
    verbatimText: '## 教育、研究与服务设计项目',
    normalizedClaim: '教育、研究与服务设计项目',
    claimType: 'education',
    numericAtoms: [],
    qualifiers: [],
    riskFlags: [],
    sourceActionVerb: null,
    attributionLevel: 'unspecified',
  }
  const educationResultAtom: EvidenceAtom = {
    ...structuredClone(template),
    evidenceId: 'ev_case3_education_result',
    sourceBlockId: 'B0021',
    sourceScopeId: 'education-case3',
    sourceSpan: { start: 215, end: 228 },
    verbatimText: '完成研究与服务设计项目。',
    normalizedClaim: '完成研究与服务设计项目。',
    claimType: 'result',
    numericAtoms: [],
    qualifiers: [],
    riskFlags: [],
    sourceActionVerb: '完成',
    attributionLevel: 'owned',
  }
  resume.evidenceAtoms.push(educationAtom, educationResultAtom)
  resume.timeline.push({
    scopeId: 'education-case3',
    kind: 'education',
    organization: '某大学',
    title: '研究与服务设计项目',
    start: '2020',
    end: '2022',
    evidenceIds: [educationAtom.evidenceId, educationResultAtom.evidenceId],
  })
  plan.stableCoreEvidenceIds.push(educationAtom.evidenceId, educationResultAtom.evidenceId)
  plan.scopePlans.push({
    scopeId: 'education-case3',
    scopeType: 'education',
    treatment: 'include',
    selectedEvidenceIds: [educationResultAtom.evidenceId, educationAtom.evidenceId],
    bulletBudget: 1,
    rewriteAngle: '保留教育项目原始边界',
  })
  return { result, resume, plan, educationAtom, educationResultAtom }
}

describe('P06 composition blueprint and compiler', () => {
  test('owns structure and compiles shuffled model blocks deterministically into the legacy artifact', () => {
    const { result, blueprint, composition } = fixtureContext()
    const shuffled = { ...composition, blocks: [...composition.blocks].reverse() }

    const orderedResult = compileCompositionArtifact({
      composition,
      blueprint,
      resume: result.resumeEvidenceBundle,
      plan: result.resumePlan,
      policy: result.generationPolicy,
    })
    const shuffledResult = compileCompositionArtifact({
      composition: shuffled,
      blueprint,
      resume: result.resumeEvidenceBundle,
      plan: result.resumePlan,
      policy: result.generationPolicy,
    })

    expect(shuffledResult).toEqual(orderedResult)
    expect(orderedResult.artifact.markdown).toBe(result.artifact.markdown)
    expect(orderedResult.artifact.claims.map(claim => claim.outputPath)).toEqual([
      'identity.name',
      blueprint.slots.find(slot => slot.kind === 'business_bullet')!.outputPath,
      blueprint.slots.find(slot => slot.kind === 'skill')!.outputPath,
    ])
    expect(orderedResult.artifact.omittedPlannedEvidenceIds).toEqual([])
    expect(orderedResult.artifact.renderStats).toEqual(measureArtifactMarkdown(orderedResult.artifact.markdown))
    expect(orderedResult.diagnostics).toEqual({
      contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
      compilerVersion: P06_COMPOSITION_COMPILER_VERSION,
      degradedSlotIds: [],
    })

    const artifactValidation = validateGeneratedResumeArtifact({
      artifact: orderedResult.artifact,
      resume: result.resumeEvidenceBundle,
      plan: result.resumePlan,
      policy: result.generationPolicy,
      gateMode: 'relaxed_release',
    })
    expect(artifactValidation.passed).toBe(true)
    expect(artifactValidation.value).toEqual(orderedResult.artifact)
    expect(artifactValidation.issues.filter(item => item.code.endsWith('_SERVER_ALIGNED'))).toEqual([])
  })

  test('renders verified contacts and timeline-only scopes without exposing either as model slots', () => {
    const { result } = fixtureContext()
    const resume = structuredClone(result.resumeEvidenceBundle)
    const plan = structuredClone(result.resumePlan)
    const identityTemplate = resume.evidenceAtoms.find(atom => atom.claimType === 'identity')!
    const timelineTemplate = resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    const emailAtom: EvidenceAtom = {
      ...identityTemplate,
      evidenceId: 'ev_composition_email',
      verbatimText: '张三｜zhangsan@example.com',
      normalizedClaim: '张三｜zhangsan@example.com',
      riskFlags: ['sensitive_pii'],
    }
    const nonIdentityPhoneAtom: EvidenceAtom = {
      ...resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!,
      evidenceId: 'ev_composition_non_identity_phone',
      verbatimText: '13800138000',
      normalizedClaim: '13800138000',
      riskFlags: ['sensitive_pii'],
    }
    const oldTimelineAtom: EvidenceAtom = {
      ...timelineTemplate,
      evidenceId: 'ev_composition_old_timeline',
      sourceScopeId: 'work-old',
      verbatimText: '乙公司｜产品助理｜2020 - 2021',
      normalizedClaim: '乙公司｜产品助理｜2020 - 2021',
    }
    resume.evidenceAtoms.push(emailAtom, nonIdentityPhoneAtom, oldTimelineAtom)
    resume.identity.name.evidenceIds = [emailAtom.evidenceId]
    resume.identity.email = { value: 'zhangsan@example.com', evidenceIds: [emailAtom.evidenceId] }
    resume.identity.phone = { value: nonIdentityPhoneAtom.verbatimText, evidenceIds: [nonIdentityPhoneAtom.evidenceId] }
    resume.timeline.push({
      scopeId: 'work-old',
      kind: 'experience',
      organization: '乙公司',
      title: '产品助理',
      start: '2020',
      end: '2021',
      evidenceIds: [oldTimelineAtom.evidenceId],
    })
    plan.scopePlans.push({
      scopeId: 'work-old',
      scopeType: 'experience',
      treatment: 'timeline_line',
      selectedEvidenceIds: [],
      bulletBudget: 0,
      rewriteAngle: '仅保留时间线',
    })
    const blueprint = buildCompositionBlueprint({ resume, plan, policy: result.generationPolicy })
    const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
    const composition: P06CompositionOutput = {
      contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
      blocks: blueprint.slots.map(slot => ({
        slotId: slot.slotId,
        evidenceIds: [slot.allowedEvidenceIds[0]],
        text: evidence.get(slot.allowedEvidenceIds[0])!.verbatimText,
      })),
    }

    expect(blueprint.slots.some(slot => slot.slotId.includes('work-old'))).toBe(false)
    expect(blueprint.slots.some(slot => slot.outputPath.startsWith('identity.'))).toBe(false)
    const { artifact } = compileCompositionArtifact({
      composition,
      blueprint,
      resume,
      plan,
      policy: result.generationPolicy,
    })

    expect(artifact.markdown).toContain('zhangsan@example.com')
    expect(artifact.markdown).not.toContain(nonIdentityPhoneAtom.verbatimText)
    expect(artifact.markdown).toContain('乙公司｜产品助理｜2020 - 2021')
    expect(artifact.markdown).toContain('\n\n乙公司｜产品助理｜2020 - 2021\n\n')
    expect(artifact.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ outputPath: 'identity.name', evidenceIds: [emailAtom.evidenceId] }),
      expect.objectContaining({ outputPath: 'identity.email', evidenceIds: [emailAtom.evidenceId] }),
      expect.objectContaining({ outputPath: 'timeline.work-old', evidenceIds: [oldTimelineAtom.evidenceId] }),
    ]))
    expect(artifact.claims.some(claim => claim.outputPath === 'identity.phone')).toBe(false)
  })

  test('strictly rejects unknown fields and unknown, duplicate, or missing slots', () => {
    const { result, blueprint, composition } = fixtureContext()
    const unknownField = { ...composition, unexpected: true }
    expect(issueCodes(validate({ result, blueprint, composition: unknownField }))).toContain('COMPOSITION_SCHEMA_INVALID')

    const unknownSlot = structuredClone(composition)
    unknownSlot.blocks.push({ slotId: 'unknown:slot', evidenceIds: ['ev_unknown'], text: 'unknown' })
    expect(issueCodes(validate({ result, blueprint, composition: unknownSlot }))).toContain('COMPOSITION_UNKNOWN_SLOT')

    const duplicateSlot = structuredClone(composition)
    duplicateSlot.blocks.push(structuredClone(duplicateSlot.blocks[0]))
    expect(issueCodes(validate({ result, blueprint, composition: duplicateSlot }))).toContain('COMPOSITION_DUPLICATE_SLOT')

    const missingSlot = structuredClone(composition)
    missingSlot.blocks.pop()
    expect(issueCodes(validate({ result, blueprint, composition: missingSlot }))).toContain('COMPOSITION_REQUIRED_SLOT_MISSING')
  })

  test('rejects unallowed, excluded, sensitive, cross-scope, and repeated business evidence', () => {
    const base = fixtureContext()
    const businessSlot = base.blueprint.slots.find(slot => slot.kind === 'business_bullet')!
    const skillSlot = base.blueprint.slots.find(slot => slot.kind === 'skill')!
    const unallowed = structuredClone(base.composition)
    const unallowedBlock = unallowed.blocks.find(block => block.slotId === businessSlot.slotId)!
    unallowedBlock.evidenceIds = [skillSlot.allowedEvidenceIds[0]]
    unallowedBlock.text = base.result.resumeEvidenceBundle.evidenceAtoms
      .find(atom => atom.evidenceId === skillSlot.allowedEvidenceIds[0])!.verbatimText
    expect(issueCodes(validate({ ...base, composition: unallowed }))).toContain('COMPOSITION_EVIDENCE_NOT_ALLOWED')

    for (const [label, mutate, expectedCode] of [
      ['excluded', (atom: EvidenceAtom) => { atom.status = 'excluded' }, 'COMPOSITION_EVIDENCE_UNSAFE'],
      ['sensitive', (atom: EvidenceAtom) => { atom.riskFlags.push('sensitive_pii') }, 'COMPOSITION_EVIDENCE_UNSAFE'],
      ['cross-scope', (atom: EvidenceAtom) => { atom.sourceScopeId = 'another-scope' }, 'COMPOSITION_CROSS_SCOPE'],
    ] as const) {
      const { result, blueprint, composition } = fixtureContext()
      const evidenceId = blueprint.slots.find(slot => slot.kind === 'business_bullet')!.allowedEvidenceIds[0]
      const atom = result.resumeEvidenceBundle.evidenceAtoms.find(item => item.evidenceId === evidenceId)!
      mutate(atom)
      const validation = validate({ result, blueprint, composition })
      expect(issueCodes(validation), label).toContain(expectedCode)
    }

    const repeated = fixtureContext()
    const repeatedBlueprint = structuredClone(repeated.blueprint)
    const originalBusinessSlot = repeatedBlueprint.slots.find(slot => slot.kind === 'business_bullet')!
    repeatedBlueprint.slots.push({
      ...originalBusinessSlot,
      slotId: `${originalBusinessSlot.slotId}:duplicate`,
      outputPath: `${originalBusinessSlot.outputPath}:duplicate`,
      order: repeatedBlueprint.slots.length,
    })
    const evidenceId = repeated.result.resumePlan.scopePlans[0].selectedEvidenceIds[0]
    const text = repeated.result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === evidenceId)!.verbatimText
    const repeatedComposition: P06CompositionOutput = {
      contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
      blocks: repeatedBlueprint.slots.map(slot => ({
        slotId: slot.slotId,
        evidenceIds: [slot.kind === 'business_bullet' ? evidenceId : slot.allowedEvidenceIds[0]],
        text: slot.kind === 'business_bullet'
          ? text
          : repeated.result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === slot.allowedEvidenceIds[0])!.verbatimText,
      })),
    }
    expect(issueCodes(validate({
      result: repeated.result,
      blueprint: repeatedBlueprint,
      composition: repeatedComposition,
    }))).toContain('COMPOSITION_DUPLICATE_BUSINESS_EVIDENCE')

    repeated.result.resumePlan.scopePlans[0].bulletBudget = 2
    expect(() => buildCompositionBlueprint({
      resume: repeated.result.resumeEvidenceBundle,
      plan: repeated.result.resumePlan,
      policy: repeated.result.generationPolicy,
    })).toThrow(CompositionBlueprintFeasibilityError)
  })

  test('accepts whole same-scope atoms joined by semicolons and rejects substrings', () => {
    const { result } = fixtureContext()
    const resume = structuredClone(result.resumeEvidenceBundle)
    const plan = structuredClone(result.resumePlan)
    const first = resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    const second: EvidenceAtom = {
      ...structuredClone(first),
      evidenceId: 'ev_composition_second_business',
      verbatimText: '协助整理用户反馈并支持版本复盘。',
      normalizedClaim: '协助整理用户反馈并支持版本复盘。',
      claimType: 'action',
      numericAtoms: [],
      qualifiers: ['协助', '支持'],
      riskFlags: ['team_attribution'],
      sourceActionVerb: '协助',
      attributionLevel: 'supported',
    }
    resume.evidenceAtoms.push(second)
    plan.scopePlans[0].selectedEvidenceIds = [first.evidenceId, second.evidenceId]
    plan.scopePlans[0].bulletBudget = 1
    plan.stableCoreEvidenceIds.push(second.evidenceId)
    const blueprint = buildCompositionBlueprint({ resume, plan, policy: result.generationPolicy })
    const businessSlot = blueprint.slots.find(slot => slot.kind === 'business_bullet')!
    const skillSlot = blueprint.slots.find(slot => slot.kind === 'skill')!
    const skill = resume.evidenceAtoms.find(atom => atom.evidenceId === skillSlot.allowedEvidenceIds[0])!
    const composition: P06CompositionOutput = {
      contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
      blocks: [
        {
          slotId: businessSlot.slotId,
          evidenceIds: [first.evidenceId, second.evidenceId],
          text: `${first.verbatimText}；${second.verbatimText}`,
        },
        { slotId: skillSlot.slotId, evidenceIds: [skill.evidenceId], text: skill.verbatimText },
      ],
    }

    const validation = validateComposition({ composition, blueprint, resume, plan })
    expect(validation.passed).toBe(true)
    const { artifact } = compileCompositionArtifact({
      composition,
      blueprint,
      resume,
      plan,
      policy: result.generationPolicy,
    })
    const mergedClaim = artifact.claims.find(claim => claim.outputPath === businessSlot.outputPath)!
    expect(mergedClaim.transformation).toBe('same_scope_merge')
    expect(mergedClaim.attributionLevel).toBe('supported')
    expect(artifact.omittedPlannedEvidenceIds).toEqual([])
    expect(validateGeneratedResumeArtifact({
      artifact,
      resume,
      plan,
      policy: result.generationPolicy,
      gateMode: 'relaxed_release',
    }).passed).toBe(true)

    const substring = structuredClone(composition)
    substring.blocks[0].text = '交付3个功能'
    const rejected = validateComposition({ composition: substring, blueprint, resume, plan })
    expect(issueCodes(rejected)).toContain('COMPOSITION_TEXT_UNPROVABLE')
    expect(() => compileCompositionArtifact({
      composition: substring,
      blueprint,
      resume,
      plan,
      policy: result.generationPolicy,
    })).toThrow(CompositionCompileError)
  })

  test('does not let presentation normalization erase numeric, team, negation, or stage boundaries', () => {
    const { result, blueprint, composition } = fixtureContext()
    const businessSlot = blueprint.slots.find(slot => slot.kind === 'business_bullet')!
    const evidenceId = businessSlot.allowedEvidenceIds[0]
    const atom = result.resumeEvidenceBundle.evidenceAtoms.find(item => item.evidenceId === evidenceId)!
    atom.verbatimText = '参与团队规划尚未上线的调研，投放400+份问卷。'
    atom.normalizedClaim = atom.verbatimText
    atom.numericAtoms = [{
      raw: '400+份',
      valueText: '400',
      unit: '份',
      qualifier: '+',
      period: null,
      ownerScope: atom.sourceScopeId,
    }]
    atom.qualifiers = ['参与', '团队', '尚未上线', '+']
    atom.riskFlags = ['team_attribution', 'future_or_planned']
    const businessBlock = composition.blocks.find(block => block.slotId === businessSlot.slotId)!
    businessBlock.text = atom.verbatimText
    expect(validate({ result, blueprint, composition }).passed).toBe(true)

    for (const unsafeText of [
      '团队规划尚未上线的调研，投放400+份问卷。',
      '参与团队规划上线的调研，投放400+份问卷。',
      '参与团队规划尚未上线的调研，投放400份问卷。',
    ]) {
      const unsafe = structuredClone(composition)
      unsafe.blocks.find(block => block.slotId === businessSlot.slotId)!.text = unsafeText
      expect(issueCodes(validate({ result, blueprint, composition: unsafe }))).toContain('COMPOSITION_TEXT_UNPROVABLE')
    }
  })

  test('rejects planned education that is not assigned to an education scope before any model call', () => {
    const context = case3ShapedEducationContext()
    context.plan.scopePlans = context.plan.scopePlans.filter(item => item.scopeId !== 'education-case3')
    context.plan.stableCoreEvidenceIds = context.plan.stableCoreEvidenceIds
      .filter(id => id !== context.educationResultAtom.evidenceId)

    const planValidation = validateV5ResumePlan({
      resume: context.resume,
      job: context.result.jobRequirementBundle,
      match: context.result.matchAnalysis,
      plan: context.plan,
      policy: context.result.generationPolicy,
      profile: context.result.strategyProfile,
      gateMode: 'relaxed_release',
    })
    expect(planValidation.issues).toContainEqual(expect.objectContaining({
      code: 'PLANNED_EVIDENCE_NOT_ASSIGNED',
      evidenceIds: [context.educationAtom.evidenceId],
    }))

    const failure = captureBlueprintFailure(() => buildCompositionBlueprint({
      resume: context.resume,
      plan: context.plan,
      policy: context.result.generationPolicy,
    }))
    expect(failure.issues).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_BLUEPRINT_REQUIRED_EVIDENCE_UNREACHABLE',
      evidenceIds: [context.educationAtom.evidenceId],
    }))
  })

  test('derives education slot kind from scope semantics instead of selected-evidence order', () => {
    const context = case3ShapedEducationContext()
    const forward = buildCompositionBlueprint({
      resume: context.resume,
      plan: context.plan,
      policy: context.result.generationPolicy,
    })
    const reversedPlan = structuredClone(context.plan)
    reversedPlan.scopePlans.find(item => item.scopeId === 'education-case3')!.selectedEvidenceIds.reverse()
    const reversed = buildCompositionBlueprint({
      resume: context.resume,
      plan: reversedPlan,
      policy: context.result.generationPolicy,
    })

    expect(forward.slots.find(slot => slot.scopeId === 'education-case3')?.kind).toBe('ancillary')
    expect(reversed.slots.find(slot => slot.scopeId === 'education-case3')?.kind).toBe('ancillary')
  })

  test('rejects occupied sections missing from sectionOrder and impossible canonical slot budgets', () => {
    const education = case3ShapedEducationContext()
    const missingEducationPolicy = {
      ...education.result.generationPolicy,
      sectionOrder: education.result.generationPolicy.sectionOrder.filter(section => section !== 'education'),
    }
    const missingSection = captureBlueprintFailure(() => buildCompositionBlueprint({
      resume: education.resume,
      plan: education.plan,
      policy: missingEducationPolicy,
    }))
    expect(missingSection.issues).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_BLUEPRINT_SECTION_UNRENDERABLE',
    }))

    const duplicate = createV5ResultFixture()
    const duplicateAtom = {
      ...structuredClone(duplicate.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!),
      evidenceId: 'ev_case3_duplicate_canonical',
    }
    duplicate.resumeEvidenceBundle.evidenceAtoms.push(duplicateAtom)
    duplicate.resumePlan.scopePlans[0].treatment = 'expand'
    duplicate.resumePlan.scopePlans[0].selectedEvidenceIds.push(duplicateAtom.evidenceId)
    duplicate.resumePlan.scopePlans[0].bulletBudget = 2
    duplicate.resumePlan.stableCoreEvidenceIds.push(duplicateAtom.evidenceId)
    const impossibleBudget = captureBlueprintFailure(() => buildCompositionBlueprint({
      resume: duplicate.resumeEvidenceBundle,
      plan: duplicate.resumePlan,
      policy: duplicate.generationPolicy,
    }))
    expect(impossibleBudget.issues).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_BLUEPRINT_CANONICAL_CAPACITY_EXCEEDED',
      evidenceIds: expect.arrayContaining([duplicateAtom.evidenceId]),
    }))
  })

  test('keeps unavoidable summary/body reuse as an explicit non-blocking schema diagnostic', () => {
    const { result } = fixtureContext()
    const plan = structuredClone(result.resumePlan)
    const policy = { ...result.generationPolicy, summaryPolicy: 'one_sentence' as const }
    plan.generationPolicy = policy
    const blueprint = buildCompositionBlueprint({
      resume: result.resumeEvidenceBundle,
      plan,
      policy,
    })
    const feasibility = validateCompositionBlueprintFeasibility({
      blueprint,
      resume: result.resumeEvidenceBundle,
      plan,
    })

    expect(feasibility.passed).toBe(true)
    expect(feasibility.issues).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_SUMMARY_BODY_REUSE_REQUIRED',
      severity: 'warning',
    }))
  })
})
