import { z } from 'zod'
import { evaluateV5Acceptance, v5AcceptanceInputSchema } from '@/v5/acceptance/evaluate'

export const JOB_TARGETED_ACCEPTANCE_CRITERIA = Object.freeze({
  version: 'job-targeted-acceptance-v1', minimumTaskPrecision: .9, minimumTaskRecall: .9,
  minimumFitPrecision: .9, minimumEligibleCoreTaskCoverage: .9, minimumMultiJobSubjects: 20,
  minimumJobsPerSubject: 2, minimumBlindJobAttribution: .8, maximumMajorProfileErrors: 0,
  maximumCrossJobFactChanges: 0,
})
const digest = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative().safe()
const id = z.string().min(1).max(120)
export const v5TargetedAssessmentSchema = z.object({
  criteriaVersion: z.literal(JOB_TARGETED_ACCEPTANCE_CRITERIA.version), candidateVersionSha256: digest,
  rubricSignoffRecordSha256: digest.nullable(),
  cases: z.array(z.object({
    caseId: id, subjectId: id, resumeSha256: digest, jdSha256: digest,
    artifactSha256: digest, profileSha256: digest, fitMapSha256: digest,
    goldAnnotationRecordSha256: digest, reviewRecordSha256: digest,
    reviewerKind: z.enum(['human_recruiter', 'model']), reviewerId: id, independentlyReviewed: z.boolean(),
    coreTaskReferenceCount: count, coreTaskPredictedCount: count, coreTaskCorrectCount: count,
    fitPredictedSupportedCount: count, fitCorrectSupportedCount: count,
    eligibleCoreTaskCount: count, representedCoreTaskCount: count, majorProfileErrors: count,
  }).strict()),
  multiJobGroups: z.array(z.object({
    subjectId: id, caseIds: z.array(id).min(2),
    reviewRecordSha256: digest, reviewerKind: z.enum(['human_recruiter', 'model']),
    reviewerId: id, independentlyReviewed: z.boolean(),
    distinctTasksConfirmed: z.boolean(), labelsHidden: z.boolean(), substantiveEvidenceReasonsChecked: z.boolean(),
    correctlyAttributedCount: count, majorFactChanges: count,
  }).strict()),
}).strict()
export type V5TargetedAssessment = z.infer<typeof v5TargetedAssessmentSchema>
const rate = (top: number, bottom: number) => bottom > 0 ? top / bottom : null

/** Human-record aggregation, not a model judge or online generation gate. */
export function evaluateV5TargetedAcceptance(baseValue: unknown, targetedValue: unknown) {
  const base = evaluateV5Acceptance(baseValue), parsedBase = v5AcceptanceInputSchema.safeParse(baseValue)
  const parsed = v5TargetedAssessmentSchema.safeParse(targetedValue)
  if (!parsed.success || !parsedBase.success) return { accepted: false, reasons: ['INVALID_TARGETED_ACCEPTANCE_RECORDS'], metrics: null, base }
  const input = parsed.data, criteria = JOB_TARGETED_ACCEPTANCE_CRITERIA, reasons = new Set<string>()
  if (!base.accepted) reasons.add('BASE_ACCEPTANCE_NOT_PASSED')
  if (!input.rubricSignoffRecordSha256) reasons.add('TARGETED_RUBRIC_NOT_SIGNED_OFF')
  if (input.candidateVersionSha256 !== parsedBase.data.candidateVersionSha256) reasons.add('TARGETED_VERSION_MISMATCH')
  const runs = new Map(parsedBase.data.runs.map(run => [run.caseId, run]))
  const registered = new Map(parsedBase.data.cases.map(item => [item.caseId, item]))
  const realIds = new Set(parsedBase.data.cases.filter(item => item.kind === 'real').map(item => item.caseId))
  const cases = new Map(input.cases.map(item => [item.caseId, item]))
  if (cases.size !== input.cases.length) reasons.add('DUPLICATE_TARGETED_REVIEW')
  if (new Set(input.cases.map(item => item.reviewRecordSha256)).size !== input.cases.length) reasons.add('REUSED_TARGETED_REVIEW_RECORD')
  let taskReference = 0, taskPredicted = 0, taskCorrect = 0, fitPredicted = 0, fitCorrect = 0, eligible = 0, represented = 0, majorProfileErrors = 0
  for (const item of input.cases) {
    const run = runs.get(item.caseId)
    const source = registered.get(item.caseId)?.targetingInput
    if (!realIds.has(item.caseId) || !run?.artifactSha256 || item.artifactSha256 !== run.artifactSha256) reasons.add('TARGETED_ARTIFACT_MISMATCH')
    if (!source || source.subjectId !== item.subjectId || source.resumeSha256 !== item.resumeSha256 || source.jdSha256 !== item.jdSha256) reasons.add('TARGETED_INPUT_MISMATCH')
    if (!run?.targetingAnalysis || run.targetingAnalysis.profileSha256 !== item.profileSha256 || run.targetingAnalysis.fitMapSha256 !== item.fitMapSha256) reasons.add('TARGETED_ANALYSIS_MISMATCH')
    if (item.reviewerKind !== 'human_recruiter' || !item.independentlyReviewed) reasons.add('TARGETED_REVIEW_NOT_HUMAN')
    if (item.coreTaskCorrectCount > Math.min(item.coreTaskReferenceCount, item.coreTaskPredictedCount)
      || item.fitCorrectSupportedCount > item.fitPredictedSupportedCount || item.representedCoreTaskCount > item.eligibleCoreTaskCount) reasons.add('TARGETED_COUNTS_INVALID')
    taskReference += item.coreTaskReferenceCount; taskPredicted += item.coreTaskPredictedCount; taskCorrect += item.coreTaskCorrectCount
    fitPredicted += item.fitPredictedSupportedCount; fitCorrect += item.fitCorrectSupportedCount
    eligible += item.eligibleCoreTaskCount; represented += item.representedCoreTaskCount; majorProfileErrors += item.majorProfileErrors
  }
  for (const caseId of realIds) if (runs.get(caseId)?.artifactSha256 && !cases.has(caseId)) reasons.add('TARGETED_HUMAN_REVIEW_MISSING')
  const subjects = new Set<string>(), usedCaseIds = new Set<string>(), groupReviews = new Set<string>(), groupResumes = new Set<string>()
  let attributed = 0, attributedTotal = 0, majorFactChanges = 0
  for (const group of input.multiJobGroups) {
    if (subjects.has(group.subjectId)) reasons.add('DUPLICATE_MULTI_JOB_SUBJECT')
    subjects.add(group.subjectId)
    const members = group.caseIds.map(caseId => cases.get(caseId))
    const resume = members[0]?.resumeSha256
    if (resume && groupResumes.has(resume)) reasons.add('REUSED_MULTI_JOB_RESUME')
    if (resume) groupResumes.add(resume)
    if (groupReviews.has(group.reviewRecordSha256)) reasons.add('REUSED_MULTI_JOB_REVIEW')
    groupReviews.add(group.reviewRecordSha256)
    if (new Set(group.caseIds).size !== group.caseIds.length || group.caseIds.some(caseId => usedCaseIds.has(caseId))
      || members.some(item => !item || item.subjectId !== group.subjectId)
      || new Set(members.map(item => item?.jdSha256)).size !== members.length
      || new Set(members.map(item => item?.resumeSha256)).size !== 1) reasons.add('MULTI_JOB_GROUP_INVALID')
    group.caseIds.forEach(caseId => usedCaseIds.add(caseId))
    if (group.reviewerKind !== 'human_recruiter' || !group.independentlyReviewed || !group.distinctTasksConfirmed || !group.labelsHidden || !group.substantiveEvidenceReasonsChecked) reasons.add('MULTI_JOB_REVIEW_INVALID')
    if (group.correctlyAttributedCount > group.caseIds.length) reasons.add('MULTI_JOB_COUNTS_INVALID')
    attributed += group.correctlyAttributedCount; attributedTotal += group.caseIds.length; majorFactChanges += group.majorFactChanges
  }
  if (subjects.size < criteria.minimumMultiJobSubjects) reasons.add('INSUFFICIENT_MULTI_JOB_SUBJECTS')
  const taskPrecision = rate(taskCorrect, taskPredicted), taskRecall = rate(taskCorrect, taskReference)
  const fitPrecision = rate(fitCorrect, fitPredicted), coreCoverage = rate(represented, eligible), blindJobAttribution = rate(attributed, attributedTotal)
  if (taskPrecision === null || taskPrecision < criteria.minimumTaskPrecision) reasons.add('TASK_PRECISION_NOT_ACCEPTED')
  if (taskRecall === null || taskRecall < criteria.minimumTaskRecall) reasons.add('TASK_RECALL_NOT_ACCEPTED')
  if (fitPrecision === null || fitPrecision < criteria.minimumFitPrecision) reasons.add('FIT_PRECISION_NOT_ACCEPTED')
  if (coreCoverage === null || coreCoverage < criteria.minimumEligibleCoreTaskCoverage) reasons.add('CORE_TASK_COVERAGE_NOT_ACCEPTED')
  if (blindJobAttribution === null || blindJobAttribution < criteria.minimumBlindJobAttribution) reasons.add('BLIND_JOB_ATTRIBUTION_NOT_ACCEPTED')
  if (majorProfileErrors > criteria.maximumMajorProfileErrors) reasons.add('MAJOR_PROFILE_ERROR')
  if (majorFactChanges > criteria.maximumCrossJobFactChanges) reasons.add('CROSS_JOB_FACT_CHANGE')
  return { accepted: reasons.size === 0, criteriaVersion: criteria.version, reasons: [...reasons].sort(), base,
    metrics: { taskPrecision, taskRecall, fitPrecision, coreCoverage, blindJobAttribution, multiJobSubjects: subjects.size,
      majorProfileErrors, majorFactChanges, reviewedCases: cases.size,
      noComparableTaskCases: input.cases.filter(item => item.coreTaskReferenceCount === 0).length,
      noEligibleCoreEvidenceCases: input.cases.filter(item => item.eligibleCoreTaskCount === 0).length,
    } }
}
