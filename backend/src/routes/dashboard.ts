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
  error_stack: string | null
  context: Record<string, unknown>
  created_at: string
}

interface AnalyticsRow {
  session_id: string
  trace_id: string | null
  event_name: string
  properties: Record<string, unknown>
  created_at: string
}

const errorSelect = 'trace_id,fingerprint,path,method,status,error_code,error_message,error_stack,context,created_at'

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
  const raw = db.query(`SELECT ${errorSelect.replace(/,/g, ', ')} FROM error_events ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Array<Record<string, unknown>>
  const rows = raw.map((r) => ({ ...r, context: typeof r.context === 'string' ? JSON.parse(r.context as string) : (r.context ?? {}) })) as unknown as ErrorRow[]
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

async function queryAnalyticsList(limit: number, offset: number): Promise<AnalyticsRow[]> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return createSupabaseRestClient({ useServiceRole: true }).request<AnalyticsRow[]>('/rest/v1/analytics_events', {
      searchParams: { select: 'session_id,trace_id,event_name,properties,created_at', limit: String(limit), offset: String(offset), order: 'created_at.desc' },
    })
  }
  const db = getDatabase()
  return db.query('SELECT session_id, trace_id, event_name, properties, created_at FROM analytics_events ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as unknown as AnalyticsRow[]
}

function groupByEventName(events: AnalyticsRow[]) {
  const grouped = new Map<string, { event_name: string; count: number; latestAt: string }>()
  for (const event of events) {
    const existing = grouped.get(event.event_name)
    if (existing) existing.count += 1
    else grouped.set(event.event_name, { event_name: event.event_name, count: 1, latestAt: event.created_at })
  }
  return Array.from(grouped.values()).sort((a, b) => b.count - a.count)
}

type GroupByKey = 'day' | 'hour' | 'event_name' | 'fingerprint' | 'path' | 'status' | 'method' | 'day_series'

async function queryDaySeries(source: 'errors' | 'analytics', dimension: 'event_name' | 'fingerprint', rangeDays: number, topN: number) {
  const since = new Date(Date.now() - rangeDays * 86400000).toISOString()
  const raw: Array<ErrorRow | AnalyticsRow> = source === 'errors'
    ? (await queryAllErrors(1000)).filter((r) => r.created_at >= since)
    : (await queryAnalyticsList(1000, 0)).filter((r) => r.created_at >= since)
  const byDay = new Map<string, Map<string, number>>()
  for (const row of raw) {
    const day = row.created_at.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, new Map())
    const dim = dimension === 'event_name' ? (row as AnalyticsRow).event_name : (row as ErrorRow).fingerprint
    const dayMap = byDay.get(day)!
    dayMap.set(dim, (dayMap.get(dim) ?? 0) + 1)
  }
  const result: Array<{ key: string; value: number; series: Array<{ key: string; value: number }> }> = []
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    const dayMap = byDay.get(d)
    if (!dayMap || dayMap.size === 0) {
      result.push({ key: d, value: 0, series: [] })
      continue
    }
    const sorted = Array.from(dayMap.entries()).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, topN)
    const rest = sorted.slice(topN).reduce((s, [, v]) => s + v, 0)
    const series = top.map(([k, v]) => ({ key: k, value: v }))
    if (rest > 0) series.push({ key: '其他', value: rest })
    result.push({ key: d, value: dayMap.size > 0 ? Array.from(dayMap.values()).reduce((s, v) => s + v, 0) : 0, series })
  }
  return result
}

async function queryAggregation(source: 'errors' | 'analytics', groupBy: GroupByKey, rangeDays: number, limit: number): Promise<{ rows: Array<{ key: string; value: number }> }> {
  const since = new Date(Date.now() - rangeDays * 86400000).toISOString()
  const raw: Array<ErrorRow | AnalyticsRow> = source === 'errors'
    ? (await queryAllErrors(1000)).filter((r) => r.created_at >= since)
    : (await queryAnalyticsList(1000, 0)).filter((r) => r.created_at >= since)
  const grouped = new Map<string, number>()
  for (const row of raw) {
    let key: string
    switch (groupBy) {
      case 'day': key = row.created_at.slice(0, 10); break
      case 'hour': key = row.created_at.slice(0, 13); break
      case 'event_name': key = (row as AnalyticsRow).event_name; break
      case 'fingerprint': key = (row as ErrorRow).fingerprint; break
      case 'path': key = (row as ErrorRow).path; break
      case 'status': key = String((row as ErrorRow).status); break
      default: key = (row as ErrorRow).method
    }
    grouped.set(key, (grouped.get(key) ?? 0) + 1)
  }
    const rows = Array.from(grouped.entries()).map(([key, value]) => ({ key, value }))
  rows.sort(groupBy === 'day' || groupBy === 'hour' ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.value - a.value)
  return { rows: rows.slice(0, limit) }
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
  .get('/analytics/events', async () => {
    const events = await queryAnalyticsList(500, 0)
    return { success: true, data: { events: groupByEventName(events) } }
  })
  .get('/analytics', async ({ query }) => {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
    const offset = Math.max(Number(query.offset) || 0, 0)
    const events = await queryAnalyticsList(limit, offset)
    return { success: true, data: { events, hasMore: events.length === limit } }
  }, { query: t.Object({ limit: t.Optional(t.String()), offset: t.Optional(t.String()) }) })
  .get('/query', async ({ query }) => {
    const source = query.source === 'analytics' ? 'analytics' : 'errors'
    const groupBy = (query.groupBy ?? 'day') as GroupByKey
    const rangeDays = Math.min(Math.max(Number(query.range) || 7, 1), 90)
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
    if (groupBy === 'day_series') {
      const dimension = query.dimension === 'fingerprint' ? 'fingerprint' : 'event_name'
      const topN = Math.min(Math.max(Number(query.topN) || 3, 1), 8)
      const rows = await queryDaySeries(source, dimension, rangeDays, topN)
      return { success: true, data: { rows } }
    }
    const { rows } = await queryAggregation(source, groupBy, rangeDays, limit)
    return { success: true, data: { rows } }
  }, { query: t.Object({ source: t.Optional(t.String()), groupBy: t.Optional(t.String()), range: t.Optional(t.String()), limit: t.Optional(t.String()), dimension: t.Optional(t.String()), topN: t.Optional(t.String()) }) })
