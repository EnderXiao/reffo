import { Elysia } from 'elysia'
import { env } from '@/config/env'
import { DashboardAccessError, requireDashboardAccess, recordDashboardAudit, type DashboardAccess } from './dashboard-access'

const accessByRequest = new WeakMap<Request, DashboardAccess>()
const completedAudit = new WeakSet<Request>()
const parsedBodies = new WeakMap<Request, unknown>()
const isDashboard = (request: Request) => { const p = new URL(request.url).pathname; return p === '/api/v1/dashboard' || p.startsWith('/api/v1/dashboard/') }
const buckets = new Map<string, {until: number; count: number}>()
const WINDOW = 60_000
const MAX_BUCKETS = 4096
let authInFlight = 0

export function consumeDashboardLimit(key: string, limit: number, now = Date.now()) {
  let entry = buckets.get(key)
  if (!entry || entry.until <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k)
      if (buckets.size >= MAX_BUCKETS) throw new DashboardAccessError('DASHBOARD_RATE_LIMITED', '后台请求繁忙，请稍后再试', 429)
    }
    entry = {until: now + WINDOW, count: 0}
    buckets.set(key, entry)
  }
  if (entry.count >= limit) throw new DashboardAccessError('DASHBOARD_RATE_LIMITED', '请求过于频繁，请一分钟后再试', 429)
  entry.count++
}

function category(request: Request) {
  const path = new URL(request.url).pathname
  if (!['GET', 'HEAD'].includes(request.method)) {
    // LLM 诊断分析成本高，单独收紧限流桶；路由内还做一次同名桶检查作为双保险（见 dashboard-diagnostics.ts）。
    if (path.includes('/diagnostics/') && path.endsWith('/analysis')) return {bucket: 'analysis', limit: 10}
    return {bucket: path.includes('/tracking/') ? 'tracking-write' : 'write', limit: path.includes('/tracking/') ? 20 : 30}
  }
  if (path.includes('/error/')) return {bucket: 'detail', limit: 30}
  if (['/query', '/trend', '/issues', '/analytics/events'].some(s => path.endsWith(s))) return {bucket: 'aggregate', limit: 10}
  return {bucket: 'read', limit: 60}
}

export function dashboardAccessFor(request: Request) {
  const access = accessByRequest.get(request)
  if (!access) throw new DashboardAccessError('DASHBOARD_AUTH_REQUIRED', '请先登录管理后台', 401)
  return access
}

// 每个后台 router 自带 guard：单独挂载路由也不会遗漏鉴权。
export function dashboardRouter(prefix = '/api/v1/dashboard') {
  return new Elysia({prefix, normalize: false})
    .onRequest(async ({request, set}) => {
      if (!isDashboard(request) || accessByRequest.has(request)) return
      try {
        const headers = Object.fromEntries(request.headers.entries())
        set.headers['cache-control'] = 'no-store'
        set.headers['x-content-type-options'] = 'nosniff'
        const origin = headers.origin
        if (origin && !env.DASHBOARD_ALLOWED_ORIGINS.includes(origin)) throw new DashboardAccessError('DASHBOARD_ORIGIN_FORBIDDEN', '不允许的后台来源', 403)
        // 预检没有凭据；仅放行已允许来源，真正请求仍完整鉴权。
        if (request.method === 'OPTIONS') {
          if (!origin) throw new DashboardAccessError('DASHBOARD_ORIGIN_FORBIDDEN', '预检缺少来源', 403)
          return
        }
        const length = Number(headers['content-length'] || 0)
        if (!Number.isFinite(length) || length > 32_768) throw new DashboardAccessError('DASHBOARD_BODY_TOO_LARGE', '请求体过大', 413)
        consumeDashboardLimit('global-auth', 600)
        if (authInFlight >= 16) throw new DashboardAccessError('DASHBOARD_BUSY', '后台繁忙，请稍后再试', 503)
        authInFlight++
        let access: DashboardAccess
        try { access = await requireDashboardAccess(headers, !['GET', 'HEAD'].includes(request.method)) } finally { authInFlight-- }
        const rule = category(request)
        consumeDashboardLimit(access.userId + ':' + rule.bucket, rule.limit)
        if (!['GET', 'HEAD'].includes(request.method) || rule.bucket === 'detail') {
          try {
            await recordDashboardAudit(access, request.method + ' ' + new URL(request.url).pathname.split('/').slice(0, 6).join('/'), rule.bucket, new URL(request.url).pathname.split('/').at(-1) ?? null, 'attempt')
          } catch {
            throw new DashboardAccessError('DASHBOARD_AUDIT_UNAVAILABLE', '审计记录暂不可用，本次操作未执行', 503)
          }
        }
        accessByRequest.set(request, access)
      } catch (error) {
        const failure = error instanceof DashboardAccessError ? error : new DashboardAccessError('DASHBOARD_UNAVAILABLE', '后台暂不可用', 503)
        return Response.json({success:false,error:{code:failure.code,message:failure.message}}, {status:failure.status,headers:{'cache-control':'no-store',...(failure.status===429?{'retry-after':'60'}:{})}})
      }
    })
    .onParse(async ({request, contentType, set}) => {
      if (!isDashboard(request)) return
      if (parsedBodies.has(request)) return parsedBodies.get(request)
      if (['GET','HEAD','OPTIONS','DELETE'].includes(request.method)) return
      if (contentType !== 'application/json') throw new DashboardAccessError('DASHBOARD_INVALID_INPUT','后台写请求必须使用 JSON',400)
      const reader = request.body?.getReader()
      if (!reader) throw new DashboardAccessError('DASHBOARD_INVALID_INPUT','缺少请求体',400)
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const {value,done} = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 32_768) { set.status=413; await reader.cancel(); throw new DashboardAccessError('DASHBOARD_BODY_TOO_LARGE','请求体过大',413) }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength}
      let body: unknown
      try {body=JSON.parse(new TextDecoder().decode(bytes))} catch {throw new DashboardAccessError('DASHBOARD_INVALID_INPUT','请求体不是有效 JSON',400)}
      const path = new URL(request.url).pathname
      const allowed = path.endsWith('/charts') ? ['chartType','title','dataQuery','position'] : path.endsWith('/pages') ? ['name','slug'] : request.method === 'PATCH' ? ['status'] : ['eventName','params','page','description']
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key=>!allowed.includes(key))) throw new DashboardAccessError('DASHBOARD_INVALID_INPUT','存在未支持的请求字段',400)
      if ('dataQuery' in body) {
        const q = body.dataQuery
        if (!q || typeof q !== 'object' || Array.isArray(q) || Object.keys(q).some(key=>!['source','groupBy','range','limit','dimension','topN'].includes(key))) throw new DashboardAccessError('DASHBOARD_INVALID_INPUT','图表查询配置无效',400)
      }
      parsedBodies.set(request, body)
      return body
    })
    .onAfterHandle(async ({request, set}) => {
      if (!isDashboard(request) || request.method === 'OPTIONS' || completedAudit.has(request)) return
      completedAudit.add(request)
      const access = accessByRequest.get(request)
      const rule = category(request)
      if (access && (!['GET', 'HEAD'].includes(request.method) || rule.bucket === 'detail')) {
        try { await recordDashboardAudit(access, request.method + ' ' + new URL(request.url).pathname.split('/').slice(0, 6).join('/'), rule.bucket, new URL(request.url).pathname.split('/').at(-1) ?? null, Number(set.status || 200) < 400 ? 'succeeded' : 'failed') } catch {
          // attempt 已在业务执行前持久化；completion 失败只记固定结构日志，不记录请求内容。
          console.error(JSON.stringify({event: 'dashboard_audit_completion_failed', actor: access.userId}))
        }
      }
    })
    .onError(({request, error, code, set}) => {
      if (!isDashboard(request)) return
      set.headers['cache-control'] = 'no-store'
      if (error instanceof DashboardAccessError) {
        set.status = error.status
        if (error.status === 429) set.headers['retry-after'] = '60'
        return {success: false, error: {code: error.code, message: error.message}}
      }
      if (code === 'PARSE' && set.status === 413) return {success:false,error:{code:'DASHBOARD_BODY_TOO_LARGE',message:'请求体过大'}}
      if (code === 'VALIDATION' || code === 'PARSE') {
        set.status = 400
        return {success: false, error: {code: 'DASHBOARD_INVALID_INPUT', message: '后台请求参数无效'}}
      }
      set.status = 503
      return {success: false, error: {code: 'DASHBOARD_UNAVAILABLE', message: '后台数据暂不可用，请稍后重试'}}
    })
}
