import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildResumeExtractionScopePlan } from '@/v5/chunked-resume-extraction'
import { buildEvidencePlanningCatalog } from '@/v5/evidence-routing'
import { buildTargetEvidenceScores, duplicateTimelineOnlyScopes, hasHighValueEvidenceRole } from '@/v5/planning-quality'
import { sourceBusinessDisplayText } from '@/v5/composition/source-display'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import { materializeDslComposition } from '@/v5/composition/dsl'
import { compileCompositionArtifact } from '@/v5/composition/compiler'
import { buildDeterministicV5ResumePlan, validateGeneratedResumeArtifact, validateV5ResumePlan } from '@/v5/validators'
import { createMatchFixture } from './fixtures'
import type { EvidenceAtom } from '@/v5/types'

function fixture(texts: string[]) {
  const input = createMatchFixture()
  let position = 1000
  const atoms = texts.map((text, index) => {
    const atom: EvidenceAtom = { ...structuredClone(input.deliverable), evidenceId: `quality_${index}`,
      sourceBlockId: `B${String(index + 100).padStart(4, '0')}`,
      sourceSpan: { start: position, end: position + text.length },
      verbatimText: text, normalizedClaim: text, sourceActionVerb: null,
      qualifiers: [], numericAtoms: [], riskFlags: [],
    }
    position = atom.sourceSpan.end + 1
    return atom
  })
  input.resume.evidenceAtoms = input.resume.evidenceAtoms.filter(atom => atom.claimType !== 'deliverable').concat(atoms)
  input.resume.timeline[0].evidenceIds = input.resume.timeline[0].evidenceIds.filter(id => id !== input.deliverable.evidenceId).concat(atoms.map(atom => atom.evidenceId))
  input.match.requirementMatches.forEach(match => { match.evidenceIds = match.evidenceIds.flatMap(id => id === input.deliverable.evidenceId ? atoms.map(atom => atom.evidenceId) : [id]) })
  return { ...input, atoms }
}

describe('V5 product-quality regressions', () => {
  test('action labels do not suppress real actions and role titles do not count as achievements', () => {
    const input = fixture(['中级产品经理；营运管理系统与员工运营工具', '关键动作参与团队设计知识检索流程，完成原型。'])
    const catalog = buildEvidencePlanningCatalog(input.resume)
    expect(catalog.businessAnchorEvidenceIds).not.toContain(input.atoms[0].evidenceId)
    expect(catalog.businessAnchorEvidenceIds).toContain(input.atoms[1].evidenceId)
  })

  test('source-qualified complete actions remain qualified, while editorial and ambiguous text stay out', () => {
    const input = fixture(['参与团队访谈20位用户并形成研究报告。', '关键动作可能负责系统设计，个人职责需确认。', 'PRD已交叉验证部分需求分析与方案'])
    input.atoms.forEach(atom => { atom.status = 'source_qualified'; atom.riskFlags = ['uncertain'] })
    const before = structuredClone(input.resume)
    const catalog = buildEvidencePlanningCatalog(input.resume)
    expect(catalog.businessAnchorEvidenceIds).toEqual([input.atoms[0].evidenceId])
    expect(input.resume).toEqual(before)
  })

  test('display cleanup retains contribution, numeric qualifiers and the not-launched boundary', () => {
    expect(sourceBusinessDisplayText('关键动作参与团队服务设计，覆盖400+份材料。')).toBe('参与团队服务设计，覆盖400+份材料。')
    expect(sourceBusinessDisplayText('结果/边界完成原型；未真实开发上线，不写商业收益或规模化结果。')).toBe('完成原型；未真实开发上线。')
    expect(sourceBusinessDisplayText('从未负责平台上线。')).toBe('从未负责平台上线。')
  })

  test('DSL closes a proven genitive continuation and final proof rejects loss of negation', () => {
    const input = fixture(['关键动作参与团队统一任务与OA', '的传达边界，形成配置原型；未上线。'])
    input.atoms.forEach(atom => { atom.status = 'source_qualified' })
    const strategy = buildAdaptiveStrategy(input)
    const plan = buildDeterministicV5ResumePlan({ ...input, ...strategy })
    const blueprint = buildCompositionBlueprint({ ...input, plan, policy: strategy.policy })
    const composition = materializeDslComposition({ ...input, plan, blueprint,
      dsl: { contractVersion: 'p06-dsl-v1', blocks: blueprint.slots.map(slot => ({
        slotId: slot.slotId, operations: [{ op: 'emit_atom', evidenceId: slot.allowedEvidenceIds[0] }], joiner: 'none',
      })) },
    })
    expect(composition.passed).toBe(true)
    const { artifact } = compileCompositionArtifact({ ...input, blueprint, plan, policy: strategy.policy, composition: composition.value })
    expect(artifact.markdown).toContain('参与团队统一任务与OA的传达边界，形成配置原型；未上线。')
    expect(validateGeneratedResumeArtifact({ ...input, plan, policy: strategy.policy, artifact }).passed).toBe(true)
    artifact.markdown = artifact.markdown.replaceAll('未上线', '已上线')
    artifact.claims.forEach(claim => { claim.outputText = claim.outputText.replaceAll('未上线', '已上线') })
    expect(validateGeneratedResumeArtifact({ ...input, plan, policy: strategy.policy, artifact }).passed).toBe(false)
  })

  test('does not promote a dangling continuation across a missing block or another scope', () => {
    for (const mode of ['gap', 'scope'] as const) {
      const input = fixture(['统一任务与OA', '的传达边界，完成原型。'])
      if (mode === 'gap') input.atoms[1].sourceBlockId = 'B0102'
      else input.atoms[1].sourceScopeId = 'other_job'
      expect(buildEvidencePlanningCatalog(input.resume).businessAnchorEvidenceIds).not.toContain(input.atoms[1].evidenceId)
    }
  })

  test('split rate labels and values cannot independently satisfy a result quota', () => {
    const input = fixture(['支持20种流程，系统替代率', '62.5%；按时完成率提升至86%，仍受运营推动影响。'])
    input.atoms.forEach(atom => { atom.claimType = 'result'; atom.status = 'source_qualified'; atom.riskFlags = ['uncertain'] })
    const before = structuredClone(input.resume)
    const catalog = buildEvidencePlanningCatalog(input.resume)
    expect(catalog.businessAnchorEvidenceIds).toEqual([])
    input.atoms.forEach(atom => expect(catalog.assessments.get(atom.evidenceId)?.reasonCodes).toContain('adjacent_metric_split'))
    expect(input.resume).toEqual(before)
  })

  test('recognizes compound outcomes without changing model labels or counting activity volume as impact', () => {
    const input = fixture(['推动3项功能上线；个人材料记录日活20K。', '参与20次访谈并形成研究报告。'])
    input.atoms.forEach(atom => { atom.claimType = 'action' })
    expect(hasHighValueEvidenceRole(input.atoms[0], 'result')).toBe(true)
    expect(hasHighValueEvidenceRole(input.atoms[0], 'deliverable')).toBe(true)
    expect(hasHighValueEvidenceRole(input.atoms[1], 'result')).toBe(false)
    expect(hasHighValueEvidenceRole(input.atoms[1], 'deliverable')).toBe(true)
    expect(input.atoms[0].claimType).toBe('action')
  })

  test('high-value gate checks omissions within selected scopes and still detects actual lost outcomes', () => {
    const input = fixture(['参与团队设计并交付原型。', '参与系统优化，完成率提升至86%。'])
    input.atoms[1].claimType = 'result'
    const strategy = buildAdaptiveStrategy(input)
    strategy.policy.targetBusinessBulletTarget = 4
    const plan = buildDeterministicV5ResumePlan({ ...input, ...strategy })
    const removedId = input.atoms[1].evidenceId
    plan.scopePlans.forEach(scope => { scope.selectedEvidenceIds = scope.selectedEvidenceIds.filter(id => id !== removedId) })
    const codes = () => validateV5ResumePlan({ ...input, ...strategy, plan }).issues.map(item => item.code)
    expect(codes()).toContain('PLAN_HIGH_VALUE_TYPE_OMITTED')
    input.atoms[1].sourceScopeId = 'unselected_project'
    input.resume.timeline.push({ ...input.resume.timeline[0], scopeId: 'unselected_project', kind: 'project', evidenceIds: [removedId] })
    expect(codes()).not.toContain('PLAN_HIGH_VALUE_TYPE_OMITTED')
    input.atoms[1].sourceScopeId = input.atoms[0].sourceScopeId
    input.atoms[0].verbatimText += '系统日活20K。'
    expect(codes()).not.toContain('PLAN_HIGH_VALUE_TYPE_OMITTED')
  })

  test('source project-card titles own their body, while dates, paper metadata and metric periods do not create scopes', () => {
    const document = canonicalizeSourceDocument([
      '## 项目经历', '智能辅导平台', '2026. 08最新项目资料', '背景：帮助一线员工', '关键动作设计检索原型。',
      '完成率 | 2025.01-2026.06', '服务共创规划', '硕士毕业论文 | 100页 | 概念验证', '背景：服务断点', '关键动作参与共创。',
    ].join('\n')).canonicalDocument
    const scopes = buildResumeExtractionScopePlan(document)
    const scopeAt = (index: number) => scopes.scopeBySourceBlockId.get(document.blocks[index].sourceBlockId)
    expect(scopeAt(1)).toBeDefined()
    expect(scopeAt(1)).toBe(scopeAt(2))
    expect(scopeAt(1)).toBe(scopeAt(5))
    expect(scopeAt(6)).toBe(scopeAt(7))
    expect(scopeAt(6)).toBe(scopeAt(9))
    expect(scopeAt(1)).not.toBe(scopeAt(6))
  })

  test('distinctive target-role evidence outranks generic keyword density without altering matching facts', () => {
    const input = fixture(['参与AI辅导场景设计，形成知识检索原型。', '负责产品业务管理、市场分析、竞品调研和跨团队合作。'])
    input.job.basicInfo.title = 'AI产品经理'
    const before = structuredClone(input.match)
    const scores = buildTargetEvidenceScores(input.resume, input.job)
    expect(scores.get(input.atoms[0].evidenceId)!).toBeGreaterThan(scores.get(input.atoms[1].evidenceId)!)
    expect(input.match).toEqual(before)
  })

  test('summary offers exactly one source-scoped unit rather than the entire cross-scope body', () => {
    const input = fixture(['参与AI辅导流程设计并形成原型。', '参与其他产品需求分析并完成交付。'])
    input.job.basicInfo.title = 'AI产品经理'
    const strategy = buildAdaptiveStrategy(input)
    const plan = buildDeterministicV5ResumePlan({ ...input, ...strategy })
    const blueprint = buildCompositionBlueprint({ ...input, plan, policy: strategy.policy })
    const summary = blueprint.slots.find(slot => slot.kind === 'summary')!
    expect(summary.allowedEvidenceIds).toEqual([input.atoms[0].evidenceId])
    expect(summary.scopeId).toBe(input.atoms[0].sourceScopeId)
    expect(blueprint.requiredBodyEvidenceIds).toContain(input.atoms[0].evidenceId)
    expect(blueprint.requiredBodyEvidenceIds).toContain(input.atoms[1].evidenceId)
  })

  test('suppresses a metadata-only duplicate but preserves a distinct period at the same company', () => {
    const input = fixture(['参与团队产品设计并交付原型。'])
    const detail = input.resume.timeline[0]
    detail.organization = '示例公司股份有限公司'; detail.start = '2024. 07'; detail.end = '2025.06'
    const overview = { ...detail, scopeId: 'overview', organization: '示例公司', start: '2024.07', title: '产品经理；会员运营', evidenceIds: [] }
    const earlier = { ...overview, scopeId: 'earlier', start: '2022.07', end: '2024.07' }
    input.resume.timeline.push(overview, earlier)
    expect([...duplicateTimelineOnlyScopes(input.resume, new Set([detail.scopeId]))]).toEqual(['overview'])
    expect(input.atoms[0].sourceScopeId).toBe(detail.scopeId)
  })

  test('never suppresses an unselected substantive role merely because its timeline matches another job', () => {
    const input = fixture(['参与团队产品设计并交付原型。'])
    const detail = input.resume.timeline[0]
    const parallel = { ...detail, scopeId: 'parallel_role', evidenceIds: ['parallel_action'] }
    input.resume.timeline.push(parallel)
    input.resume.evidenceAtoms.push({ ...input.atoms[0], evidenceId: 'parallel_action', sourceScopeId: parallel.scopeId })
    expect([...duplicateTimelineOnlyScopes(input.resume, new Set([detail.scopeId]))]).toEqual([])
  })
})
