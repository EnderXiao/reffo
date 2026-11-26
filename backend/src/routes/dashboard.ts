import {t} from 'elysia'
import {env} from '@/config/env'
import {dashboardRouter, dashboardAccessFor} from '@/auth/dashboard-guard'
import {dashboardPermissions, DashboardAccessError} from '@/auth/dashboard-access'
import {listDashboardErrors, listDashboardAnalytics, aggregateDashboard, dashboardIssues, type GroupBy} from '@/repositories/dashboard-data'
import {redactDashboardValue} from '@/shared/dashboard-redaction'

const integer = (minimum: number, maximum: number) => t.Optional(t.Numeric({minimum, maximum, multipleOf: 1}))
const filter = t.Optional(t.String({minLength: 1, maxLength: 160, pattern: '^[a-zA-Z0-9_./:@-]+$'}))
const querySchema = t.Object({
  source: t.Optional(t.Union([t.Literal('errors'), t.Literal('analytics')])),
  groupBy: t.Optional(t.Union(['day','hour','event_name','fingerprint','path','status','method','day_series'].map(x => t.Literal(x)))),
  range: integer(1,90), limit: integer(1,100), topN: integer(1,8),
  dimension: t.Optional(t.Union([t.Literal('event_name'), t.Literal('fingerprint')])),
})

export const dashboardRoutes = dashboardRouter()
  .get('/session', ({request}) => {
    const access = dashboardAccessFor(request)
    return {success: true, data: {...access, permissions: dashboardPermissions(access.role), environment: env.APP_ENV}}
  })
  .get('/errors', async ({query}) => ({success: true, data: await listDashboardErrors({traceId: query.traceId, fingerprint: query.fingerprint}, query.limit ?? 20, query.offset ?? 0)}), {
    query: t.Object({limit: integer(1,100), offset: integer(0,10000), traceId: filter, fingerprint: filter}),
    detail: {tags: ['Dashboard'], summary: '后台异常分页列表（不含堆栈/上下文）'},
  })
  .get('/error/:traceId', async ({params,query}) => {
    const errors = await listDashboardErrors({traceId: params.traceId,id:query.id}, query.id ? 1 : 20, 0, true)
    const analytics = await listDashboardAnalytics({traceId: params.traceId}, 50, 0)
    return {success: true, data: {traceId: params.traceId, errors: errors.errors, relatedEvents: analytics.events}}
  }, {params: t.Object({traceId: t.String({minLength: 1, maxLength: 160, pattern: '^[a-zA-Z0-9_./:@-]+$'})}),query:t.Object({id:t.Optional(t.String({format:'uuid'}))})})
  .get('/issues', async ({query}) => ({success: true, data: redactDashboardValue(await dashboardIssues(query.days ?? 7, query.limit ?? 50, query.offset ?? 0))}), {
    query: t.Object({days: integer(1,90), limit: integer(1,100), offset: integer(0,10000)}),
  })
  .get('/trend', async ({query}) => {
    const {rows} = await aggregateDashboard({source:'errors',groupBy:'day',days:query.days ?? 7,limit:90,dimension:'fingerprint',topN:3})
    return {success:true,data:{trend: rows.map(row => { const r = row as {key:string;value:number}; return {date:r.key,count:r.value} })}}
  }, {query:t.Object({days:integer(1,30)})})
  .get('/analytics/events', async () => {
    const {rows} = await aggregateDashboard({source:'analytics',groupBy:'event_name',days:7,limit:100,dimension:'event_name',topN:3})
    return {success:true,data:{events:rows.map(row => {const r=row as {key:string;value:number};return {event_name:r.key,count:r.value}})}}
  })
  .get('/analytics', async ({query}) => ({success:true,data: await listDashboardAnalytics({traceId:query.traceId,eventName:query.eventName},query.limit ?? 20,query.offset ?? 0)}), {
    query:t.Object({limit:integer(1,100),offset:integer(0,10000),traceId:filter,eventName:filter}),
  })
  .get('/query', async ({query}) => {
    const source = query.source ?? 'errors'
    const groupBy = (query.groupBy ?? 'day') as GroupBy
    const dimension = query.dimension ?? (source === 'errors' ? 'fingerprint' : 'event_name')
    if ((source === 'errors' && groupBy === 'event_name') || (source === 'analytics' && ['fingerprint','path','status','method'].includes(groupBy)) || (groupBy === 'day_series' && dimension !== (source === 'errors' ? 'fingerprint' : 'event_name'))) {
      throw new DashboardAccessError('DASHBOARD_INVALID_INPUT','数据源与分组维度不兼容',400)
    }
    return {success:true,data:redactDashboardValue(await aggregateDashboard({source,groupBy,days:query.range ?? 7,limit:query.limit ?? 50,dimension,topN:query.topN ?? 3}))}
  }, {query:querySchema})
