import { describe, expect, test } from 'bun:test'
import { createDigest } from '@/harness/run-context'
import { V5_ACCEPTANCE_CRITERIA } from '@/v5/acceptance/criteria'
import { acceptanceCohortDigest, evaluateV5Acceptance, type V5AcceptanceInput } from '@/v5/acceptance/evaluate'
import { evaluateV5TargetedAcceptance, JOB_TARGETED_ACCEPTANCE_CRITERIA, type V5TargetedAssessment } from '@/v5/acceptance/targeted-evaluate'

// Arithmetic-only test data. These fictional records are never exported as a real acceptance cohort.
function fictionalRecords() {
  const base: V5AcceptanceInput = {
    criteriaVersion: V5_ACCEPTANCE_CRITERIA.version, frozenCohortSha256: createDigest('pending'),
    candidateVersionSha256: createDigest('candidate'), baselineVersionSha256: createDigest('baseline'),
    cases: [], runs: [], reviews: [],
  }
  const targeted: V5TargetedAssessment = { criteriaVersion: JOB_TARGETED_ACCEPTANCE_CRITERIA.version,
    candidateVersionSha256: base.candidateVersionSha256, rubricSignoffRecordSha256: createDigest('signed rubric'), cases: [], multiJobGroups: [] }
  const metrics = { model: 'fixture-model', cacheCondition: 'cold', inputTokens: 1000, outputTokens: 100,
    latencyMs: 1000, physicalCalls: 4, authorizedCallLimit: 6 }
  for (let index = 0; index < 130; index++) {
    const caseId = `fictional-${index}`, real = index < 100, subjectId = `subject-${Math.floor(index / 2)}`
    const inputSha256 = createDigest(`input-${index}`), artifactSha256 = createDigest(`artifact-${index}`)
    const baselineArtifactSha256 = createDigest(`baseline-${index}`)
    const targetingInput = { subjectId, resumeSha256: createDigest(subjectId), jdSha256: createDigest(`jd-${index}`) }
    const targetingAnalysis = { profileSha256: createDigest(`profile-${index}`), fitMapSha256: createDigest(`fit-${index}`) }
    base.cases.push({ caseId, inputSha256, kind: real ? 'real' : 'adversarial', partition: 'held_out', authorized: true,
      requiresDoubleReview: index === 2, strata: { richness: 'sparse', careerStage: 'early', jobDistance: 'adjacent' }, targetingInput })
    base.runs.push({ caseId, inputSha256, execution: real ? 'live' : 'synthetic',
      candidateVersionSha256: base.candidateVersionSha256, baselineVersionSha256: base.baselineVersionSha256,
      outcome: 'first_pass', failureOrigin: null, artifactSha256, baselineArtifactSha256, targetingAnalysis,
      safetyAudit: { recordSha256: createDigest(`audit-${index}`), verified: true, majorIncidents: 0, expectedBehaviorPassed: true },
      candidateMetrics: { ...metrics }, baselineMetrics: { ...metrics } })
    if (!real) continue
    for (let reviewer = 0; reviewer < (index === 2 ? 2 : 1); reviewer++) base.reviews.push({
      caseId, reviewerId: `fixture-reviewer-${reviewer}`, recordSha256: createDigest(`review-${index}-${reviewer}`),
      artifactSha256, baselineArtifactSha256, criteriaVersion: base.criteriaVersion,
      reviewerKind: 'human_recruiter', independent: true, blindedSameRubric: true,
      scores: [25, 20, 15, 10, 10, 10, 10], deliverableWithoutSubstantiveRewrite: true,
      pairwise: 'win', missingCoreEvidenceIds: [], majorIncident: false,
    })
    targeted.cases.push({ caseId, ...targetingInput, ...targetingAnalysis, artifactSha256,
      goldAnnotationRecordSha256: createDigest(`gold-${index}`), reviewRecordSha256: createDigest(`target-review-${index}`),
      reviewerKind: 'human_recruiter', reviewerId: 'fixture-reviewer', independentlyReviewed: true,
      coreTaskReferenceCount: 2, coreTaskPredictedCount: 2, coreTaskCorrectCount: 2,
      fitPredictedSupportedCount: 2, fitCorrectSupportedCount: 2, eligibleCoreTaskCount: 2, representedCoreTaskCount: 2, majorProfileErrors: 0 })
    if (index < 40 && index % 2 === 0) targeted.multiJobGroups.push({ subjectId,
      caseIds: [caseId, `fictional-${index + 1}`], reviewRecordSha256: createDigest(`group-review-${index}`),
      reviewerKind: 'human_recruiter', reviewerId: 'fixture-reviewer', independentlyReviewed: true,
      distinctTasksConfirmed: true, labelsHidden: true, substantiveEvidenceReasonsChecked: true,
      correctlyAttributedCount: 2, majorFactChanges: 0 })
  }
  base.frozenCohortSha256 = acceptanceCohortDigest(base.cases)
  return { base, targeted }
}

describe('offline release assessment arithmetic and provenance', () => {
  test('complete fictional records exercise acceptance arithmetic without real provider or human claims', () => {
    const { base, targeted } = fictionalRecords()
    expect(evaluateV5Acceptance(base)).toMatchObject({ accepted: true, reasons: [], metrics: { realCases: 100, adversarialCases: 30, tokenMedianRatio: 1 } })
    expect(evaluateV5TargetedAcceptance(base, targeted)).toMatchObject({ accepted: true, reasons: [], metrics: { multiJobSubjects: 20, blindJobAttribution: 1 } })
  })
  test.each([
    'cohort_changed', 'version_changed', 'replay', 'zero_calls', 'over_budget', 'missing_audit', 'model_review',
    'unblinded', 'missing_review', 'missing_second_review', 'review_wrong_artifact', 'review_reused',
    'unknown_tokens', 'cache_changed', 'missing_run', 'duplicate_input', 'not_held_out', 'unauthorized',
    'adversarial_wrong_behavior', 'major_incident', 'missing_core', 'token_regression', 'latency_regression', 'review_disagreement',
  ] as const)('cannot pass base acceptance with %s', mutation => {
    const { base } = fictionalRecords()
    if (mutation === 'cohort_changed') base.cases[0].strata.richness = 'rich'
    if (mutation === 'version_changed') base.runs[0].candidateVersionSha256 = createDigest('wrong version')
    if (mutation === 'replay') base.runs[0].execution = 'offline_replay'
    if (mutation === 'zero_calls') base.runs[0].candidateMetrics.physicalCalls = 0
    if (mutation === 'over_budget') base.runs[0].candidateMetrics.physicalCalls = 7
    if (mutation === 'missing_audit') base.runs[0].safetyAudit = null
    if (mutation === 'model_review') base.reviews[0].reviewerKind = 'model'
    if (mutation === 'unblinded') base.reviews[0].blindedSameRubric = false
    if (mutation === 'missing_review') base.reviews = base.reviews.filter(review => review.caseId !== 'fictional-0')
    if (mutation === 'missing_second_review') base.reviews = base.reviews.filter(review => !(review.caseId === 'fictional-2' && review.reviewerId.endsWith('1')))
    if (mutation === 'review_wrong_artifact') base.reviews[0].artifactSha256 = createDigest('wrong artifact')
    if (mutation === 'review_reused') base.reviews[1].recordSha256 = base.reviews[0].recordSha256
    if (mutation === 'unknown_tokens') base.runs[0].candidateMetrics.inputTokens = null
    if (mutation === 'cache_changed') base.runs[0].candidateMetrics.cacheCondition = 'warm'
    if (mutation === 'missing_run') base.runs.shift()
    if (mutation === 'duplicate_input') base.cases[1].inputSha256 = base.cases[0].inputSha256
    if (mutation === 'not_held_out') base.cases[0].partition = 'development'
    if (mutation === 'unauthorized') base.cases[0].authorized = false
    if (mutation === 'adversarial_wrong_behavior') base.runs[100].safetyAudit!.expectedBehaviorPassed = false
    if (mutation === 'major_incident') base.reviews[0].majorIncident = true
    if (mutation === 'missing_core') base.reviews[0].missingCoreEvidenceIds = ['core-1']
    if (mutation === 'token_regression') base.runs.forEach(run => { run.candidateMetrics.inputTokens = 1001 })
    if (mutation === 'latency_regression') base.runs.forEach(run => { run.candidateMetrics.latencyMs = 1001 })
    if (mutation === 'review_disagreement') base.reviews.find(review => review.caseId === 'fictional-2')!.pairwise = 'loss'
    expect(evaluateV5Acceptance(base).accepted).toBe(false)
  })
  test('failed and missing runs stay in the denominator and costs are not silently zeroed', () => {
    const { base } = fictionalRecords()
    base.runs[0] = { ...base.runs[0], outcome: 'failed', artifactSha256: null, failureOrigin: 'provider' }
    base.runs.splice(1, 1)
    const result = evaluateV5Acceptance(base)
    expect(result.accepted).toBe(false)
    expect(result.metrics).toMatchObject({ firstPassRate: .98, boundedSuccessRate: .98, humanDeliverableRate: .98,
      providerFailures: 1, missingRuns: 1, tokenMedianRatio: null })
  })
  test.each([
    'no_signoff', 'wrong_version', 'wrong_input', 'wrong_analysis', 'wrong_artifact', 'model_review', 'missing_review',
    'bad_counts', 'poor_task_precision', 'poor_task_recall', 'poor_fit', 'poor_coverage', 'profile_error',
    'too_few_subjects', 'same_jd', 'same_resume_different_subject', 'unblinded', 'no_reasons', 'reused_group_review',
    'non_independent_group', 'poor_attribution', 'fact_changed', 'no_applicable_evidence',
  ] as const)('cannot pass targeted acceptance with %s', mutation => {
    const { base, targeted } = fictionalRecords()
    if (mutation === 'no_signoff') targeted.rubricSignoffRecordSha256 = null
    if (mutation === 'wrong_version') targeted.candidateVersionSha256 = createDigest('wrong version')
    if (mutation === 'wrong_input') targeted.cases[0].resumeSha256 = createDigest('wrong resume')
    if (mutation === 'wrong_analysis') targeted.cases[0].profileSha256 = createDigest('wrong profile')
    if (mutation === 'wrong_artifact') targeted.cases[0].artifactSha256 = createDigest('wrong artifact')
    if (mutation === 'model_review') targeted.cases[0].reviewerKind = 'model'
    if (mutation === 'missing_review') targeted.cases.pop()
    if (mutation === 'bad_counts') targeted.cases[0].coreTaskCorrectCount = 3
    if (mutation === 'poor_task_precision') targeted.cases.forEach(item => { item.coreTaskPredictedCount = 4 })
    if (mutation === 'poor_task_recall') targeted.cases.forEach(item => { item.coreTaskReferenceCount = 4 })
    if (mutation === 'poor_fit') targeted.cases.forEach(item => { item.fitCorrectSupportedCount = 1 })
    if (mutation === 'poor_coverage') targeted.cases.forEach(item => { item.representedCoreTaskCount = 1 })
    if (mutation === 'profile_error') targeted.cases[0].majorProfileErrors = 1
    if (mutation === 'too_few_subjects') targeted.multiJobGroups.pop()
    if (mutation === 'same_jd') targeted.cases[1].jdSha256 = targeted.cases[0].jdSha256
    if (mutation === 'same_resume_different_subject') for (const index of [2, 3]) {
      targeted.cases[index].resumeSha256 = targeted.cases[0].resumeSha256
      base.cases[index].targetingInput!.resumeSha256 = targeted.cases[0].resumeSha256
      base.frozenCohortSha256 = acceptanceCohortDigest(base.cases)
    }
    if (mutation === 'unblinded') targeted.multiJobGroups[0].labelsHidden = false
    if (mutation === 'no_reasons') targeted.multiJobGroups[0].substantiveEvidenceReasonsChecked = false
    if (mutation === 'reused_group_review') targeted.multiJobGroups[1].reviewRecordSha256 = targeted.multiJobGroups[0].reviewRecordSha256
    if (mutation === 'non_independent_group') targeted.multiJobGroups[0].independentlyReviewed = false
    if (mutation === 'poor_attribution') targeted.multiJobGroups.forEach(group => { group.correctlyAttributedCount = 1 })
    if (mutation === 'fact_changed') targeted.multiJobGroups[0].majorFactChanges = 1
    if (mutation === 'no_applicable_evidence') targeted.cases.forEach(item => { item.eligibleCoreTaskCount = 0; item.representedCoreTaskCount = 0 })
    expect(evaluateV5TargetedAcceptance(base, targeted).accepted).toBe(false)
  })
  test('empty or malformed records never pass and cannot produce a fake perfect percentage', () => {
    expect(evaluateV5Acceptance({}).accepted).toBe(false)
    const { base, targeted } = fictionalRecords()
    base.cases = []; base.runs = []; base.reviews = []; base.frozenCohortSha256 = acceptanceCohortDigest([])
    targeted.cases = []; targeted.multiJobGroups = []
    expect(evaluateV5TargetedAcceptance(base, targeted)).toMatchObject({ accepted: false, metrics: { blindJobAttribution: null, taskPrecision: null } })
  })
})
