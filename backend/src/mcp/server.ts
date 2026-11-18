import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createSupabaseRestClient } from '@/repositories/supabase/client'

interface ErrorEvent {
  trace_id: string
  fingerprint: string
  path: string
  method: string
  status: number | null
  error_code: string | null
  error_message: string
  error_stack: string | null
  created_at: string
}

interface AnalyticsEvent {
  session_id: string
  trace_id: string | null
  event_name: string
  properties: Record<string, unknown>
  created_at: string
}

const client = createSupabaseRestClient({ useServiceRole: true })

async function queryErrors(searchParams: Record<string, string>, limit = 50): Promise<ErrorEvent[]> {
  return client.request<ErrorEvent[]>('/rest/v1/error_events', {
    searchParams: { select: 'trace_id,fingerprint,path,method,status,error_code,error_message,error_stack,created_at', ...searchParams, limit: String(limit), order: 'created_at.desc' },
  })
}

async function queryAnalytics(searchParams: Record<string, string>, limit = 50): Promise<AnalyticsEvent[]> {
  return client.request<AnalyticsEvent[]>('/rest/v1/analytics_events', {
    searchParams: { select: 'session_id,trace_id,event_name,properties,created_at', ...searchParams, limit: String(limit), order: 'created_at.desc' },
  })
}

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

const server = new McpServer({ name: 'reffo-observability', version: '1.0.0' })

server.tool(
  'searchErrorByTraceId',
  '按 traceId 查错误及其关联的埋点上下文',
  { traceId: z.string() },
  async ({ traceId }) => {
    const errors = await queryErrors({ trace_id: 'eq.' + traceId }, 20)
    const events = await queryAnalytics({ trace_id: 'eq.' + traceId }, 20)
    return textResult({ traceId, errors, relatedEvents: events })
  },
)

server.tool(
  'listRecentErrors',
  '查最近发生的错误',
  { limit: z.number().min(1).max(100).optional() },
  async ({ limit }) => {
    const errors = await queryErrors({}, limit ?? 20)
    return textResult(errors)
  },
)

server.tool(
  'listIssues',
  '按 fingerprint 聚合的错误分组（issue），看频次',
  { limit: z.number().min(1).max(100).optional() },
  async ({ limit }) => {
    const errors = await queryErrors({}, limit ?? 100)
    const grouped = new Map<string, { count: number; latestMessage: string; latestPath: string }>()
    for (const error of errors) {
      const existing = grouped.get(error.fingerprint)
      if (existing) existing.count += 1
      else grouped.set(error.fingerprint, { count: 1, latestMessage: error.error_message, latestPath: error.path })
    }
    const issues = Array.from(grouped.entries()).map(([fingerprint, info]) => ({ fingerprint, ...info }))
      .sort((a, b) => b.count - a.count)
    return textResult(issues)
  },
)

server.tool(
  'getIssueDetail',
  '查某个 fingerprint（issue）的所有错误实例',
  { fingerprint: z.string() },
  async ({ fingerprint }) => {
    const errors = await queryErrors({ fingerprint: 'eq.' + fingerprint }, 50)
    return textResult({ fingerprint, count: errors.length, errors })
  },
)

server.tool(
  'queryAnalyticsEvents',
  '按事件名查埋点（如 click_generate）',
  { eventName: z.string(), limit: z.number().min(1).max(100).optional() },
  async ({ eventName, limit }) => {
    const events = await queryAnalytics({ event_name: 'eq.' + eventName }, limit ?? 50)
    return textResult(events)
  },
)

// ===== 埋点需求台账工具 =====
server.tool(
  'listTrackingRequirements',
  '查埋点需求台账：status 过滤（pending 待实现 / implemented 已上线 / 不传全部）',
  { status: z.string().optional() },
  async ({ status }) => {
    const requirements = await client.request('/rest/v1/tracking_requirements', {
      searchParams: { select: '*', ...(status ? { status: 'eq.' + status } : {}), order: 'created_at.desc' },
    })
    return textResult(requirements)
  },
)

server.tool(
  'getTrackingRequirement',
  '按 event_name 查单个埋点需求（Agent 实现埋点前读取参数/页面/业务描述）',
  { eventName: z.string() },
  async ({ eventName }) => {
    const requirements = await client.request('/rest/v1/tracking_requirements', {
      searchParams: { select: '*', event_name: 'eq.' + eventName, limit: '1' },
    })
    return textResult(requirements)
  },
)

server.tool(
  'markTrackingRequirementImplemented',
  '标记埋点需求为已上线（Agent 在前端实现埋点后调用）',
  { eventName: z.string() },
  async ({ eventName }) => {
    await client.request('/rest/v1/tracking_requirements', {
      method: 'PATCH',
      searchParams: { event_name: 'eq.' + eventName },
      body: { status: 'implemented', updated_at: new Date().toISOString() },
    })
    return textResult({ event_name: eventName, status: 'implemented' })
  },
)

// ===== 低代码搭建工具 =====
const CHART_TYPES = ['stat', 'line', 'bar', 'pie', 'funnel', 'table']

server.tool(
  'listChartTypes',
  '列出可用的图表类型（stat 数字卡片 / line 折线 / bar 柱状 / pie 饼图 / funnel 漏斗 / table 表格）',
  async () => textResult(CHART_TYPES),
)

server.tool(
  'listDashboardPages',
  '列出已建看板子页面',
  async () => {
    const pages = await client.request('/rest/v1/dashboard_pages', { searchParams: { select: 'id,name,slug', order: 'created_at.asc' } })
    return textResult(pages)
  },
)

server.tool(
  'createDashboardPage',
  '创建看板子页面',
  { name: z.string(), slug: z.string().optional() },
  async ({ name, slug }) => {
    const id = crypto.randomUUID()
    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID().slice(0, 8)
    await client.request('/rest/v1/dashboard_pages', { method: 'POST', body: { id, name, slug: finalSlug, created_at: new Date().toISOString() } })
    return textResult({ id, name, slug: finalSlug })
  },
)

server.tool(
  'addChart',
  '给看板页面添加图表卡片',
  { pageId: z.string(), chartType: z.string(), title: z.string(), dataQuery: z.record(z.any()).optional(), position: z.number().optional() },
  async ({ pageId, chartType, title, dataQuery, position }) => {
    const id = crypto.randomUUID()
    const chart = { id, page_id: pageId, chart_type: chartType, title, data_query: dataQuery ?? {}, position: position ?? 0, created_at: new Date().toISOString() }
    await client.request('/rest/v1/dashboard_charts', { method: 'POST', body: chart })
    return textResult(chart)
  },
)

server.tool(
  'deleteChart',
  '删除图表卡片',
  { chartId: z.string() },
  async ({ chartId }) => {
    await client.request('/rest/v1/dashboard_charts', { method: 'DELETE', searchParams: { id: 'eq.' + chartId } })
    return textResult({ deleted: chartId })
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

void main().catch(error => {
  console.error('MCP server 启动失败:', error)
  process.exit(1)
})
