import {expect, test} from 'bun:test'
import {resumeStageFingerprint} from '@/v5/stage-fingerprints'
import {V5_PROMPT_VERSIONS} from '@/v5/prompts'
import {currentGenerationStageFingerprints, generationJobRetryChanges} from '@/services/generation-job-version'
import type {GenerationJob} from '@/types/generation-job'

test('writing prompt changes invalidate writing only, matching prompt changes preserve extraction', () => {
  const writing = {...V5_PROMPT_VERSIONS, P06C: '5.7.0-p06c-repair-test'}
  expect(resumeStageFingerprint('generation', writing)).not.toBe(resumeStageFingerprint('generation'))
  for (const stage of ['extraction', 'matching', 'interview'] as const) {
    expect(resumeStageFingerprint(stage, writing)).toBe(resumeStageFingerprint(stage))
  }
  const matching = {...V5_PROMPT_VERSIONS, P03R: '5.1.0-p03r-scope-test'}
  expect(resumeStageFingerprint('matching', matching)).not.toBe(resumeStageFingerprint('matching'))
  expect(resumeStageFingerprint('extraction', matching)).toBe(resumeStageFingerprint('extraction'))
})

test('a repaired writer retries without discarding compatible analysis or matching', () => {
  const now = '2026-11-14T00:00:00.000Z'
  const job = {id: 'generation-repair-test', status: 'failed', stage: 'optimized', quota_charged: true,
    payload: {input: {resume_markdown: '源简历', jd_text: '目标岗位', company: '', position: '', location: ''},
      analysis: {}, matching: {}, optimized: {optimized_resume: '旧正文'}, interview: {}, releaseFingerprint: 'old',
      stageFingerprints: {...currentGenerationStageFingerprints(), generation: 'old-writing-policy'},
      failure: {code: 'V5_SUPPORTED_WRITING_BLOCKED', stage: 'optimized', issueCodes: ['WRITER_GAP_BOUNDARY_INVALID'],
        retryable: false, action: 'inspect_stage_validation', occurredAt: now}}} as GenerationJob
  const change = generationJobRetryChanges(job, 'current', now)
  expect(change.stage).toBe('optimized')
  expect(change.payload!.analysis).toBe(job.payload.analysis)
  expect(change.payload!.matching).toBe(job.payload.matching)
  expect(change.payload).not.toHaveProperty('optimized')
  expect(change.payload).not.toHaveProperty('interview')
  expect(change.payload).not.toHaveProperty('failure')
  expect(change.status).toBe('queued')
  expect(change).not.toHaveProperty('quota_charged')
  expect(job.payload.optimized).toBeDefined()
})
