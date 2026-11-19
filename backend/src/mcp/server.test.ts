import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { fileURLToPath } from 'node:url'
import { DashboardApiClient, DashboardApiError, createServer, parseDashboardUrl, readDashboardConfig, type FetchLike } from './server.js'

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 200 && status < 300 ? { success: true, data } : { success: false, error: { message: 'sensitive server detail' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function setupFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl: FetchLike = (async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} })
    if (status === 200) return response({ errors: [], hasMore: false })
    return response(null, status)
  }) as FetchLike
  return { calls, fetchImpl }
}

describe('dashboard MCP API client', () => {
  test('sends bearer auth, JSON contract, timeout and no-redirect policy', async () => {
    const { calls, fetchImpl } = setupFetch()
    const client = new DashboardApiClient({
      baseUrl: new URL('https://dashboard.example.test/api/v1/dashboard'),
      token: 'access-token-test',
      fetchImpl,
      timeoutMs: 1000,
    })
    await client.request('/errors', { query: { limit: 20, offset: 0 } })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://dashboard.example.test/api/v1/dashboard/errors?limit=20&offset=0')
    expect(calls[0].init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer access-token-test', Accept: 'application/json' }))
    expect(calls[0].init.redirect).toBe('error')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  test('rejects non-success API response without leaking response body', async () => {
    const { fetchImpl } = setupFetch(403)
    const client = new DashboardApiClient({ baseUrl: new URL('https://dashboard.example.test/api/v1/dashboard'), token: 'secret-token', fetchImpl, timeoutMs: 1000 })
    await expect(client.request('/pages')).rejects.toBeInstanceOf(DashboardApiError)
    const server = createServer(client)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const mcpClient = new Client({ name: 'mcp-test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await mcpClient.connect(clientTransport)
    const result = await mcpClient.callTool({ name: 'listDashboardPages', arguments: {} })
    const toolResult = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> }
    expect(toolResult.isError).toBe(true)
    const text = toolResult.content?.[0]?.text ?? ''
    expect(text).not.toContain('sensitive server detail')
    expect(text).not.toContain('secret-token')
    await mcpClient.close()
    await server.close()
  })

  test('SDK lists all thirteen tools and calls a tool through in-memory transport', async () => {
    const { fetchImpl } = setupFetch()
    const server = createServer(new DashboardApiClient({ baseUrl: new URL('http://localhost:3000/api/v1/dashboard'), token: 'token', fetchImpl, timeoutMs: 1000 }))
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const mcpClient = new Client({ name: 'mcp-test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await mcpClient.connect(clientTransport)
    const tools = await mcpClient.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'searchErrorByTraceId', 'listRecentErrors', 'listIssues', 'getIssueDetail', 'queryAnalyticsEvents',
      'listTrackingRequirements', 'getTrackingRequirement', 'markTrackingRequirementImplemented',
      'listChartTypes', 'listDashboardPages', 'createDashboardPage', 'addChart', 'deleteChart',
    ])
    const addChartTool = tools.tools.find((tool) => tool.name === 'addChart')
    expect(addChartTool?.inputSchema.required).toEqual(['pageId', 'chartType', 'title'])
    const dataQuerySchema = addChartTool?.inputSchema.properties?.dataQuery as { additionalProperties?: boolean; required?: string[] } | undefined
    expect(dataQuerySchema?.additionalProperties).toBe(false)
    expect(dataQuerySchema?.required).toBeUndefined()
    const result = await mcpClient.callTool({ name: 'listRecentErrors', arguments: { limit: 20 } })
    expect(result.isError).not.toBe(true)
    await mcpClient.close()
    await server.close()
  })
})

describe('dashboard MCP configuration', () => {
  test('MCP source does not import Supabase or service-role secrets', () => {
    const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('createSupabaseRestClient')
    expect(source).not.toContain('service_role')
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  test('fails closed when credentials are missing and rejects unsafe URLs', () => {
    expect(() => readDashboardConfig({})).toThrow()
    expect(() => parseDashboardUrl('http://dashboard.example.test')).toThrow()
    expect(() => parseDashboardUrl('https://user:pass@dashboard.example.test')).toThrow()
    expect(() => parseDashboardUrl('https://dashboard.example.test?token=secret')).toThrow()
    expect(() => parseDashboardUrl('https://dashboard.example.test#fragment')).toThrow()
    expect(parseDashboardUrl('http://127.0.0.1:3000').pathname).toBe('/api/v1/dashboard')
  })
})

async function startFakeDashboardApi(sessionStatus = 200) {
  const calls = { session: 0, pagesRead: 0, pageWrites: 0 }
  const fake = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const authorization = request.headers.get('authorization')
      if (authorization !== 'Bearer stdio-access-token') return Response.json({ success: false }, { status: 401 })
      const url = new URL(request.url)
      if (url.pathname === '/api/v1/dashboard/session') {
        calls.session++
        return Response.json(sessionStatus === 200
          ? { success: true, data: { userId: '00000000-0000-4000-8000-000000000001', role: 'owner', permissions: { canRead: true, canViewDetails: true, canWrite: true }, environment: 'test' } }
          : { success: false, error: { code: 'DASHBOARD_FORBIDDEN', message: 'denied' } }, { status: sessionStatus })
      }
      if (url.pathname === '/api/v1/dashboard/pages' && request.method === 'GET') {
        calls.pagesRead++
        return Response.json({ success: true, data: { pages: [] } })
      }
      if (url.pathname === '/api/v1/dashboard/pages' && request.method === 'POST') {
        calls.pageWrites++
        return Response.json({ success: false, error: { code: 'DASHBOARD_FORBIDDEN', message: 'write denied' } }, { status: 403 })
      }
      return Response.json({ success: false, error: { code: 'NOT_FOUND', message: 'not found' } }, { status: 404 })
    },
  })
  return { fake, calls, baseUrl: 'http://127.0.0.1:' + fake.port }
}

describe('real stdio MCP process', () => {
  test('authenticates against local API, lists tools, reads successfully, and preserves write 403', async () => {
    const { fake, calls, baseUrl } = await startFakeDashboardApi()
    const serverPath = fileURLToPath(new URL('./server.ts', import.meta.url))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      cwd: process.cwd(),
      env: { DASHBOARD_API_BASE_URL: baseUrl, DASHBOARD_ACCESS_TOKEN: 'stdio-access-token' },
      stderr: 'pipe',
    })
    const mcpClient = new Client({ name: 'stdio-test-client', version: '1.0.0' })
    try {
      await mcpClient.connect(transport)
      const tools = await mcpClient.listTools()
      expect(calls.session).toBe(1)
      expect(tools.tools).toHaveLength(13)
      const read = await mcpClient.callTool({ name: 'listDashboardPages', arguments: {} })
      const readResult = read as { isError?: boolean; content?: Array<{ text?: string }> }
      expect(readResult.isError).not.toBe(true)
      expect(calls.pagesRead).toBe(1)
      const write = await mcpClient.callTool({ name: 'createDashboardPage', arguments: { name: 'Denied page' } })
      const writeResult = write as { isError?: boolean; content?: Array<{ text?: string }> }
      expect(writeResult.isError).toBe(true)
      expect(calls.pageWrites).toBe(1)
    } finally {
      await mcpClient.close()
      fake.stop(true)
    }
  })

  test('exits non-zero when the session check is forbidden', async () => {
    const { fake, baseUrl } = await startFakeDashboardApi(403)
    const serverPath = fileURLToPath(new URL('./server.ts', import.meta.url))
    const child = Bun.spawn([process.execPath, serverPath], {
      cwd: process.cwd(),
      env: { DASHBOARD_API_BASE_URL: baseUrl, DASHBOARD_ACCESS_TOKEN: 'stdio-access-token', PATH: process.env.PATH ?? '' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      const exitCode = await child.exited
      expect(exitCode).not.toBe(0)
    } finally {
      fake.stop(true)
    }
  })
})
