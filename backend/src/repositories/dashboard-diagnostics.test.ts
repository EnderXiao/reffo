import {describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

// 同进程内多个测试文件共享模块注册表，env 相关 sqlite 单例会在文件间串扰；
// 沿用 resume-stage-cache-repository.test.ts 的 isolated() 子进程模式，每个用例独立进程、独立库。
function isolated(script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'reffo-diag-repo-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', script + '\nprocess.exit(0)'], {
      cwd: join(import.meta.dir, '../..'),
      env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: 'sqlite', AUTH_REQUIRED: 'false',
        SQLITE_DATABASE_PATH: join(directory, 'diagnostics.sqlite'),
        HARNESS_DATABASE_PATH: join(directory, 'harness.sqlite'),
        SUPABASE_URL: 'https://diagnostics.invalid', SUPABASE_SECRET_KEY: 'test-service-key'},
      stdout: 'pipe', stderr: 'pipe',
    })
    expect({code: result.exitCode, stderr: result.stderr.toString()}).toEqual({code: 0, stderr: ''})
    return JSON.parse(result.stdout.toString()) as Record<string, unknown>
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
}

const header = `
import assert from 'node:assert/strict'
const diagnostics = await import('./src/repositories/dashboard-diagnostics.ts')
const {DashboardAccessError} = await import('./src/auth/dashboard-access.ts')
const db = diagnostics.ensureDiagnosticsTables()
const now = () => new Date().toISOString()
const at = (minutes) => new Date(Date.now() + minutes * 60000).toISOString()
function seedSample(runId, opts = {}) {
  db.query('INSERT INTO harness_failure_samples (id, run_id, reason, status, event_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId + '-sample', runId, opts.reason ?? null, opts.status ?? 'failed', opts.eventCount ?? 0, opts.createdAt ?? now())
}
function seedCall(runId, opts) {
  const callId = opts.callId ?? crypto.randomUUID()
  db.query('INSERT INTO provider_calls (id, call_id, event_kind, run_id, step_run_id, attempt_id, stage, provider, model, retry_index, call_reason, occurred_at, latency_ms, input_tokens, output_tokens, reasoning_tokens, provider_request_id, error_code, failure_class, provider_status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(callId + '-id', callId, opts.eventKind, runId, null, null, null, 'deepseek', opts.model ?? 'deepseek-v4', 0, null, opts.occurredAt ?? now(), opts.latency ?? null, null, null, null, null, opts.errorCode ?? null, opts.failureClass ?? null, opts.providerStatus ?? null, at(1440))
}
function seedJob(opts) {
  db.query('INSERT INTO resume_generation_jobs (id, user_id, status, stage, error, created_at, updated_at, lease_expires_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(opts.id, '11111111-1111-4111-8111-111111111111', opts.status, opts.stage, opts.error ?? null, opts.createdAt ?? now(), opts.updatedAt ?? now(), now(), JSON.stringify(opts.payload))
}
function seedEvent(runId, type, payload, occurredAt) {
  db.query('INSERT INTO harness_events (id, type, version, run_id, request_id, step_run_id, attempt_id, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), type, 1, runId, 'req-1', 'step-1', null, occurredAt ?? now(), JSON.stringify(payload))
}
function utcMidnight() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}
`

describe('dashboard-diagnostics repository (sqlite)', () => {
  test('summary aggregates samples, failed jobs, attempts and top lists', () => {
    isolated(header + `
      seedSample('sum-a', {eventCount: 3})
      seedSample('sum-b', {eventCount: 1})
      seedJob({id: 'job-new', status: 'failed', stage: 'matching', error: '模型服务暂时不可用',
        payload: {failure: {code: 'V5_PROVIDER_TEMPORARY_FAILURE', stage: 'matching', runId: 'sum-a', retryable: true, action: 'retry_preserved_checkpoint'}}})
      seedJob({id: 'job-old', status: 'failed', stage: 'analysis',
        payload: {failure: {code: 'OLD', stage: 'analysis', runId: 'sum-b', retryable: false, action: 'x'}}, updatedAt: '2020-01-01T00:00:00.000Z'})
      seedCall('sum-a', {eventKind: 'requested'})
      seedCall('sum-a', {eventKind: 'completed', latency: 100})
      seedCall('sum-a', {eventKind: 'failed', errorCode: 'HTTP_502', failureClass: 'provider_http', providerStatus: 502})
      seedCall('sum-b', {eventKind: 'failed', errorCode: '', failureClass: null, model: 'glm-ocr', latency: 55})
      seedCall('sum-b', {eventKind: 'failed', errorCode: '', failureClass: null, model: 'glm-ocr'})
      const summary = await diagnostics.diagnosticSummary(1)
      assert.equal(summary.days, 1)
      assert.equal(summary.windowStart, utcMidnight())
      assert.equal(summary.failedRuns, 2)
      assert.equal(summary.failedJobs, 1)
      assert.equal(summary.providerAttempts, 4)
      assert.equal(summary.providerFailures, 3)
      assert.equal(summary.failureRatePercent, 75)
      assert.deepEqual(summary.topErrorCodes, [{code: 'unknown', count: 2}, {code: 'HTTP_502', count: 1}])
      assert.deepEqual(summary.topFailureClasses, [{class: 'unclassified', count: 2}, {class: 'provider_http', count: 1}])
      assert.deepEqual(summary.topModels, [{model: 'deepseek-v4', count: 3}, {model: 'glm-ocr', count: 2}])
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('runs joins provider stats and the failure job via payload failure.runId', () => {
    isolated(header + `
      const createdAt = at(-10)
      const lastCall = at(-8)
      seedSample('run-x', {reason: 'P03 校验失败', eventCount: 2, createdAt})
      seedCall('run-x', {eventKind: 'requested', model: 'deepseek-v4', occurredAt: at(-9)})
      seedCall('run-x', {eventKind: 'failed', model: 'deepseek-v4', errorCode: 'P03_VALIDATION_FAILED', failureClass: 'output_validation', latency: 120, occurredAt: lastCall})
      seedJob({id: 'job-x', status: 'failed', stage: 'matching', error: '岗位分析暂未完成，任务已停止。',
        payload: {failure: {code: 'P03_VALIDATION_FAILED', stage: 'matching', runId: 'run-x', retryable: false, action: 'inspect_stage_validation'}}})
      const {runs, hasMore} = await diagnostics.diagnosticRuns({days: 7, limit: 10, offset: 0, model: '', error: ''})
      assert.equal(hasMore, false)
      assert.equal(runs.length, 1)
      const run = runs[0]
      assert.equal(run.runId, 'run-x')
      assert.equal(run.failedAt, createdAt)
      assert.equal(run.reason, 'P03 校验失败')
      assert.equal(run.eventCount, 2)
      assert.equal(run.failedCalls, 1)
      assert.equal(run.attempts, 1)
      assert.equal(run.maxLatencyMs, 120)
      assert.equal(run.lastCallAt, lastCall)
      assert.deepEqual(run.models, ['deepseek-v4'])
      assert.deepEqual(run.errorCodes, ['P03_VALIDATION_FAILED'])
      assert.deepEqual(run.failureClasses, ['output_validation'])
      assert.equal(run.jobId, 'job-x')
      assert.equal(run.jobStage, 'matching')
      assert.equal(run.jobErrorCode, 'P03_VALIDATION_FAILED')
      assert.equal(run.jobAction, 'inspect_stage_validation')
      assert.equal(run.jobError, '岗位分析暂未完成，任务已停止。')
      assert.equal(run.retryable, false)
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('runs paginates with hasMore and latest-first ordering', () => {
    isolated(header + `
      seedSample('page-1', {createdAt: at(-30)})
      seedSample('page-2', {createdAt: at(-20)})
      seedSample('page-3', {createdAt: at(-10)})
      const page = await diagnostics.diagnosticRuns({days: 7, limit: 2, offset: 0, model: '', error: ''})
      assert.deepEqual(page.runs.map(run => run.runId), ['page-3', 'page-2'])
      assert.equal(page.hasMore, true)
      const next = await diagnostics.diagnosticRuns({days: 7, limit: 2, offset: 2, model: '', error: ''})
      assert.deepEqual(next.runs.map(run => run.runId), ['page-1'])
      assert.equal(next.hasMore, false)
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('model and error filters are case-insensitive and reject unsafe patterns', () => {
    isolated(header + `
      seedSample('f-m', {})
      seedCall('f-m', {eventKind: 'failed', model: 'glm-x', errorCode: 'GLM_BUSY'})
      seedSample('f-n', {})
      seedCall('f-n', {eventKind: 'failed', model: 'deepseek-v4', errorCode: 'HTTP_503', failureClass: 'provider_http'})
      seedSample('f-s', {reason: 'STREAM 不完整，服务中断'})
      seedCall('f-s', {eventKind: 'failed', model: 'deepseek-v4', errorCode: 'V5_STREAM', failureClass: 'stream_incomplete'})
      const byModel = await diagnostics.diagnosticRuns({days: 7, limit: 10, offset: 0, model: 'glm-x', error: ''})
      assert.deepEqual(byModel.runs.map(run => run.runId), ['f-m'])
      const byReason = await diagnostics.diagnosticRuns({days: 7, limit: 10, offset: 0, model: '', error: 'stream'})
      assert.deepEqual(byReason.runs.map(run => run.runId), ['f-s'])
      const byCode = await diagnostics.diagnosticRuns({days: 7, limit: 10, offset: 0, model: '', error: 'http_503'})
      assert.deepEqual(byCode.runs.map(run => run.runId), ['f-n'])
      let invalidError = null
      try { await diagnostics.diagnosticRuns({days: 7, limit: 10, offset: 0, model: '', error: 'bad%chars'}) } catch (error) { invalidError = error }
      assert.ok(invalidError instanceof DashboardAccessError)
      assert.equal(invalidError.code, 'DASHBOARD_INVALID_INPUT')
      assert.equal(invalidError.status, 400)
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('arrays are deduplicated, sorted and capped at 12 items', () => {
    isolated(header + `
      seedSample('many', {})
      for (let index = 0; index < 13; index += 1) {
        seedCall('many', {eventKind: 'failed', model: 'model-' + String(index).padStart(2, '0'), errorCode: 'CODE_' + index})
      }
      const {runs} = await diagnostics.diagnosticRuns({days: 7, limit: 10, offset: 0, model: '', error: ''})
      const run = runs.find(item => item.runId === 'many')
      assert.ok(run)
      assert.equal(run.models.length, 12)
      assert.equal(run.errorCodes.length, 12)
      assert.deepEqual(run.models, ['model-00', 'model-01', 'model-02', 'model-03', 'model-04', 'model-05', 'model-06', 'model-07', 'model-08', 'model-09', 'model-10', 'model-11'])
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('detail projects payloads, drops sensitive keys, filters by runId', () => {
    isolated(header + `
      seedSample('run-d', {reason: '分析失败', eventCount: 2})
      seedEvent('run-d', 'step.failed', {
        stepName: 'extract', errorCode: 'P01_FAIL', errorMessage: '处理失败，联系 support@reffo.cn',
        content: 'TOP-SECRET-RESUME', inputDigest: 'DIGEST-VALUE', message: 'raw model message',
        input: 'jd text', output: 'resume markdown', prompt: 'system prompt secret',
        retryIndex: 2, attemptNumber: 1, agentState: 'idle', issueCodes: ['P01_A', 'P01_B'],
      }, at(-5))
      seedEvent('run-d', 'workflow.failed', {workflowName: 'v5', errorCode: 'GENERATION_FAILED'}, at(-4))
      seedEvent('run-other', 'step.failed', {stepName: 'other', errorCode: 'OTHER'}, at(-3))
      seedCall('run-d', {eventKind: 'failed', errorCode: 'HTTP_502', failureClass: 'provider_http', providerStatus: 502})
      seedCall('run-other', {eventKind: 'failed', errorCode: 'NOPE'})
      seedJob({id: 'job-d', status: 'failed', stage: 'analysis', error: 'err-message',
        payload: {failure: {code: 'P01_FAIL', stage: 'analysis', runId: 'run-d', retryable: true, action: 'retry_preserved_checkpoint'}}})
      const detail = await diagnostics.diagnosticDetail('run-d')
      assert.equal(detail.events.length, 2)
      assert.equal(detail.events[0].type, 'step.failed')
      assert.equal(detail.events[1].type, 'workflow.failed')
      assert.deepEqual(detail.events[0].payload, {
        stepName: 'extract', errorCode: 'P01_FAIL', errorMessage: '处理失败，联系 [EMAIL]',
        retryIndex: 2, attemptNumber: 1, agentState: 'idle', issueCodes: ['P01_A', 'P01_B'],
      })
      assert.equal(detail.providerCalls.length, 1)
      assert.equal(detail.providerCalls[0].failureClass, 'provider_http')
      assert.equal(detail.providerCalls[0].providerStatus, 502)
      assert.equal(detail.providerCalls[0].errorCode, 'HTTP_502')
      assert.equal(detail.failureSample.reason, '分析失败')
      assert.equal(detail.job.failure.code, 'P01_FAIL')
      assert.equal(detail.job.failure.retryable, true)
      const serialized = JSON.stringify(detail)
      for (const sensitive of ['TOP-SECRET-RESUME', 'DIGEST-VALUE', 'raw model message', 'jd text', 'resume markdown', 'system prompt secret']) {
        assert.ok(!serialized.includes(sensitive), 'leaked ' + sensitive)
      }
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('missing run detail is empty', () => {
    isolated(header + `
      const detail = await diagnostics.diagnosticDetail('missing-run')
      assert.equal(detail.failureSample, null)
      assert.equal(detail.job, null)
      assert.deepEqual(detail.events, [])
      assert.deepEqual(detail.providerCalls, [])
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('safeHarnessPayload keeps only whitelisted scalars and truncates errorMessage', () => {
    isolated(header + `
      const payload = diagnostics.safeHarnessPayload({
        stepName: 'extract', errorCode: 'P01_FAIL', errorMessage: 'e'.repeat(400) + ' secret@example.com',
        content: 'drop', promptDigest: 'drop', input: 'drop', output: 'drop', message: 'drop',
        nested: {stepName: 'x'}, retryIndex: ['bad'], issueCodes: ['A', 1], agentState: null,
      })
      assert.deepEqual(payload, {stepName: 'extract', errorCode: 'P01_FAIL', errorMessage: 'e'.repeat(300), agentState: null})
      const fromString = diagnostics.safeHarnessPayload(JSON.stringify({stepName: 'parsed', content: 'drop'}))
      assert.deepEqual(fromString, {stepName: 'parsed'})
      console.log(JSON.stringify({ok: true}))
    `)
  })
})
