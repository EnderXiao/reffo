import { Elysia, t } from 'elysia'
import { randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { createSupabaseRestClient } from '@/repositories/supabase/client'

interface TrackingRequirement {
  id: string
  event_name: string
  params: unknown[]
  page: string
  description: string
  status: 'pending' | 'implemented'
  created_at: string
  updated_at: string
}

function ensureSqliteTable() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS tracking_requirements (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL UNIQUE,
    params TEXT NOT NULL DEFAULT '[]',
    page TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`)
  return db
}

const client = () => createSupabaseRestClient({ useServiceRole: true })

function mapRow(row: Record<string, unknown>): TrackingRequirement {
  return {
    id: row.id as string,
    event_name: row.event_name as string,
    params: typeof row.params === 'string' ? JSON.parse(row.params) : (row.params as unknown[] ?? []),
    page: row.page as string,
    description: row.description as string,
    status: (row.status as 'pending' | 'implemented') ?? 'pending',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

async function listRequirements(status?: string): Promise<TrackingRequirement[]> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return client().request('/rest/v1/tracking_requirements', {
      searchParams: { select: '*', ...(status ? { status: `eq.${status}` } : {}), order: 'created_at.desc' },
    })
  }
  const db = ensureSqliteTable()
  const rows = status
    ? db.query('SELECT * FROM tracking_requirements WHERE status = ? ORDER BY created_at DESC').all(status) as unknown as Record<string, unknown>[]
    : db.query('SELECT * FROM tracking_requirements ORDER BY created_at DESC').all() as unknown as Record<string, unknown>[]
  return rows.map(mapRow)
}

async function createRequirement(input: { event_name: string; params: unknown[]; page: string; description: string }) {
  const id = randomUUID()
  const now = new Date().toISOString()
  if (env.DATABASE_PROVIDER === 'supabase') {
    await client().request('/rest/v1/tracking_requirements', {
      method: 'POST',
      body: { id, ...input, status: 'pending', created_at: now, updated_at: now },
    })
  } else {
    const db = ensureSqliteTable()
    db.query('INSERT INTO tracking_requirements (id, event_name, params, page, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.event_name, JSON.stringify(input.params), input.page, input.description, 'pending', now, now)
  }
  return { id, ...input, status: 'pending' }
}

async function updateStatus(id: string, status: 'pending' | 'implemented') {
  const now = new Date().toISOString()
  if (env.DATABASE_PROVIDER === 'supabase') {
    await client().request('/rest/v1/tracking_requirements', {
      method: 'PATCH',
      searchParams: { id: `eq.${id}` },
      body: { status, updated_at: now },
    })
  } else {
    const db = ensureSqliteTable()
    db.query('UPDATE tracking_requirements SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
  }
}

export const trackingRequirementRoutes = new Elysia({ prefix: '/api/v1/dashboard/tracking' })
  .get('/requirements', async ({ query }) => {
    const requirements = await listRequirements(query.status)
    return { success: true, data: { requirements } }
  }, { query: t.Object({ status: t.Optional(t.String()) }) })
  .post('/requirements', async ({ body }) => {
    const requirement = await createRequirement({ event_name: body.eventName, params: body.params ?? [], page: body.page, description: body.description })
    return { success: true, data: { requirement } }
  }, { body: t.Object({ eventName: t.String(), params: t.Optional(t.Array(t.String())), page: t.String(), description: t.String() }) })
  .patch('/requirements/:id', async ({ params, body }) => {
    await updateStatus(params.id, body.status)
    return { success: true, data: {} }
  }, { body: t.Object({ status: t.Union([t.Literal('pending'), t.Literal('implemented')]) }) })
