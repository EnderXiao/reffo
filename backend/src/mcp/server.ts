import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

export type FetchLike = typeof fetch

const MAX_RESPONSE_BYTES = 2_000_000
const REQUEST_TIMEOUT_MS = 10_000
const ALLOWED_CHART_TYPES = ['stat', 'line', 'bar', 'pie', 'funnel', 'table'] as const
const ALLOWED_GROUP_BY = ['day', 'hour', 'event_name', 'fingerprint', 'path', 'status', 'method', 'day_series'] as const
const ALLOWED_DIMENSIONS = ['event_name', 'fingerprint'] as const
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_./:@-]+$/
const SAFE_EVENT_NAME = z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/)
const SAFE_TRACE_ID = z.string().trim().min(1).max(160).regex(SAFE_IDENTIFIER_PATTERN)
const SAFE_FINGERPRINT = z.string().trim().min(1).max(160).regex(SAFE_IDENTIFIER_PATTERN)
const SAFE_UUID = z.string().uuid()
const PAGE_NAME = z.string().trim().min(1).max(80)
const PAGE_SLUG = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const CHART_TITLE = z.string().trim().min(1).max(100)
const LIMIT = z.number().int().min(1).max(100).optional()
const OFFSET = z.number().int().min(0).max(10000).optional()
const RANGE = z.number().int().min(1).max(90).optional()
const BASE_PATH = '/api/v1/dashboard'

export interface DashboardApiConfig {
  baseUrl: URL
  token: string
  fetchImpl: FetchLike
  timeoutMs: number
}

export class DashboardApiError extends Error {
  readonly status: number | null
  constructor(status: number | null, message = '后台 API 请求失败') {
    super(message)
    this.name = 'DashboardApiError'
    this.status = status
  }
}

function safeToolError(error: unknown): string {
  if (error instanceof DashboardApiError) {
    if (error.status === 401) return '后台 API 未授权'
    if (error.status === 403) return '后台 API 拒绝访问'
    if (error.status === 429) return '后台 API 请求过于频繁'
    if (error.status !== null && error.status >= 400 && error.status < 500) return '后台 API 请求无效'
    return '后台 API 暂不可用'
  }
  if (error instanceof Error && error.name === 'AbortError') return '后台 API 请求超时'
  return '后台 API 请求失败'
}

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function toolFailure(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: safeToolError(error) }], isError: true }
}

export function parseDashboardUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('DASHBOARD_API_BASE_URL 无效') }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('DASHBOARD_API_BASE_URL 必须使用 HTTPS 或回环 HTTP')
  if (url.username || url.password || url.search || url.hash) throw new Error('DASHBOARD_API_BASE_URL 不得包含凭据、查询参数或片段')
  if (url.port && ((url.protocol === 'https:' && url.port === '80') || (url.protocol === 'http:' && url.port === '443'))) throw new Error('DASHBOARD_API_BASE_URL 端口无效')
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname === BASE_PATH || pathname.endsWith(BASE_PATH)) url.pathname = pathname
  else if (pathname === '' || pathname === '/') url.pathname = BASE_PATH
  else if (pathname.endsWith('/api/v1')) url.pathname = pathname + '/dashboard'
  else url.pathname = pathname + BASE_PATH
  return url
}

export function readDashboardConfig(env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch): DashboardApiConfig {
  const rawBase = env.DASHBOARD_API_BASE_URL
  const token = env.DASHBOARD_ACCESS_TOKEN
  if (!rawBase || !token) throw new Error('DASHBOARD_API_BASE_URL 与 DASHBOARD_ACCESS_TOKEN 必须设置')
  if (!/^[^\s]+$/.test(token) || token.length > 8192) throw new Error('DASHBOARD_ACCESS_TOKEN 无效')
  return { baseUrl: parseDashboardUrl(rawBase), token, fetchImpl, timeoutMs: REQUEST_TIMEOUT_MS }
}

function responseLooksSuccessful(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { success?: unknown }).success === true
}

export class DashboardApiClient {
  constructor(private readonly config: DashboardApiConfig) {}

  private url(path: string, query?: Record<string, string | number | undefined>): URL {
    const normalized = path.startsWith('/') ? path.slice(1) : path
    const url = new URL(normalized, this.config.baseUrl.toString().replace(/\/+$/, '') + '/')
    if (query) for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value))
    return url
  }

  async request<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.config.fetchImpl(this.url(path, options.query), {
        method: options.method ?? 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + this.config.token,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      const length = Number(response.headers.get('content-length') ?? '')
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new DashboardApiError(response.status)
      const raw = await response.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) throw new DashboardApiError(response.status)
      let parsed: unknown = null
      try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
      if (!response.ok || !responseLooksSuccessful(parsed)) throw new DashboardApiError(response.status)
      return (parsed as { data?: T }).data as T
    } finally {
      clearTimeout(timer)
    }
  }
}

function withErrors<T extends (...args: never[]) => Promise<{ content: Array<{ type: 'text'; text: string }> }>>(handler: T) {
  return async (...args: Parameters<T>) => {
    try { return await handler(...args) } catch (error) { return toolFailure(error) }
  }
}

export function createServer(api: DashboardApiClient = new DashboardApiClient(readDashboardConfig())): McpServer {
  const server = new McpServer({ name: 'reffo-observability', version: '1.0.0' })
  const register = server.tool.bind(server)
  register('searchErrorByTraceId', '按 traceId 查错误及其关联的埋点上下文', { traceId: SAFE_TRACE_ID }, withErrors(async ({ traceId }: { traceId: string }) => textResult(await api.request('/error/' + encodeURIComponent(traceId)))))
  register('listRecentErrors', '查最近发生的错误', { limit: LIMIT, offset: OFFSET, traceId: SAFE_TRACE_ID.optional(), fingerprint: SAFE_FINGERPRINT.optional() }, withErrors(async ({ limit, offset, traceId, fingerprint }: { limit?: number; offset?: number; traceId?: string; fingerprint?: string }) => textResult(await api.request('/errors', { query: { limit: limit ?? 20, offset: offset ?? 0, traceId, fingerprint } }))))
  register('listIssues', '按 fingerprint 聚合的错误分组（issue），看频次', { days: RANGE, limit: LIMIT, offset: OFFSET }, withErrors(async ({ days, limit, offset }: { days?: number; limit?: number; offset?: number }) => textResult(await api.request('/issues', { query: { days: days ?? 7, limit: limit ?? 50, offset: offset ?? 0 } }))))
  register('getIssueDetail', '查某个 fingerprint（issue）的所有错误实例', { fingerprint: SAFE_FINGERPRINT, limit: LIMIT, offset: OFFSET }, withErrors(async ({ fingerprint, limit, offset }: { fingerprint: string; limit?: number; offset?: number }) => textResult(await api.request('/errors', { query: { fingerprint, limit: limit ?? 100, offset: offset ?? 0 } }))))
  register('queryAnalyticsEvents', '按事件名查埋点（如 click_generate）', { eventName: SAFE_EVENT_NAME, traceId: SAFE_TRACE_ID.optional(), limit: LIMIT, offset: OFFSET }, withErrors(async ({ eventName, traceId, limit, offset }: { eventName: string; traceId?: string; limit?: number; offset?: number }) => textResult(await api.request('/analytics', { query: { eventName, traceId, limit: limit ?? 50, offset: offset ?? 0 } }))))
  register('listTrackingRequirements', '查埋点需求台账：status 过滤（pending 待实现 / implemented 已落地 / 不传全部）', { status: z.enum(['pending', 'implemented']).optional(), eventName: SAFE_EVENT_NAME.optional(), limit: LIMIT, offset: OFFSET }, withErrors(async ({ status, eventName, limit, offset }: { status?: 'pending' | 'implemented'; eventName?: string; limit?: number; offset?: number }) => textResult(await api.request('/tracking/requirements', { query: { status, eventName, limit: limit ?? 100, offset: offset ?? 0 } }))))
  register('getTrackingRequirement', '按 event_name 查单个埋点需求（Agent 实现埋点前读取参数/页面/业务描述）', { eventName: SAFE_EVENT_NAME }, withErrors(async ({ eventName }: { eventName: string }) => textResult(await api.request('/tracking/requirements', { query: { eventName, limit: 1, offset: 0 } }))))
  register('markTrackingRequirementImplemented', '标记埋点需求为已实现（仅表示代码已实现，不表示生产上线）', { eventName: SAFE_EVENT_NAME, status: z.enum(['implemented', 'pending']).default('implemented') }, withErrors(async ({ eventName, status }: { eventName: string; status?: 'implemented' | 'pending' }) => {
    const result = await api.request<{ requirements: Array<{ id: string }> }>('/tracking/requirements', { query: { eventName, limit: 1, offset: 0 } })
    const id = result.requirements?.[0]?.id
    if (!id) throw new DashboardApiError(404)
    return textResult(await api.request('/tracking/requirements/' + encodeURIComponent(id), { method: 'PATCH', body: { status: status ?? 'implemented' } }))
  }))
  register('listChartTypes', '列出可用的图表类型（stat 数字卡片 / line 折线 / bar 柱状 / pie 饼图 / funnel 漏斗 / table 表格）', withErrors(async () => textResult(ALLOWED_CHART_TYPES)))
  register('listDashboardPages', '列出已建看板子页面', withErrors(async () => textResult(await api.request('/pages'))))
  register('createDashboardPage', '创建看板子页面', { name: PAGE_NAME, slug: PAGE_SLUG.optional() }, withErrors(async ({ name, slug }: { name: string; slug?: string }) => textResult(await api.request('/pages', { method: 'POST', body: { name, ...(slug ? { slug } : {}) } }))))
  const DATA_QUERY = z.object({
    source: z.enum(['errors', 'analytics']).optional(),
    groupBy: z.enum(ALLOWED_GROUP_BY).optional(),
    range: RANGE,
    limit: LIMIT,
    topN: z.number().int().min(1).max(8).optional(),
    dimension: z.enum(ALLOWED_DIMENSIONS).optional(),
  }).strict().optional()
  register('addChart', '给看板页面添加图表卡片', { pageId: SAFE_UUID, chartType: z.enum(ALLOWED_CHART_TYPES), title: CHART_TITLE, dataQuery: DATA_QUERY, position: z.number().int().min(0).max(99).optional() }, withErrors(async ({ pageId, chartType, title, dataQuery, position }: { pageId: string; chartType: (typeof ALLOWED_CHART_TYPES)[number]; title: string; dataQuery?: Record<string, unknown>; position?: number }) => textResult(await api.request('/pages/' + encodeURIComponent(pageId) + '/charts', { method: 'POST', body: { chartType, title, ...(dataQuery === undefined ? {} : { dataQuery }), ...(position === undefined ? {} : { position }) } }))))
  register('deleteChart', '删除图表卡片', { chartId: SAFE_UUID }, withErrors(async ({ chartId }: { chartId: string }) => textResult(await api.request('/charts/' + encodeURIComponent(chartId), { method: 'DELETE' }))))
  return server
}

export async function startServer(): Promise<void> {
  const api = new DashboardApiClient(readDashboardConfig())
  await api.request('/session')
  const transport = new StdioServerTransport()
  await createServer(api).connect(transport)
}

if (import.meta.main) {
  void startServer().catch(() => {
    console.error('MCP server 启动失败')
    process.exitCode = 1
  })
}
