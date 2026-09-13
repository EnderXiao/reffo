import { expect, spyOn, test } from 'bun:test'
import { env } from '@/config/env'
import { mvpRoutes } from '@/routes/mvp'
import { V5SingleStepAdapter, v5SingleStepAdapter } from '@/v5/single-step-adapter'
import { V5CheckpointRepository } from '@/repositories/v5-checkpoint-repository'
import { V5WorkflowBlockedError } from '@/v5/errors'
import { V5_WORKFLOW_VERSION } from '@/v5/types'
import { createSingleStepFixture } from '@/v5/tests/single-step-fixtures'
import { MemoryCheckpointStorage } from '@/v5/tests/checkpoint-storage-fixture'
import { FIXTURE_RESUME, FIXTURE_JD } from '@/v5/tests/fixtures'
import { writingIssue } from '@/v5/writing/facts'

async function post<T extends 'analyze' | 'match' | 'generate' | 'interview'>(path: T, body: unknown) {
  const response = await mvpRoutes.handle(new Request(`http://localhost/api/v1/mvp/${path}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  }))
  return {status: response.status, body: await response.json() as {
    data: Awaited<ReturnType<V5SingleStepAdapter[T]>>['data']
    meta: { harness: { workflow_version: string; step_statuses: Array<{ stepName: string }> } }
    error: { code: string }
  }}
}

test('existing frontend request sequence reaches V5 analysis, matching, Writer and on-demand interview', async () => {
  const previous = {APP_ENV: env.APP_ENV, AUTH_REQUIRED: env.AUTH_REQUIRED}
  env.APP_ENV = 'local'
  env.AUTH_REQUIRED = false
  const fixture = createSingleStepFixture()
  const adapter = new V5SingleStepAdapter(new V5CheckpointRepository('fixture', new MemoryCheckpointStorage()), fixture.createWorkflow)
  const mocks = [
    spyOn(v5SingleStepAdapter, 'analyze').mockImplementation(adapter.analyze.bind(adapter)),
    spyOn(v5SingleStepAdapter, 'match').mockImplementation(adapter.match.bind(adapter)),
    spyOn(v5SingleStepAdapter, 'generate').mockImplementation(adapter.generate.bind(adapter)),
    spyOn(v5SingleStepAdapter, 'interview').mockImplementation(adapter.interview.bind(adapter)),
  ]
  try {
    const analysis = await post('analyze', {resume_markdown: FIXTURE_RESUME})
    expect(analysis.status).toBe(200)
    expect(analysis.body.meta.harness.workflow_version).toBe(V5_WORKFLOW_VERSION)
    expect(analysis.body.meta.harness.step_statuses[0].stepName).toBe('v5_p01_resume_extract')
    const structured_resume = analysis.body.data.structured_resume
    const matching = await post('match', {structured_resume, jd_text: FIXTURE_JD})
    expect(matching.status).toBe(200)
    expect(matching.body.meta.harness.step_statuses.map((s: {stepName: string}) => s.stepName)).toEqual(['v5_p02_job_extract', 'v5_p03_match'])
    const generated = await post('generate', {structured_resume, matching: matching.body.data})
    expect(generated.status).toBe(200)
    expect(generated.body.data.optimized_resume).toContain('产品迭代')
    const interview = await post('interview', {analysis: analysis.body.data, matching: matching.body.data, optimized_resume: generated.body.data.optimized_resume})
    expect(interview.status).toBe(200)
    expect(interview.body.data.questions).toHaveLength(4)
    expect(fixture.versions).toHaveLength(5)
    expect(fixture.versions.every(v => v.startsWith('5.'))).toBe(true)
    const stale = await post('match', {structured_resume: {personal_info: {name: '旧结果'}}, jd_text: FIXTURE_JD})
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('V5_CHECKPOINT_UNAVAILABLE')
    expect(fixture.versions).toHaveLength(5)
  } finally {
    for (const mock of mocks) mock.mockRestore()
    Object.assign(env, previous)
  }
})

test('V5 failures retain HTTP status, run ID and diagnostic codes without leaking prompt or resume', async () => {
  const previous = env.AUTH_REQUIRED
  env.AUTH_REQUIRED = false
  const failure = new V5WorkflowBlockedError({
    code: 'V5_PROVIDER_UNAVAILABLE', state: 'provider_failure', retryable: true, httpStatus: 503, message: 'private upstream error',
  })
  failure.runId = 'failed-run'
  const match = spyOn(v5SingleStepAdapter, 'match').mockRejectedValue(failure)
  try {
    const result = await post('match', {structured_resume: {}, jd_text: FIXTURE_JD})
    expect(result.status).toBe(503)
    expect(result.body.error).toMatchObject({code: 'MATCH_FAILED', details: {run_id: 'failed-run', error_code: 'V5_PROVIDER_UNAVAILABLE', retryable: true}})
    expect(JSON.stringify(result.body)).not.toContain('private upstream error')
  } finally { match.mockRestore(); env.AUTH_REQUIRED = previous }
})

test('incomplete generated entries return an actionable error and retain the diagnostic run', async () => {
  const previous = { APP_ENV: env.APP_ENV, AUTH_REQUIRED: env.AUTH_REQUIRED }
  env.APP_ENV = 'local'
  env.AUTH_REQUIRED = false
  const failure = new V5WorkflowBlockedError({ code: 'V5_SUPPORTED_WRITING_BLOCKED', state: 'blocked_fact_validation',
    message: 'private model output', issues: [writingIssue('ENTRY_SET_INVALID', 'entries', [], '经历结构不一致')] })
  failure.runId = 'entry-failed-run'
  const generate = spyOn(v5SingleStepAdapter, 'generate').mockRejectedValue(failure)
  try {
    const result = await post('generate', { structured_resume: {}, matching: {} })
    expect(result.status).toBe(422)
    expect(result.body.error).toMatchObject({ code: 'GENERATED_ENTRIES_INCOMPLETE',
      message: '生成内容不完整，部分经历未正确生成，请重新生成',
      details: { run_id: 'entry-failed-run', error_code: 'V5_SUPPORTED_WRITING_BLOCKED' } })
    expect(JSON.stringify(result.body)).toContain('ENTRY_SET_INVALID')
    expect(JSON.stringify(result.body)).not.toContain('private model output')
  } finally { generate.mockRestore(); Object.assign(env, previous) }
})
