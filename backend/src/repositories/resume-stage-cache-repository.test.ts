import {describe,expect,test} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

function isolated(script:string,provider:'sqlite'|'supabase'='sqlite') {
  const directory=mkdtempSync(join(tmpdir(),'reffo-stage-lease-'))
  try {
    const result=Bun.spawnSync([process.execPath,'-e',script+'\nprocess.exit(0)'],{cwd:join(import.meta.dir,'../..'),
      env:{...process.env,APP_ENV:'local',DATABASE_PROVIDER:provider,AUTH_REQUIRED:'false',SQLITE_DATABASE_PATH:join(directory,'cache.sqlite'),
        SUPABASE_URL:'https://stage-contract.invalid',SUPABASE_SECRET_KEY:'test-service-key'},stdout:'pipe',stderr:'pipe'})
    expect({code:result.exitCode,stderr:result.stderr.toString()}).toEqual({code:0,stderr:''})
    return JSON.parse(result.stdout.toString()) as Record<string,unknown>
  }finally{rmSync(directory,{recursive:true,force:true})}
}
const fixture=`
  import assert from 'node:assert/strict'
  import {ResumeStageCacheRepository,ResumeStageCacheBusyError,ensureResumeStageCacheTables} from './src/repositories/resume-stage-cache-repository.ts'
  import {resumeStageCacheKey} from './src/v5/stage-fingerprints.ts'
  const owner='lease-test',dependency={resume:'source',jd:'target'},key=resumeStageCacheKey('matching',owner,dependency)
  const validate=value=>!!value&&typeof value==='object'&&value.ok===true
  const input={owner,stage:'matching',sourceDigest:'source',dependency,validate}
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
`

describe('durable stage coordination',()=>{
  test('matching can request its full bounded timeout without extending a tighter owner request deadline',()=>{
    expect(isolated(fixture+`
      let explicit=0,defaultMs=0,tighter=0
      await new ResumeStageCacheRepository().resolve({...input,owner:'guest',timeoutMs:360000,
        compute:async({timeoutMs})=>{explicit=timeoutMs;return {ok:true}}})
      await new ResumeStageCacheRepository().resolve({...input,owner:'guest',
        compute:async({timeoutMs})=>{defaultMs=timeoutMs;return {ok:true}}})
      await new ResumeStageCacheRepository({requestMs:1000}).resolve({...input,owner:'guest',timeoutMs:360000,
        compute:async({timeoutMs})=>{tighter=timeoutMs;return {ok:true}}})
      assert.ok(explicit>359000 && explicit<=360000)
      assert.ok(defaultMs>204000 && defaultMs<=205000)
      assert.ok(tighter>0 && tighter<=1000)
      for(const timeoutMs of [0,-1,NaN,Infinity,1.5,600001]) {
        await assert.rejects(()=>new ResumeStageCacheRepository().resolve({...input,timeoutMs,compute:async()=>({ok:true})}),/INVALID_STAGE_REQUEST_TIMEOUT/)
      }
      console.log(JSON.stringify({matchingDeadline:true,otherStagesUnchanged:true,tighterDeadlinePreserved:true,invalidRejected:true}))
    `)).toEqual({matchingDeadline:true,otherStagesUnchanged:true,tighterDeadlinePreserved:true,invalidRejected:true})
  })
  test('a live competing lease returns recoverable busy without a paid fallback or checkpoint loss',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables()
      db.query('INSERT INTO resume_stage_cache_locks(cache_key,owner_id,source_digest,lease_token,lease_expires_at) VALUES(?,?,?,?,?)').run(key,owner,'source','other-token',new Date(Date.now()+1000).toISOString())
      db.query('INSERT INTO v5_checkpoints VALUES(?,?,?,?,?)').run('checkpoint',owner,'fingerprint','2099-01-01','{}')
      let calls=0,error;const started=Date.now()
      try{await new ResumeStageCacheRepository({coalesceMs:40,pollMs:5,requestMs:500}).resolve({...input,compute:async()=>{calls++;return {ok:true}}})}catch(e){error=e}
      assert.ok(error instanceof ResumeStageCacheBusyError);assert.equal(error.httpStatus,409);assert.equal(error.retryable,true)
      assert.equal(calls,0);assert.ok(Date.now()-started<350)
      assert.ok(db.query('SELECT 1 FROM v5_checkpoints WHERE id=?').get('checkpoint'))
      console.log(JSON.stringify({boundedBusy:true,noDuplicate:true,checkpointPreserved:true}))
    `)).toEqual({boundedBusy:true,noDuplicate:true,checkpointPreserved:true})
  })
  test('an interrupted short lease is taken over with only the remaining request budget',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables()
      db.query('INSERT INTO resume_stage_cache_locks(cache_key,owner_id,source_digest,lease_token,lease_expires_at) VALUES(?,?,?,?,?)').run(key,owner,'source','interrupted',new Date(Date.now()+45).toISOString())
      let budget=0;const started=Date.now()
      const result=await new ResumeStageCacheRepository({coalesceMs:180,pollMs:5,requestMs:260}).resolve({...input,compute:async context=>{budget=context.timeoutMs;return {ok:true}}})
      assert.equal(result.cacheStatus,'miss');assert.ok(budget>0 && budget<240);assert.ok(Date.now()-started<240)
      assert.equal(db.query('SELECT COUNT(*) n FROM resume_stage_cache_locks').get().n,0)
      console.log(JSON.stringify({takeover:true,remainingBudget:true,released:true}))
    `)).toEqual({takeover:true,remainingBudget:true,released:true})
  })
  test('heartbeats keep a long computation exclusive and its completion becomes a cache hit',()=>{
    expect(isolated(fixture+`
      let calls=0,startCompute;const started=new Promise(resolve=>startCompute=resolve)
      const repo=new ResumeStageCacheRepository({leaseMs:80,renewMs:15,coalesceMs:25,pollMs:5,requestMs:1000})
      const first=repo.resolve({...input,compute:async()=>{calls++;startCompute();await pause(220);return {ok:true}}})
      await started;await pause(115)
      let busy=false;try{await repo.resolve({...input,compute:async()=>{calls++;return {ok:true}}})}catch(e){busy=e instanceof ResumeStageCacheBusyError}
      assert.equal(busy,true);assert.equal(calls,1);assert.equal((await first).cacheStatus,'miss')
      const after=await repo.resolve({...input,compute:async()=>{calls++;return {ok:true}}})
      assert.equal(after.cacheStatus,'hit');assert.equal(calls,1)
      console.log(JSON.stringify({renewedBeyondInitialLease:true,oneCompute:true,readyHit:true}))
    `)).toEqual({renewedBeyondInitialLease:true,oneCompute:true,readyHit:true})
  })
  test('ownership loss aborts the old worker and cannot publish or release the replacement lease',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables();let cancelled=false,error
      try{await new ResumeStageCacheRepository({leaseMs:100,renewMs:10,requestMs:1000}).resolve({...input,compute:async({signal})=>{
        db.query('UPDATE resume_stage_cache_locks SET lease_token=? WHERE cache_key=?').run('replacement-token',key)
        await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason)},{once:true}))
        return {ok:true}
      }})}catch(e){error=e}
      assert.ok(error instanceof ResumeStageCacheBusyError);assert.equal(cancelled,true)
      assert.equal(db.query('SELECT COUNT(*) n FROM resume_stage_cache').get().n,0)
      assert.equal(db.query('SELECT lease_token FROM resume_stage_cache_locks WHERE cache_key=?').get(key).lease_token,'replacement-token')
      console.log(JSON.stringify({cancelled:true,notPublished:true,replacementPreserved:true}))
    `)).toEqual({cancelled:true,notPublished:true,replacementPreserved:true})
  })
  test('the entire request deadline cancels compute before releasing its lease',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables();let settled=false,error;const started=Date.now()
      try{await new ResumeStageCacheRepository({leaseMs:100,renewMs:15,requestMs:65}).resolve({...input,compute:async({signal})=>{
        await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{settled=true;reject(signal.reason)},{once:true}));return {ok:true}
      }})}catch(e){error=e}
      assert.ok(error instanceof ResumeStageCacheBusyError);assert.equal(settled,true);assert.ok(Date.now()-started<300)
      assert.equal(db.query('SELECT COUNT(*) n FROM resume_stage_cache').get().n,0)
      console.log(JSON.stringify({deadlineCancelled:true,noUnsettledPublication:true}))
    `)).toEqual({deadlineCancelled:true,noUnsettledPublication:true})
  })
  test('source revocation between compute and publication keeps the result unavailable',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables();let error
      try{await new ResumeStageCacheRepository().resolve({...input,compute:async()=>{
        db.query('INSERT INTO resume_cache_revocations(owner_id,source_digest,revoked_at) VALUES(?,?,?)').run(owner,'source',new Date().toISOString());return {ok:true}
      }})}catch(e){error=e}
      assert.ok(error instanceof ResumeStageCacheBusyError)
      assert.equal(db.query('SELECT COUNT(*) n FROM resume_stage_cache').get().n,0)
      console.log(JSON.stringify({revocationWon:true}))
    `)).toEqual({revocationWon:true})
  })
  test('a fresh request recomputes a previously revoked source without restoring old payloads or deleting its revocation',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables(),repo=new ResumeStageCacheRepository()
      await repo.resolve({...input,compute:async()=>({ok:true,version:'old'})})
      db.query('INSERT INTO resume_cache_revocations(owner_id,source_digest,revoked_at) VALUES(?,?,?)')
        .run(owner,'source','2026-11-13 02:49:00')
      const revoked=db.query('SELECT * FROM resume_cache_revocations WHERE owner_id=? AND source_digest=?').get(owner,'source')
      assert.ok(revoked.revocation_epoch)
      assert.equal(db.query('SELECT payload FROM resume_stage_cache WHERE cache_key=?').get(key).payload,'{}')
      let calls=0
      const fresh=await repo.resolve({...input,compute:async()=>{calls++;return {ok:true,version:'fresh'}}})
      assert.equal(fresh.cacheStatus,'miss');assert.equal(fresh.value.version,'fresh');assert.equal(calls,1)
      const hit=await repo.resolve({...input,compute:async()=>{throw new Error('must reuse fresh result')}})
      assert.equal(hit.cacheStatus,'hit');assert.equal(hit.value.version,'fresh')
      assert.deepEqual(db.query('SELECT * FROM resume_cache_revocations WHERE owner_id=? AND source_digest=?').get(owner,'source'),revoked)
      console.log(JSON.stringify({freshComputed:true,oldPayloadAbsent:true,revocationRetained:true,freshHit:true}))
    `)).toEqual({freshComputed:true,oldPayloadAbsent:true,revocationRetained:true,freshHit:true})
  })
  test('a revoked old worker cannot overwrite a freshly computed replacement for the same source',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables(),repo=new ResumeStageCacheRepository()
      let startCompute,finishOld
      const started=new Promise(resolve=>startCompute=resolve),finish=new Promise(resolve=>finishOld=resolve)
      const old=repo.resolve({...input,compute:async()=>{startCompute();await finish;return {ok:true,version:'old'}}})
      await started
      const oldLease=db.query('SELECT * FROM resume_stage_cache_locks WHERE cache_key=?').get(key)
      db.query('INSERT INTO resume_cache_revocations(owner_id,source_digest,revoked_at) VALUES(?,?,?)').run(owner,'source',new Date().toISOString())
      assert.equal(db.query('SELECT COUNT(*) n FROM resume_stage_cache_locks WHERE cache_key=?').get(key).n,0)
      const fresh=await repo.resolve({...input,compute:async()=>({ok:true,version:'fresh'})})
      assert.equal(fresh.cacheStatus,'miss')
      // Even if an obsolete process restores its old token, its epoch is stale.
      db.query('INSERT INTO resume_stage_cache_locks(cache_key,owner_id,source_digest,lease_token,lease_expires_at,revocation_epoch) VALUES(?,?,?,?,?,?)')
        .run(key,owner,'source',oldLease.lease_token,new Date(Date.now()+1000).toISOString(),oldLease.revocation_epoch)
      finishOld();let rejected=false
      try{await old}catch(e){rejected=e instanceof ResumeStageCacheBusyError}
      assert.equal(rejected,true)
      const hit=await repo.resolve({...input,compute:async()=>{throw new Error('must keep fresh')}})
      assert.equal(hit.value.version,'fresh')
      console.log(JSON.stringify({oldRejected:true,replacementPreserved:true,staleEpochBlocked:true}))
    `)).toEqual({oldRejected:true,replacementPreserved:true,staleEpochBlocked:true})
  })
  test('repeated revocations advance an opaque epoch even when timestamps are identical',()=>{
    expect(isolated(fixture+`
      const db=ensureResumeStageCacheTables(),repo=new ResumeStageCacheRepository(),stamp='2026-11-13T02:49:00.000Z'
      const revoke=()=>db.query('INSERT INTO resume_cache_revocations(owner_id,source_digest,revoked_at) VALUES(?,?,?) ON CONFLICT(owner_id,source_digest) DO UPDATE SET revoked_at=excluded.revoked_at').run(owner,'source',stamp)
      revoke();const first=db.query('SELECT revocation_epoch FROM resume_cache_revocations').get().revocation_epoch
      await repo.resolve({...input,compute:async()=>({ok:true,version:'first-fresh'})})
      revoke();const second=db.query('SELECT revocation_epoch FROM resume_cache_revocations').get().revocation_epoch
      assert.notEqual(first,second)
      assert.equal(db.query('SELECT payload FROM resume_stage_cache WHERE cache_key=?').get(key).payload,'{}')
      const fresh=await repo.resolve({...input,compute:async()=>({ok:true,version:'second-fresh'})})
      assert.equal(fresh.value.version,'second-fresh')
      console.log(JSON.stringify({epochAdvanced:true,deletedPayloadAbsent:true,freshAfterEachRevocation:true}))
    `)).toEqual({epochAdvanced:true,deletedPayloadAbsent:true,freshAfterEachRevocation:true})
  })
  test('an uncertain Supabase claim fails busy and never enables a second model call',()=>{
    expect(isolated(fixture+`
      let calls=0,claims=0
      globalThis.fetch=async(url,options)=>{
        if(new URL(url).pathname.endsWith('/claim_resume_stage_cache')){claims++;throw new Error('unknown claim outcome')}
        return Response.json([])
      }
      let error;try{await new ResumeStageCacheRepository().resolve({...input,compute:async()=>{calls++;return {ok:true}}})}catch(e){error=e}
      assert.ok(error instanceof ResumeStageCacheBusyError);assert.equal(calls,0);assert.equal(claims,1)
      console.log(JSON.stringify({unknownIsBusy:true,noCompute:true}))
    `,'supabase')).toEqual({unknownIsBusy:true,noCompute:true})
  })
  test('Supabase renewal and publication retain owner/token/expiry CAS and use a 30 second lease',()=>{
    expect(isolated(fixture+`
      let cached=null,token,renewed=false,stored=false,deleted=false,claimTtl=0
      globalThis.fetch=async(url,options)=>{
        const target=new URL(url),body=options?.body?JSON.parse(options.body):null
        if(target.pathname.endsWith('/claim_resume_stage_cache')){token=body.p_token;claimTtl=Date.parse(body.p_expiry)-Date.now();return Response.json(true)}
        if(target.pathname.endsWith('/resume_stage_cache') && (!options?.method||options.method==='GET'))return Response.json(cached?[cached]:[])
        if(target.pathname.endsWith('/resume_stage_cache_locks') && options.method==='PATCH'){
          assert.equal(target.searchParams.get('owner_id'),'eq.'+owner);assert.equal(target.searchParams.get('lease_token'),'eq.'+token)
          assert.ok(target.searchParams.get('lease_expires_at').startsWith('gt.'));assert.ok(Date.parse(body.lease_expires_at)>Date.now())
          renewed=true;return Response.json([{lease_token:token}])
        }
        if(target.pathname.endsWith('/store_resume_stage_cache')){assert.equal(renewed,true);assert.equal(body.p_lease_token,token);cached=body.p_row;stored=true;return Response.json(null)}
        if(target.pathname.endsWith('/resume_stage_cache_locks') && options.method==='DELETE'){
          assert.equal(target.searchParams.get('owner_id'),'eq.'+owner);assert.equal(target.searchParams.get('lease_token'),'eq.'+token);deleted=true;return Response.json(null)
        }
        throw new Error('unexpected cache operation')
      }
      const result=await new ResumeStageCacheRepository().resolve({...input,compute:async()=>({ok:true})})
      assert.equal(result.cacheStatus,'miss');assert.ok(claimTtl>29000 && claimTtl<=30000);assert.ok(renewed&&stored&&deleted)
      console.log(JSON.stringify({shortLease:true,renewCas:true,publishCas:true,releaseCas:true}))
    `,'supabase')).toEqual({shortLease:true,renewCas:true,publishCas:true,releaseCas:true})
  })
})
