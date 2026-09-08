import { expect, test } from 'bun:test'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { buildTaskEvidenceLinks, buildTaskRelevanceLinks, writingLinkRelation } from '@/v5/writing/task-support'
import { buildWritingThemes } from '@/v5/writing/themes'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { targetingEvidenceScores, validateJobFitMap } from '@/v5/targeting/fit'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'

function fixture() {
  const f = createTargetingFixture()
  f.business.riskFlags = []
  const task: JobTarget = { id: 'task:model-eval', kind: 'task', text: '模型效果评估',
    priority: 'core', basis: 'explicit', taskIds: ['task:model-eval'], requirementIds: [] }
  const attribute: JobTarget = { ...task, id: 'attribute:collaboration', kind: 'attribute', text: '跨团队协作能力' }
  const link: JobFitMap['links'][number] = { targetId: attribute.id, status: 'direct',
    evidenceIds: [f.business.evidenceId], similarity: '有协作发布实践。', difference: '未提供模型效果评估实践。', expressionAngle: '突出协作。' }
  return { ...f, targets: [task, attribute], fit: { ...f.fit, links: [link], narratives: [], questions: [] }, task, attribute, link }
}

test('related attributes and compound requirements never certify their associated tasks', () => {
  const f = fixture(), before = structuredClone(f)
  expect(buildTaskEvidenceLinks(f).size).toBe(0)
  expect(writingLinkRelation(f.link, f.attribute)).toBe('related_context')
  expect(targetingEvidenceScores(f.fit, f.targets, f.resume).has(f.business.evidenceId)).toBe(true)
  f.targets[1].kind = 'requirement'
  expect(buildTaskEvidenceLinks(f).size).toBe(0)
  f.targets[1].kind = 'attribute'
  expect(f).toEqual(before)
})

test.each(['direct', 'transferable'] as const)('retains an independently supported %s task without spreading sibling IDs', status => {
  const f = fixture()
  f.task.taskIds.push('task:unrelated')
  f.fit.links = [{ ...f.link, targetId: f.task.id, status }]
  expect([...buildTaskEvidenceLinks(f).get(f.business.evidenceId)!]).toEqual([f.task.id])
  expect(writingLinkRelation(f.fit.links[0], f.task)).toBe(`${status}_task_evidence`)
})

test('partial task evidence stays selectable and labeled partial, never upgraded into supported task IDs', () => {
  const f = fixture()
  f.fit.links = [{ ...f.link, targetId: f.task.id, status: 'weak_signal' }]
  expect(buildTaskEvidenceLinks(f).size).toBe(0)
  expect(targetingEvidenceScores(f.fit, f.targets, f.resume).has(f.business.evidenceId)).toBe(true)
  expect(writingLinkRelation(f.fit.links[0], f.task)).toBe('partial_task_evidence')
  expect(buildTaskRelevanceLinks(f).get(f.business.evidenceId)?.has(f.task.id)).toBe(true)
})

test('removing false proof labels does not suppress a relevant partial-practice theme in favor of generic duties', () => {
  const f = fixture(), r = createV5ResultFixture()
  const p = buildWritingPlan({ resume: r.resumeEvidenceBundle, plan: r.resumePlan,
    policy: r.generationPolicy, match: r.matchAnalysis, job: r.jobRequirementBundle })
  const base = p.facts.find(fact => fact.claimType === 'deliverable')!
  const practice = { ...base, evidenceId: 'partial', claimType: 'action' as const, text: '设计模型效果评估指标，尚未完成评测。' }
  const duty = { ...base, evidenceId: 'duty', claimType: 'responsibility' as const, text: '负责协作和方案整理。' }
  const themes = buildWritingThemes({ facts: [practice, duty], blueprint: p.blueprint,
    targets: f.targets, mode: 'skill', limit: 1, taskLinks: new Map(),
    relevanceTaskLinks: new Map([[practice.evidenceId, new Set([f.task.id])]]) })
  expect(themes[0].anchorEvidenceId).toBe(practice.evidenceId)
  expect(themes[0].targetTaskIds).toEqual([])
})

test.each(['unknown', 'explicit_gap', 'conflicted'] as const)('does not claim task support from %s', status => {
  const f = fixture()
  f.fit.links = [{ ...f.link, targetId: f.task.id, status }]
  expect(buildTaskEvidenceLinks(f).size).toBe(0)
  expect(writingLinkRelation(f.fit.links[0], f.task)).toBe('unproven')
})

test('unknown targets and excluded facts cannot acquire supported task IDs', () => {
  const f = fixture()
  f.fit.links = [{ ...f.link, targetId: f.task.id }]
  f.task.basis = 'unknown'
  expect(buildTaskEvidenceLinks(f).size).toBe(0)
  f.task.basis = 'explicit'; f.business.status = 'excluded'
  expect(buildTaskEvidenceLinks(f).size).toBe(0)
})

test('real model evaluation practice remains directly supported after validation', () => {
  const f = fixture()
  f.business.verbatimText = '构建模型评测集，与研发对比模型效果评估结果并记录错误类型。'
  f.business.normalizedClaim = f.business.verbatimText
  f.business.claimType = 'action'
  f.fit.links = [{ ...f.link, targetId: f.task.id, difference: '评估场景与岗位业务不同。' }]
  const checked = validateJobFitMap(f.fit, f.targets, f.resume)
  expect(checked.passed).toBe(true)
  expect(checked.value!.links.find(l => l.targetId === f.task.id)?.status).toBe('direct')
  expect([...buildTaskEvidenceLinks({ ...f, fit: checked.value! }).get(f.business.evidenceId)!]).toEqual([f.task.id])
})

test('reports related-task uncertainty without rejecting generation, changing status or erasing practice', () => {
  const f = fixture(), before = structuredClone(f.fit)
  const result = validateJobFitMap(f.fit, f.targets, f.resume)
  expect(result.passed).toBe(true)
  expect(result.issues.some(i => i.code === 'JOB_FIT_RELATED_TASK_UNPROVEN' && i.severity === 'warning')).toBe(true)
  expect(result.value!.links.find(l => l.targetId === f.attribute.id)?.status).toBe('direct')
  expect(result.value!.links.find(l => l.targetId === f.attribute.id)?.evidenceIds).toEqual(f.link.evidenceIds)
  expect(f.fit).toEqual(before)
  const again = validateJobFitMap(result.value!, f.targets, f.resume)
  expect(again.value).toEqual(result.value)
  f.fit.links.push({ ...f.link, targetId: f.task.id, status: 'transferable' })
  expect(validateJobFitMap(f.fit, f.targets, f.resume).issues.some(i => i.code === 'JOB_FIT_RELATED_TASK_UNPROVEN')).toBe(false)
})

test('actual Writer plan uses scoped task support while retaining related and partial source material', () => {
  const f = fixture(), r = createV5ResultFixture()
  for (const status of ['direct', 'weak_signal'] as const) {
    f.fit.links = [{ ...f.link, status }]
    const p = buildWritingPlan({ resume: f.resume, job: f.job, match: r.matchAnalysis, plan: r.resumePlan,
      policy: r.generationPolicy, targeting: { profile: f.candidate.jobSuccessProfile, targets: f.targets, fit: f.fit },
      editorialPolicy: 'document-editorial-v1' })
    expect(p.facts.some(fact => fact.evidenceId === f.business.evidenceId)).toBe(true)
    expect(p.summaryThemes?.flatMap(t => t.targetTaskIds) ?? []).not.toContain(f.task.id)
    expect(Object.values(p.skillThemes ?? {}).flatMap(t => t.targetTaskIds)).not.toContain(f.task.id)
    expect(Object.values(p.editorial?.slots ?? {}).flatMap(t => t.targetTaskIds)).not.toContain(f.task.id)
    const payload = writingPayload(p)
    expect(payload.jobTargeting?.taskSupportPolicy).toBe('independent-task-evidence-v1')
    expect(payload.jobTargeting?.links[0].relation).toBe('related_context')
    expect(payload.jobTargeting?.links[0].status).toBe(status)
    expect(payload.jobTargeting?.editorialIntents?.[0].difference).toBe(f.link.difference)
    // Historical plans must not acquire a new policy label merely by being serialized.
    const historical = structuredClone(p)
    delete historical.taskSupportPolicy
    const historicalPayload = writingPayload(historical)
    expect(historicalPayload.jobTargeting).not.toHaveProperty('taskSupportPolicy')
    expect(historicalPayload.jobTargeting?.links[0]).not.toHaveProperty('relation')
  }
})
