import {describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {jobHistory} from '@/services/generation-jobs'
import type {GenerationJob} from '@/types/generation-job'

function isolated(script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'reffo-generation-commit-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', script + '\nprocess.exit(0)'], {cwd: join(import.meta.dir, '../..'),
      env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: 'sqlite', AUTH_REQUIRED: 'false',
        SQLITE_DATABASE_PATH: join(directory, 'history.sqlite'), HARNESS_DATABASE_PATH: join(directory, 'harness.sqlite')},
      stdout: 'pipe', stderr: 'pipe'})
    expect({code: result.exitCode, stderr: result.stderr.toString()}).toEqual({code: 0, stderr: ''})
    return JSON.parse(result.stdout.toString().trim().split('\n').at(-1)!) as Record<string, unknown>
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
}

const analysis = {
  quality_score: 88,
  structured_resume: {
    personal_info: {name: 'Jeremy Smith'},
    education: [], experience: [], projects: [],
    skills: {hard_skills: [], soft_skills: []},
  },
  strengths: [], weaknesses: [], suggestions: [], capability_summary: '',
}

const matching = {
  match_score: 91,
  hard_requirements_match: {TypeScript: true},
  skill_match: {matched: ['TypeScript'], missing: []},
  experience_match: '具备相关经验',
  optimization_suggestions: ['补充量化结果'],
}

const optimized = {
  optimized_resume: '# Jeremy Smith\n\n## Optimized',
  changes_summary: ['突出架构能力'],
  improvement_score: 4,
}

function jobAt(stage: GenerationJob['stage'], payload: GenerationJob['payload']): GenerationJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    status: 'running',
    stage,
    background: false,
    read_at: null,
    confirmed_at: null,
    history_id: null,
    error: null,
    created_at: '2026-11-24T06:14:49.000Z',
    updated_at: '2026-11-24T06:14:50.000Z',
    lease_token: 'lease-token',
    lease_expires_at: '2026-11-24T06:19:50.000Z',
    quota_charged: false,
    payload,
  }
}

const input = {
  resume_markdown: '# Jeremy Smith\n\n## Experience',
  jd_text: '岗位职责：负责前端架构与交付',
  company: 'OpenAI',
  position: '前端工程师',
  location: '上海',
}

describe('生成任务的历史提交编号', () => {
  test('同一阶段重复生成复用同一编号，阶段推进后编号随之变化', () => {
    const analysisJob = jobAt('analysis', {input, analysis: analysis as never})
    const first = jobHistory(analysisJob)
    const replay = jobHistory({...analysisJob, updated_at: '2026-11-24T07:00:00.000Z'})

    expect(replay.commit_id).toBe(first.commit_id!)
    expect(first.commit_id!.startsWith('generation-11111111-1111-4111-8111-111111111111-')).toBe(true)
    expect(first.commit_id!.length).toBeLessThanOrEqual(128)

    const matchingJob = jobAt('matching', {input, analysis: analysis as never, matching: matching as never})
    expect(jobHistory(matchingJob).commit_id).not.toBe(first.commit_id!)
  })

  test('worker 逐阶段写真实历史时不再触发 RESUME_COMMIT_CONFLICT', () => {
    const output = isolated(`
      import {GenerationJobWorker} from './src/services/generation-jobs.ts'
      import {getDatabase} from './src/repositories/database.ts'
      const analysis = ${JSON.stringify(analysis)}
      const matching = ${JSON.stringify(matching)}
      const {createPlainCompletionDocument, serializeDraft} = await import('./src/shared/resume-completion.ts')
      const document = createPlainCompletionDocument(['# Jeremy Smith', '', '## Optimized'].join(String.fromCharCode(10)))
      const optimized = {optimized_resume: serializeDraft(document), completion_document: document,
        changes_summary: ['突出架构能力'], improvement_score: 4}
      let job = {id:'11111111-1111-4111-8111-111111111111', user_id:'user-1', status:'running', stage:'analysis',
        background:false, read_at:null, confirmed_at:null, history_id:null, error:null,
        created_at:'2026-11-24T06:14:49.000Z', updated_at:'2026-11-24T06:14:50.000Z',
        lease_token:'lease-token', lease_expires_at:'2026-11-24T06:19:50.000Z', quota_charged:false,
        payload:{input:{resume_markdown:'# Jeremy Smith\\n\\n## Experience', jd_text:'岗位职责：负责前端架构与交付',
          company:'OpenAI', position:'前端工程师', location:'上海'}}}
      const repository = {patch: async (user, id, changes) => (job = {...job, ...changes}), renew: async () => job,
        quota: async () => undefined, claim: async () => null, create: async () => job, get: async () => job, list: async () => [job]}
      const adapter = {analyze: async () => ({data: analysis, cache: {status: 'miss'}}), match: async () => ({data: matching}),
        generate: async () => ({data: optimized})}
      const worker = new GenerationJobWorker(repository, adapter)
      await worker.execute(job)
      const commits = getDatabase().query('SELECT COUNT(*) AS total, COUNT(DISTINCT commit_id) AS distinctIds FROM resume_history_commits').get()
      console.log(JSON.stringify({status: job.status, historyId: job.history_id, commits}))
    `)

    expect(output.status).toBe('completed')
    expect(output.historyId).toBe('JD-11111111-1111-4111-8111-111111111111')
    // 分析、匹配和简历交付分别写一次历史。面试建议由独立任务保存。
    expect(output.commits).toEqual({total: 3, distinctIds: 3})
  })

  test('服务端生成写入不受客户端补全基准校验拦截', () => {
    const output = isolated(`
      import {SqliteResumeHistoryRepository} from './src/repositories/resume-history-repository.sqlite.ts'
      import {createCompletionDocument, serializeDraft} from './src/shared/resume-completion.ts'
      const document = createCompletionDocument({schemaVersion: 'resume-completion-v4', documentId: 'v4', blocks: [
        {blockId: 'body', kind: 'bullet', prefix: '- ', entryId: 'entry', unitId: 'unit',
          segments: [{kind: 'text', segmentId: 'safe', markdown: '设计门店辅导流程', origin: 'generated'}]}]})
      const repo = new SqliteResumeHistoryRepository()
      const context = {userId: 'owner-1', useServiceRole: true}
      const base = {id: 'JD-1', position: '产品经理', company: '示例公司', name: '候选人',
        created_at: '2026-11-24T00:00:00.000Z', quality_score: 80, match_score: 0, tags: [],
        resume_content: '源简历', jd_content: '目标JD', optimized_content: '',
        process_result: {analysis: {}}, progress: {analysis: 'done', matching: 'generating', optimized: 'pending', interview: 'pending'},
        commit_id: 'gen-1-analysis', server_generated: true}
      repo.save(context, base)
      const optimized = {optimized_resume: serializeDraft(document), completion_document: document}
      const write = (commitId, generated) => repo.update(context, 'JD-1', {...base, commit_id: commitId,
        server_generated: generated, optimized_content: optimized.optimized_resume,
        process_result: {analysis: {}, optimized: JSON.parse(JSON.stringify(optimized))}})
      let blocked = null
      try { write('gen-1-client-edit', false) } catch (error) { blocked = error.code }
      const saved = write('gen-1-server-write', true)
      console.log(JSON.stringify({blocked, stored: saved.optimized_content.length > 0}))
    `)

    expect(output).toEqual({blocked: 'RESUME_COMPLETION_MISMATCH', stored: true})
  })
})
