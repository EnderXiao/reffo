import { expect, test } from 'bun:test'
import { calculateV5MatchScore } from '@/v5/match-score'
import type { JobFitMap } from '@/v5/targeting/contracts'
import { coreTaskEvidence, projectLegacyMatch, sourcePracticeStrengths, targetingEvidenceScores, validateJobFitMap } from '@/v5/targeting/fit'
import { planJobFitRepair } from '@/v5/targeting/fit-repair'
import { buildRequirementJudgments } from '@/v5/targeting/judgments'
import { createTargetingFixture } from './targeting-fixtures'

function fixture() {
  const f = createTargetingFixture()
  const fit: JobFitMap = {contractVersion: 'job-fit-map-v2', links: f.targets.map(target => ({
    targetId: target.id, status: 'unknown', evidenceIds: [f.business.evidenceId],
    similarity: '已有局部产品交付实践。', difference: '当前材料尚不足以判断该项完整要求。', expressionAngle: '',
    supportedAspects: [{text: f.business.verbatimText, evidenceIds: [f.business.evidenceId]}],
    unprovenAspects: [], roleBoundary: '', supportRelation: null,
  })), narratives: [], questions: []}
  return {...f, fit}
}

test('unknown judgments retain their original source references and validate idempotently', () => {
  const f = fixture(), original = structuredClone(f.fit)
  const first = validateJobFitMap(f.fit, f.targets, f.resume)
  expect(first.passed).toBe(true)
  const second = validateJobFitMap(first.value!, f.targets, f.resume)
  expect(second.passed).toBe(true)
  expect(second.value).toEqual(first.value)
  expect(second.value!.links.map(link => ({status: link.status, evidenceIds: link.evidenceIds, supportedAspects: link.supportedAspects})))
    .toEqual(original.links.map(link => ({status: link.status, evidenceIds: link.evidenceIds, supportedAspects: link.supportedAspects})))
  expect(f.fit).toEqual(original)
})

test('unknown references neither certify requirements nor earn matching or writing-selection scores', () => {
  const f = fixture(), checked = validateJobFitMap(f.fit, f.targets, f.resume).value!
  const judgments = buildRequirementJudgments(checked, f.job, f.resume)
  expect(judgments.items.length).toBeGreaterThan(0)
  expect(judgments.items.every(item => item.status === 'unproven' && item.supportRelation === null)).toBe(true)
  expect(judgments.items.every(item => item.supportedAspects.length > 0 && item.evidenceIds.includes(f.business.evidenceId))).toBe(true)
  expect(targetingEvidenceScores(checked, f.targets, f.resume).size).toBe(0)
  expect(coreTaskEvidence(checked, f.targets, f.resume).size).toBe(0)
  expect(sourcePracticeStrengths(checked, f.targets, f.resume)).toEqual([])
  expect(checked.narratives).toEqual([])
  const match = projectLegacyMatch(checked, f.targets, f.resume, f.job)
  const score = calculateV5MatchScore({resume: f.resume, job: f.job, match})
  expect(score.score).toBeNull()
  expect(score.components.every(component => component.earned === 0)).toBe(true)
})

test('unknown judgments without evidence cannot acquire source references or aspects', () => {
  const f = fixture()
  f.fit.links.forEach(link => {link.evidenceIds = []; link.supportedAspects = []})
  const first = validateJobFitMap(f.fit, f.targets, f.resume)
  const second = validateJobFitMap(first.value!, f.targets, f.resume)
  expect(first.passed).toBe(true)
  expect(second.passed).toBe(true)
  expect(second.value).toEqual(first.value)
  expect(second.value!.links.every(link => !link.evidenceIds.length && !link.supportedAspects!.length)).toBe(true)
})

test('an unknown job assumption clears both references and dependent aspects idempotently', () => {
  const f = fixture()
  f.targets[0]!.basis = 'unknown'
  f.fit.links[0]!.status = 'direct'
  const first = validateJobFitMap(f.fit, f.targets, f.resume)
  expect(first.passed).toBe(true)
  expect(first.value!.links[0]).toMatchObject({status: 'unknown', evidenceIds: [], supportedAspects: []})
  const second = validateJobFitMap(first.value!, f.targets, f.resume)
  expect(second.passed).toBe(true)
  expect(second.value).toEqual(first.value)
})

test.each(['outside_link', 'unknown_source'] as const)('unknown judgments still reject invalid aspect evidence: %s', mutation => {
  const f = fixture(), link = f.fit.links[0]!
  link.supportedAspects![0]!.evidenceIds = [mutation === 'outside_link' ? f.skill.evidenceId : 'not_source_evidence']
  if (mutation === 'unknown_source') link.evidenceIds = ['not_source_evidence']
  const checked = validateJobFitMap(f.fit, f.targets, f.resume)
  expect(checked.passed).toBe(false)
  expect(checked.issues.some(issue => issue.severity === 'error'
    && issue.code === (mutation === 'outside_link' ? 'JOB_FIT_ASPECT_EVIDENCE_INVALID' : 'JOB_FIT_EVIDENCE_INVALID'))).toBe(true)
})

test('an unsupported explicit-gap downgrade preserves its source references on later validation', () => {
  const f = fixture()
  f.fit.links[0]!.status = 'explicit_gap'
  const first = validateJobFitMap(f.fit, f.targets, f.resume)
  expect(first.passed).toBe(true)
  expect(first.value!.links[0]!.status).toBe('unknown')
  expect(first.value!.links[0]!.evidenceIds).toEqual([f.business.evidenceId])
  expect(first.issues.some(issue => issue.code === 'JOB_FIT_UNPROVEN_GAP_ALIGNED')).toBe(true)
  const second = validateJobFitMap(first.value!, f.targets, f.resume)
  expect(second.passed).toBe(true)
  expect(second.value).toEqual(first.value)
})

test('rechecking a normalized draft does not add an unknown judgment to another target repair scope', () => {
  const f = fixture(), targets = f.targets.slice(0, 2)
  f.fit.links = f.fit.links.slice(0, 2)
  f.fit.links[1]!.evidenceIds = ['not_source_evidence']
  f.fit.links[1]!.supportedAspects = []
  const checked = validateJobFitMap(f.fit, targets, f.resume)
  expect(checked.passed).toBe(false)
  const plan = planJobFitRepair({current: checked.value, schemaValidated: true, issues: checked.issues, targets, resume: f.resume})
  expect(plan.rebuild).toBe(false)
  expect(plan.targets.map(target => target.id)).toEqual([targets[1]!.id])
  expect(plan.issues.some(issue => issue.code === 'JOB_FIT_ASPECT_EVIDENCE_INVALID')).toBe(false)
})
