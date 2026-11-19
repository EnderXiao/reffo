import {env} from '@/config/env'
import {getDatabase} from './database'
import {dashboardClient} from './dashboard-client'
import {DashboardAccessError} from '@/auth/dashboard-access'

const PAGE_SQL = "CASE page WHEN 'pages/auth' THEN '登录/注册页' WHEN 'pages/create' THEN '创建页' WHEN 'pages/result' THEN '结果页' WHEN '首页任务卡片' THEN '首页' ELSE page END"
export async function listTrackingPages(): Promise<{pages: string[]}> {
  if (env.DATABASE_PROVIDER === 'supabase') return dashboardClient().request('/rest/v1/rpc/dashboard_tracking_pages', {method:'POST',body:{}})
  const rows = database().query('SELECT DISTINCT '+PAGE_SQL+' AS page FROM tracking_requirements ORDER BY page LIMIT 100').all() as Array<{page:string}>
  return {pages:rows.map(r=>r.page)}
}
interface Requirement {id:string;event_name:string;params:string[];page:string;description:string;status:'pending'|'implemented';created_at:string;updated_at:string}
function database() {
  const db=getDatabase()
  db.exec("CREATE TABLE IF NOT EXISTS tracking_requirements (id TEXT PRIMARY KEY,event_name TEXT NOT NULL UNIQUE,params TEXT NOT NULL DEFAULT '[]',page TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);")
  return db
}
export async function listRequirements(status?:string,eventName?:string,limit=100,offset=0,page?:string,search?:string):Promise<{requirements:Requirement[];hasMore:boolean}> {
  let rows: Requirement[]
  if(env.DATABASE_PROVIDER==='supabase') {
    const result = await dashboardClient().request<{requirements: Requirement[]; hasMore: boolean}>('/rest/v1/rpc/dashboard_tracking_requirements',{method:'POST',body:{p_status:status??null,p_event:eventName??null,p_limit:limit,p_offset:offset,p_page:page??null,p_search:search??null}})
    return result
  }else{
    const where:string[]=[];const args:string[]=[]
    if(status){where.push('status = ?');args.push(status)}
    if(eventName){where.push('event_name = ?');args.push(eventName)}
    if(page){where.push(PAGE_SQL + ' = ?');args.push(page)}
    if(search){where.push('(instr(lower(event_name),lower(?)) > 0 OR instr(description,?) > 0)');args.push(search,search)}
    const raw=database().query('SELECT * FROM tracking_requirements'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(...args,limit+1,offset) as Array<Omit<Requirement,'params'>&{params:string}>
    rows=raw.map(r=>({...r,params:JSON.parse(r.params)}))
  }
  return {requirements:rows.slice(0,limit),hasMore:rows.length>limit}
}
export async function createRequirement(input:{event_name:string;params:string[];page:string;description:string}) {
  const row={...input,id:crypto.randomUUID(),status:'pending' as const,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
  if((await listRequirements(undefined,input.event_name,1,0)).requirements.length) throw new DashboardAccessError('DASHBOARD_CONFLICT','埋点 ID 已存在',409)
  try {
    if(env.DATABASE_PROVIDER==='supabase') await dashboardClient().request('/rest/v1/tracking_requirements',{method:'POST',body:row})
    else database().query('INSERT INTO tracking_requirements (id,event_name,params,page,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(row.id,row.event_name,JSON.stringify(row.params),row.page,row.description,row.status,row.created_at,row.updated_at)
  } catch(error) {
    if(error && typeof error==='object' && (('status' in error && error.status===409)||('code' in error && error.code==='SQLITE_CONSTRAINT_UNIQUE'))) throw new DashboardAccessError('DASHBOARD_CONFLICT','埋点 ID 已存在',409)
    throw error
  }
  return row
}
export async function updateStatus(id:string,status:'pending'|'implemented') {
  if(env.DATABASE_PROVIDER==='supabase') {
    const rows=await dashboardClient().request<Array<{id:string}>>('/rest/v1/tracking_requirements',{method:'PATCH',searchParams:{id:'eq.'+id,select:'id'},body:{status,updated_at:new Date().toISOString()},prefer:'return=representation'})
    if(!rows.length) throw new DashboardAccessError('DASHBOARD_NOT_FOUND','埋点需求不存在',404)
  }else{
    const result=database().query('UPDATE tracking_requirements SET status = ?,updated_at = ? WHERE id = ?').run(status,new Date().toISOString(),id)
    if(!result.changes) throw new DashboardAccessError('DASHBOARD_NOT_FOUND','埋点需求不存在',404)
  }
}
