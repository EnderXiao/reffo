import { Elysia } from 'elysia'
import { randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { createSupabaseRestClient } from '@/repositories/supabase/client'

interface AnalyticsEventInput {
  session_id?: string
  trace_id?: string
  event_name: string
  properties?: Record<string, unknown>
  page?: string
}

interface AnalyticsEventRow {
  id: string
  session_id: string
  trace_id: string | null
  user_id: string | null
  event_name: string
  properties: Record<string, unknown>
  page: string | null
  created_at: string
}

function ensureSqliteTable() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    trace_id TEXT,
    user_id TEXT,
    event_name TEXT NOT NULL,
    properties TEXT NOT NULL DEFAULT '{}',
    page TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name, created_at);`)
  return db
}

async function persistEvents(events: AnalyticsEventInput[]) {
  const now = new Date().toISOString()
  const rows: AnalyticsEventRow[] = events.map(event => ({
    id: randomUUID(),
    session_id: event.session_id ?? '',
    trace_id: event.trace_id ?? null,
    user_id: null,
    event_name: event.event_name,
    properties: event.properties ?? {},
    page: event.page ?? null,
    created_at: now,
  }))

  if (env.DATABASE_PROVIDER === 'supabase') {
    await createSupabaseRestClient({ useServiceRole: true }).request('/rest/v1/analytics_events', {
      method: 'POST',
      body: rows,
    })
    return
  }

  const db = ensureSqliteTable()
  const insert = db.query(`INSERT INTO analytics_events
    (id, session_id, trace_id, user_id, event_name, properties, page, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  db.transaction(() => {
    for (const row of rows) {
      insert.run(row.id, row.session_id, row.trace_id, row.user_id, row.event_name,
        JSON.stringify(row.properties), row.page, row.created_at)
    }
  })()
}

/** 埋点上报：接收 sendBeacon 批量埋点，异步落库，不阻塞响应。 */
export const telemetryRoutes = new Elysia({ prefix: '/api/v1' })
  .post('/telemetry', ({ body }) => {
    const raw = Array.isArray(body) ? body : [body]
    const events = raw.filter((event): event is AnalyticsEventInput =>
      Boolean(event && typeof event === 'object' && 'event_name' in event && typeof (event as AnalyticsEventInput).event_name === 'string'))
    if (events.length > 0) void persistEvents(events).catch(() => undefined)
    return { success: true, received: events.length }
  })
