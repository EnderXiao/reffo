import { expect, test } from 'bun:test'
import { buildAbstractionReview } from '@/v5/acceptance/abstraction-review'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { buildWritingPlan } from '@/v5/writing/plan'

test('offline abstraction review leaves semantic judgments empty even for valid references', () => {
  const r = createV5ResultFixture()
  const input = { resume: r.resumeEvidenceBundle, artifact: r.artifact, writingPlan: buildWritingPlan({
    resume: r.resumeEvidenceBundle, plan: r.resumePlan, policy: r.generationPolicy, match: r.matchAnalysis, job: r.jobRequirementBundle }) }
  const before = structuredClone(input), report = buildAbstractionReview(input)
  expect(report.rows.length).toBeGreaterThan(0)
  expect(report.rows.every(row => row.review.category === null)).toBe(true)
  expect(report.semanticQualityAssessed).toBe(false)
  expect(report.releaseAcceptanceAssessed).toBe(false)
  expect(report.externalCallsMade).toBe(0)
  expect(report.artifactSha256).toMatch(/^[a-f0-9]{64}$/)
  expect(input).toEqual(before)
  input.artifact.markdown += '变更'
  expect(buildAbstractionReview(input).artifactSha256).not.toBe(report.artifactSha256)
})

test('missing original Writer plan stays unavailable, not reconstructed as historical evidence', () => {
  const r = createV5ResultFixture()
  const report = buildAbstractionReview({ resume: r.resumeEvidenceBundle, artifact: r.artifact })
  expect(report.rows.every(row => row.offeredSources === null && row.writerViews === null)).toBe(true)
})
