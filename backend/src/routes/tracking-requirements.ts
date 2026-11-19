import {t} from 'elysia'
import {dashboardRouter} from '@/auth/dashboard-guard'
import {createRequirement,listRequirements,updateStatus,listTrackingPages} from '@/repositories/tracking-requirements'
const status = t.Union([t.Literal('pending'),t.Literal('implemented')])
const name = t.String({minLength:1,maxLength:100,pattern:'^[a-z][a-z0-9_]*$'})
export const trackingRequirementRoutes = dashboardRouter('/api/v1/dashboard/tracking')
  .get('/pages', async () => ({success:true,data:await listTrackingPages()}))
  .get('/requirements', async ({query}) => ({success:true,data:await listRequirements(query.status,query.eventName,query.limit??100,query.offset??0,query.page,query.search)}), {
    query:t.Object({status:t.Optional(status),eventName:t.Optional(name),page:t.Optional(t.String({minLength:1,maxLength:100})),search:t.Optional(t.String({minLength:1,maxLength:100})),limit:t.Optional(t.Numeric({minimum:1,maximum:100,multipleOf:1})),offset:t.Optional(t.Numeric({minimum:0,maximum:10000,multipleOf:1}))}),
  })
  .post('/requirements', async ({body}) => ({success:true,data:{requirement:await createRequirement({event_name:body.eventName,params:body.params??[],page:body.page.trim(),description:body.description.trim()})}}), {
    body:t.Object({eventName:name,params:t.Optional(t.Array(t.String({minLength:1,maxLength:80,pattern:'^[a-z][a-z0-9_]*$'}),{maxItems:30,uniqueItems:true})),page:t.String({minLength:1,maxLength:100,pattern:'\\S'}),description:t.String({minLength:1,maxLength:2000,pattern:'\\S'})},{additionalProperties:false}),
  })
  .patch('/requirements/:id', async ({params,body}) => {
    await updateStatus(params.id,body.status)
    return {success:true,data:{id:params.id,status:body.status}}
  }, {params:t.Object({id:t.String({format:'uuid'})}),body:t.Object({status},{additionalProperties:false})})
