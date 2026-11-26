import { randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
import { errorFingerprint, normalizeText } from './error-fingerprint'
import { logger } from './logger'
import { getTraceId } from './request-context'

export interface ReportErrorInput {
  path?: string
  method?: string
  status?: number
  errorCode?: string
  context?: Record<string, unknown>
  error: unknown
}

interface ErrorEventRow {
  id: string
  trace_id: string
  session_id: string | null
  user_id: string | null
  fingerprint: string
  path: string
  method: string
  status: number | null
  error_code: string | null
  error_message: string
  error_stack: string | null
  context: Record<string, unknown>
  created_at: string
}

function buildRecord(input: ReportErrorInput): ErrorEventRow {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error))
  return {
    id: randomUUID(),
    trace_id: getTraceId() ?? '',
    session_id: null,
    user_id: null,
    fingerprint: errorFingerprint(error),
    path: input.path ?? '',
    method: input.method ?? '',
    status: input.status ?? null,
    error_code: input.errorCode ?? null,
    error_message: error.message,
    error_stack: error.stack ?? null,
    context: input.context ?? {},
    created_at: new Date().toISOString(),
  }
}

function ensureSqliteTable() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS error_events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    session_id TEXT,
    user_id TEXT,
    fingerprint TEXT NOT NULL,
    path TEXT NOT NULL,
    method TEXT NOT NULL,
    status INTEGER,
    error_code TEXT,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    context TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_error_events_trace_id ON error_events(trace_id);
  CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint ON error_events(fingerprint, created_at);`)
  return db
}

async function persist(record: ErrorEventRow) {
  if (env.DATABASE_PROVIDER === 'supabase') {
    await createSupabaseRestClient({ useServiceRole: true }).request('/rest/v1/error_events', {
      method: 'POST',
      body: record,
    })
    return
  }
  const db = ensureSqliteTable()
  db.query(`INSERT INTO error_events
    (id, trace_id, session_id, user_id, fingerprint, path, method, status, error_code, error_message, error_stack, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(record.id, record.trace_id, record.session_id, record.user_id, record.fingerprint,
      record.path, record.method, record.status, record.error_code, record.error_message,
      record.error_stack, JSON.stringify(record.context), record.created_at)
}

// 同签名错误 5 分钟内只上报一次，防止高频噪声（如过期会话轮询）淹没异常表。
const ERROR_REPORT_DEDUPE_WINDOW_MS = 5 * 60 * 1000
const recentErrorReports = new Map<string, number>()

function errorSignature(input: ReportErrorInput): string {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error))
  return [input.path ?? '', input.method ?? '', input.errorCode ?? '', error.name, normalizeText(error.message)].join('|')
}

/** 异步上报异常：不阻塞请求，Supabase 写入失败降级到日志。 */
export function reportError(input: ReportErrorInput): void {
  const now = Date.now()
  const signature = errorSignature(input)
  const lastReportedAt = recentErrorReports.get(signature)
  if (lastReportedAt !== undefined && now - lastReportedAt < ERROR_REPORT_DEDUPE_WINDOW_MS) {
    return
  }
  recentErrorReports.set(signature, now)
  if (recentErrorReports.size > 2000) {
    for (const [key, at] of recentErrorReports) {
      if (now - at >= ERROR_REPORT_DEDUPE_WINDOW_MS) recentErrorReports.delete(key)
    }
  }

  const record = buildRecord(input)
  void persist(record).catch(error => {
    // fallback：连不上 Supabase 也保留到日志
    logger.error('[ErrorEvent] 异常上报失败，降级到日志', error)
    logger.error('[ErrorEvent] ' + record.fingerprint + ' ' + record.error_message, record.error_stack ?? undefined)
  })
}
