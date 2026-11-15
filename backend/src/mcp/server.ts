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

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

void main().catch(error => {
  console.error('MCP server 启动失败:', error)
  process.exit(1)
})
