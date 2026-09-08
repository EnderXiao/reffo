import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildResumeEvidenceBundle } from '@/v5/evidence'
import { buildEvidencePlanningCatalog } from '@/v5/evidence-routing'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildDeterministicV5ResumePlan } from '@/v5/validators'
import { buildWritingPlan } from '@/v5/writing/plan'
import { compileWritingArtifact } from '@/v5/writing/compiler'
import type { EvidenceAtom, ResumeExtractionCandidate } from '@/v5/types'
import { createMatchFixture, createResumeFixture } from './fixtures'

function fixture(text: string, sourceActionVerb: string | null, role = '业务专员', claimType: EvidenceAtom['claimType'] = 'action') {
  const input = createMatchFixture()
  const { candidate: base } = createResumeFixture()
  const document = canonicalizeSourceDocument(`示例企业｜${role}｜2022-至今\n${text}`, 'generic-evidence').canonicalDocument
  const facts: ResumeExtractionCandidate['factCandidates'] = document.blocks.map((block, index) => ({
    factLocalId: `fact_${index}`, sourceBlockId: block.sourceBlockId,
    blockRelativeSpan: { start: 0, end: block.text.length }, verbatimText: block.text, normalizedClaim: block.text,
    claimType: index === 0 ? 'timeline' : claimType, sourceScopeLocalId: 'work', proposedStatus: 'source_supported',
    attributionLevel: 'unspecified', sourceActionVerb: index === 0 ? null : sourceActionVerb,
    qualifiers: [], numericAtoms: [], riskFlags: [],
  }))
  const candidate: ResumeExtractionCandidate = { ...base, identityCandidates: [],
    timelineCandidates: [{ scopeLocalId: 'work', kind: 'experience', organization: '示例企业', title: role, start: '2022', end: '至今', factLocalIds: facts.map(fact => fact.factLocalId) }],
    sectionCandidates: [{ sectionLocalId: 'work', type: 'experience', title: '工作经历', scopeLocalIds: ['work'], factLocalIds: facts.map(fact => fact.factLocalId) }],
    factCandidates: facts, unmappedFragments: [], conflicts: [],
    coverageClaim: { mappedSourceBlockIds: document.blocks.map(block => block.sourceBlockId), unmappedSourceBlockIds: [] },
    qualityAssessment: { ...base.qualityAssessment, strengths: [], weaknesses: [], suggestions: [] },
  }
  input.resume = buildResumeEvidenceBundle(document, candidate)
  const atom = input.resume.evidenceAtoms.find(item => item.claimType !== 'timeline')!
  input.job.basicInfo.title = role
  input.job.requirementAtoms = [input.core]
  input.core.verbatimText = text; input.core.normalizedRequirement = text
  input.match.requirementMatches = [{ requirementId: input.core.requirementId, status: 'direct_match', evidenceIds: [atom.evidenceId], confidence: 'high', rationale: '合成测试：岗位任务与源动作直接对应' }]
  input.match.positioning.primaryEvidenceIds = [atom.evidenceId]
  input.match.positioning.primaryRequirementIds = [input.core.requirementId]
  input.match.strengths = []; input.match.gaps = []
  return { ...input, atom }
}

const CASES: Array<{ role: string; text: string; verb: string }> = [
  { role: '客户经理', text: '洽谈渠道合作条款，签订年度供货协议。', verb: '洽谈' },
  { role: '财务专员', text: '复核报销凭证，核对发票与银行回单。', verb: '复核' },
  { role: '客服专员', text: '受理售后申诉，答复客户并记录处理进度。', verb: '受理' },
  { role: '研究助理', text: '编码观察笔记，归纳受访者意见。', verb: '编码' },
  { role: '产品设计师', text: '尚未上线的原型上完成可用性测试。', verb: '完成' },
  { role: '研究助理', text: '未商业化的课题中编码访谈资料。', verb: '编码' },
  { role: 'Accountant', text: 'Audited expense receipts against bank records.', verb: 'Audited' },
  { role: 'Customer Service', text: 'Processed refund requests and recorded case histories.', verb: 'Processed' },
]

describe('generic evidence selection from source-anchored P01 annotations', () => {
  test('a fixed work-scope reservation is not spent again on optional credentials', () => {
    const input = fixture('复核报销凭证并核对银行回单。', '复核', '财务专员', 'responsibility')
    const timeline = { ...input.atom, evidenceId: 'brief-timeline', claimType: 'timeline' as const,
      sourceScopeId: 'brief-work', verbatimText: '另一企业｜业务专员｜2018 - 2019', sourceSpan:{start:1000,end:1020} }
    const description = { ...timeline, evidenceId: 'brief-description', claimType:'other' as const,
      verbatimText:'客户服务平台、售后管理工具及运营支持', sourceSpan:{start:1021,end:1050} }
    input.resume.evidenceAtoms.push(timeline, description)
    input.resume.timeline.push({scopeId:'brief-work',kind:'experience',organization:'另一企业',title:'业务专员',
      start:'2018',end:'2019',evidenceIds:[timeline.evidenceId,description.evidenceId]})
    for (let index=0; index<4; index++) input.resume.evidenceAtoms.push({...input.atom,
      evidenceId:`language-${index}`,claimType:'language',verbatimText:'英语工作交流'})
    const strategy = buildAdaptiveStrategy(input)
    Object.assign(strategy.policy, {hardTotalListItemMax:4,targetBusinessBulletTarget:2,targetBusinessBulletMin:1})
    const plan = buildDeterministicV5ResumePlan({...input,...strategy,preserveWorkCoverage:true})
    const selected = new Set([...plan.stableCoreEvidenceIds,...plan.customizedEvidenceIds])
    expect(plan.scopePlans.find(s=>s.scopeId===input.atom.sourceScopeId)?.bulletBudget).toBe(1)
    expect(input.resume.evidenceAtoms.filter(a=>a.claimType==='language'&&selected.has(a.evidenceId))).toHaveLength(2)
  })

  test('entry planning reserves a real action for a lower-ranked job before expanding the strongest job', () => {
    const input = fixture('复核报销凭证并核对银行回单。', '复核', '财务专员', 'responsibility')
    const first = input.resume.timeline[0]
    for (let index = 0; index < 6; index++) {
      const atom = { ...input.atom, evidenceId: `extra-${index}`,
        sourceScopeId: `high-ranked-project-${index}`,
        verbatimText: `复核采购凭证并形成第${index + 1}版报告。` }
      input.resume.evidenceAtoms.push(atom)
      input.resume.timeline.push({ ...first, kind: 'project', scopeId: atom.sourceScopeId, evidenceIds: [atom.evidenceId] })
    }
    const old = { ...input.atom, evidenceId: 'earlier-work-action', sourceScopeId: 'earlier-work',
      verbatimText: '复核售后退款凭证并记录处理进度。' }
    input.resume.evidenceAtoms.push(old)
    input.resume.timeline.push({ ...first, scopeId: old.sourceScopeId, start: '2020', end: '2021', evidenceIds: [old.evidenceId] })
    const strategy = buildAdaptiveStrategy(input)
    strategy.policy.targetBusinessBulletTarget = 4
    strategy.policy.hardProjectMax = 6
    const targetingScores = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom.evidenceId === old.evidenceId ? 0 : 100]))
    const legacy = buildDeterministicV5ResumePlan({ ...input, ...strategy, targetingScores })
    expect(legacy.scopePlans.find(s => s.scopeId === old.sourceScopeId)?.selectedEvidenceIds).toEqual([])
    const before = structuredClone(input.resume)
    const plan = buildDeterministicV5ResumePlan({ ...input, ...strategy, targetingScores, preserveWorkCoverage: true })
    expect(plan.scopePlans.find(s => s.scopeId === old.sourceScopeId)).toMatchObject({ treatment: 'compress', selectedEvidenceIds: [old.evidenceId], bulletBudget: 1 })
    expect(plan.scopePlans.reduce((sum, scope) => sum + scope.bulletBudget, 0)).toBeLessThanOrEqual(4)
    expect(input.resume).toEqual(before)
  })

  test.each(['处理及时率由30%提升至', '差错率从8%降低至。', 'Increased conversion from 5% to'])('does not select an unfinished numeric comparison: %s', text => {
    const input = fixture(text, null, '业务专员', 'result')
    expect(buildEvidencePlanningCatalog(input.resume).assessments.get(input.atom.evidenceId)?.allowedUses).toEqual([])
  })

  test.each(CASES)('retains $role actions through the actual plan and local Writer compiler', ({ role, text, verb }) => {
    const input = fixture(text, verb, role)
    const before = structuredClone(input.resume)
    const catalog = buildEvidencePlanningCatalog(input.resume)
    expect(catalog.businessAnchorEvidenceIds).toContain(input.atom.evidenceId)
    const strategy = buildAdaptiveStrategy(input)
    const plan = buildDeterministicV5ResumePlan({ ...input, ...strategy })
    expect(plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds)).toContain(input.atom.evidenceId)
    const writingPlan = buildWritingPlan({ ...input, plan, policy: strategy.policy })
    expect(writingPlan.facts.map(fact => fact.evidenceId)).toContain(input.atom.evidenceId)
    const composition = { contractVersion: 'p06-composition-v1', blocks: writingPlan.blueprint.slots.map(slot => ({
      slotId: slot.slotId, evidenceIds: writingPlan.coreEvidenceIdsBySlot[slot.slotId] ?? [input.atom.evidenceId], text,
    })) }
    const { artifact } = compileWritingArtifact({ ...input, plan, policy: strategy.policy, writingPlan, composition })
    expect(artifact.markdown).toContain(text)
    expect(input.resume).toEqual(before)
  })

  test('retains source-anchored responsibility without requiring sentence punctuation', () => {
    const input = fixture('复核报销凭证并核对银行回单', '复核', '财务专员', 'responsibility')
    expect(buildEvidencePlanningCatalog(input.resume).businessAnchorEvidenceIds).toContain(input.atom.evidenceId)
  })

  test.each([
    ['销售专员', '拜访目标客户并签订供货协议', '拜访'],
    ['客服专员', '受理售后申诉并记录处理进度', '受理'],
    ['Accountant', 'Audited expense receipts against bank records', 'Audited'],
    ['客户经理', '目标客户沟通中洽谈合作条款。', '洽谈'],
    ['审计专员', '稽核采购成本', '稽核'],
    ['客户经理', '与不同区域客户洽谈合作条款。', '洽谈'],
    ['财务专员', '在不增加成本的条件下复核报销凭证。', '复核'],
    ['客服专员', '在不影响营业的前提下受理客户退款。', '受理'],
    ['产品设计师', '尚未上线的原型上完成可用性测试。', '完成'],
    ['研究助理', '未商业化的课题中编码访谈资料。', '编码'],
    ['Customer Service', 'Reviewed cases without delay and processed refunds.', 'processed'],
  ])('accepts a source predicate for %s without treating headings or metric nouns as universal exclusions', (role, text, verb) => {
    const input = fixture(text, verb, role, 'responsibility')
    expect(buildEvidencePlanningCatalog(input.resume).businessAnchorEvidenceIds).toContain(input.atom.evidenceId)
  })

  test.each([
    ['title', '业务专员', '业务'],
    ['heading', '# 洽谈客户合作条款', '洽谈'],
    ['tool-list', 'Excel、Word', 'Excel'],
    ['skill-label', '工具：Excel，熟练操作办公软件。', '操作'],
    ['proficiency', '熟悉复核凭证的方法。', '复核'],
    ['english-proficiency', 'Skilled in SQL and Excel.', 'led'],
    ['english-substring', 'The company-owned workflow.', 'owned'],
    ['noun-metadata', '研究参与者', '参与'],
    ['context', '项目背景：需要洽谈更多客户。', '洽谈'],
    ['objective', '目标：洽谈新的渠道客户。', '洽谈'],
    ['fragment', '洽谈客户合作条款，', '洽谈'],
    ['bare-verb', '洽谈', '洽谈'],
    ['bare-known-verb', '负责', '负责'],
    ['editorial', '洽谈合作条款；投递前需要确认。', '洽谈'],
    ['non-source-verb', '客户沟通记录与合同条款。', '签订'],
    ['negated', '从未洽谈客户合作条款。', '洽谈'],
    ['negated-known', '此前未独立负责系统上线。', '负责'],
    ['negated-in-unreleased-context', '没有在尚未上线的原型上完成可用性测试。', '完成'],
    ['negated-after-unreleased-context', '尚未上线的原型上未完成可用性测试。', '完成'],
    ['negated-english', 'Never audited expense receipts.', 'audited'],
  ])('does not promote %s to a business anchor', (_kind, text, verb) => {
    const input = fixture(text, verb)
    expect(buildEvidencePlanningCatalog(input.resume).businessAnchorEvidenceIds).not.toContain(input.atom.evidenceId)
  })

  test.each(['excluded', 'conflicting', 'future_or_planned', 'sensitive_pii', 'prompt_injection_like_text'] as const)(
    'does not bypass %s with a source-anchored action', risk => {
      const input = fixture('复核报销凭证并核对银行回单。', '复核')
      if (risk === 'excluded') input.atom.status = 'excluded'
      else input.atom.riskFlags.push(risk)
      const before = structuredClone(input.resume)
      expect(buildEvidencePlanningCatalog(input.resume).businessAnchorEvidenceIds).not.toContain(input.atom.evidenceId)
      expect(input.resume).toEqual(before)
    }
  )

  test('qualified complete actions stay usable without upgrading source status or attribution', () => {
    const input = fixture('协助复核报销凭证并核对银行回单。', '复核')
    input.atom.status = 'source_qualified'; input.atom.attributionLevel = 'supported'; input.atom.riskFlags = ['uncertain']
    const before = structuredClone(input.resume)
    expect(buildEvidencePlanningCatalog(input.resume).assessments.get(input.atom.evidenceId)).toMatchObject({
      standaloneClass: 'anchor', quality: 'usable',
    })
    expect(input.resume).toEqual(before)
  })

  test('skill and metadata annotations remain non-business even when their verb occurs in source', () => {
    for (const kind of ['skill', 'other'] as const) {
      const input = fixture('复核报销凭证的方法。', '复核', '业务专员', kind)
      expect(buildEvidencePlanningCatalog(input.resume).businessAnchorEvidenceIds).not.toContain(input.atom.evidenceId)
    }
  })

  test('missing or invalid novel verb annotations remain supplemental rather than inferring a new action', () => {
    for (const verb of [null, '不存在的动词', '复核报销凭证。']) {
      const input = fixture('复核报销凭证。', verb)
      expect(buildEvidencePlanningCatalog(input.resume).businessAnchorEvidenceIds).not.toContain(input.atom.evidenceId)
    }
  })
})
