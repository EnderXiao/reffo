import { Elysia, t } from 'elysia'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { createSupabaseRestClient } from '@/repositories/supabase/client'

interface ErrorRow {
  trace_id: string
  fingerprint: string
  path: string
  method: string
  status: number | null
  error_code: string | null
  error_message: string
  created_at: string
}

interface AnalyticsRow {
  session_id: string
  trace_id: string | null
  event_name: string
  properties: Record<string, unknown>
  created_at: string
}

const errorSelect = 'trace_id,fingerprint,path,method,status,error_code,error_message,created_at'

async function queryErrorsSupabase(searchParams: Record<string, string>, limit: number, offset: number): Promise<{ rows: ErrorRow[]; total: number }> {
  const client = createSupabaseRestClient({ useServiceRole: true })
  const rows = await client.request<ErrorRow[]>('/rest/v1/error_events', {
    searchParams: { select: errorSelect, ...searchParams, limit: String(limit), offset: String(offset), order: 'created_at.desc' },
  })
  // 总数（简化：不精确计数，前端用「是否还有下一页」判断）
  return { rows, total: rows.length }
}

function queryErrorsSqlite(searchParams: Record<string, string>, limit: number, offset: number): { rows: ErrorRow[]; total: number } {
  const db = getDatabase()
  const where: string[] = []
  const args: Array<string | number> = []
  if (searchParams.trace_id) { where.push('trace_id = ?'); args.push(searchParams.trace_id) }
  if (searchParams.fingerprint) { where.push('fingerprint = ?'); args.push(searchParams.fingerprint) }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''
  const rows = db.query(`SELECT ${errorSelect.replace(/,/g, ', ')} FROM error_events ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as unknown as ErrorRow[]
  return { rows, total: rows.length }
}

async function queryErrors(searchParams: Record<string, string>, limit: number, offset: number) {
  if (env.DATABASE_PROVIDER === 'supabase') return queryErrorsSupabase(searchParams, limit, offset)
  return queryErrorsSqlite(searchParams, limit, offset)
}

async function queryAllErrors(limit: number): Promise<ErrorRow[]> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return createSupabaseRestClient({ useServiceRole: true }).request<ErrorRow[]>('/rest/v1/error_events', {
      searchParams: { select: errorSelect, limit: String(limit), order: 'created_at.desc' },
    })
  }
  const db = getDatabase()
  return db.query(`SELECT ${errorSelect.replace(/,/g, ', ')} FROM error_events ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as ErrorRow[]
}

async function queryAnalyticsByTraceId(traceId: string): Promise<AnalyticsRow[]> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return createSupabaseRestClient({ useServiceRole: true }).request<AnalyticsRow[]>('/rest/v1/analytics_events', {
      searchParams: { select: 'session_id,trace_id,event_name,properties,created_at', trace_id: `eq.${traceId}`, order: 'created_at.desc', limit: '50' },
    })
  }
  const db = getDatabase()
  return db.query('SELECT session_id, trace_id, event_name, properties, created_at FROM analytics_events WHERE trace_id = ? ORDER BY created_at DESC LIMIT 50').all(traceId) as unknown as AnalyticsRow[]
}

function groupByFingerprint(errors: ErrorRow[]) {
  const grouped = new Map<string, { fingerprint: string; count: number; latestMessage: string; latestPath: string; latestAt: string }>()
  for (const error of errors) {
    const existing = grouped.get(error.fingerprint)
    if (existing) { existing.count += 1 }
    else grouped.set(error.fingerprint, { fingerprint: error.fingerprint, count: 1, latestMessage: error.error_message, latestPath: error.path, latestAt: error.created_at })
  }
  return Array.from(grouped.values()).sort((a, b) => b.count - a.count)
}

function groupByDay(errors: ErrorRow[], days: number) {
  const buckets = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    buckets.set(d.toISOString().slice(0, 10), 0)
  }
  for (const error of errors) {
    const day = error.created_at.slice(0, 10)
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }))
}

export const dashboardRoutes = new Elysia({ prefix: '/api/v1/dashboard' })
  .get('/errors', async ({ query }) => {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
    const offset = Math.max(Number(query.offset) || 0, 0)
    const searchParams: Record<string, string> = {}
    if (query.traceId) searchParams.trace_id = `eq.${query.traceId}`
    if (query.fingerprint) searchParams.fingerprint = `eq.${query.fingerprint}`
    const { rows } = await queryErrors(searchParams, limit, offset)
    return { success: true, data: { errors: rows, hasMore: rows.length === limit } }
  }, { query: t.Object({ limit: t.Optional(t.String()), offset: t.Optional(t.String()), traceId: t.Optional(t.String()), fingerprint: t.Optional(t.String()) }) })
  .get('/issues', async () => {
    const errors = await queryAllErrors(200)
    return { success: true, data: { issues: groupByFingerprint(errors) } }
  })
  .get('/trend', async ({ query }) => {
    const days = Math.min(Math.max(Number(query.days) || 7, 1), 30)
    const errors = await queryAllErrors(500)
    return { success: true, data: { trend: groupByDay(errors, days) } }
  }, { query: t.Object({ days: t.Optional(t.String()) }) })
  .get('/error/:traceId', async ({ params }) => {
    const { rows } = await queryErrors({ trace_id: `eq.${params.traceId}` }, 20, 0)
    const events = await queryAnalyticsByTraceId(params.traceId)
    return { success: true, data: { traceId: params.traceId, errors: rows, relatedEvents: events } }
  })
