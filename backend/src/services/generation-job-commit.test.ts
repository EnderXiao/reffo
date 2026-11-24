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
    return JSON.parse(result.stdout.toString()) as Record<string, unknown>
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

const interview = {
  questions: ['请介绍一次架构优化'],
  story_recommendations: [],
  follow_up_questions: [],
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
      const optimized = ${JSON.stringify(optimized)}
      const interview = ${JSON.stringify(interview)}
      let job = {id:'11111111-1111-4111-8111-111111111111', user_id:'user-1', status:'running', stage:'analysis',
        background:false, read_at:null, confirmed_at:null, history_id:null, error:null,
        created_at:'2026-11-24T06:14:49.000Z', updated_at:'2026-11-24T06:14:50.000Z',
        lease_token:'lease-token', lease_expires_at:'2026-11-24T06:19:50.000Z', quota_charged:false,
        payload:{input:{resume_markdown:'# Jeremy Smith\\n\\n## Experience', jd_text:'岗位职责：负责前端架构与交付',
          company:'OpenAI', position:'前端工程师', location:'上海'}}}
      const repository = {patch: async (user, id, changes) => (job = {...job, ...changes}), renew: async () => job,
        quota: async () => undefined, claim: async () => null, create: async () => job, get: async () => job, list: async () => [job]}
      const adapter = {analyze: async () => ({data: analysis, cache: {status: 'miss'}}), match: async () => ({data: matching}),
        generate: async () => ({data: optimized}), interview: async () => ({data: interview})}
      const worker = new GenerationJobWorker(repository, adapter)
      await worker.execute(job)
      const commits = getDatabase().query('SELECT COUNT(*) AS total, COUNT(DISTINCT commit_id) AS distinctIds FROM resume_history_commits').get()
      console.log(JSON.stringify({status: job.status, historyId: job.history_id, commits}))
    `)

    expect(output.status).toBe('completed')
    expect(output.historyId).toBe('JD-11111111-1111-4111-8111-111111111111')
    // 面试阶段的进度已收敛为 done，收尾写入与它内容一致，因此命中同一条提交（幂等回放），
    // 关键是不再出现同一编号对应不同内容的情况。
    expect(output.commits).toEqual({total: 4, distinctIds: 4})
  })
})
