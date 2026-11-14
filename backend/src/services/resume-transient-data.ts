import type {Database} from 'bun:sqlite'
import {env} from '@/config/env'
import {getDatabase} from '@/repositories/database'
import {createSupabaseRestClient} from '@/repositories/supabase/client'
import {ensureResumeStageCacheTables} from '@/repositories/resume-stage-cache-repository'
import {clearOwnerResumeExtractionCache} from '@/v5/single-step-adapter'

/** Source deletion revokes the owner's transient source capabilities; saved histories remain independent. */
export async function revokeSourceTransientData(owner: string) {
  clearOwnerResumeExtractionCache(owner)
  if (env.DATABASE_PROVIDER==='supabase') {
    await createSupabaseRestClient({useServiceRole:true}).request('/rest/v1/rpc/revoke_resume_source_transients',{method:'POST',body:{p_owner:owner}})
    return
  }
  const db=ensureResumeStageCacheTables()
  db.transaction(()=>revokeSourceTransientDataInTransaction(db,owner)).immediate()
}
export function revokeSourceTransientDataInTransaction(db:Database,owner:string) {
  const now=new Date().toISOString()
  db.query(`INSERT OR REPLACE INTO resume_cache_revocations(owner_id,source_digest,revoked_at)
    SELECT owner_id,source_digest,? FROM resume_stage_cache WHERE owner_id=?`).run(now,owner)
  db.query("UPDATE resume_stage_cache SET revoked_at=?,payload='{}' WHERE owner_id=?").run(now,owner)
  db.query('DELETE FROM v5_checkpoints WHERE owner_id=?').run(owner)
  db.query('DELETE FROM v5_analysis_cache WHERE owner_id=?').run(owner)
  db.query('DELETE FROM resume_stage_cache_locks WHERE owner_id=?').run(owner)
  if(db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='resume_exports'").get())
    db.query("UPDATE resume_exports SET status='revoked',model=NULL,file_base64=NULL,lease_token=NULL WHERE owner_id=?").run(owner)
}
export async function cleanupResumeTransientData() {
  if (env.DATABASE_PROVIDER==='supabase') {
    const client=createSupabaseRestClient({useServiceRole:true}),now=new Date().toISOString()
    for (const table of ['resume_stage_cache','resume_review_tasks']) await client.request(`/rest/v1/${table}`,{method:'DELETE',searchParams:{expires_at:`lte.${now}`},prefer:'return=minimal'})
    return
  }
  const db=getDatabase(),now=new Date().toISOString()
  for (const table of ['resume_stage_cache','resume_review_tasks']) if(db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.query(`DELETE FROM ${table} WHERE expires_at<=?`).run(now)
}
