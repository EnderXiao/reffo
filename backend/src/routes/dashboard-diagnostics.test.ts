import {afterEach, beforeEach, describe, expect, mock, test} from 'bun:test'

// 路由层测试：mock 掉认证与数据依赖，验证参数校验、viewer 403、owner 分析成功与审计/限流落点。
// 现有 dashboard 路由没有测试文件，这里沿用 auth.test.ts 的 mock.module 模式。
const TEST_USER = '11111111-1111-4111-8111-111111111111'
let memberRole: 'owner' | 'viewer' = 'owner'
const audits: Array<{action: string; resourceType: string; resourceId: string | null; outcome: string}> = []

mock.module('@/repositories/supabase/client', () => ({
  createSupabaseRestClient: () => ({request: async () => ({})}),
  getSupabaseAuthUser: async () => ({id: TEST_USER}),
  SupabaseRestError: class SupabaseRestError extends Error {status = 500},
}))
mock.module('@/repositories/dashboard-security', () => ({
  findDashboardMember: async () => ({user_id: TEST_USER, role: memberRole, status: 'active'}),
  insertDashboardAudit: async (audit: {action: string; resource_type: string; resource_id: string | null; metadata?: {outcome?: string}}) => {
    audits.push({action: audit.action, resourceType: audit.resource_type, resourceId: audit.resource_id, outcome: audit.metadata?.outcome ?? 'attempt'})
  },
}))
mock.module('@/repositories/dashboard-diagnostics', () => ({
  diagnosticSummary: async () => ({days: 7, windowStart: '2026-11-20T00:00:00Z', failedRuns: 3, failedJobs: 1, providerAttempts: 10, providerFailures: 2, failureRatePercent: 20, topErrorCodes: [], topFailureClasses: [], topModels: []}),
  diagnosticRuns: async () => ({runs: [], hasMore: false}),
  diagnosticDetail: async () => ({runId: 'run-1', failureSample: null, job: null, events: [], providerCalls: []}),
}))
mock.module('@/services/diagnostic-analysis', () => ({
  analyzeRun: async () => ({analysis: {conclusion: '模型服务 502，属于 provider 端临时故障。', confidence: 'low', rootCauseClass: 'unknown', confirmedEvidence: [], uncertainFactors: [], recommendedActions: [], followUpQuestions: []}, model: 'test-model', analyzedAt: '2026-11-20T00:00:00.000Z', events: [], providerCalls: []}),
}))

const {dashboardDiagnosticsRoutes} = await import('@/routes/dashboard-diagnostics')

function call(path: string, options: {method?: string; body?: unknown; auth?: boolean} = {}) {
  return dashboardDiagnosticsRoutes.handle(new Request('http://localhost' + path, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.auth === false ? {} : {Authorization: 'Bearer test-token'}),
      ...(options.body === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    ...(options.body === undefined ? {} : {body: JSON.stringify(options.body)}),
  }))
}

describe('dashboardDiagnosticsRoutes', () => {
  beforeEach(() => {
    audits.length = 0
    memberRole = 'owner'
  })
  afterEach(() => { memberRole = 'owner' })

  test('rejects out-of-range query params with 400', async () => {
    const response = await call('/api/v1/dashboard/diagnostics/runs?days=0')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({success: false, error: {code: 'DASHBOARD_INVALID_INPUT'}})
  })

  test('rejects forbidden filter characters with 400', async () => {
    const response = await call('/api/v1/dashboard/diagnostics/runs?error=bad%20chars')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({success: false, error: {code: 'DASHBOARD_INVALID_INPUT'}})
  })

  test('rejects invalid runId with 400', async () => {
    const response = await call('/api/v1/dashboard/diagnostics/runs/bad%20id')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({success: false, error: {code: 'DASHBOARD_INVALID_INPUT'}})
  })

  test('returns summary for an authenticated dashboard member', async () => {
    const response = await call('/api/v1/dashboard/diagnostics/summary')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({success: true, data: {failedRuns: 3, providerAttempts: 10}})
  })

  test('requires authentication with 401', async () => {
    const response = await call('/api/v1/dashboard/diagnostics/summary', {auth: false})
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({success: false, error: {code: 'DASHBOARD_AUTH_REQUIRED'}})
  })

  test('rejects analysis for viewer with 403', async () => {
    memberRole = 'viewer'
    const response = await call('/api/v1/dashboard/diagnostics/runs/run-1/analysis', {method: 'POST', body: {}})
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({success: false, error: {code: 'DASHBOARD_FORBIDDEN'}})
    expect(audits.some(audit => audit.resourceType === 'analysis' && audit.resourceId === 'run-1')).toBe(false)
  })

  test('owner analysis succeeds and records the attempt audit', async () => {
    const response = await call('/api/v1/dashboard/diagnostics/runs/run-1/analysis', {method: 'POST', body: {}})
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({success: true, data: {runId: 'run-1', model: 'test-model', analysis: {conclusion: '模型服务 502，属于 provider 端临时故障。'}}})
    expect(audits.some(audit => audit.action === 'POST /api/v1/dashboard/diagnostics/runs/:runId/analysis' && audit.resourceType === 'analysis' && audit.resourceId === 'run-1' && audit.outcome === 'attempt')).toBe(true)
    // guard 的 onAfterHandle 会补写 completion 审计（action 为截断形式）。
    expect(audits.some(audit => audit.action === 'POST /api/v1/dashboard/diagnostics/runs' && audit.resourceType === 'analysis' && audit.outcome === 'succeeded')).toBe(true)
  })
})
