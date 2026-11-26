import {describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

// 同进程内多个测试文件共享模块注册表，env 相关 sqlite 单例会在文件间串扰；
// 沿用 isolated() 子进程模式：每个用例独立进程、独立库、独立 provider 注入。
function isolated(script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'reffo-diag-analysis-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', script + '\nprocess.exit(0)'], {
      cwd: join(import.meta.dir, '../..'),
      env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: 'sqlite', AUTH_REQUIRED: 'false',
        SQLITE_DATABASE_PATH: join(directory, 'diagnostics.sqlite'),
        HARNESS_DATABASE_PATH: join(directory, 'harness.sqlite'),
        SUPABASE_URL: 'https://diagnostics.invalid', SUPABASE_SECRET_KEY: 'test-key',
        OPENAI_API_KEY: 'test-key'},
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
const analysis = await import('./src/services/diagnostic-analysis.ts')
const diagnostics = await import('./src/repositories/dashboard-diagnostics.ts')
const {env} = await import('./src/config/env.ts')
const {DashboardAccessError} = await import('./src/auth/dashboard-access.ts')
const db = diagnostics.ensureDiagnosticsTables()
const t1 = '2026-11-20T01:00:00.000Z'
const t2 = '2026-11-20T01:00:05.000Z'
const t3 = '2026-11-20T01:00:09.000Z'
const validAnalysis = {
  conclusion: '模型服务返回 502，属于 provider 端临时故障。',
  confidence: 'high',
  rootCauseClass: 'provider_http',
  confirmedEvidence: ['2026-11-20T01:00:00Z HTTP_502 provider_http'],
  uncertainFactors: [],
  recommendedActions: ['检查 provider 侧状态'],
  followUpQuestions: [],
}
function seedEvidenceRun() {
  db.query('INSERT INTO harness_failure_samples (id, run_id, reason, status, event_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('run-ev-sample', 'run-ev', '分析失败', 'failed', 3, '2026-11-20T01:00:10.000Z')
  const insertEvent = (id, type, stepRunId, occurredAt, payload) => db.query('INSERT INTO harness_events (id, type, version, run_id, request_id, step_run_id, attempt_id, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, type, 1, 'run-ev', 'req-1', stepRunId, null, occurredAt, JSON.stringify(payload))
  insertEvent('ev-1', 'step.failed', 'step-extract', t1, {stepName: 'extract', errorCode: 'P01_FAIL', content: 'TOP-SECRET-RESUME'})
  insertEvent('ev-2', 'step.failed', 'step-extract', t2, {stepName: 'extract', errorCode: 'P01_BAD', inputDigest: 'DIGEST-VALUE'})
  insertEvent('ev-3', 'workflow.failed', null, t3, {workflowName: 'v5', errorCode: 'GENERATION_FAILED'})
  db.query('INSERT INTO provider_calls (id, call_id, event_kind, run_id, step_run_id, attempt_id, stage, provider, model, retry_index, call_reason, occurred_at, latency_ms, input_tokens, output_tokens, reasoning_tokens, provider_request_id, error_code, failure_class, provider_status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('pc-1', 'pc-1-cid', 'failed', 'run-ev', null, null, null, 'deepseek', 'deepseek-v4', 0, null, t2, 90, null, null, null, null, 'HTTP_502', 'provider_http', 502, '2026-11-22T00:00:00.000Z')
  db.query('INSERT INTO resume_generation_jobs (id, user_id, status, stage, error, created_at, updated_at, lease_expires_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('job-ev', '11111111-1111-4111-8111-111111111111', 'failed', 'analysis', '源简历分析暂未完成，任务已停止。', t3, t3, t3, JSON.stringify({failure: {code: 'P01_FAIL', stage: 'analysis', runId: 'run-ev', retryable: true, action: 'retry_preserved_checkpoint'}}))
}
function fakeProvider(contents) {
  const calls = []
  let index = 0
  return {
    calls,
    complete: async (input) => {
      calls.push({input})
      const content = contents[Math.min(index, contents.length - 1)]
      index += 1
      return {provider: 'test', model: input.model ?? 'test-model', content, latencyMs: 1}
    },
  }
}
seedEvidenceRun()
`

describe('diagnostic-analysis', () => {
  test('builds compact evidence with timeline, step errors and job failure without sensitive content', () => {
    isolated(header + `
      const evidence = await analysis.buildEvidence('run-ev')
      assert.equal(evidence.runId, 'run-ev')
      const stepFailed = evidence.timeline.find(item => item.type === 'step.failed')
      assert.deepEqual(stepFailed, {type: 'step.failed', count: 2, firstAt: t1, lastAt: t2})
      const extract = evidence.steps.find(item => item.stepName === 'extract')
      assert.deepEqual(extract.errorCodes, ['P01_BAD', 'P01_FAIL'])
      assert.equal(evidence.failureSample.runId, 'run-ev')
      assert.equal(evidence.job.failureCode, 'P01_FAIL')
      assert.equal(evidence.job.failureAction, 'retry_preserved_checkpoint')
      assert.equal(evidence.job.retryable, true)
      assert.equal(evidence.job.stage, 'analysis')
      assert.equal(evidence.providerCalls.length, 1)
      const serialized = JSON.stringify(evidence)
      assert.ok(!serialized.includes('TOP-SECRET-RESUME'))
      assert.ok(!serialized.includes('DIGEST-VALUE'))
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('parses valid provider JSON with bounded request parameters', () => {
    isolated(header + `
      const provider = fakeProvider([JSON.stringify(validAnalysis)])
      const result = await analysis.analyzeRun('run-ev', provider)
      assert.deepEqual(result.analysis, validAnalysis)
      assert.equal(result.model, env.AI_MODEL)
      assert.ok(Number.isFinite(Date.parse(result.analyzedAt)))
      assert.equal(result.events.length, 3)
      assert.equal(result.providerCalls.length, 1)
      assert.equal(provider.calls.length, 1)
      const input = provider.calls[0].input
      assert.equal(input.model, env.AI_MODEL)
      assert.equal(input.temperature, 0)
      assert.equal(input.maxOutputTokens, 1000)
      assert.equal(input.responseFormat, 'json_object')
      assert.equal(input.messages[0].role, 'system')
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('retries once after JSON parse failure with a validation hint', () => {
    isolated(header + `
      const provider = fakeProvider(['not-json', JSON.stringify(validAnalysis)])
      const result = await analysis.analyzeRun('run-ev', provider)
      assert.equal(result.analysis.conclusion, validAnalysis.conclusion)
      assert.equal(provider.calls.length, 2)
      assert.ok(provider.calls[1].input.messages[1].content.includes('不是有效 JSON'))
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('retries once after zod failure then throws 502 on second failure', () => {
    isolated(header + `
      const provider = fakeProvider(['{"conclusion": 123}', '{"conclusion": 123}'])
      const error = await analysis.analyzeRun('run-ev', provider).catch(caught => caught)
      assert.ok(error instanceof DashboardAccessError)
      assert.equal(error.code, 'DASHBOARD_ANALYSIS_FAILED')
      assert.equal(error.status, 502)
      assert.equal(provider.calls.length, 2)
      assert.ok(provider.calls[1].input.messages[1].content.includes('未通过结果校验'))
      assert.ok(provider.calls[1].input.messages[1].content.includes('conclusion'))
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('rejects out-of-bound fields after one retry with the offending path in the hint', () => {
    isolated(header + `
      const oversized = {...validAnalysis, conclusion: 'c'.repeat(601), confirmedEvidence: Array.from({length: 13}, (_, index) => 'evidence-' + index)}
      const provider = fakeProvider([JSON.stringify(oversized), JSON.stringify(oversized)])
      const error = await analysis.analyzeRun('run-ev', provider).catch(caught => caught)
      assert.ok(error instanceof DashboardAccessError)
      assert.equal(error.code, 'DASHBOARD_ANALYSIS_FAILED')
      assert.equal(error.status, 502)
      assert.equal(provider.calls.length, 2)
      assert.ok(provider.calls[1].input.messages[1].content.includes('conclusion'))
      console.log(JSON.stringify({ok: true}))
    `)
  })

  test('provider failure maps to 502 without a retry', () => {
    isolated(header + `
      let calls = 0
      const provider = {complete: async () => { calls += 1; throw new Error('provider down') }}
      const error = await analysis.analyzeRun('run-ev', provider).catch(caught => caught)
      assert.ok(error instanceof DashboardAccessError)
      assert.equal(error.code, 'DASHBOARD_ANALYSIS_FAILED')
      assert.equal(error.status, 502)
      assert.equal(calls, 1)
      console.log(JSON.stringify({ok: true}))
    `)
  })
})
