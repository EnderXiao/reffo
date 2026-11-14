import {describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const fixtureScript = `
  import assert from 'node:assert/strict'
  import {createCompletionDocument} from './src/shared/resume-completion.ts'
  import {saveCompletionBaseline, loadCompletionBaseline} from './src/services/resume-completion-baseline.ts'
  import {V5CheckpointRepository} from './src/repositories/v5-checkpoint-repository.ts'
  import {singleStepFingerprint} from './src/v5/single-step-adapter.ts'
  const document = createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: 'guest-completion',
    blocks: [{blockId: 'row', kind: 'bullet', prefix: '- ', segments: [
      {kind: 'text', segmentId: 'text', markdown: '主导门店流程优化。', origin: 'generated'}]}]})
  const processResult = (token, target = document) => ({optimized: {completion_document: target, completion_context: token}})
  const repository = new V5CheckpointRepository(singleStepFingerprint())
  const unavailable = promise => assert.rejects(promise, error => error.code === 'RESUME_COMPLETION_MISMATCH')
`

function runIsolated(script: string, provider: 'sqlite' | 'supabase' = 'sqlite') {
  const directory = mkdtempSync(join(tmpdir(), 'reffo-completion-baseline-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', fixtureScript + script + '\nprocess.exit(0)'], {cwd: join(import.meta.dir, '../..'),
      env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: provider, AUTH_REQUIRED: 'false',
        SUPABASE_URL: 'http://127.0.0.1', SQLITE_DATABASE_PATH: join(directory, 'history.sqlite'),
        HARNESS_DATABASE_PATH: join(directory, 'harness.sqlite')}, stdout: 'pipe', stderr: 'pipe'})
    expect({exitCode: result.exitCode, stderr: result.stderr.toString()}).toEqual({exitCode: 0, stderr: ''})
  } finally { rmSync(directory, {recursive: true, force: true}) }
}

describe('访客简历生成基准接续', () => {
  test('v3 与 v4 基准隔离且访客 v4 接续保留服务端行动依据', () => {
    runIsolated(`
      import {freezeActionPlan, freezeResolvedActionPlan} from './src/shared/resume-actions.ts'
      const actionPlan = freezeActionPlan({planId:'p',sourceRevision:'s',judgmentRevision:'j',actions:[]})
      const resolvedPlan = freezeResolvedActionPlan({resolvedPlanId:'rp',revision:0,basePlanId:actionPlan.planId,baseDigest:actionPlan.baseDigest,actions:[],bindings:[]})
      const actionBaseline = {actionPlan,resolvedPlan,interviewBasis:{preparationTopics:[]}}
      for (const version of ['resume-completion-v3','resume-completion-v4']) {
        const linked = createCompletionDocument({...document,schemaVersion:version,documentId:version})
        const token = await saveCompletionBaseline('guest',linked,actionBaseline)
        assert.deepEqual(await loadCompletionBaseline('user-a',processResult(token,linked)),linked)
        const protocol = version === 'resume-completion-v4' ? 'resume-edit-baseline-v4' : 'resume-edit-baseline-v3'
        assert.equal((await new V5CheckpointRepository(protocol).load(token,'user-a')).fingerprint,protocol)
        await unavailable(loadCompletionBaseline('user-b',processResult(token,linked)))
        const other = createCompletionDocument({...linked,schemaVersion:version === 'resume-completion-v4' ? 'resume-completion-v3' : 'resume-completion-v4'})
        await unavailable(loadCompletionBaseline('user-a',processResult(token,other)))
      }
    `)
  })

  test('SQLite 只绑定独立 completion 凭证，同一用户可重试，其他用户不能接管', () => {
    runIsolated(`
      const token = await saveCompletionBaseline('guest', document)
      assert.match(token, /^[a-f0-9]{64}$/)
      assert.deepEqual(await loadCompletionBaseline('user-a', processResult(token)), document)
      assert.equal((await repository.load(token, 'user-a')).owner_id, 'user-a')
      assert.deepEqual(await loadCompletionBaseline('user-a', processResult(token)), document)
      await unavailable(loadCompletionBaseline('user-b', processResult(token)))
      await assert.rejects(repository.load(token, 'guest'))
      const raceToken = await saveCompletionBaseline('guest', document)
      const results = await Promise.allSettled(['user-a', 'user-b'].map(owner => loadCompletionBaseline(owner, processResult(raceToken))))
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(results.filter(result => result.status === 'rejected').length, 1)
      const winner = results[0].status === 'fulfilled' ? 'user-a' : 'user-b'
      assert.deepEqual(await loadCompletionBaseline(winner, processResult(raceToken)), document)
      const retryToken = await saveCompletionBaseline('guest', document)
      const retries = await Promise.all([loadCompletionBaseline('user-a', processResult(retryToken)), loadCompletionBaseline('user-a', processResult(retryToken))])
      assert.equal(retries.length, 2)
      assert.deepEqual(retries, [document, document])
    `)
  })

  test('拒绝错误文档、过期、损坏、普通 matching 和跨用户凭证且不改变访客归属', () => {
    runIsolated(`
      import {getDatabase} from './src/repositories/database.ts'
      import {createDigest} from './src/harness/run-context.ts'
      const token = await saveCompletionBaseline('guest', document)
      await unavailable(loadCompletionBaseline('user-a', processResult(token, {...document, documentId: 'other-document'})))
      assert.equal((await repository.load(token, 'guest')).owner_id, 'guest')
      await unavailable(loadCompletionBaseline('user-a', processResult(token.slice(1))))
      const matchingToken = await repository.save('guest', {kind: 'matching', generated: {completionDocument: document}})
      await unavailable(loadCompletionBaseline('user-a', processResult(matchingToken)))
      assert.equal((await repository.load(matchingToken, 'guest')).owner_id, 'guest')
      await unavailable(loadCompletionBaseline('user-a', {optimized: {completion_document: document}, matching: {jd_structure: {_v5_context: matchingToken}}}))
      const ownedToken = await saveCompletionBaseline('user-b', document)
      await unavailable(loadCompletionBaseline('user-a', processResult(ownedToken)))
      assert.equal((await repository.load(ownedToken, 'user-b')).owner_id, 'user-b')
      const expiredToken = await saveCompletionBaseline('guest', document)
      getDatabase().query('UPDATE v5_checkpoints SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', createDigest(expiredToken))
      await unavailable(loadCompletionBaseline('user-a', processResult(expiredToken)))
      assert.equal(getDatabase().query('SELECT owner_id FROM v5_checkpoints WHERE id = ?').get(createDigest(expiredToken)).owner_id, 'guest')
      const damagedToken = await repository.save('guest', {kind: 'completion', document: {...document, markdownFingerprint: 'damaged'}})
      await unavailable(loadCompletionBaseline('user-a', processResult(damagedToken)))
      assert.equal((await repository.load(damagedToken, 'guest')).owner_id, 'guest')
      const previousVersionToken = await new V5CheckpointRepository('old-fingerprint').save('guest', {kind: 'completion', document})
      await unavailable(loadCompletionBaseline('user-a', processResult(previousVersionToken)))
      const matchingOwnerToken = await repository.save('user-a', {kind: 'matching', generated: {completionDocument: document}})
      assert.deepEqual(await loadCompletionBaseline('user-a', processResult(matchingOwnerToken)), document)
    `)
  })

  test('Supabase 以 guest、有效期和文档条件原子绑定，竞争失败不能覆盖新归属', () => {
    runIsolated(`
      const rows = new Map()
      const patches = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (input, init) => {
        const params = new URL(String(input)).searchParams
        const method = init?.method ?? 'GET'
        if (method === 'POST') { const row = JSON.parse(init.body); rows.set(row.id, row); return Response.json(null) }
        if (method === 'DELETE') return Response.json(null)
        const id = params.get('id')?.slice(3)
        const row = rows.get(id)
        const owner = params.get('owner_id')?.slice(3)
        const current = row && row.owner_id === owner && row.expires_at > params.get('expires_at').slice(3) ? row : null
        if (method === 'GET') return Response.json(current ? [structuredClone(current)] : [])
        assert.equal(method, 'PATCH')
        patches.push(Object.fromEntries(params))
        assert.equal(params.get('owner_id'), 'eq.guest')
        assert.equal(params.get('fingerprint'), 'eq.' + singleStepFingerprint())
        assert.equal(params.get('payload->>kind'), 'eq.completion')
        assert.equal(params.get('payload->document->>documentId'), 'eq.' + document.documentId)
        assert.equal(params.get('payload->document->>schemaVersion'), 'eq.resume-completion-v2')
        assert.equal(params.get('payload->document->>revision'), 'eq.0')
        assert.match(params.get('expires_at'), /^gt\./)
        if (!current) return Response.json([])
        current.owner_id = JSON.parse(init.body).owner_id
        return Response.json([structuredClone(current)])
      }
      try {
        const token = await saveCompletionBaseline('guest', document)
        const results = await Promise.allSettled(['user-a', 'user-b'].map(owner => loadCompletionBaseline(owner, processResult(token))))
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
        assert.equal(results.filter(result => result.status === 'rejected').length, 1)
        const winner = results[0].status === 'fulfilled' ? 'user-a' : 'user-b'
        const loser = winner === 'user-a' ? 'user-b' : 'user-a'
        const patchCount = patches.length
        assert.deepEqual(await loadCompletionBaseline(winner, processResult(token)), document)
        await unavailable(loadCompletionBaseline(loser, processResult(token)))
        assert.equal(patches.length, patchCount)
        assert.equal((await repository.load(token, winner)).owner_id, winner)
      } finally {globalThis.fetch = originalFetch}
    `, 'supabase')
  })

  test('Landing generate 返回独立 completion 凭证，原 matching/source 检查点继续归访客', () => {
    runIsolated(`
      import {mvpRoutes} from './src/routes/mvp.ts'
      import {v5SingleStepAdapter} from './src/v5/single-step-adapter.ts'
      import presets from './src/config/landing-presets.json'
      const sourceToken = await repository.save('guest', {kind: 'resume', source: 'source stays private'})
      const matchingToken = await repository.save('guest', {kind: 'matching', resumeToken: sourceToken, generated: {completionDocument: document}})
      const generatedCompletionToken = await saveCompletionBaseline('guest',document)
      const originalGenerate = v5SingleStepAdapter.generate
      v5SingleStepAdapter.generate = async (_structured, _matching, owner) => {
        assert.equal(owner, 'guest')
        return {runId: 'guest-run', steps: [], data: {optimized_resume: '- 主导门店流程优化。', completion_document: document, completion_context: generatedCompletionToken, changes_summary: [], improvement_score: 0}}
      }
      try {
        const response = await mvpRoutes.handle(new Request('http://localhost/api/v1/mvp/generate', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Reffo-Completion-Schema':'resume-completion-v4'}, body: JSON.stringify({structured_resume: {}, matching: {}, landing: true, preset_jd_id: Object.keys(presets)[0]})}))
        assert.equal(response.status, 200)
        const body = await response.json()
        const token = body.data.completion_context
        assert.match(token, /^[a-f0-9]{64}$/)
        assert.notEqual(token, matchingToken)
        assert.equal((await repository.load(token, 'guest')).payload.kind, 'completion')
        assert.deepEqual(await loadCompletionBaseline('signed-in-user', processResult(token)), document)
        assert.equal((await repository.load(matchingToken, 'guest')).payload.kind, 'matching')
        assert.equal((await repository.load(sourceToken, 'guest')).payload.kind, 'resume')
        await assert.rejects(repository.load(matchingToken, 'signed-in-user'))
        await assert.rejects(repository.load(sourceToken, 'signed-in-user'))
      } finally {v5SingleStepAdapter.generate = originalGenerate}
    `)
  })
})
