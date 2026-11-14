import {expect, test} from 'bun:test'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const fixture = `
  import assert from 'node:assert/strict'
  import {createCompletionDocument,serializeDraft} from './src/shared/resume-completion.ts'
  import {freezeActionPlan,freezeResolvedActionPlan,actionContentDigest} from './src/shared/resume-actions.ts'
  import {upgradeResumeCompletion} from './src/services/resume-completion-upgrade.ts'
  const context={userId:'owner',useServiceRole:true}
  const document=createCompletionDocument({schemaVersion:'resume-completion-v3',documentId:'legacy',blocks:[{blockId:'row',kind:'bullet',prefix:'- ',segments:[{kind:'text',segmentId:'text',markdown:'负责用户体验设计。',origin:'generated'}]}]})
  const plan=freezeActionPlan({planId:'p',sourceRevision:'s',judgmentRevision:'j',actions:[]})
  const resolved=freezeResolvedActionPlan({resolvedPlanId:'r',revision:0,basePlanId:plan.planId,baseDigest:plan.baseDigest,actions:[],bindings:[]})
  const input={id:'upgrade-test',position:'产品经理',company:'测试公司',name:'测试姓名',created_at:'2026-11-13T00:00:00.000Z',quality_score:70,match_score:60,tags:[],resume_content:'源简历',jd_content:'岗位',optimized_content:serializeDraft(document),completion_baseline:document,action_baseline:{actionPlan:plan,resolvedPlan:resolved},process_result:{optimized:{optimized_resume:serializeDraft(document),completion_document:document}}}
  const upgrade=history=>upgradeResumeCompletion(history,{documentId:document.documentId,revision:0,digest:actionContentDigest(document)})
`

function run(script: string, provider: 'sqlite' | 'supabase') {
  const directory = mkdtempSync(join(tmpdir(), 'reffo-upgrade-cas-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', fixture + script], {cwd: join(import.meta.dir, '../..'),
      env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: provider, AUTH_REQUIRED: 'false', SUPABASE_URL: 'http://127.0.0.1',
        SUPABASE_SERVICE_ROLE_KEY: 'test', SQLITE_DATABASE_PATH: join(directory, 'history.sqlite'), HARNESS_DATABASE_PATH: join(directory, 'harness.sqlite')},
      stdout: 'pipe', stderr: 'pipe'})
    expect({exitCode: result.exitCode, stderr: result.stderr.toString()}).toEqual({exitCode: 0, stderr: ''})
  } finally {rmSync(directory, {recursive: true, force: true})}
}

test('SQLite upgrade CAS protects concurrent same-revision process changes, ownership and repeated writes', () => {
  run(`
    import {SqliteResumeHistoryRepository} from './src/repositories/resume-history-repository.sqlite.ts'
    import {getDatabase} from './src/repositories/database.ts'
    const repo=new SqliteResumeHistoryRepository()
    const original=repo.save(context,input), next=upgrade(original)
    const changed={...original.process_result,background_review:{revision:1}}
    getDatabase().query('UPDATE resume_histories SET process_result_json=? WHERE user_id=? AND id=?').run(JSON.stringify(changed),context.userId,original.id)
    assert.throws(()=>repo.upgradeCompletion(context,original,next),error=>error.code==='RESUME_VERSION_CONFLICT')
    assert.deepEqual(repo.findById(context,original.id).process_result,changed)
    const current=repo.findById(context,original.id), refreshed=upgrade(current)
    assert.throws(()=>repo.upgradeCompletion({...context,userId:'other'},current,refreshed),error=>error.code==='RESUME_VERSION_CONFLICT')
    const saved=repo.upgradeCompletion(context,current,refreshed)
    assert.equal(saved.process_result.optimized.completion_document.schemaVersion,'resume-completion-v4')
    assert.equal(saved.process_result.optimized.completion_document.revision,1)
    assert.equal(saved.process_result.background_review.revision,1)
    assert.ok(saved.process_result.server_completion_upgrade_archive)
    assert.throws(()=>repo.upgradeCompletion(context,current,refreshed),error=>error.code==='RESUME_VERSION_CONFLICT')
    assert.equal(upgradeResumeCompletion(saved,{documentId:document.documentId,revision:0,digest:actionContentDigest(document)}),saved)
    assert.equal(repo.findById(context,original.id).process_result.optimized.completion_document.revision,1)
  `, 'sqlite')
})

test('Supabase upgrade uses one atomic RPC with full original snapshot CAS and respects conflicts', () => {
  run(`
    import {SupabaseResumeHistoryRepository} from './src/repositories/resume-history-repository.supabase.ts'
    import {prepareResumeHistorySnapshot} from './src/services/resume-completion-snapshot.ts'
    const original={...prepareResumeHistorySnapshot(input,null),id:input.id,updated_at:'2026-11-13T00:00:01.000Z'}
    const next=upgrade(original), repo=new SupabaseResumeHistoryRepository()
    let calls=0, conflict=false
    globalThis.fetch=async (url,init)=>{
      calls++
      assert.equal(new URL(String(url)).pathname,'/rest/v1/rpc/commit_resume_history')
      assert.equal(init.method,'POST')
      const body=JSON.parse(init.body)
      assert.equal(body.p_owner_id,context.userId)
      assert.equal(body.p_record.user_id,context.userId)
      assert.equal(body.p_record.id,original.id)
      assert.equal(body.p_commit_id,null)
      assert.deepEqual(body.p_expected.processResult,JSON.parse(JSON.stringify(original.process_result)))
      assert.equal(body.p_expected.updatedAt,original.updated_at)
      assert.equal(body.p_expected.documentId,document.documentId)
      assert.equal(body.p_expected.revision,0)
      assert.equal(body.p_expected.resolvedDigest,resolved.resolvedDigest)
      assert.equal(body.p_record.process_result.optimized.completion_document.revision,1)
      assert.ok(body.p_record.process_result.server_completion_upgrade_archive)
      assert.ok(body.p_source_digest)
      assert.ok(Array.isArray(body.p_tasks))
      return Response.json(conflict?{conflict:'version'}:{record:body.p_record})
    }
    const saved=await repo.upgradeCompletion(context,original,next)
    assert.equal(saved.process_result.optimized.completion_document.schemaVersion,'resume-completion-v4')
    assert.equal(calls,1)
    conflict=true
    await assert.rejects(repo.upgradeCompletion(context,original,next),error=>error.code==='RESUME_VERSION_CONFLICT')
    assert.equal(calls,2)
  `, 'supabase')
  const migration = readFileSync(join(import.meta.dir, '../../../supabase/migrations/202611130008_completion_upgrade_cas.sql'), 'utf8')
  expect(migration).toContain("p_expected ? 'processResult' and p_expected->'processResult' is distinct from old_record.process_result")
})
