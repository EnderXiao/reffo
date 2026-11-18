import { Elysia, t } from 'elysia'
import { randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { createSupabaseRestClient } from '@/repositories/supabase/client'

interface ChartConfig {
  id: string
  page_id: string
  chart_type: string
  title: string
  data_query: Record<string, unknown>
  position: number
}

function ensureSqliteTables() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS dashboard_pages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dashboard_charts (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    chart_type TEXT NOT NULL,
    title TEXT NOT NULL,
    data_query TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );`)
  return db
}

const client = () => createSupabaseRestClient({ useServiceRole: true })

async function listPages(): Promise<Array<{ id: string; name: string; slug: string }>> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return client().request('/rest/v1/dashboard_pages', { searchParams: { select: 'id,name,slug', order: 'created_at.asc' } })
  }
  const db = ensureSqliteTables()
  return db.query('SELECT id, name, slug FROM dashboard_pages ORDER BY created_at ASC').all() as unknown as Array<{ id: string; name: string; slug: string }>
}

async function getCharts(pageId: string): Promise<ChartConfig[]> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return client().request('/rest/v1/dashboard_charts', { searchParams: { select: 'id,page_id,chart_type,title,data_query,position', page_id: `eq.${pageId}`, order: 'position.asc' } })
  }
  const db = ensureSqliteTables()
  const rows = db.query('SELECT id, page_id, chart_type, title, data_query, position FROM dashboard_charts WHERE page_id = ? ORDER BY position ASC').all(pageId) as unknown as Array<{ id: string; page_id: string; chart_type: string; title: string; data_query: string; position: number }>
  return rows.map((r) => ({ ...r, data_query: JSON.parse(r.data_query || '{}') }))
}

async function createPage(name: string, slug: string) {
  const id = randomUUID()
  const now = new Date().toISOString()
  if (env.DATABASE_PROVIDER === 'supabase') {
    await client().request('/rest/v1/dashboard_pages', { method: 'POST', body: { id, name, slug, created_at: now } })
  } else {
    const db = ensureSqliteTables()
    db.query('INSERT INTO dashboard_pages (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run(id, name, slug, now)
  }
  return { id, name, slug }
}

async function addChart(pageId: string, chartType: string, title: string, dataQuery: Record<string, unknown>, position: number) {
  const id = randomUUID()
  const now = new Date().toISOString()
  if (env.DATABASE_PROVIDER === 'supabase') {
    await client().request('/rest/v1/dashboard_charts', { method: 'POST', body: { id, page_id: pageId, chart_type: chartType, title, data_query: dataQuery, position, created_at: now } })
  } else {
    const db = ensureSqliteTables()
    db.query('INSERT INTO dashboard_charts (id, page_id, chart_type, title, data_query, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, pageId, chartType, title, JSON.stringify(dataQuery), position, now)
  }
  return { id, page_id: pageId, chart_type: chartType, title, data_query: dataQuery, position }
}

async function deleteChart(chartId: string) {
  if (env.DATABASE_PROVIDER === 'supabase') {
    await client().request('/rest/v1/dashboard_charts', { method: 'DELETE', searchParams: { id: `eq.${chartId}` } })
  } else {
    const db = ensureSqliteTables()
    db.query('DELETE FROM dashboard_charts WHERE id = ?').run(chartId)
  }
}

export const dashboardPagesRoutes = new Elysia({ prefix: '/api/v1/dashboard' })
  .get('/pages', async () => {
    const pages = await listPages()
    return { success: true, data: { pages } }
  })
  .post('/pages', async ({ body }) => {
    const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || randomUUID().slice(0, 8)
    const page = await createPage(body.name, slug)
    return { success: true, data: { page } }
  }, { body: t.Object({ name: t.String(), slug: t.Optional(t.String()) }) })
  .get('/pages/:id', async ({ params }) => {
    const pages = await listPages()
    const page = pages.find((p) => p.id === params.id)
    const charts = await getCharts(params.id)
    return { success: true, data: { page, charts } }
  })
  .post('/pages/:id/charts', async ({ params, body }) => {
    const chart = await addChart(params.id, body.chartType, body.title, body.dataQuery ?? {}, body.position ?? 0)
    return { success: true, data: { chart } }
  }, { body: t.Object({ chartType: t.String(), title: t.String(), dataQuery: t.Optional(t.Record(t.String(), t.Any())), position: t.Optional(t.Number()) }) })
  .delete('/charts/:id', async ({ params }) => {
    await deleteChart(params.id)
    return { success: true, data: {} }
  })
