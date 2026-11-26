import type {SQLQueryBindings} from 'bun:sqlite'
import {env} from '@/config/env'
import {DashboardAccessError} from '@/auth/dashboard-access'
import {getDatabase} from './database'
import {dashboardClient} from './dashboard-client'
import {redactDashboardText} from '@/shared/dashboard-redaction'
import {ensureProviderCallColumns} from '@/services/provider-call-recorder'

// Harness/LLM 异常诊断数据访问：supabase 走 service-role RPC（SQL 见 202611200001_llm_diagnostics.sql），
// sqlite 走本地等价 SQL。所有对外对象均显式投影，列表里即使底层多返回字段也不会泄漏。

export interface DiagnosisSummary {
  days: number
  windowStart: string
  failedRuns: number
  failedJobs: number
  providerAttempts: number
  providerFailures: number
  failureRatePercent: number | null
  topErrorCodes: Array<{code: string; count: number}>
  topFailureClasses: Array<{class: string; count: number}>
  topModels: Array<{model: string; count: number}>
}
export interface DiagnosisRunItem {
  runId: string
  failedAt: string
  reason: string | null
  status: string
  eventCount: number
  failedCalls: number
  attempts: number
  maxLatencyMs: number | null
  lastCallAt: string | null
  models: string[]
  errorCodes: string[]
  failureClasses: string[]
  jobId: string | null
  jobStage: string | null
  jobErrorCode: string | null
  jobError: string | null
  jobAction: string | null
  retryable: boolean | null
}
export interface DiagnosisEventItem {
  id: string
  type: string
  stepRunId: string | null
  attemptId: string | null
  occurredAt: string
  payload: Record<string, unknown>
}
export interface DiagnosisProviderCallItem {
  id: string
  callId: string
  eventKind: string
  provider: string
  model: string
  stage: string | null
  retryIndex: number
  callReason: string | null
  occurredAt: string
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  providerRequestId: string | null
  errorCode: string | null
  failureClass: string | null
  providerStatus: number | null
}
export interface DiagnosisFailureSampleItem {
  id: string
  runId: string
  reason: string | null
  status: string
  eventCount: number
  createdAt: string
}
export interface DiagnosisJobItem {
  id: string
  status: string
  stage: string
  error: string | null
  createdAt: string
  updatedAt: string
  failure: Record<string, unknown> | null
}
export interface DiagnosisRunDetail {
  runId: string
  failureSample: DiagnosisFailureSampleItem | null
  job: DiagnosisJobItem | null
  events: DiagnosisEventItem[]
  providerCalls: DiagnosisProviderCallItem[]
}

const EVENTS_SELECT = 'id,type,step_run_id,attempt_id,occurred_at,payload_json'
const CALLS_SELECT = 'id,call_id,event_kind,provider,model,stage,retry_index,call_reason,occurred_at,latency_ms,input_tokens,output_tokens,reasoning_tokens,provider_request_id,error_code,failure_class,provider_status'
const SAMPLE_SELECT = 'id,run_id,reason,status,event_count,created_at'
const MAX_ARRAY_ITEMS = 12
const MAX_DETAIL_ROWS = 200
// 与 RPC 内校验一致：筛选参数只允许这些字符，保证 ilike/LIKE 模式不含通配符。
const SAFE_TEXT_FILTER = /^[a-zA-Z0-9_./:-]*$/

function startIso(days: number) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1)).toISOString()
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

// 事件 payload 白名单投影：只保留诊断必需的字段，任何含 prompt/Digest/Content/input/output/message
// 的 key 一律丢弃，避免把用户简历、JD 或提示词带进诊断接口。
const PAYLOAD_ALLOWED_KEYS = new Set([
  'stepName', 'errorCode', 'errorMessage', 'agentState', 'provider', 'model', 'callReason',
  'attemptNumber', 'workflowName', 'finishReason', 'issueCodes', 'transportMode', 'retryIndex',
])
const PAYLOAD_BLOCKED_KEY = /prompt|digest|content|input|output|message/i

export function safeHarnessPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { return {} }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    // errorMessage 在白名单内且按 300 截断脱敏；其余命中内容类 key 的一律丢弃。
    if (!PAYLOAD_ALLOWED_KEYS.has(key)) continue
    if (key !== 'errorMessage' && PAYLOAD_BLOCKED_KEY.test(key)) continue
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = key === 'errorMessage' ? redactDashboardText(String(value), 300) : value
      continue
    }
    // issueCodes 是诊断错误码列表（非内容），仅保留短字符串数组。
    if (key === 'issueCodes' && Array.isArray(value) && value.length <= 12 && value.every(item => typeof item === 'string')) {
      result[key] = value.slice(0, 12).map(item => String(item).slice(0, 100))
    }
  }
  return result
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function uniqueSortedLimited(values: Array<string | null>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  result.sort((a, b) => a.localeCompare(b))
  return result.slice(0, MAX_ARRAY_ITEMS)
}

// sqlite 侧四张表等价 schema；provider_calls 老库缺失新列由 ensureProviderCallColumns 补齐。
export function ensureDiagnosticsTables() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS harness_events (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, version INTEGER NOT NULL, run_id TEXT NOT NULL,
      request_id TEXT NOT NULL, step_run_id TEXT, attempt_id TEXT, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_diag_harness_events_run ON harness_events(run_id, occurred_at);
    CREATE TABLE IF NOT EXISTS harness_failure_samples (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, reason TEXT, status TEXT NOT NULL,
      event_count INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_diag_failure_samples_created ON harness_failure_samples(created_at);
    CREATE TABLE IF NOT EXISTS provider_calls (
      id TEXT PRIMARY KEY, call_id TEXT NOT NULL, event_kind TEXT NOT NULL, run_id TEXT, step_run_id TEXT,
      attempt_id TEXT, stage TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, retry_index INTEGER NOT NULL,
      call_reason TEXT, occurred_at TEXT NOT NULL, latency_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      reasoning_tokens INTEGER, provider_request_id TEXT, error_code TEXT, failure_class TEXT, provider_status INTEGER,
      expires_at TEXT NOT NULL, UNIQUE(call_id, event_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_diag_provider_calls_run ON provider_calls(run_id, occurred_at);
    CREATE TABLE IF NOT EXISTS resume_generation_jobs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
      background INTEGER NOT NULL DEFAULT 0, read_at TEXT, confirmed_at TEXT, history_id TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_token TEXT, lease_expires_at TEXT NOT NULL,
      quota_charged INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
    );`)
  ensureProviderCallColumns(db)
  return db
}

function database() {
  return ensureDiagnosticsTables()
}

let queryInFlight = 0
const cache = new Map<string, {until: number; value: unknown}>()
const pending = new Map<string, Promise<unknown>>()
async function boundedDiagnostics<T>(key: string, query: () => Promise<T>): Promise<T> {
  const cached = cache.get(key)
  if (cached && cached.until > Date.now()) return cached.value as T
  const running = pending.get(key)
  if (running) return running as Promise<T>
  if (queryInFlight >= 4) throw new Error('Dashboard aggregation busy')
  queryInFlight++
  const promise = query().then(value => {
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(key, {until: Date.now() + 15_000, value})
    return value
  }).finally(() => { queryInFlight--; pending.delete(key) })
  pending.set(key, promise)
  return promise
}

function assertDiagnosticFilters(model: string, error: string) {
  if (model.length > 120 || error.length > 120 || !SAFE_TEXT_FILTER.test(model) || !SAFE_TEXT_FILTER.test(error)) {
    throw new DashboardAccessError('DASHBOARD_INVALID_INPUT', '诊断筛选参数无效', 400)
  }
}

export function diagnosticSummary(days: number): Promise<DiagnosisSummary> {
  return boundedDiagnostics(JSON.stringify(['diagnostics-summary', env.DATABASE_PROVIDER, env.SUPABASE_URL, days]), async () => {
    if (env.DATABASE_PROVIDER === 'supabase') {
      return dashboardClient().request<DiagnosisSummary>('/rest/v1/rpc/dashboard_diagnostic_summary', {method: 'POST', body: {p_days: days}})
    }
    const db = database()
    const cutoff = startIso(days)
    const countOne = (sql: string, ...args: SQLQueryBindings[]) => (db.query(sql).get(...args) as {n: number}).n
    const failedRuns = countOne('SELECT COUNT(*) AS n FROM harness_failure_samples WHERE created_at >= ?', cutoff)
    const failedJobs = countOne('SELECT COUNT(*) AS n FROM resume_generation_jobs WHERE status = ? AND updated_at >= ?', 'failed', cutoff)
    const attempts = countOne("SELECT COUNT(*) AS n FROM provider_calls WHERE event_kind IN ('completed','failed') AND occurred_at >= ?", cutoff)
    const failures = countOne("SELECT COUNT(*) AS n FROM provider_calls WHERE event_kind = 'failed' AND occurred_at >= ?", cutoff)
    const topErrors = db.query("SELECT COALESCE(NULLIF(error_code,''),'unknown') AS code, COUNT(*) AS count FROM provider_calls WHERE event_kind = 'failed' AND occurred_at >= ? GROUP BY code ORDER BY count DESC, code ASC LIMIT 8").all(cutoff) as Array<{code: string; count: number}>
    const topClasses = db.query("SELECT COALESCE(failure_class,'unclassified') AS class, COUNT(*) AS count FROM provider_calls WHERE event_kind = 'failed' AND occurred_at >= ? GROUP BY class ORDER BY count DESC, class ASC LIMIT 8").all(cutoff) as Array<{class: string; count: number}>
    const topModels = db.query('SELECT model, COUNT(*) AS count FROM provider_calls WHERE occurred_at >= ? GROUP BY model ORDER BY count DESC, model ASC LIMIT 8').all(cutoff) as Array<{model: string; count: number}>
    return {
      days,
      windowStart: cutoff,
      failedRuns,
      failedJobs,
      providerAttempts: attempts,
      providerFailures: failures,
      failureRatePercent: attempts > 0 ? round1((100 * failures) / attempts) : null,
      topErrorCodes: topErrors,
      topFailureClasses: topClasses,
      topModels,
    }
  })
}

interface SampleRow { id: string; run_id: string; reason: string | null; status: string; event_count: number; created_at: string }
interface ProviderCallAggRow { run_id: string; event_kind: string; latency_ms: number | null; occurred_at: string; model: string; error_code: string | null; failure_class: string | null }
interface JobRow { id: string; status: string; stage: string; error: string | null; created_at: string; updated_at: string; payload: unknown }
interface JobFailureInfo { jobId: string | null; jobStage: string | null; jobErrorCode: string | null; jobError: string | null; jobAction: string | null; retryable: boolean | null }

function jobFailureInfo(payload: unknown): {code: string | null; action: string | null; retryable: boolean | null} {
  const parsed = parseJsonObject(payload)
  const failure = parsed.failure && typeof parsed.failure === 'object' && !Array.isArray(parsed.failure) ? parsed.failure as Record<string, unknown> : null
  if (!failure) return {code: null, action: null, retryable: null}
  return {
    code: typeof failure.code === 'string' ? failure.code : null,
    action: typeof failure.action === 'string' ? failure.action : null,
    retryable: typeof failure.retryable === 'boolean' ? failure.retryable : null,
  }
}

function failureRunId(payload: unknown): string | null {
  const parsed = parseJsonObject(payload)
  const failure = parsed.failure && typeof parsed.failure === 'object' && !Array.isArray(parsed.failure) ? parsed.failure as Record<string, unknown> : null
  return typeof failure?.runId === 'string' ? failure.runId : null
}

export async function diagnosticRuns(filters: {days: number; limit: number; offset: number; model: string; error: string}): Promise<{runs: DiagnosisRunItem[]; hasMore: boolean}> {
  const key = JSON.stringify(['diagnostics-runs', env.DATABASE_PROVIDER, env.SUPABASE_URL, filters])
  if (env.DATABASE_PROVIDER === 'supabase') {
    return boundedDiagnostics(key, async () => dashboardClient().request<{runs: DiagnosisRunItem[]; hasMore: boolean}>('/rest/v1/rpc/dashboard_diagnostic_runs', {
      method: 'POST', body: {p_days: filters.days, p_limit: filters.limit, p_offset: filters.offset, p_model: filters.model, p_error: filters.error},
    }))
  }
  assertDiagnosticFilters(filters.model, filters.error)
  return boundedDiagnostics(key, async () => {
    const db = database()
    const cutoff = startIso(filters.days)
    const where: string[] = ['fs.created_at >= ?']
    const args: SQLQueryBindings[] = [cutoff]
    if (filters.model) {
      where.push('EXISTS (SELECT 1 FROM provider_calls pc WHERE pc.run_id = fs.run_id AND pc.model = ?)')
      args.push(filters.model)
    }
    if (filters.error) {
      // 与 RPC ilike 对齐：大小写不敏感包含匹配；字符已白名单校验，escape 仅作纵深防御。
      const pattern = '%' + escapeLike(filters.error) + '%'
      where.push(`(fs.reason LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM provider_calls pc WHERE pc.run_id = fs.run_id
        AND pc.event_kind = 'failed' AND (COALESCE(pc.error_code,'') LIKE ? ESCAPE '\\' OR COALESCE(pc.failure_class,'') LIKE ? ESCAPE '\\')))`)
      args.push(pattern, pattern, pattern)
    }
    const rows = db.query(`SELECT id, run_id, reason, status, event_count, created_at FROM harness_failure_samples fs
      WHERE ${where.join(' AND ')} ORDER BY fs.created_at DESC, fs.id DESC LIMIT ? OFFSET ?`)
      .all(...args, filters.limit + 1, filters.offset) as SampleRow[]
    const page = rows.slice(0, filters.limit)
    const runIds = page.map(row => row.run_id)
    const callRows: ProviderCallAggRow[] = []
    const jobRows: JobRow[] = []
    if (runIds.length) {
      const placeholders = runIds.map(() => '?').join(',')
      callRows.push(...db.query(`SELECT run_id, event_kind, latency_ms, occurred_at, model, error_code, failure_class
        FROM provider_calls WHERE run_id IN (${placeholders})`).all(...runIds) as ProviderCallAggRow[])
      jobRows.push(...db.query(`SELECT id, status, stage, error, created_at, updated_at, payload
        FROM resume_generation_jobs WHERE json_extract(payload, '$.failure.runId') IN (${placeholders}) ORDER BY updated_at DESC`)
        .all(...runIds) as JobRow[])
    }
    const callsByRun = new Map<string, ProviderCallAggRow[]>()
    for (const row of callRows) {
      const entries = callsByRun.get(row.run_id) ?? []
      entries.push(row)
      callsByRun.set(row.run_id, entries)
    }
    const jobByRun = new Map<string, JobFailureInfo>()
    for (const row of jobRows) {
      const runId = failureRunId(row.payload)
      if (!runId || jobByRun.has(runId)) continue
      const failure = jobFailureInfo(row.payload)
      jobByRun.set(runId, {
        jobId: row.id,
        jobStage: row.stage,
        jobErrorCode: failure.code,
        jobError: row.error ? redactDashboardText(row.error, 500) : null,
        jobAction: failure.action,
        retryable: failure.retryable,
      })
    }
    const runs = page.map((sample): DiagnosisRunItem => {
      const calls = callsByRun.get(sample.run_id) ?? []
      const failed = calls.filter(row => row.event_kind === 'failed')
      const terminal = calls.filter(row => row.event_kind === 'completed' || row.event_kind === 'failed')
      const maxLatency = calls.reduce<number | null>((max, row) => row.latency_ms !== null && (max === null || row.latency_ms > max) ? row.latency_ms : max, null)
      const lastCallAt = calls.reduce<string | null>((last, row) => last === null || row.occurred_at > last ? row.occurred_at : last, null)
      const job = jobByRun.get(sample.run_id)
      return {
        runId: sample.run_id,
        failedAt: sample.created_at,
        reason: sample.reason ? redactDashboardText(sample.reason, 500) : null,
        status: sample.status,
        eventCount: sample.event_count,
        failedCalls: failed.length,
        attempts: terminal.length,
        maxLatencyMs: maxLatency,
        lastCallAt,
        models: uniqueSortedLimited(calls.map(row => row.model)),
        errorCodes: uniqueSortedLimited(failed.map(row => row.error_code)),
        failureClasses: uniqueSortedLimited(failed.map(row => row.failure_class)),
        jobId: job?.jobId ?? null,
        jobStage: job?.jobStage ?? null,
        jobErrorCode: job?.jobErrorCode ?? null,
        jobError: job?.jobError ?? null,
        jobAction: job?.jobAction ?? null,
        retryable: job?.retryable ?? null,
      }
    })
    return {runs, hasMore: rows.length > filters.limit}
  })
}

export async function listHarnessEvents(runId: string): Promise<DiagnosisEventItem[]> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    const rows = await dashboardClient().request<Array<{id: string; type: string; step_run_id: string | null; attempt_id: string | null; occurred_at: string; payload_json: unknown}>>('/rest/v1/harness_events', {
      searchParams: {select: EVENTS_SELECT, run_id: 'eq.' + runId, order: 'occurred_at.asc,id.asc', limit: MAX_DETAIL_ROWS},
    })
    return rows.map(row => ({id: row.id, type: row.type, stepRunId: row.step_run_id, attemptId: row.attempt_id, occurredAt: row.occurred_at, payload: safeHarnessPayload(row.payload_json)}))
  }
  const rows = database().query(`SELECT ${EVENTS_SELECT} FROM harness_events WHERE run_id = ? ORDER BY occurred_at ASC, id ASC LIMIT ?`).all(runId, MAX_DETAIL_ROWS) as Array<{id: string; type: string; step_run_id: string | null; attempt_id: string | null; occurred_at: string; payload_json: string}>
  return rows.map(row => ({id: row.id, type: row.type, stepRunId: row.step_run_id, attemptId: row.attempt_id, occurredAt: row.occurred_at, payload: safeHarnessPayload(row.payload_json)}))
}

interface ProviderCallRow {
  id: string
  call_id: string
  event_kind: string
  provider: string
  model: string
  stage: string | null
  retry_index: number
  call_reason: string | null
  occurred_at: string
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  provider_request_id: string | null
  error_code: string | null
  failure_class: string | null
  provider_status: number | null
}

function toProviderCallItem(row: ProviderCallRow): DiagnosisProviderCallItem {
  return {
    id: row.id,
    callId: row.call_id,
    eventKind: row.event_kind,
    provider: row.provider,
    model: row.model,
    stage: row.stage,
    retryIndex: row.retry_index,
    callReason: row.call_reason,
    occurredAt: row.occurred_at,
    latencyMs: row.latency_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    providerRequestId: row.provider_request_id,
    errorCode: row.error_code,
    failureClass: row.failure_class,
    providerStatus: row.provider_status,
  }
}

export async function listProviderCalls(runId: string): Promise<DiagnosisProviderCallItem[]> {
  let rows: ProviderCallRow[]
  if (env.DATABASE_PROVIDER === 'supabase') {
    rows = await dashboardClient().request<ProviderCallRow[]>('/rest/v1/provider_calls', {
      searchParams: {select: CALLS_SELECT, run_id: 'eq.' + runId, order: 'occurred_at.asc,id.asc', limit: MAX_DETAIL_ROWS},
    })
  } else {
    rows = database().query(`SELECT ${CALLS_SELECT} FROM provider_calls WHERE run_id = ? ORDER BY occurred_at ASC, id ASC LIMIT ?`).all(runId, MAX_DETAIL_ROWS) as ProviderCallRow[]
  }
  return rows.map(toProviderCallItem)
}

export async function findFailureSample(runId: string): Promise<DiagnosisFailureSampleItem | null> {
  let row: SampleRow | null
  if (env.DATABASE_PROVIDER === 'supabase') {
    const rows = await dashboardClient().request<SampleRow[]>('/rest/v1/harness_failure_samples', {
      searchParams: {select: SAMPLE_SELECT, run_id: 'eq.' + runId, limit: 1},
    })
    row = rows[0] ?? null
  } else {
    row = database().query(`SELECT ${SAMPLE_SELECT} FROM harness_failure_samples WHERE run_id = ? LIMIT 1`).get(runId) as SampleRow | null
  }
  if (!row) return null
  return {id: row.id, runId: row.run_id, reason: row.reason ? redactDashboardText(row.reason, 500) : null, status: row.status, eventCount: row.event_count, createdAt: row.created_at}
}

export async function findJobByRunId(runId: string): Promise<DiagnosisJobItem | null> {
  let row: JobRow | null
  if (env.DATABASE_PROVIDER === 'supabase') {
    const rows = await dashboardClient().request<Array<{id: string; status: string; stage: string; error: string | null; created_at: string; updated_at: string; failure?: unknown} & Record<string, unknown>>>('/rest/v1/resume_generation_jobs', {
      searchParams: {select: 'id,status,stage,error,created_at,updated_at,payload->failure', 'payload->failure->>runId': 'eq.' + runId, limit: 1},
    })
    const first = rows[0]
    // PostgREST 对 jsonb 操作符列按表达式原文作键名，兼容 failure / payload->failure 两种形态。
    const failureValue = first ? (first.failure ?? first['payload->failure']) : null
    row = first ? {id: first.id, status: first.status, stage: first.stage, error: first.error, created_at: first.created_at, updated_at: first.updated_at, payload: {failure: failureValue}} : null
  } else {
    row = database().query(`SELECT id, status, stage, error, created_at, updated_at, payload
      FROM resume_generation_jobs WHERE json_extract(payload, '$.failure.runId') = ? ORDER BY updated_at DESC LIMIT 1`).get(runId) as JobRow | null
  }
  if (!row) return null
  const parsed = parseJsonObject(row.payload)
  const failure = parsed.failure && typeof parsed.failure === 'object' && !Array.isArray(parsed.failure) ? parsed.failure as Record<string, unknown> : null
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    error: row.error ? redactDashboardText(row.error, 500) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    failure,
  }
}

export async function diagnosticDetail(runId: string): Promise<DiagnosisRunDetail> {
  const [events, providerCalls, failureSample, job] = await Promise.all([
    listHarnessEvents(runId),
    listProviderCalls(runId),
    findFailureSample(runId),
    findJobByRunId(runId),
  ])
  return {runId, failureSample, job, events, providerCalls}
}
