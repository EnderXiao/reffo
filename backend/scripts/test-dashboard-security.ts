import assert from 'node:assert/strict'
import {env} from '../src/config/env'
import {Elysia} from 'elysia'
import {cors} from '@elysiajs/cors'
import {dashboardRoutes} from '../src/routes/dashboard'
import {dashboardPagesRoutes} from '../src/routes/dashboard-pages'
import {trackingRequirementRoutes} from '../src/routes/tracking-requirements'
import {dashboardRouter,consumeDashboardLimit} from '../src/auth/dashboard-guard'
import {getDatabase,resetDatabaseConnection} from '../src/repositories/database'
import {dashboardJson,redactDashboardText} from '../src/shared/dashboard-redaction'

// 真实 Elysia 路由 + 隔离 SQLite，只 stub Supabase 的身份核验 HTTP。
env.APP_ENV='local';env.AUTH_REQUIRED=false;env.DATABASE_PROVIDER='sqlite'
env.SUPABASE_URL='https://auth.invalid';env.SUPABASE_PUBLISHABLE_KEY='public-test'
env.DASHBOARD_ALLOWED_ORIGINS=['https://ops.example.test']
const owner='00000000-0000-4000-8000-000000000010'
const viewer='00000000-0000-4000-8000-000000000011'
const disabled='00000000-0000-4000-8000-000000000012'
const outsider='00000000-0000-4000-8000-000000000013'
env.DASHBOARD_OWNER_USER_IDS=[owner,disabled]
const realFetch=globalThis.fetch
let authCalls=0
const users:Record<string,string>={owner,viewer,disabled,outsider}
globalThis.fetch=(async(input,init)=>{
  assert.equal(String(input),'https://auth.invalid/auth/v1/user')
  authCalls++
  const token=new Headers(init?.headers).get('authorization')?.replace('Bearer ','')??''
  if (token === 'auth-unavailable') return new Response('{}',{status:503})
  if (token === 'auth-timeout') throw new DOMException('Timeout','TimeoutError')
  return users[token]?new Response(JSON.stringify({id:users[token]}),{headers:{'content-type':'application/json'}}):new Response('{}',{status:401})
}) as typeof fetch
const app=new Elysia().use(cors({origin:env.DASHBOARD_ALLOWED_ORIGINS,methods:['GET','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization'],exposeHeaders:['Retry-After']})).use(dashboardRoutes).use(dashboardPagesRoutes).use(trackingRequirementRoutes).get('/business',()=>({ok:true}))
const base='http://localhost/api/v1/dashboard'
async function request(path:string,token?:string,method='GET',body?:unknown,origin?:string){
  return app.handle(new Request(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}))
}
let checks=0
async function status(path:string,expected:number,token?:string,method='GET',body?:unknown,origin?:string){
  const r=await request(path,token,method,body,origin)
  assert.equal(r.status,expected,path+' '+method+' expected '+expected+' got '+r.status+' '+await r.clone().text())
  assert.equal(r.headers.get('cache-control'),'no-store')
  checks++
  return r
}
try{
  assert.equal((await app.handle(new Request('http://localhost/business'))).status,200,'dashboard auth must not leak to business routes')
  for(const path of ['/session','/errors','/issues','/trend','/analytics','/analytics/events','/query','/pages','/tracking/requirements']) await status(path,401)
  await status('/pages',401,undefined,'POST',{name:'看板'})
  await status('/session',401,'bad-token')
  await status('/session',503,'auth-unavailable')
  await status('/session',503,'auth-timeout')
  const preflight=await app.handle(new Request(base+'/tracking/requirements',{method:'OPTIONS',headers:{Origin:'https://ops.example.test','Access-Control-Request-Method':'PATCH','Access-Control-Request-Headers':'authorization,content-type'}}))
  assert.equal(preflight.headers.get('access-control-allow-origin'),'https://ops.example.test')
  assert.ok(preflight.headers.get('access-control-allow-methods')?.includes('PATCH'))
  assert.equal(preflight.status,204)
  const rejectedPreflight=await app.handle(new Request(base+'/tracking/requirements',{method:'OPTIONS',headers:{Origin:'https://evil.test','Access-Control-Request-Method':'PATCH'}}))
  assert.equal(rejectedPreflight.status,403)
  const preflightAuthCalls=authCalls
  await app.handle(new Request(base+'/errors',{method:'OPTIONS',headers:{Origin:'https://ops.example.test','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}}))
  assert.equal(authCalls,preflightAuthCalls,'preflight never calls identity provider')
  // 首次 owner 核验会建立 local 权限表；显式禁用仍覆盖引导名单。
  await status('/session',200,'owner')
  const db=getDatabase()
  const now=new Date().toISOString()
  for(const [id,role,state] of [[viewer,'viewer','active'],[disabled,'owner','disabled']]) db.query('INSERT INTO dashboard_members (id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),id,role,state,now,now)
  await status('/session',403,'outsider')
  await status('/session',403,'disabled')
  const calls=authCalls
  await status('/errors',403,'owner','GET',undefined,'https://evil.test')
  assert.equal(authCalls,calls,'origin rejection must precede identity network call')
  const viewerSession=await (await status('/session',200,'viewer')).json()
  assert.equal(viewerSession.data.permissions.canWrite,false)
  await status('/pages',403,'viewer','POST',{name:'无权创建'})
  await status('/tracking/requirements',403,'viewer','POST',{eventName:'blocked',page:'首页',description:'test'})
  await status('/charts/00000000-0000-4000-8000-000000000001',403,'viewer','DELETE')
  await status('/errors',200,'viewer')
  // 同一 trace 多个异常按 id 区分，列表无详情、详情脱敏。
  for(let i=0;i<2;i++) db.query('INSERT INTO error_events (id,trace_id,fingerprint,path,method,status,error_code,error_message,error_stack,context,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'trace-1','fp','/api/path','GET',500,'FAILED','failed token=private','Error at stack user@example.test',JSON.stringify({authorization:'secret',nested:{password:'private'},safe:'ok'}),now)
  const listing=await (await status('/errors?limit=1&traceId=trace-1',200,'viewer')).json()
  assert.equal(listing.data.errors.length,1);assert.equal(listing.data.hasMore,true)
  assert.equal('context' in listing.data.errors[0],false);assert.equal('error_stack' in listing.data.errors[0],false)
  const detail=await (await status('/error/trace-1',200,'viewer')).json()
  assert.equal(detail.data.errors.length,2)
  assert.equal(detail.data.errors[0].context.authorization,'[REDACTED]')
  assert.equal(detail.data.errors[0].context.nested.password,'[REDACTED]')
  assert.match(detail.data.errors[0].error_stack,/\[EMAIL\]/)
  const olderId = crypto.randomUUID()
  for(let i=0;i<25;i++) db.query('INSERT INTO error_events (id,trace_id,fingerprint,path,method,status,error_message,created_at) VALUES (?,?,?,?,?,?,?,?)').run(i===24?olderId:crypto.randomUUID(),'trace-many','fp-many','/api/many','GET',500,'failure',new Date(Date.now()-i*1000).toISOString())
  const oldDetail = await (await status('/error/trace-many?id='+olderId,200,'viewer')).json()
  assert.equal(oldDetail.data.errors.length,1); assert.equal(oldDetail.data.errors[0].id,olderId)
  const created=await (await status('/pages',200,'owner','POST',{name:'业务看板'})).json()
  const pageId=created.data.page.id
  const chart=await (await status('/pages/'+pageId+'/charts',200,'owner','POST',{chartType:'bar',title:'事件',dataQuery:{source:'analytics',groupBy:'event_name',range:7}})).json()
  await status('/pages/'+pageId,200,'viewer')
  await status('/charts/'+chart.data.chart.id,200,'owner','DELETE')
  await status('/pages/'+pageId+'/charts',400,'owner','POST',{chartType:'javascript',title:'非法'})
  await status('/pages/'+pageId+'/charts',400,'owner','POST',{chartType:'bar',title:'非法',dataQuery:{sql:'drop table'}})
  const req=await (await status('/tracking/requirements',200,'owner','POST',{eventName:'test_click',params:['task_id'],page:'首页',description:'测试事件'})).json()
  await status('/tracking/requirements/'+req.data.requirement.id,403,'viewer','PATCH',{status:'implemented'})
  await status('/tracking/requirements/'+req.data.requirement.id,200,'owner','PATCH',{status:'implemented'})
  await status('/tracking/requirements?status=bad',400,'viewer')
  await status('/errors?limit=100000',400,'viewer')
  await status('/errors?limit=1.5',400,'viewer')
  await status('/errors?offset=-1',400,'viewer')
  await status('/query?source=analytics&groupBy=path',400,'owner')
  await status('/query?source=analytics&groupBy=day_series&dimension=fingerprint',400,'owner')
  await status('/query?groupBy=arbitrary_sql',400,'owner')
  await status('/query?range=10000',400,'owner')
  // 聚合必须覆盖超过旧版 1000 条限制，且补齐每日零值。
  const ins=db.query('INSERT INTO analytics_events (id,session_id,event_name,properties,created_at) VALUES (?,?,?,?,?)')
  db.transaction(()=>{for(let i=0;i<1005;i++) ins.run(crypto.randomUUID(),'s','click_a','{}',now)})()
  const agg=await (await status('/query?source=analytics&groupBy=event_name',200,'viewer')).json()
  assert.equal(agg.data.rows[0].value,1005)
  const series=await (await status('/query?source=analytics&groupBy=day_series&range=7',200,'viewer')).json()
  assert.equal(series.data.rows.length,7);assert.equal(series.data.rows.at(-1).value,1005)
  assert.equal(series.data.rows[0].value,0)
  const audits=db.query('SELECT * FROM dashboard_audit_logs').all() as Array<{metadata:string}>
  assert.ok(audits.length>=8);assert.equal(JSON.stringify(audits).includes('private'),false)
  assert.ok(audits.some(r=>r.metadata.includes('succeeded')))
  const remaining=await status('/tracking/requirements?eventName=test_click&limit=1',200,'viewer')
  assert.equal((await remaining.json()).data.requirements.length,1)
  const trackingInsert = db.query('INSERT INTO tracking_requirements (id,event_name,params,page,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  db.transaction(()=>{for(let i=0;i<105;i++) trackingInsert.run(crypto.randomUUID(),'catalog_'+i,'[]',i%2?'pages/create':'创建页','批量测试','pending',now,now)})()
  const trackingFirst = await (await status('/tracking/requirements?limit=20&page='+encodeURIComponent('创建页'),200,'viewer')).json()
  assert.equal(trackingFirst.data.requirements.length,20);assert.equal(trackingFirst.data.hasMore,true)
  const trackingNext = await (await status('/tracking/requirements?limit=20&offset=100&page='+encodeURIComponent('创建页'),200,'viewer')).json()
  assert.equal(trackingNext.data.requirements.length,5);assert.equal(trackingNext.data.hasMore,false)
  const trackingSearch = await (await status('/tracking/requirements?search=catalog_104',200,'viewer')).json()
  assert.equal(trackingSearch.data.requirements[0].event_name,'catalog_104')
  // 低频事件即使不在前十排行里，台账也须显示真实近七天计数。
  for(let i=0;i<12;i++) for(let n=0;n<2;n++) ins.run(crypto.randomUUID(),'s','rank_'+i,'{}',now)
  ins.run(crypto.randomUUID(),'s','catalog_104','{}',now)
  ins.run(crypto.randomUUID(),'s','catalog_104','{}','2020-01-01T00:00:00.000Z')
  const countedRequirement=await (await status('/tracking/requirements?eventName=catalog_104',200,'viewer')).json()
  assert.equal(countedRequirement.data.requirements[0].received_count,1)
  assert.equal(trackingFirst.data.requirements[0].received_count,0)
  const trackingPages = await (await status('/tracking/pages',200,'viewer')).json()
  assert.ok(trackingPages.data.pages.includes('创建页'));assert.ok(!trackingPages.data.pages.includes('pages/create'))
  // 已允许来源也不替代鉴权。
  await status('/session',401,undefined,'GET',undefined,'https://ops.example.test')
  await status('/session',200,'viewer','GET',undefined,'https://ops.example.test')
  const oversized = await app.handle(new Request(base+'/pages',{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify({name:'x'.repeat(40000)})}))
  assert.equal(oversized.status,413)
  // 审计不可写则业务不执行，不能无声丢失高权限写操作。
  db.exec('DROP TABLE dashboard_audit_logs; CREATE TABLE dashboard_audit_logs (invalid TEXT)')
  await status('/pages',503,'owner','POST',{name:'审计失败不能创建'})
  assert.equal(db.query('SELECT name FROM dashboard_pages WHERE name = ?').all('审计失败不能创建').length,0)
  for(let i=0;i<2;i++) consumeDashboardLimit('isolated-rate-test',2,1000)
  assert.throws(()=>consumeDashboardLimit('isolated-rate-test',2,1000))
  consumeDashboardLimit('isolated-rate-test',2,61001)
  // HTTP 限流真实返回 429，且不因为产品路由共挂而误伤产品。
  let limited:Response|undefined
  for(let i=0;i<65;i++){const r=await request('/errors','owner');if(r.status===429){limited=r;break}}
  assert.equal(limited?.status,429);assert.equal(limited?.headers.get('retry-after'),'60')
  assert.equal((await app.handle(new Request('http://localhost/business'))).status,200)
  // 单独挂载的后台路由同样必须保护。
  assert.equal((await dashboardPagesRoutes.handle(new Request(base+'/pages'))).status,401)
  assert.equal((await trackingRequirementRoutes.handle(new Request(base+'/tracking/requirements'))).status,401)
  assert.equal(dashboardJson({access_token:'secret',safe:'ok'}).access_token,'[REDACTED]')
  assert.ok(!redactDashboardText('Bearer hidden user@example.test password=123').includes('hidden'))
  console.log('PASS dashboard security: '+checks+' HTTP checks + RBAC, audit, redaction, >1000 aggregation, rate limiting and independent router protection')
}finally{globalThis.fetch=realFetch;resetDatabaseConnection()}
process.exit(0)
