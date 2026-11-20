import {t} from 'elysia'
import {dashboardRouter, dashboardAccessFor} from '@/auth/dashboard-guard'
import {DashboardAccessError, recordDashboardAudit} from '@/auth/dashboard-access'
import {diagnosticSummary, diagnosticRuns, diagnosticDetail} from '@/repositories/dashboard-diagnostics'
import {analyzeRun} from '@/services/diagnostic-analysis'

// 与 dashboard.ts 的 filter/integer 风格一致；runId 白名单字符集。
const integer = (minimum: number, maximum: number) => t.Optional(t.Numeric({minimum, maximum, multipleOf: 1}))
const runIdParam = t.Object({runId: t.String({minLength: 1, maxLength: 160, pattern: '^[a-zA-Z0-9_./:@-]+$'})})
// model/error 筛选允许为空；字符集与 RPC 内校验一致（无 ilike 通配符）。
const textFilter = t.Optional(t.String({maxLength: 120, pattern: '^[a-zA-Z0-9_./:-]*$'}))

export const dashboardDiagnosticsRoutes = dashboardRouter()
  .get('/diagnostics/summary', async ({query}) => ({success: true, data: await diagnosticSummary(query.days ?? 7)}), {
    query: t.Object({days: integer(1, 90)}),
    detail: {tags: ['Dashboard'], summary: 'Harness/LLM 异常诊断汇总（失败 run/任务、provider 失败率与 Top 分布）'},
  })
  .get('/diagnostics/runs', async ({query}) => {
    const data = await diagnosticRuns({days: query.days ?? 7, limit: query.limit ?? 20, offset: query.offset ?? 0, model: query.model ?? '', error: query.error ?? ''})
    return {success: true, data}
  }, {
    query: t.Object({days: integer(1, 90), limit: integer(1, 100), offset: integer(0, 10000), model: textFilter, error: textFilter}),
    detail: {tags: ['Dashboard'], summary: '分页列出最近失败的 Harness run 及其 provider/任务诊断信息'},
  })
  .get('/diagnostics/runs/:runId', async ({params}) => ({success: true, data: await diagnosticDetail(params.runId)}), {
    params: runIdParam,
    detail: {tags: ['Dashboard'], summary: '单个失败 run 的事件、provider 调用与关联任务明细（已脱敏）'},
  })
  .post('/diagnostics/runs/:runId/analysis', async ({params, request}) => {
    const access = dashboardAccessFor(request)
    // 双重 owner 判定：guard 已拒绝 viewer 写请求，这里再判一次防止路由被绕过挂载。
    if (access.role !== 'owner') throw new DashboardAccessError('DASHBOARD_FORBIDDEN', '当前账号没有执行诊断分析的权限', 403)
    // 限流由 guard 的 category() 统一消耗 analysis 桶（10 次/分钟/用户），路由层不重复消耗。
    // 分析前先落 attempt 审计；完成后 guard 的 onAfterHandle 会补 succeeded/failed。
    await recordDashboardAudit(access, 'POST /api/v1/dashboard/diagnostics/runs/:runId/analysis', 'analysis', params.runId, 'attempt')
    const result = await analyzeRun(params.runId)
    return {success: true, data: {...result, runId: params.runId}}
  }, {
    params: runIdParam,
    detail: {tags: ['Dashboard'], summary: '调用 LLM 对单个失败 run 做根因分析（仅 owner，结果不落库）'},
  })
