import {describe,expect,test} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

function isolated(script:string) {
  const directory=mkdtempSync(join(tmpdir(),'reffo-transaction-'))
  try {
    const result=Bun.spawnSync([process.execPath,'-e',script+'\nprocess.exit(0)'],{cwd:join(import.meta.dir,'../..'),
      env:{...process.env,APP_ENV:'local',DATABASE_PROVIDER:'sqlite',AUTH_REQUIRED:'false',SQLITE_DATABASE_PATH:join(directory,'history.sqlite')},stdout:'pipe',stderr:'pipe'})
    expect({code:result.exitCode,stderr:result.stderr.toString()}).toEqual({code:0,stderr:''})
    return JSON.parse(result.stdout.toString()) as Record<string,unknown>
  }finally{rmSync(directory,{recursive:true,force:true})}
}
const fixture=`
  import assert from 'node:assert/strict'
  import {getDatabase} from './src/repositories/database.ts'
  import {SqliteResumeHistoryRepository} from './src/repositories/resume-history-repository.sqlite.ts'
  import {createPlainCompletionDocument,serializeDraft} from './src/shared/resume-completion.ts'
  import {ResumeReviewQueue,buildResumeReviewTasks} from './src/services/resume-review-service.ts'
  const repo=new SqliteResumeHistoryRepository(),context={userId:'owner',useServiceRole:true}
  const doc=createPlainCompletionDocument('# 测试姓名\\n- 负责需求分析。')
  const input={id:'test-history',commit_id:'commit-first',position:'产品经理',company:'示例公司',name:'',created_at:'2026-11-12',
    quality_score:70,match_score:null,tags:[],resume_content:'源简历',jd_content:'目标JD',optimized_content:serializeDraft(doc),
    process_result:{optimized:{optimized_resume:serializeDraft(doc),completion_document:doc}}}
`
describe('durable document delivery transactions',()=>{
  test('source OCR reference survives persistence and a manual replacement clears it',()=>{
    const output=isolated(fixture+`
      import {SqliteSourceResumeRepository} from './src/repositories/source-resume-repository.sqlite.ts'
      const sources=new SqliteSourceResumeRepository(),parseId='11111111-1111-4111-8111-111111111111'
      const saved=sources.save(context,{title:'源',resume_markdown:'原始测试简历',source_type:'file',parse_id:parseId})
      assert.equal(saved.parse_id,parseId);assert.equal(sources.getLatest(context).parse_id,parseId)
      assert.equal(sources.getLatest({userId:'other',useServiceRole:true}),null)
      sources.save(context,{title:'手动源',resume_markdown:'用户手动改写',source_type:'manual',parse_id:parseId})
      assert.equal(sources.getLatest(context).parse_id,null)
      console.log(JSON.stringify({persisted:true,ownerScoped:true,manualCleared:true}))
    `)
    expect(output).toEqual({persisted:true,ownerScoped:true,manualCleared:true})
  })
  test('separate worker processes coalesce an identical stage through one durable lease',()=>{
    const output=isolated(fixture+`
      import {ensureResumeStageCacheTables} from './src/repositories/resume-stage-cache-repository.ts'
      ensureResumeStageCacheTables().exec('CREATE TABLE compute_counter(n INTEGER NOT NULL);INSERT INTO compute_counter VALUES(0)')
      const childCode=\`import {ResumeStageCacheRepository} from './src/repositories/resume-stage-cache-repository.ts';
        import {getDatabase} from './src/repositories/database.ts';
        const result=await new ResumeStageCacheRepository().resolve({owner:'lease-owner',stage:'matching',sourceDigest:'source',dependency:{resume:'r',jd:'j'},
          compute:async()=>{getDatabase().query('UPDATE compute_counter SET n=n+1').run();await new Promise(r=>setTimeout(r,100));return {ok:true}},
          validate:value=>!!value&&typeof value==='object'&&value.ok===true});console.log(JSON.stringify(result));process.exit(0)\`
      const children=[1,2].map(()=>Bun.spawn([process.execPath,'-e',childCode],{env:process.env,stdout:'pipe',stderr:'pipe'}))
      const results=await Promise.all(children.map(async child=>({code:await child.exited,out:JSON.parse(await new Response(child.stdout).text()),err:await new Response(child.stderr).text()})))
      assert.ok(results.every(result=>result.code===0 && result.out.value.ok && !result.err))
      assert.equal(getDatabase().query('SELECT n FROM compute_counter').get().n,1)
      console.log(JSON.stringify({onePhysicalCompute:true,twoWorkerResults:true}))
    `)
    expect(output).toEqual({onePhysicalCompute:true,twoWorkerResults:true})
  })
  test('source deletion and revocation roll back together when revocation fails',()=>{
    const output=isolated(fixture+`
      import {SqliteSourceResumeRepository} from './src/repositories/source-resume-repository.sqlite.ts'
      const sources=new SqliteSourceResumeRepository()
      const source=sources.save(context,{title:'源',resume_markdown:'原始测试简历',source_type:'manual'})
      const db=getDatabase()
      db.query("INSERT INTO v5_checkpoints VALUES('checkpoint','owner','fingerprint','2099-01-01','{}')").run()
      db.exec("CREATE TRIGGER fail_revocation BEFORE DELETE ON v5_checkpoints BEGIN SELECT RAISE(ABORT,'revocation unavailable');END")
      const originalError=console.error;console.error=()=>{}
      let failed=false;try{sources.delete(context,source.id)}catch{failed=true}finally{console.error=originalError}
      assert.ok(failed);assert.equal(sources.getLatest(context).id,source.id)
      assert.ok(getDatabase().query("SELECT 1 FROM v5_checkpoints WHERE id='checkpoint'").get())
      getDatabase().exec('DROP TRIGGER fail_revocation')
      assert.equal(sources.delete(context,source.id),true)
      assert.equal(sources.getLatest(context),null)
      assert.equal(getDatabase().query("SELECT 1 FROM v5_checkpoints WHERE id='checkpoint'").get(),null)
      console.log(JSON.stringify({rollbackPreservedSource:true,successfulDeleteRevoked:true}))
    `)
    expect(output).toEqual({rollbackPreservedSource:true,successfulDeleteRevoked:true})
  })
  test('existing SQLite NOT NULL score columns migrate without losing saved histories',()=>{
    const output=isolated(fixture+`
      getDatabase().exec(\`CREATE TABLE resume_histories(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,position TEXT NOT NULL,company TEXT NOT NULL,name TEXT NOT NULL,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,quality_score INTEGER NOT NULL,match_score INTEGER NOT NULL,tags_json TEXT NOT NULL,
        resume_content TEXT NOT NULL,jd_content TEXT NOT NULL,optimized_content TEXT NOT NULL,optimization_suggestions_json TEXT,changes_summary_json TEXT,
        process_result_json TEXT,result_context_json TEXT,progress_json TEXT,card_color TEXT,card_pattern TEXT);
        INSERT INTO resume_histories VALUES('old','owner','岗位','公司','姓名','2026-01-01','2026-01-01',70,80,'[]','源','JD','旧正文',null,null,null,null,null,null,null);\`)
      const saved=repo.save(context,input)
      assert.equal(saved.match_score,null);assert.equal(repo.findById(context,'old').optimized_content,'旧正文')
      console.log(JSON.stringify({nullable:true,preserved:true}))
    `)
    expect(output).toEqual({nullable:true,preserved:true})
  })
  test('lost save response repeats the original acknowledgement and rejects an altered request',()=>{
    const output=isolated(fixture+`
      const first=repo.save(context,input)
      const next=repo.update(context,first.id,{company:'用户后改公司',commit_id:'commit-next'})
      const retry=repo.save(context,input)
      assert.deepEqual(retry,first)
      assert.equal(repo.findById(context,first.id).company,'用户后改公司')
      let conflict=false;try{repo.save(context,{...input,company:'不同参数'})}catch(e){conflict=e.status===409}
      assert.ok(conflict);assert.equal(first.match_score,null)
      console.log(JSON.stringify({idempotent:true,conflict:true,nullableScore:true}))
    `)
    expect(output).toEqual({idempotent:true,conflict:true,nullableScore:true})
  })
  test('outbox enqueue failure rolls back history and idempotency acknowledgement together',()=>{
    const output=isolated(fixture+`
      repo.list(context)
      const db=getDatabase()
      db.exec("CREATE TRIGGER reject_review_enqueue BEFORE INSERT ON resume_review_tasks BEGIN SELECT RAISE(ABORT,'simulated outbox failure'); END")
      const review={version:'resume-action-review-v1',basePlanId:'base',basePlanDigest:'base-digest',resolvedPlanId:'resolved',resolvedDigest:'resolved-digest',documentId:doc.documentId,revision:doc.revision,reviewRevision:0,inputDigest:'input',resumeFingerprint:'fp',outcomes:[{actionId:'a',state:'pending_review',anchors:[],coveredAspectIds:[],remainingAspectIds:[],validation:'pending',source:'edit',explanation:'待核对'}]}
      input.process_result.optimized.action_review=review
      input.process_result.optimized.resolved_action_plan={resolvedDigest:'resolved-digest',actions:[{actionId:'a'}]}
      const originalError=console.error;console.error=()=>{}
      let failed=false;try{repo.save(context,input)}catch{failed=true}finally{console.error=originalError}
      assert.ok(failed);assert.equal(repo.findById(context,input.id),null)
      assert.equal(getDatabase().query('SELECT COUNT(*) AS n FROM resume_history_commits').get().n,0)
      console.log(JSON.stringify({historyRolledBack:true,ackRolledBack:true}))
    `)
    expect(output).toEqual({historyRolledBack:true,ackRolledBack:true})
  })
  test('pending review survives an unrelated revision and stale leases cannot patch the newer document',()=>{
    const output=isolated(fixture+`
      const review={version:'resume-action-review-v1',basePlanId:'base',basePlanDigest:'base-digest',resolvedPlanId:'resolved',resolvedDigest:'resolved-digest',documentId:doc.documentId,revision:0,reviewRevision:0,inputDigest:'input',resumeFingerprint:'fp',outcomes:[{actionId:'a',state:'pending_review',anchors:[],coveredAspectIds:[],remainingAspectIds:[],validation:'pending',source:'edit',explanation:'待核对'}]}
      input.process_result.optimized.action_review=review
      input.process_result.optimized.resolved_action_plan={resolvedDigest:'resolved-digest',actions:[{actionId:'a'}]}
      const first=repo.save(context,input),queue=new ResumeReviewQueue(),old=await queue.claim()
      assert.ok(old)
      const next=structuredClone(input);next.commit_id='commit-later';next.company='无关公司修改';next.process_result.optimized.action_review.revision=1
      const saved=repo.save(context,next)
      const current=await queue.claim()
      assert.equal(current.actionId,'a');assert.equal(current.revision,1)
      const patched=await queue.finish(old,{...review.outcomes[0],state:'adopted',validation:'semantic_pass',source:'semantic_review'})
      assert.equal(patched,false)
      assert.equal(repo.findById(context,input.id).company,'无关公司修改')
      console.log(JSON.stringify({pendingCarried:true,staleLeaseRejected:true}))
    `)
    expect(output).toEqual({pendingCarried:true,staleLeaseRejected:true})
  })
})
