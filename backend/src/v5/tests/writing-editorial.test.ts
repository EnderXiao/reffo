import { describe, expect, test } from 'bun:test'
import { buildSlotEditorialGuides, preferredEmphasis, overviewDetailOverlaps, sourceOrganizationNames, WRITING_EDITORIAL_VERSION } from '@/v5/writing/editorial'
import { buildWritingFact } from '@/v5/writing/facts'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import type { EvidenceAtom, GenerationPolicy } from '@/v5/types'
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
  test('explicit organization aliases are usable but name resemblance does not infer project ownership', () => {
    const input = inputFixture()
    input.resume.timeline[0].organization = '甲科技有限公司｜数字中心'
    const alias = input.resume.evidenceAtoms[0]
    alias.verbatimText = '甲科技有限公司（简称甲科技）'
    expect([...sourceOrganizationNames(input.resume, 'work')]).toEqual(['甲科技有限公司｜数字中心', '甲科技有限公司', '甲科技'])
    alias.verbatimText = '甲科技产品项目'
    expect(sourceOrganizationNames(input.resume, 'work').has('甲科技')).toBe(false)
    alias.verbatimText = '乙科技有限公司（简称甲科技）'
    expect(sourceOrganizationNames(input.resume, 'work').has('甲科技')).toBe(false)
  })
  test('summary priorities are selected representative practices, not new mandatory facts', () => {
    const input = inputFixture(), plan = buildWritingPlan(input)
    expect(plan.summaryPriorityEvidenceIds?.[0]).toBe('detail')
    expect(plan.summaryPriorityEvidenceIds!.length).toBeLessThanOrEqual(2)
    expect(plan.summaryPriorityEvidenceIds).not.toContain('other')
    const summary = plan.blueprint.slots.find(slot => slot.kind === 'summary')
    if (summary) expect(plan.coreEvidenceIdsBySlot[summary.slotId]).toEqual([])
    expect(plan.summaryPriorityEvidenceIds?.every(id => plan.facts.some(fact => fact.evidenceId === id))).toBe(true)
  })
  test('qualitative and stage deliverables receive priority without becoming quantitative outcomes', () => {
    const emphasis = preferredEmphasis(fact('编码访谈笔记；形成概念原型，尚未上线。'), ['编码访谈笔记'])
    expect(emphasis.some(item => item.kind === 'delivery' && item.text.includes('尚未上线'))).toBe(true)
    expect(emphasis.some(item => item.kind === 'outcome')).toBe(false)
  })
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

function lengthFixture(texts: string[], unit: GenerationPolicy['outputLength']['unit'] = 'cjk_characters', softMax = 900) {
  const base = buildWritingPlan(inputFixture())
  const facts = texts.map((text, index) => ({ ...fact(text), evidenceId: `fact-${index}`, scopeId: `scope-${index}` }))
  return {
    blueprint: { ...base.blueprint, slots: facts.map((fact, index) => ({
      slotId: `slot-${index}`, kind: 'business_bullet' as const, sectionKey: 'experience' as const,
      scopeId: fact.scopeId, outputPath: `experience[${index}]`, order: index, required: true,
      allowedEvidenceIds: [fact.evidenceId],
    })) },
    facts,
    coreBySlot: Object.fromEntries(facts.map((fact, index) => [`slot-${index}`, [fact.evidenceId]])),
    taskLinks: new Map(facts.map(fact => [fact.evidenceId, new Set(['core'])])),
    targets: [{ id: 'core', kind: 'task' as const, text: '岗位核心工作', priority: 'core' as const,
      basis: 'explicit' as const, taskIds: ['core'], requirementIds: [] }],
    overlaps: new Map<string, string[]>(),
    outputLength: { unit, softMin: null, hardMin: null, softMax, hardMax: Math.ceil(softMax * 1.3) },
  }
}

describe('material-aware shared Writer length budget (advisory only)', () => {
  test.each([
    ['财务', '复核报销凭证，核对发票与银行回单，整理差异并反馈经办人员。'],
    ['销售', '洽谈渠道合作条款，记录客户需求与交付限制，跟进供货协议进度。'],
    ['研究', '编码观察笔记，归纳参与者意见，整理研究局限与下一轮验证问题。'],
  ])('richer %s material is not clipped to the old 105-character ceiling', (_role, sentence) => {
    const sparse = buildSlotEditorialGuides(lengthFixture([sentence]))['slot-0'].lengthHint
    const rich = buildSlotEditorialGuides(lengthFixture([sentence.repeat(7)]))['slot-0'].lengthHint
    expect(rich.target).toBeGreaterThan(105)
    expect(rich.target).toBeGreaterThan(sparse.target)
    expect(sparse.target).toBeLessThan(100)
  })
  test('large global allowance does not pad sparse evidence or change protected facts', () => {
    const input = lengthFixture(['核对报销凭证。'])
    const before = structuredClone(input)
    const small = buildSlotEditorialGuides(input)['slot-0']
    const large = buildSlotEditorialGuides({ ...input, outputLength: { ...input.outputLength, softMax: 10000, hardMax: 12000 } })['slot-0']
    expect(large).toEqual(small)
    expect(small.lengthHint.target).toBeLessThan(40)
    expect(input).toEqual(before)
  })
  test('only assigned supporting material earns room; unused facts cannot inflate length', () => {
    const input = lengthFixture(['整理客户需求。'])
    const baseline = buildSlotEditorialGuides(input)['slot-0'].lengthHint.target
    const optional = { ...fact('跟进合同进度，记录客户反馈并向交付同事说明。'), evidenceId: 'optional', scopeId: 'scope-0' }
    input.facts.push(optional)
    expect(buildSlotEditorialGuides(input)['slot-0'].lengthHint.target).toBe(baseline)
    input.blueprint.slots[0].allowedEvidenceIds.push(optional.evidenceId)
    expect(buildSlotEditorialGuides(input)['slot-0'].lengthHint.target).toBeGreaterThan(baseline)
  })
  test('shares the existing document budget and preserves core-task priority under pressure', () => {
    const text = '核对报销凭证并整理差异，记录处理情况与复核结论。'.repeat(8)
    const input = lengthFixture([text, text, text], 'cjk_characters', 240)
    input.taskLinks.delete('fact-1'); input.taskLinks.delete('fact-2')
    const guides = Object.values(buildSlotEditorialGuides(input))
    expect(guides[0].lengthHint.target).toBeGreaterThan(guides[1].lengthHint.target)
    expect(guides[1].lengthHint.target).toBe(guides[2].lengthHint.target)
    expect(guides.reduce((sum, guide) => sum + guide.lengthHint.target, 0)).toBeLessThanOrEqual(192)
    expect(guides.reduce((sum, guide) => sum + guide.lengthHint.max, 0)).toBeLessThanOrEqual(Math.floor(312 * 0.8))
    expect(guides.every(guide => guide.lengthHint.max >= guide.lengthHint.target)).toBe(true)
  })
  test('reserves ancillary and summary space without adding slots or gates', () => {
    const input = lengthFixture(['梳理业务问题并整理处理记录。'.repeat(50)], 'cjk_characters', 300)
    const original = buildSlotEditorialGuides(input)['slot-0'].lengthHint.target
    const education = { ...fact('完成学位课程与研究论文。'.repeat(10)), evidenceId: 'education' }
    // Use a full WritingPlan blueprint because ancillary slots have a different kind.
    const blueprint = structuredClone(buildWritingPlan(inputFixture()).blueprint)
    blueprint.slots = [...input.blueprint.slots, { slotId: 'education', kind: 'ancillary', sectionKey: 'education',
      scopeId: 'school', outputPath: 'education[0]', order: 1, required: true, allowedEvidenceIds: ['education'] }]
    const guides = buildSlotEditorialGuides({ ...input, blueprint, facts: [...input.facts, education] })
    expect(Object.keys(guides)).toEqual(['slot-0'])
    expect(guides['slot-0'].lengthHint.target).toBeLessThan(original)
    expect(blueprint.slots).toHaveLength(2)
  })
  test('word guidance follows words rather than English character length', () => {
    const short = buildSlotEditorialGuides(lengthFixture(['Read case notes and filed service forms.'], 'words'))['slot-0'].lengthHint
    const long = buildSlotEditorialGuides(lengthFixture(['Reviewed customer correspondence and categorized service documentation.'], 'words'))['slot-0'].lengthHint
    expect(short).toEqual(long)
    expect(short.unit).toBe('words')
    expect(short.target).toBeLessThan(25)
  })
  test('cross-language input is not treated as having no material', () => {
    const guides = buildSlotEditorialGuides(lengthFixture(['Reviewed customer correspondence and categorized service documentation.'], 'cjk_characters'))
    expect(guides['slot-0'].lengthHint.target).toBeGreaterThan(20)
  })
  test.each([
    'Анализировал обращения клиентов и составлял отчёты.',
    'راجعت طلبات العملاء وأعددت تقارير المتابعة.',
    'おきゃくさまのごいけんをまとめました。',
  ])('non-Latin source receives nonzero room even when requesting English output: %s', text => {
    const guide = buildSlotEditorialGuides(lengthFixture([text], 'words'))['slot-0']
    expect(guide.lengthHint.target).toBeGreaterThan(10)
    expect(guide.lengthHint.max).toBeGreaterThan(guide.lengthHint.target)
  })
})
