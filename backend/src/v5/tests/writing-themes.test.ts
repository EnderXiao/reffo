import { expect, test } from 'bun:test'
import { buildWritingThemes } from '@/v5/writing/themes'
import { buildWritingFact } from '@/v5/writing/facts'
import { buildWritingPlan } from '@/v5/writing/plan'
import { buildSlotEditorialGuides } from '@/v5/writing/editorial'
import { createV5ResultFixture } from '@/v5/tests/fixtures'

function fixture() {
  const r = createV5ResultFixture()
  const plan = buildWritingPlan({ resume: r.resumeEvidenceBundle, plan: r.resumePlan, policy: r.generationPolicy,
    match: r.matchAnalysis, job: r.jobRequirementBundle })
  const base = plan.facts.find(f => f.claimType === 'deliverable')!
  const facts = ['核对发票与银行回单，整理报销差异。', '编码访谈笔记，归纳使用障碍。', '洽谈渠道条款，记录供货限制。']
    .map((text, i) => ({ ...base, evidenceId: `practice-${i}`, scopeId: `scope-${i}`, text, claimType: 'action' as const }))
  return { facts, blueprint: plan.blueprint, taskLinks: new Map(facts.map(f => [f.evidenceId, new Set(['task'])])),
    targets: [{ id: 'task', kind: 'task' as const, text: '核对发票与银行回单', priority: 'core' as const,
      basis: 'explicit' as const, taskIds: ['task'], requirementIds: [] }], mode: 'skill' as const, limit: 3 }
}

test('distinct practice themes do not merge methods just because their JD task is the same', () => {
  const input = fixture(), before = structuredClone(input)
  const themes = buildWritingThemes(input)
  expect(themes).toHaveLength(3)
  expect(themes[0].anchorEvidenceId).toBe('practice-0')
  expect(themes.every(theme => theme.supportingEvidenceIds.length === 0)).toBe(true)
  expect(new Set(themes.map(theme => theme.anchorEvidenceId)).size).toBe(3)
  expect(input).toEqual(before)
  expect(buildWritingThemes({ ...input, facts: [...input.facts].reverse() })).toEqual(themes)
})

test('sparse, repeated, result-only and context material cannot pad skill themes', () => {
  const input = fixture(), first = input.facts[0]
  const result = { ...first, evidenceId: 'result', claimType: 'result' as const }
  const context = { ...first, evidenceId: 'context', contextForEvidenceId: first.evidenceId }
  expect(buildWritingThemes({ ...input, facts: [first, { ...first, evidenceId: 'duplicate' }, result, context] })).toHaveLength(1)
  expect(buildWritingThemes({ ...input, facts: [result, context] })).toEqual([])
})

test('summary themes are bounded and every detailed reference belongs to its anchor', () => {
  const input = fixture()
  const themes = buildWritingThemes({ ...input, mode: 'summary', limit: 2 })
  expect(themes).toHaveLength(2)
  for (const theme of themes) expect(theme.detailSlotIds.every(id => input.blueprint.slots
    .find(slot => slot.slotId === id)?.allowedEvidenceIds.includes(theme.anchorEvidenceId))).toBe(true)
})

test('only related explicit skill labels can supplement the primary practice', () => {
  const input = fixture()
  const labels = [
    { ...input.facts[0], evidenceId: 'label', text: '发票与银行回单核对', claimType: 'skill' as const },
    { ...input.facts[0], evidenceId: 'other-label', text: 'Python编程', claimType: 'skill' as const },
  ]
  expect(buildWritingThemes({ ...input, facts: [...input.facts, ...labels] })[0].supportingEvidenceIds).toEqual(['label'])
})

test('related concrete practice precedes generic duties; sparse duties are still usable', () => {
  const input = fixture()
  const duty = { ...input.facts[0], evidenceId: 'duty', claimType: 'responsibility' as const,
    text: '负责发票核对、银行回单管理、报销差异处理和团队日常管理。' }
  input.taskLinks.set(duty.evidenceId, new Set(['task']))
  expect(buildWritingThemes({ ...input, facts: [duty, input.facts[0]], limit: 1 })[0].anchorEvidenceId).toBe('practice-0')
  expect(buildWritingThemes({ ...input, facts: [duty] })[0].anchorEvidenceId).toBe('duty')
})

test.each(['words', 'cjk_characters'] as const)('skill reference pool does not consume body editing room (%s)', unit => {
  const r = createV5ResultFixture()
  const original = r.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  const fact = buildWritingFact({ ...original, verbatimText: '核对报销凭证，整理差异记录并反馈经办人员。'.repeat(20), claimType: 'action' })!
  const blueprint = buildWritingPlan({ resume: r.resumeEvidenceBundle, plan: r.resumePlan, policy: r.generationPolicy,
    match: r.matchAnalysis, job: r.jobRequirementBundle }).blueprint
  const body = blueprint.slots.find(slot => slot.kind === 'business_bullet')!
  const skill = blueprint.slots.find(slot => slot.kind === 'skill')!
  blueprint.slots = [body, skill]
  body.allowedEvidenceIds = [fact.evidenceId]; skill.allowedEvidenceIds = [fact.evidenceId]
  const input = { blueprint, facts: [fact], coreBySlot: { [body.slotId]: [fact.evidenceId], [skill.slotId]: [fact.evidenceId] },
    taskLinks: new Map<string, Set<string>>(), targets: [], overlaps: new Map<string, string[]>(), methodSkills: true,
    outputLength: { ...r.generationPolicy.outputLength, unit, softMax: 240, hardMax: 300 } }
  const before = buildSlotEditorialGuides(input)
  const optional = { ...fact, evidenceId: 'optional-label', claimType: 'skill' as const, text: '凭证复核。'.repeat(50) }
  input.facts.push(optional); skill.allowedEvidenceIds.push(optional.evidenceId)
  expect(buildSlotEditorialGuides(input)).toEqual(before)
  expect(before[body.slotId].lengthHint.max).toBeLessThanOrEqual(240)
})
