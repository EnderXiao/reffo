import { describe, expect, test } from 'bun:test'
import { preferredEmphasis, overviewDetailOverlaps, WRITING_EDITORIAL_VERSION } from '@/v5/writing/editorial'
import { buildWritingFact } from '@/v5/writing/facts'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import type { EvidenceAtom } from '@/v5/types'
import type { JobTarget } from '@/v5/targeting/profile'

function fact(text: string) {
  const atom = createTargetingFixture().business
  return buildWritingFact({ ...atom, claimType: 'action', verbatimText: text, riskFlags: [] })!
}

function inputFixture() {
  const r = createV5ResultFixture(), t = createTargetingFixture()
  const work = r.resumeEvidenceBundle.timeline[0]
  const source = r.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  const make = (id: string, scope: string, text: string, start: number): EvidenceAtom => ({ ...source,
    evidenceId: id, sourceScopeId: scope, sourceSpan: {start, end: start + text.length}, sourceBlockId: `B${start}`,
    claimType: 'action', verbatimText: text, normalizedClaim: text, riskFlags: [], numericAtoms: [], qualifiers: [] })
  const atoms = [
    make('overview', 'work', '负责会员增长分析、渠道归因与触点优化。', 100),
    make('unique', 'work', '梳理权限治理与业务规则，制定权限审批方案。', 180),
    make('unrelated', 'work', '安排行政物资采购与办公室日常维护。', 260),
    make('detail', 'project', '分析会员增长、渠道归因与触点优化，制定触达方案；转化率提升15%，审核时间由30分钟降至10分钟。', 400),
    make('other', 'other-work', '负责会员增长分析、渠道归因与触点优化。', 600),
  ]
  const resume = structuredClone(r.resumeEvidenceBundle)
  resume.evidenceAtoms = atoms
  resume.timeline = [
    { ...work, scopeId: 'work', kind: 'experience' as const, organization: '甲', evidenceIds: ['overview', 'unique', 'unrelated'] },
    { ...work, scopeId: 'project', kind: 'project' as const, organization: '甲', title: '会员项目', evidenceIds: ['detail'] },
    { ...work, scopeId: 'other-work', kind: 'experience' as const, organization: '乙', evidenceIds: ['other'] },
  ]
  const plan = structuredClone(r.resumePlan)
  plan.scopePlans = resume.timeline.map(scope => ({ scopeId: scope.scopeId, scopeType: scope.kind,
    treatment: 'include' as const, selectedEvidenceIds: scope.evidenceIds, bulletBudget: 1, rewriteAngle: '选材测试' }))
  plan.stableCoreEvidenceIds = atoms.map(atom => atom.evidenceId)
  plan.customizedEvidenceIds = []; plan.featuredSkillEvidenceIds = []; plan.evidencePillars = []
  const targets: JobTarget[] = [
    { id: 'job:task:growth', kind: 'task', text: '会员增长分析、渠道归因与触点优化', priority: 'core', basis: 'explicit', taskIds: ['job:task:growth'], requirementIds: [] },
    { id: 'job:task:rules', kind: 'task', text: '权限治理与业务规则', priority: 'supporting', basis: 'explicit', taskIds: ['job:task:rules'], requirementIds: [] },
  ]
  const fit = { ...t.fit, narratives: [], links: targets.map(target => ({ targetId: target.id, status: 'transferable' as const,
    evidenceIds: target.priority === 'core' ? ['overview', 'detail', 'other'] : ['unique'], similarity: '已有局部实践', difference: '业务规模仍有差距', expressionAngle: '已支持工作' })) }
  return { resume, plan, policy: r.generationPolicy, job: r.jobRequirementBundle, match: r.matchAnalysis,
    targeting: { profile: t.candidate.jobSuccessProfile, targets, fit } }
}

describe('deterministic editorial planning, not another quality gate', () => {
  test('later observed results become intact priority excerpts without new numeric obligations', () => {
    const f = fact('分析用户问题，设计辅导能力；辅导有效率95%；审核由40分钟降至近乎零人工干预。')
    const before = structuredClone(f)
    const emphasis = preferredEmphasis(f, ['设计辅导能力'])
    expect(emphasis.find(item => item.kind === 'outcome')?.text).toBe('辅导有效率95%；审核由40分钟降至近乎零人工干预。')
    expect(f.requiredNumbers).toEqual([])
    expect(f).toEqual(before)
    expect(emphasis.every(item => f.text.includes(item.text))).toBe(true)
  })
  test.each([
    '梳理需求；预计转化率提升15%。', '梳理需求；目标是收入增长20%。',
    '梳理需求；转化率未能提升15%。', '梳理需求；转化率未提升15%。', '梳理需求，尚未上线；实验准确率90%。',
    '梳理需求；访谈20人，整理30条问题。', '使用版本2.0；团队共15人。',
  ])('does not promote plans, negative results, counts or versions to observed outcomes: %s', text => {
    expect(preferredEmphasis(fact(text), ['梳理需求']).filter(item => item.kind === 'outcome')).toEqual([])
  })
  test('same sparse material receives different emphasis for different job tasks, not invented facts', () => {
    const f = fact('分析会员增长与触点转化；梳理权限治理与审批规则。')
    const growth = preferredEmphasis(f, ['会员增长触点转化'])
    const rules = preferredEmphasis(f, ['权限治理审批规则'])
    expect(growth).not.toEqual(rules)
    expect(rules[0].text).toBe('梳理权限治理与审批规则。')
    expect(rules.every(item => f.text.includes(item.text))).toBe(true)
    expect(f.protectedNumbers).toEqual([])
  })
  test('keeps unrelated jobs separate, chooses distinct work evidence, and prunes unrelated optional context', () => {
    const input = inputFixture(), before = structuredClone(input)
    const plan = buildWritingPlan(input)
    const work = plan.blueprint.slots.find(slot => slot.scopeId === 'work')!
    expect(plan.coreEvidenceIdsBySlot[work.slotId]).toEqual(['unique'])
    expect(plan.facts.map(f => f.evidenceId)).not.toContain('unrelated')
    expect(plan.facts.map(f => f.evidenceId)).toContain('other')
    const detail = plan.blueprint.slots.find(slot => slot.scopeId === 'project')!
    expect(plan.editorial!.slots[detail.slotId].emphasis[0].text).toContain('15%')
    expect(plan.editorial!.slots[detail.slotId].lengthHint.target).toBeGreaterThan(plan.editorial!.slots[work.slotId].lengthHint.target)
    expect(plan.blueprint.slots.filter(slot => slot.kind === 'business_bullet')).toHaveLength(3)
    for (const slot of plan.blueprint.slots.filter(slot => slot.kind === 'business_bullet')) {
      expect(slot.allowedEvidenceIds.every(id => plan.facts.find(fact => fact.evidenceId === id)?.scopeId === slot.scopeId)).toBe(true)
    }
    expect(input).toEqual(before)
    expect(writingPayload(plan).editorialVersion).toBe(WRITING_EDITORIAL_VERSION)
  })
  test.each(['different_task', 'different_company', 'different_work_region', 'only_tool_overlap', 'different_dates', 'optional_detail'] as const)('does not equate unrelated evidence: %s', mutation => {
    const input = inputFixture()
    const plan = buildWritingPlan({...input, targeting: undefined})
    const links = new Map([['overview', new Set(['task'])], ['detail', new Set([mutation === 'different_task' ? 'other' : 'task'])]])
    if (mutation === 'different_company') input.resume.timeline[1].organization = '丙'
    if (mutation === 'different_work_region') input.resume.evidenceAtoms.find(atom => atom.evidenceId === 'detail')!.sourceSpan.start = 800
    if (mutation === 'only_tool_overlap') plan.facts.find(fact => fact.evidenceId === 'detail')!.text = '使用SQL制作财务分析报表。'
    if (mutation === 'different_dates') input.resume.timeline[1].start = '2000-01'
    expect(overviewDetailOverlaps({resume: input.resume, blueprint: plan.blueprint, facts: plan.facts, taskLinks: links,
      ...(mutation === 'optional_detail' ? {primaryDetailIds: new Set<string>()} : {})}).has('overview')).toBe(false)
  })
  test('old non-targeted plans do not receive a new editorial protocol', () => {
    const input = inputFixture()
    const plan = buildWritingPlan({...input, targeting: undefined})
    expect(plan.editorial).toBeUndefined()
    expect(writingPayload(plan)).not.toHaveProperty('editorialVersion')
  })
})
