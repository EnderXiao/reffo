import { t } from 'elysia'
import { dashboardRouter } from '@/auth/dashboard-guard'
import { DashboardAccessError } from '@/auth/dashboard-access'
import { randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { dashboardClient } from '@/repositories/dashboard-client'

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

const client = dashboardClient

async function listPages(): Promise<Array<{ id: string; name: string; slug: string }>> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return client().request('/rest/v1/dashboard_pages', { searchParams: { select: 'id,name,slug', order: 'created_at.asc', limit: '100' } })
  }
  const db = ensureSqliteTables()
  return db.query('SELECT id, name, slug FROM dashboard_pages ORDER BY created_at ASC LIMIT 100').all() as unknown as Array<{ id: string; name: string; slug: string }>
}

async function getCharts(pageId: string): Promise<ChartConfig[]> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    return client().request('/rest/v1/dashboard_charts', { searchParams: { select: 'id,page_id,chart_type,title,data_query,position', page_id: `eq.${pageId}`, order: 'position.asc', limit: '100' } })
  }
  const db = ensureSqliteTables()
  const rows = db.query('SELECT id, page_id, chart_type, title, data_query, position FROM dashboard_charts WHERE page_id = ? ORDER BY position ASC LIMIT 100').all(pageId) as unknown as Array<{ id: string; page_id: string; chart_type: string; title: string; data_query: string; position: number }>
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

const idParams = t.Object({id: t.String({format:'uuid'})})
const chartQuery = t.Object({
  source: t.Optional(t.Union([t.Literal('errors'),t.Literal('analytics')])),
  groupBy: t.Optional(t.Union(['day','hour','event_name','fingerprint','path','status','method','day_series'].map(x => t.Literal(x)))),
  range: t.Optional(t.Integer({minimum:1,maximum:90})), limit: t.Optional(t.Integer({minimum:1,maximum:100})),
  topN: t.Optional(t.Integer({minimum:1,maximum:8})), dimension: t.Optional(t.Union([t.Literal('event_name'),t.Literal('fingerprint')])),
}, {additionalProperties:false})

export const dashboardPagesRoutes = dashboardRouter()
  .get('/pages', async () => ({success:true,data:{pages:await listPages()}}))
  .post('/pages', async ({body}) => {
    if ((await listPages()).length >= 100) throw new DashboardAccessError('DASHBOARD_CAPACITY','最多 100 个看板页面',400)
    const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || randomUUID().slice(0,8)
    return {success:true,data:{page:await createPage(body.name.trim(),slug)}}
  }, {body:t.Object({name:t.String({minLength:1,maxLength:80,pattern:'\\S'}),slug:t.Optional(t.String({minLength:1,maxLength:80,pattern:'^[a-z0-9]+(-[a-z0-9]+)*$'}))},{additionalProperties:false})})
  .get('/pages/:id', async ({params}) => {
    const page = (await listPages()).find(p=>p.id===params.id)
    if (!page) throw new DashboardAccessError('DASHBOARD_NOT_FOUND','看板页面不存在',404)
    return {success:true,data:{page,charts:await getCharts(params.id)}}
  }, {params:idParams})
  .post('/pages/:id/charts', async ({params,body}) => {
    if (!(await listPages()).some(p=>p.id===params.id)) throw new DashboardAccessError('DASHBOARD_NOT_FOUND','看板页面不存在',404)
    if ((await getCharts(params.id)).length >= 50) throw new DashboardAccessError('DASHBOARD_CAPACITY','每页最多 50 张图表',400)
    return {success:true,data:{chart:await addChart(params.id,body.chartType,body.title.trim(),body.dataQuery??{},body.position??0)}}
  }, {params:idParams,body:t.Object({chartType:t.Union(['stat','line','bar','pie','funnel','table'].map(x=>t.Literal(x))),title:t.String({minLength:1,maxLength:100}),dataQuery:t.Optional(chartQuery),position:t.Optional(t.Integer({minimum:0,maximum:99}))},{additionalProperties:false})})
  .delete('/charts/:id', async ({params}) => {
    await deleteChart(params.id)
    return {success:true,data:{}}
  }, {params:idParams})
