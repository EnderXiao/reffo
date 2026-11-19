import type {SQLQueryBindings} from 'bun:sqlite'
import {env} from '@/config/env'
import {getDatabase} from './database'
import {dashboardClient} from './dashboard-client'
import {dashboardJson, redactDashboardText} from '@/shared/dashboard-redaction'

export type DataSource = 'errors' | 'analytics'
export type GroupBy = 'day' | 'hour' | 'event_name' | 'fingerprint' | 'path' | 'status' | 'method' | 'day_series'
export interface AggregateQuery {source: DataSource; groupBy: GroupBy; days: number; limit: number; dimension: 'event_name' | 'fingerprint'; topN: number}
export interface ErrorRow {
  id: string; trace_id: string; fingerprint: string; path: string; method: string; status: number | null
  error_code: string | null; error_message: string; created_at: string; error_stack?: string | null; context?: Record<string, unknown>
}
export interface AnalyticsRow {id: string; session_id: string; trace_id: string | null; event_name: string; properties: Record<string, unknown>; page: string | null; created_at: string}
const ERROR_LIST = 'id,trace_id,fingerprint,path,method,status,error_code,error_message,created_at'
const ANALYTICS = 'id,session_id,trace_id,event_name,properties,page,created_at'

function database() {
  const db = getDatabase()
  db.exec("CREATE TABLE IF NOT EXISTS error_events (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, session_id TEXT, user_id TEXT, fingerprint TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL, status INTEGER, error_code TEXT, error_message TEXT NOT NULL, error_stack TEXT, context TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);")
  db.exec("CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, trace_id TEXT, user_id TEXT, event_name TEXT NOT NULL, properties TEXT NOT NULL DEFAULT '{}', page TEXT, created_at TEXT NOT NULL);")
  return db
}

function safeError(row: ErrorRow, detail: boolean): ErrorRow {
  // 显式投影，列表即使底层返回额外字段也不能泄漏详情。
  const result: ErrorRow = {id: row.id, trace_id: row.trace_id, fingerprint: row.fingerprint, path: redactDashboardText(row.path, 500), method: row.method, status: row.status, error_code: row.error_code, error_message: redactDashboardText(row.error_message, 1000), created_at: row.created_at}
  if (detail) { result.error_stack = row.error_stack ? redactDashboardText(row.error_stack) : null; result.context = dashboardJson(row.context) }
  return result
}

export async function listDashboardErrors(filters: {traceId?: string; fingerprint?: string; id?: string}, limit: number, offset: number, detail = false) {
  const select = ERROR_LIST + (detail ? ',error_stack,context' : '')
  let rows: ErrorRow[]
  if (env.DATABASE_PROVIDER === 'supabase') {
    rows = await dashboardClient().request<ErrorRow[]>('/rest/v1/error_events', {searchParams: {select, ...(filters.traceId ? {trace_id: 'eq.' + filters.traceId} : {}), ...(filters.fingerprint ? {fingerprint: 'eq.' + filters.fingerprint} : {}), ...(filters.id ? {id:'eq.'+filters.id}:{}), limit: limit + 1, offset, order: 'created_at.desc,id.desc'}})
  } else {
    const where: string[] = []; const args: SQLQueryBindings[] = []
    if (filters.traceId) {where.push('trace_id = ?'); args.push(filters.traceId)}
    if (filters.fingerprint) {where.push('fingerprint = ?'); args.push(filters.fingerprint)}
    if (filters.id) {where.push('id = ?'); args.push(filters.id)}
    rows = database().query('SELECT ' + select + ' FROM error_events' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(...args, limit + 1, offset) as ErrorRow[]
  }
  return {errors: rows.slice(0, limit).map(r => safeError(r, detail)), hasMore: rows.length > limit}
}

export async function listDashboardAnalytics(filters: {traceId?: string; eventName?: string}, limit: number, offset: number) {
  let rows: AnalyticsRow[]
  if (env.DATABASE_PROVIDER === 'supabase') {
    rows = await dashboardClient().request<AnalyticsRow[]>('/rest/v1/analytics_events', {searchParams: {select: ANALYTICS, ...(filters.traceId ? {trace_id: 'eq.' + filters.traceId} : {}), ...(filters.eventName ? {event_name: 'eq.' + filters.eventName} : {}), limit: limit + 1, offset, order: 'created_at.desc,id.desc'}})
  } else {
    const where: string[] = []; const args: SQLQueryBindings[] = []
    if (filters.traceId) {where.push('trace_id = ?'); args.push(filters.traceId)}
    if (filters.eventName) {where.push('event_name = ?'); args.push(filters.eventName)}
    rows = database().query('SELECT ' + ANALYTICS + ' FROM analytics_events' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(...args, limit + 1, offset) as AnalyticsRow[]
  }
  return {events: rows.slice(0, limit).map(r => ({...r, page: r.page ? redactDashboardText(r.page, 500) : null, properties: dashboardJson(r.properties)})), hasMore: rows.length > limit}
}

let queryInFlight = 0
const cache = new Map<string, {until: number; value: unknown}>()
const pendingAggregates = new Map<string, Promise<unknown>>()
async function boundedAggregate<T>(key: string, query: () => Promise<T>): Promise<T> {
  const cached = cache.get(key)
  if (cached && cached.until > Date.now()) return cached.value as T
  const pending = pendingAggregates.get(key)
  if (pending) return pending as Promise<T>
  if (queryInFlight >= 4) throw new Error('Dashboard aggregation busy')
  queryInFlight++
  const promise = query().then(value => {
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(key, {until: Date.now() + 15_000, value})
    return value
  }).finally(() => {queryInFlight--; pendingAggregates.delete(key)})
  pendingAggregates.set(key, promise)
  return promise
}
function startIso(days: number) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1)).toISOString()
}

export function aggregateDashboard(q: AggregateQuery): Promise<{rows: unknown[]}> {
  return boundedAggregate(JSON.stringify([env.DATABASE_PROVIDER, env.SUPABASE_URL, q]), async () => {
    if (env.DATABASE_PROVIDER === 'supabase') return dashboardClient().request<{rows: unknown[]}>('/rest/v1/rpc/dashboard_aggregate', {method: 'POST', body: {p_source: q.source, p_group: q.groupBy, p_days: q.days, p_limit: q.limit, p_dimension: q.dimension, p_top_n: q.topN}})
    const table = q.source === 'errors' ? 'error_events' : 'analytics_events'
    const columns: Record<GroupBy, string> = {day: 'substr(created_at,1,10)', hour: 'substr(created_at,1,13)', event_name: 'event_name', fingerprint: 'fingerprint', path: 'path', status: 'CAST(status AS TEXT)', method: 'method', day_series: 'substr(created_at,1,10)'}
    if (q.groupBy === 'day_series') {
      const rows = database().query('SELECT substr(created_at,1,10) AS day, ' + q.dimension + ' AS key, COUNT(*) AS value FROM ' + table + ' WHERE created_at >= ? GROUP BY day, ' + q.dimension + ' ORDER BY day ASC, value DESC, key ASC').all(startIso(q.days)) as Array<{day: string; key: string; value: number}>
      const byDay = new Map<string, Array<{key: string; value: number}>>()
      for (const row of rows) { const group = byDay.get(row.day) ?? []; group.push({key: row.key, value: row.value}); byDay.set(row.day, group) }
      const result = []
      const start = new Date(startIso(q.days)).getTime()
      for (let i = 0; i < q.days; i++) {
        const key = new Date(start + i * 86400000).toISOString().slice(0, 10)
        const group = byDay.get(key) ?? []
        const series = group.slice(0, q.topN)
        const rest = group.slice(q.topN).reduce((s, r) => s + r.value, 0)
        if (rest) series.push({key: '其他', value: rest})
        result.push({key, value: group.reduce((s, r) => s + r.value, 0), series})
      }
      return {rows: result}
    }
    const order = q.groupBy === 'day' || q.groupBy === 'hour' ? 'key ASC' : 'value DESC, key ASC'
    const rows = database().query('SELECT ' + columns[q.groupBy] + ' AS key, COUNT(*) AS value FROM ' + table + ' WHERE created_at >= ? GROUP BY key ORDER BY ' + order + ' LIMIT ?').all(startIso(q.days), q.limit)
    return {rows}
  })
}

export function dashboardIssues(days: number, limit: number, offset: number): Promise<{issues: unknown[]; hasMore: boolean}> {
  return boundedAggregate(JSON.stringify(['issues', env.DATABASE_PROVIDER, env.SUPABASE_URL, days, limit, offset]), async () => {
    if (env.DATABASE_PROVIDER === 'supabase') return dashboardClient().request('/rest/v1/rpc/dashboard_issues', {method: 'POST', body: {p_days: days, p_limit: limit, p_offset: offset}})
    const rows = database().query('WITH grouped AS (SELECT fingerprint, COUNT(*) AS count FROM error_events WHERE created_at >= ? GROUP BY fingerprint) SELECT g.fingerprint, g.count, e.error_message AS latestMessage, e.path AS latestPath, e.created_at AS latestAt FROM grouped g JOIN error_events e ON e.id = (SELECT id FROM error_events WHERE fingerprint = g.fingerprint ORDER BY created_at DESC, id DESC LIMIT 1) ORDER BY g.count DESC, g.fingerprint ASC LIMIT ? OFFSET ?').all(startIso(days), limit + 1, offset) as Array<{latestMessage: string; latestPath: string}>
    return {issues: rows.slice(0, limit).map(r => ({...r, latestMessage: redactDashboardText(r.latestMessage, 1000), latestPath: redactDashboardText(r.latestPath, 500)})), hasMore: rows.length > limit}
  })
}
