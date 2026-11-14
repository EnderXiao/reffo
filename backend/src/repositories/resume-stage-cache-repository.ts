import {randomUUID} from 'node:crypto'
import {env} from '@/config/env'
import {createCanonicalDigest} from '@/harness/run-context'
import {getDatabase} from './database'
import {createSupabaseRestClient} from './supabase/client'
import {resumeStageCacheKey,resumeStageFingerprint,type ResumeCachedStage} from '@/v5/stage-fingerprints'
import {V5WorkflowBlockedError} from '@/v5/errors'

export interface StageCacheArtifact<T> {version: 'resume-stage-artifact-v1'; stage: ResumeCachedStage; fingerprint: string; digest: string; artifact: T}
interface StageRow {cache_key: string;owner_id: string;stage: string;fingerprint: string;payload: unknown;source_digest: string;expires_at: string;revoked_at: string|null}
const client = () => createSupabaseRestClient({useServiceRole: true})
export function ensureResumeStageCacheTables() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS resume_stage_cache (cache_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,stage TEXT NOT NULL,
    fingerprint TEXT NOT NULL,payload TEXT NOT NULL,source_digest TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT);
    CREATE INDEX IF NOT EXISTS resume_stage_source ON resume_stage_cache(owner_id,source_digest);
    CREATE TABLE IF NOT EXISTS v5_checkpoints (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,fingerprint TEXT NOT NULL,expires_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS v5_analysis_cache (cache_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,lease_token TEXT NOT NULL,lease_expires_at TEXT NOT NULL,payload TEXT,expires_at TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS resume_stage_refs (owner_id TEXT NOT NULL,history_id TEXT NOT NULL,source_digest TEXT NOT NULL,
    PRIMARY KEY(owner_id,history_id,source_digest));
    CREATE TABLE IF NOT EXISTS resume_cache_revocations(owner_id TEXT NOT NULL,source_digest TEXT NOT NULL,revoked_at TEXT NOT NULL,
    PRIMARY KEY(owner_id,source_digest));
    CREATE TABLE IF NOT EXISTS resume_stage_cache_locks(cache_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,source_digest TEXT NOT NULL,lease_token TEXT NOT NULL,lease_expires_at TEXT NOT NULL);`)
  const revocationColumns = db.query('PRAGMA table_info(resume_cache_revocations)').all() as Array<{name: string}>
  if (!revocationColumns.some(column => column.name === 'revocation_epoch')) db.exec("ALTER TABLE resume_cache_revocations ADD COLUMN revocation_epoch TEXT NOT NULL DEFAULT ''")
  const leaseColumns = db.query('PRAGMA table_info(resume_stage_cache_locks)').all() as Array<{name: string}>
  if (!leaseColumns.some(column => column.name === 'revocation_epoch')) db.exec(`ALTER TABLE resume_stage_cache_locks ADD COLUMN revocation_epoch TEXT;
    DELETE FROM resume_stage_cache_locks WHERE revocation_epoch IS NULL;`)
  // Epochs distinguish repeated deletions even within the same clock tick. Old
  // leases have NULL and must be claimed again before they can publish.
  db.exec(`UPDATE resume_cache_revocations SET revocation_epoch=lower(hex(randomblob(16))) WHERE revocation_epoch='';
    CREATE TRIGGER IF NOT EXISTS resume_stage_revocation_insert AFTER INSERT ON resume_cache_revocations BEGIN
      UPDATE resume_cache_revocations SET revocation_epoch=lower(hex(randomblob(16))) WHERE owner_id=NEW.owner_id AND source_digest=NEW.source_digest;
      UPDATE resume_stage_cache SET revoked_at=NEW.revoked_at,payload='{}' WHERE owner_id=NEW.owner_id AND source_digest=NEW.source_digest;
      DELETE FROM resume_stage_cache_locks WHERE owner_id=NEW.owner_id AND source_digest=NEW.source_digest;
    END;
    CREATE TRIGGER IF NOT EXISTS resume_stage_revocation_update AFTER UPDATE OF revoked_at ON resume_cache_revocations BEGIN
      UPDATE resume_cache_revocations SET revocation_epoch=lower(hex(randomblob(16))) WHERE owner_id=NEW.owner_id AND source_digest=NEW.source_digest;
      UPDATE resume_stage_cache SET revoked_at=NEW.revoked_at,payload='{}' WHERE owner_id=NEW.owner_id AND source_digest=NEW.source_digest;
      DELETE FROM resume_stage_cache_locks WHERE owner_id=NEW.owner_id AND source_digest=NEW.source_digest;
    END;`)
  if (db.query("SELECT 1 FROM sqlite_master WHERE name='resume_histories' AND type='table'").get()) db.exec(`
    CREATE TRIGGER IF NOT EXISTS revoke_deleted_resume_stage AFTER DELETE ON resume_histories BEGIN
      INSERT OR REPLACE INTO resume_cache_revocations(owner_id,source_digest,revoked_at)
        SELECT OLD.user_id,source_digest,datetime('now') FROM resume_stage_refs WHERE owner_id=OLD.user_id AND history_id=OLD.id;
      UPDATE resume_stage_cache SET revoked_at = datetime('now'), payload = '{}'
        WHERE owner_id = OLD.user_id AND source_digest IN (SELECT source_digest FROM resume_stage_refs WHERE owner_id=OLD.user_id AND history_id=OLD.id);
      DELETE FROM v5_checkpoints WHERE owner_id=OLD.user_id AND json_extract(payload,'$.sourceDigest') IN
        (SELECT source_digest FROM resume_stage_refs WHERE owner_id=OLD.user_id AND history_id=OLD.id);
      DELETE FROM resume_stage_refs WHERE owner_id=OLD.user_id AND history_id=OLD.id;
      DELETE FROM v5_analysis_cache WHERE owner_id=OLD.user_id;
      DELETE FROM resume_stage_cache_locks WHERE owner_id=OLD.user_id;
    END;`)
  return db
}
export class ResumeStageCacheBusyError extends V5WorkflowBlockedError {
  constructor() {super({code: 'RESUME_STAGE_BUSY', state: 'workflow_failure', httpStatus: 409, retryable: true,
    message: '相同输入的阶段正在处理或恢复中，已有检查点已保留，请稍后重试；本次未重复调用模型。'})}
}
export class ResumeStageCacheRepository {
  constructor(private readonly timing: {leaseMs?:number;renewMs?:number;coalesceMs?:number;pollMs?:number;requestMs?:number} = {}) {}
  async resolve<T>(input: {owner: string;stage: ResumeCachedStage;dependency: unknown;sourceDigest: string;timeoutMs?: number;
    compute: (context: {timeoutMs: number;signal: AbortSignal})=>Promise<T>;validate: (value:unknown)=>value is T}) {
    if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 600_000)) {
      throw new Error('INVALID_STAGE_REQUEST_TIMEOUT')
    }
    const requestedMs = input.timeoutMs ?? 205_000
    const started = Date.now(), requestMs = Math.min(requestedMs, this.timing.requestMs ?? requestedMs)
    const deadline = started + requestMs
    const remaining = () => Math.max(0, deadline - Date.now())
    if (!input.owner || input.owner === 'guest') return {value: await input.compute({timeoutMs: remaining(),signal:AbortSignal.timeout(requestMs)}),cacheStatus: 'disabled' as const}
    const key = resumeStageCacheKey(input.stage,input.owner,input.dependency)
    const fingerprint = resumeStageFingerprint(input.stage)
    const readReady=async():Promise<T|null>=>{
      const now = new Date().toISOString()
      const rows = env.DATABASE_PROVIDER === 'supabase'
        ? await client().request<StageRow[]>('/rest/v1/resume_stage_cache',{searchParams:{cache_key:`eq.${key}`,owner_id:`eq.${input.owner}`,fingerprint:`eq.${fingerprint}`,expires_at:`gt.${now}`,revoked_at:'is.null',limit:1}})
        : ensureResumeStageCacheTables().query('SELECT * FROM resume_stage_cache WHERE cache_key=? AND owner_id=? AND fingerprint=? AND expires_at>? AND revoked_at IS NULL').all(key,input.owner,fingerprint,now) as StageRow[]
      const row = rows[0]
      let payload: StageCacheArtifact<unknown> | undefined
      try {payload = (typeof row?.payload === 'string' ? JSON.parse(row.payload) : row?.payload) as StageCacheArtifact<unknown> | undefined} catch {return null}
      if (payload?.version === 'resume-stage-artifact-v1' && payload.stage === input.stage && payload.fingerprint === fingerprint
        && payload.digest === createCanonicalDigest(payload.artifact) && input.validate(payload.artifact)) return structuredClone(payload.artifact)
      return null
    }
    const leaseToken=randomUUID()
    const controller=new AbortController()
    let acquired=false, lostLease=false, heartbeat:ReturnType<typeof setInterval>|undefined, renewing=false
    const abort=()=>{lostLease=true;controller.abort(new ResumeStageCacheBusyError())}
    const requestTimer=setTimeout(abort,remaining())
    requestTimer.unref?.()
    // Bound storage coordination too. An unknown claim result is never permission to issue a second paid computation.
    const coordinate = async <R>(operation: Promise<R>):Promise<R> => {
      let timer:ReturnType<typeof setTimeout>|undefined
      try {return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ResumeStageCacheBusyError()),Math.min(1500,remaining()))})])}
      catch {throw new ResumeStageCacheBusyError()}
      finally {clearTimeout(timer)}
    }
    try {
      const ready=await coordinate(readReady())
      if(ready!==null)return {value:ready,cacheStatus:'hit' as const}
      const waitDeadline=Math.min(deadline,Date.now()+(this.timing.coalesceMs ?? 1000))
      do {
        acquired=await coordinate(this.claim(key,input.owner,input.sourceDigest,leaseToken))
        if(acquired)break
        const coalesced=await coordinate(readReady())
        if(coalesced!==null)return {value:coalesced,cacheStatus:'coalesced' as const}
        if(Date.now()>=waitDeadline)throw new ResumeStageCacheBusyError()
        await new Promise(resolve=>setTimeout(resolve,Math.min(this.timing.pollMs ?? 100,waitDeadline-Date.now())))
      }while(remaining()>0)
      if(!acquired || remaining()<=0)throw new ResumeStageCacheBusyError()
      heartbeat=setInterval(()=>{
        if(renewing)return
        renewing=true
        void coordinate(this.renew(key,input.owner,leaseToken)).then(ok=>{if(!ok)abort()})
          .catch(abort).finally(()=>{renewing=false})
      },this.timing.renewMs ?? 10_000)
      heartbeat.unref?.()
      const prior=await coordinate(readReady())
      if(prior!==null)return {value:prior,cacheStatus:'coalesced' as const}
      const value = await input.compute({timeoutMs: remaining(),signal:controller.signal})
      if(lostLease || remaining()<=0)throw new ResumeStageCacheBusyError()
      if (!input.validate(value)) throw new Error('STAGE_CACHE_ARTIFACT_INVALID')
      // Renew verifies ownership immediately before publishing; delete/revocation and expired leases cannot resurrect a result.
      if(!await coordinate(this.renew(key,input.owner,leaseToken)))throw new ResumeStageCacheBusyError()
      const payload: StageCacheArtifact<T> = {version:'resume-stage-artifact-v1',stage:input.stage,fingerprint,digest:createCanonicalDigest(value),artifact:structuredClone(value)}
      const row: StageRow = {cache_key:key,owner_id:input.owner,stage:input.stage,fingerprint,payload,source_digest:input.sourceDigest,
        expires_at:new Date(Date.now()+env.RESUME_STAGE_CACHE_TTL_MS).toISOString(),revoked_at:null}
      if (env.DATABASE_PROVIDER === 'supabase') await coordinate(client().request('/rest/v1/rpc/store_resume_stage_cache',{method:'POST',body:{p_row:row,p_lease_token:leaseToken}}))
      else ensureResumeStageCacheTables().query(`INSERT INTO resume_stage_cache (cache_key,owner_id,stage,fingerprint,payload,source_digest,expires_at,revoked_at)
        SELECT ?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM resume_stage_cache_locks lease
          WHERE lease.cache_key=? AND lease.owner_id=? AND lease.source_digest=? AND lease.lease_token=? AND lease.lease_expires_at>?
          AND lease.revocation_epoch=COALESCE((SELECT revoked.revocation_epoch FROM resume_cache_revocations revoked
            WHERE revoked.owner_id=lease.owner_id AND revoked.source_digest=lease.source_digest),''))
        ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,revoked_at=NULL`).run(
        key,input.owner,input.stage,fingerprint,JSON.stringify(payload),input.sourceDigest,row.expires_at,key,input.owner,input.sourceDigest,leaseToken,new Date().toISOString())
      if(await coordinate(readReady())===null)throw new ResumeStageCacheBusyError()
      return {value,cacheStatus:'miss' as const}
    }catch(error){
      if(controller.signal.aborted)throw controller.signal.reason
      if(error instanceof ResumeStageCacheBusyError)throw error
      // Storage errors cannot establish absence of another worker, so preserve checkpoints and report recoverable coordination failure.
      if(!acquired)throw new ResumeStageCacheBusyError()
      throw error
    }finally{clearTimeout(requestTimer);clearInterval(heartbeat);if(acquired)await coordinate(this.release(key,input.owner,leaseToken)).catch(()=>undefined)}
  }
  private async claim(key:string,owner:string,sourceDigest:string,token:string):Promise<boolean> {
    const now=new Date().toISOString(),expires=new Date(Date.now()+(this.timing.leaseMs ?? 30_000)).toISOString()
    if(env.DATABASE_PROVIDER==='supabase')return client().request<boolean>('/rest/v1/rpc/claim_resume_stage_cache',{method:'POST',body:{p_key:key,p_owner:owner,p_source_digest:sourceDigest,p_token:token,p_expiry:expires}})
    const row=ensureResumeStageCacheTables().query(`INSERT INTO resume_stage_cache_locks(cache_key,owner_id,source_digest,lease_token,lease_expires_at,revocation_epoch)
      VALUES(?,?,?,?,?,COALESCE((SELECT revocation_epoch FROM resume_cache_revocations WHERE owner_id=? AND source_digest=?),''))
      ON CONFLICT(cache_key) DO UPDATE SET lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,revocation_epoch=excluded.revocation_epoch
      WHERE resume_stage_cache_locks.owner_id=excluded.owner_id AND resume_stage_cache_locks.lease_expires_at<=? RETURNING lease_token`).get(key,owner,sourceDigest,token,expires,owner,sourceDigest,now) as {lease_token:string}|null
    return row?.lease_token===token
  }
  private async renew(key:string,owner:string,token:string):Promise<boolean> {
    const now=new Date().toISOString(),expiry=new Date(Date.now()+(this.timing.leaseMs ?? 30_000)).toISOString()
    if(env.DATABASE_PROVIDER==='supabase') {
      const rows=await client().request<Array<{lease_token:string}>>('/rest/v1/resume_stage_cache_locks',{method:'PATCH',prefer:'return=representation',
        searchParams:{cache_key:`eq.${key}`,owner_id:`eq.${owner}`,lease_token:`eq.${token}`,lease_expires_at:`gt.${now}`},body:{lease_expires_at:expiry}})
      return rows[0]?.lease_token===token
    }
    return Boolean(ensureResumeStageCacheTables().query(`UPDATE resume_stage_cache_locks SET lease_expires_at=?
      WHERE cache_key=? AND owner_id=? AND lease_token=? AND lease_expires_at>?
        AND revocation_epoch=COALESCE((SELECT revoked.revocation_epoch FROM resume_cache_revocations revoked
          WHERE revoked.owner_id=resume_stage_cache_locks.owner_id AND revoked.source_digest=resume_stage_cache_locks.source_digest),'')
      RETURNING lease_token`).get(expiry,key,owner,token,now))
  }
  private async release(key:string,owner:string,token:string) {
    if(env.DATABASE_PROVIDER==='supabase')await client().request('/rest/v1/resume_stage_cache_locks',{method:'DELETE',searchParams:{cache_key:`eq.${key}`,owner_id:`eq.${owner}`,lease_token:`eq.${token}`},prefer:'return=minimal'})
    else ensureResumeStageCacheTables().query('DELETE FROM resume_stage_cache_locks WHERE cache_key=? AND owner_id=? AND lease_token=?').run(key,owner,token)
  }
}
export const resumeStageCacheRepository = new ResumeStageCacheRepository()
