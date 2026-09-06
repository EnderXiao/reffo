import { z } from 'zod'
import { V5_ACCEPTANCE_CRITERIA as criteria } from '@/v5/acceptance/criteria'
import { createDigest } from '@/harness/run-context'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().trim().min(1).max(120)
const count = z.number().int().nonnegative().safe()
const metricsSchema = z.object({
  model: id, cacheCondition: id,
  inputTokens: count.nullable(), outputTokens: count.nullable(), latencyMs: count.nullable(),
  physicalCalls: count, authorizedCallLimit: count,
}).strict()
const reviewSchema = z.object({
  caseId: id, reviewerId: id, recordSha256: digest, artifactSha256: digest, baselineArtifactSha256: digest,
  criteriaVersion: z.literal(criteria.version),
  // Attestation must be checked against actual review records by the release owner.
  reviewerKind: z.enum(['human_recruiter', 'model']), independent: z.boolean(), blindedSameRubric: z.boolean(),
  scores: z.tuple([z.number().min(0).max(25), z.number().min(0).max(20), z.number().min(0).max(15),
    z.number().min(0).max(10), z.number().min(0).max(10), z.number().min(0).max(10), z.number().min(0).max(10)]),
  deliverableWithoutSubstantiveRewrite: z.boolean(), pairwise: z.enum(['win', 'tie', 'loss']),
  missingCoreEvidenceIds: z.array(id), majorIncident: z.boolean(),
}).strict()

export const v5AcceptanceInputSchema = z.object({
  criteriaVersion: z.literal(criteria.version),
  frozenCohortSha256: digest, candidateVersionSha256: digest, baselineVersionSha256: digest,
  cases: z.array(z.object({
    caseId: id, inputSha256: digest, kind: z.enum(['real', 'adversarial']),
    partition: z.enum(['held_out', 'development']), authorized: z.boolean(), requiresDoubleReview: z.boolean(),
    strata: z.object({ richness: id, careerStage: id, jobDistance: id }).strict(),
    targetingInput: z.object({ subjectId: id, resumeSha256: digest, jdSha256: digest }).strict().optional(),
  }).strict()),
  runs: z.array(z.object({
    caseId: id, inputSha256: digest, execution: z.enum(['live', 'offline_replay', 'synthetic']),
    candidateVersionSha256: digest, baselineVersionSha256: digest,
    outcome: z.enum(['first_pass', 'bounded_success', 'failed', 'safe_end']),
    failureOrigin: z.enum(['provider', 'product', 'unknown']).nullable(),
    artifactSha256: digest.nullable(), baselineArtifactSha256: digest.nullable(),
    targetingAnalysis: z.object({ profileSha256: digest, fitMapSha256: digest }).strict().optional(),
    safetyAudit: z.object({ recordSha256: digest, verified: z.boolean(), majorIncidents: count, expectedBehaviorPassed: z.boolean() }).strict().nullable(),
    candidateMetrics: metricsSchema, baselineMetrics: metricsSchema.nullable(),
  }).strict()),
  reviews: z.array(reviewSchema),
}).strict()
export type V5AcceptanceInput = z.infer<typeof v5AcceptanceInputSchema>
export const acceptanceCohortDigest = (cases: V5AcceptanceInput['cases']) => createDigest([...cases].sort((a, b) => a.caseId.localeCompare(b.caseId)))

const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const p95 = (values: number[]): number | null => values.length
  ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null
const rate = (numerator: number, denominator: number) => denominator ? numerator / denominator : null
const ratio = (candidate: number | null, baseline: number | null) => candidate !== null && baseline !== null && baseline > 0 ? candidate / baseline : null
const successful = (run: V5AcceptanceInput['runs'][number]) => ['first_pass', 'bounded_success'].includes(run.outcome) && run.artifactSha256 !== null

/** Offline release assessment only. Never changes runtime delivery gates or starts an API call. */
export function evaluateV5Acceptance(value: unknown) {
  const parsed = v5AcceptanceInputSchema.safeParse(value)
  if (!parsed.success) return { accepted: false, criteriaVersion: criteria.version, reasons: ['INVALID_ACCEPTANCE_RECORDS'], metrics: null }
  const input = parsed.data
  const reasons = new Set<string>()
  const fail = (reason: string) => { reasons.add(reason) }
  if (input.frozenCohortSha256 !== acceptanceCohortDigest(input.cases)) fail('FROZEN_COHORT_MISMATCH')
  const cases = new Map(input.cases.map(item => [item.caseId, item]))
  const runs = new Map(input.runs.map(item => [item.caseId, item]))
  if (cases.size !== input.cases.length || runs.size !== input.runs.length) fail('DUPLICATE_CASE_OR_RUN')
  if (new Set(input.cases.map(item => item.inputSha256)).size !== input.cases.length) fail('DUPLICATE_INPUT_PAIR')
  if (new Set(input.reviews.map(review => review.recordSha256)).size !== input.reviews.length) fail('REUSED_HUMAN_REVIEW_RECORD')
  if (input.runs.some(run => !cases.has(run.caseId)) || input.reviews.some(review => !cases.has(review.caseId))) fail('UNREGISTERED_RECORD')
  if (input.cases.some(item => item.partition !== 'held_out' || !item.authorized)) fail('COHORT_NOT_AUTHORIZED_HELD_OUT')
  const real = input.cases.filter(item => item.kind === 'real')
  const adversarial = input.cases.filter(item => item.kind === 'adversarial')
  if (real.length < criteria.minimumRealCases) fail('INSUFFICIENT_REAL_CASES')
  if (adversarial.length < criteria.minimumAdversarialCases) fail('INSUFFICIENT_ADVERSARIAL_CASES')
  let majorIncidents = 0, firstPass = 0, boundedSuccess = 0, deliverable = 0, wins = 0, losses = 0, ties = 0
  let providerFailures = 0, productFailures = 0, unknownFailures = 0, missingRuns = 0
  const scores: number[] = [], candidateTokens: number[] = [], baselineTokens: number[] = []
  const candidateLatency: number[] = [], baselineLatency: number[] = []
  const groups = new Map<string, { total: number; succeeded: number; deliverable: number }>()
  for (const item of input.cases) {
    const run = runs.get(item.caseId)
    const groupKey = `${item.strata.richness}/${item.strata.careerStage}/${item.strata.jobDistance}`
    if (item.kind === 'real') {
      const group = groups.get(groupKey) ?? { total: 0, succeeded: 0, deliverable: 0 }
      group.total += 1
      groups.set(groupKey, group)
    }
    if (!run) { missingRuns += 1; fail('REGISTERED_RUN_MISSING'); continue }
    if (run.inputSha256 !== item.inputSha256) fail('RUN_INPUT_MISMATCH')
    if (run.candidateVersionSha256 !== input.candidateVersionSha256 || run.baselineVersionSha256 !== input.baselineVersionSha256) fail('RUN_VERSION_MISMATCH')
    if (item.kind === 'real' && run.execution !== 'live') fail('REAL_CASE_NOT_LIVE')
    if (run.candidateMetrics.physicalCalls > run.candidateMetrics.authorizedCallLimit) fail('CALL_LIMIT_EXCEEDED')
    if (successful(run) && item.kind === 'real' && run.candidateMetrics.physicalCalls === 0) fail('REAL_CASE_WITHOUT_PROVIDER_CALL')
    if (!run.safetyAudit?.verified) fail('SAFETY_AUDIT_MISSING')
    majorIncidents += run.safetyAudit?.majorIncidents ?? 0
    if (item.kind === 'adversarial') {
      if (!run.safetyAudit?.expectedBehaviorPassed) fail('ADVERSARIAL_BEHAVIOR_NOT_ACCEPTED')
      continue
    }
    if (run.outcome === 'first_pass' && successful(run)) firstPass += 1
    if (successful(run)) { boundedSuccess += 1; groups.get(groupKey)!.succeeded += 1 }
    else {
      if (run.failureOrigin === 'provider') providerFailures += 1
      else if (run.failureOrigin === 'product') productFailures += 1
      else unknownFailures += 1
    }
    // Include failures and their consumed tokens in matched cost comparisons.
    const current = run.candidateMetrics, base = run.baselineMetrics
    if (!base || base.model !== current.model || base.cacheCondition !== current.cacheCondition) fail('COST_CONDITIONS_NOT_COMPARABLE')
    else if ([current.inputTokens, current.outputTokens, current.latencyMs, base.inputTokens, base.outputTokens, base.latencyMs].some(value => value === null)) fail('UNKNOWN_COST_OR_LATENCY')
    else {
      candidateTokens.push(current.inputTokens! + current.outputTokens!)
      baselineTokens.push(base.inputTokens! + base.outputTokens!)
      candidateLatency.push(current.latencyMs!)
      baselineLatency.push(base.latencyMs!)
    }
    if (!successful(run)) continue
    const submitted = input.reviews.filter(review => review.caseId === item.caseId)
    const reviews = submitted.filter(review => review.reviewerKind === 'human_recruiter' && review.independent && review.blindedSameRubric
      && review.artifactSha256 === run.artifactSha256 && review.baselineArtifactSha256 === run.baselineArtifactSha256)
    if (reviews.length !== submitted.length) fail('INVALID_HUMAN_REVIEW_PROVENANCE')
    if (new Set(reviews.map(review => review.reviewerId)).size !== reviews.length
      || new Set(reviews.map(review => review.recordSha256)).size !== reviews.length) fail('DUPLICATE_HUMAN_REVIEW')
    if (reviews.length < (item.requiresDoubleReview ? 2 : 1)) { fail('HUMAN_REVIEW_MISSING'); continue }
    if (reviews.some(review => review.majorIncident)) majorIncidents += 1
    if (reviews.some(review => review.missingCoreEvidenceIds.length)) fail('CORE_CONTRIBUTION_MISSING')
    const qualityScores = reviews.map(review => review.scores.reduce((sum, score) => sum + score, 0))
    scores.push(median(qualityScores)!)
    if (reviews.every(review => review.deliverableWithoutSubstantiveRewrite)) { deliverable += 1; groups.get(groupKey)!.deliverable += 1 }
    const decisions = new Set(reviews.map(review => `${review.pairwise}/${review.deliverableWithoutSubstantiveRewrite}/${review.majorIncident}`))
    if (decisions.size > 1 || Math.max(...qualityScores) - Math.min(...qualityScores) > 15) fail('HUMAN_DISAGREEMENT_REQUIRES_ADJUDICATION')
    if (reviews.every(review => review.pairwise === 'win')) wins += 1
    else if (reviews.every(review => review.pairwise === 'loss')) losses += 1
    else if (reviews.every(review => review.pairwise === 'tie')) ties += 1
  }
  if (majorIncidents > criteria.maximumMajorIncidents) fail('MAJOR_INCIDENT')
  const firstPassRate = rate(firstPass, real.length), boundedSuccessRate = rate(boundedSuccess, real.length)
  const humanDeliverableRate = rate(deliverable, real.length), humanMedianScore = median(scores)
  const pairwiseWinRate = rate(wins, real.length), pairwiseLossRate = rate(losses, real.length)
  if (firstPassRate === null || firstPassRate < criteria.minimumFirstPassRate) fail('FIRST_PASS_RATE_BELOW_TARGET')
  if (boundedSuccessRate === null || boundedSuccessRate < criteria.minimumBoundedSuccessRate) fail('BOUNDED_SUCCESS_RATE_BELOW_TARGET')
  if (humanDeliverableRate === null || humanDeliverableRate < criteria.minimumHumanDeliverableRate) fail('HUMAN_DELIVERABILITY_BELOW_TARGET')
  if (humanMedianScore === null || humanMedianScore < criteria.minimumHumanMedianScore) fail('HUMAN_SCORE_BELOW_TARGET')
  if (pairwiseWinRate === null || pairwiseWinRate < criteria.minimumPairwiseWinRate) fail('PAIRWISE_WIN_RATE_BELOW_TARGET')
  if (pairwiseLossRate === null || pairwiseLossRate > criteria.maximumPairwiseLossRate) fail('PAIRWISE_LOSS_RATE_ABOVE_TARGET')
  const costComplete = candidateTokens.length === real.length && real.length > 0
  const tokenMedianRatio = costComplete ? ratio(median(candidateTokens), median(baselineTokens)) : null
  const tokenP95Ratio = costComplete ? ratio(p95(candidateTokens), p95(baselineTokens)) : null
  const latencyP95Ratio = costComplete ? ratio(p95(candidateLatency), p95(baselineLatency)) : null
  if (tokenMedianRatio === null || tokenMedianRatio > criteria.maximumTokenMedianRatio) fail('TOKEN_MEDIAN_NOT_ACCEPTED')
  if (tokenP95Ratio === null || tokenP95Ratio > criteria.maximumTokenP95Ratio) fail('TOKEN_P95_NOT_ACCEPTED')
  if (latencyP95Ratio === null || latencyP95Ratio > criteria.maximumLatencyP95Ratio) fail('LATENCY_P95_NOT_ACCEPTED')
  return { accepted: reasons.size === 0, criteriaVersion: criteria.version, reasons: [...reasons].sort(),
    metrics: { realCases: real.length, adversarialCases: adversarial.length, missingRuns, majorIncidents,
      firstPassRate, boundedSuccessRate, humanDeliverableRate, humanMedianScore,
      pairwiseWinRate, pairwiseLossRate, pairwiseTies: ties, scoredCases: scores.length,
      scoresBelow80: scores.filter(score => score < 80).length,
      providerFailures, productFailures, unknownFailures, tokenMedianRatio, tokenP95Ratio, latencyP95Ratio,
      strata: Object.fromEntries(groups),
    } }
}
