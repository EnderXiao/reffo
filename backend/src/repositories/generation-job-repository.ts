import {randomUUID} from 'node:crypto'
import type {Database} from 'bun:sqlite'
import {env} from '@/config/env'
import {getDatabase} from './database'
import {createSupabaseRestClient} from './supabase/client'
import {ResumeQuotaError} from '@/services/resume-quota'
import {referralRewardRepository} from './referral-reward-repository'
import type {GenerationJob, GenerationJobInput} from '@/types/generation-job'
import type {SaveResumeHistoryInput} from '@/types'
import {sqliteResumeHistoryRepository} from './resume-history-repository.sqlite'
import {resumeHistoryCommitParameters, supabaseResumeHistoryRepository} from './resume-history-repository.supabase'
import {historyCommitDigest, ResumeHistoryCommitError} from '@/services/resume-history-commit'

const table = '/rest/v1/resume_generation_jobs'
const service = () => createSupabaseRestClient({useServiceRole: true})
const leaseDuration = 90000

function database() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS resume_generation_jobs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
    background INTEGER NOT NULL DEFAULT 0, read_at TEXT, confirmed_at TEXT, history_id TEXT, error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_token TEXT, lease_expires_at TEXT NOT NULL,
    quota_charged INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS generation_jobs_owner ON resume_generation_jobs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS generation_jobs_pending ON resume_generation_jobs(status, lease_expires_at);`)
  return db
}

function decode(row: GenerationJob | null): GenerationJob | null {
  if (!row) return null
    return {...row, background: Boolean(row.background), quota_charged: Boolean(row.quota_charged),
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload}
}

type GenerationJobCommit = {
  stage: GenerationJob['stage']
  payload: GenerationJob['payload']
  status: 'running' | 'completed'
  history_id: string
  interviewRecovery?: {version: string; expectedUpdatedAt: string}
}

function readSqliteJob(db: Database, userId: string, id: string) {
  return decode(db.query('SELECT * FROM resume_generation_jobs WHERE id = ? AND user_id = ?').get(id, userId) as GenerationJob | null)
}

export class GenerationJobRepository {
  async commit(job: GenerationJob, next: GenerationJobCommit, history?: SaveResumeHistoryInput): Promise<GenerationJob | null> {
    const historyId = job.history_id ?? `JD-${job.id}`
    if (next.history_id !== historyId || (history && history.id !== historyId)) throw new Error('GENERATION_HISTORY_MISMATCH')
    const context = {userId: job.user_id, useServiceRole: true}
    const digest = history ? historyCommitDigest(history) : null
    if (env.DATABASE_PROVIDER === 'supabase') {
      const previous = history ? await supabaseResumeHistoryRepository.findById(context, historyId) : null
      const parameters = history && digest ? resumeHistoryCommitParameters(context, {...history,
        card_color: previous?.card_color, card_pattern: previous?.card_pattern}, historyId, previous, digest) : null
      const result = await service().request<{job?: GenerationJob; conflict?: string}>('/rest/v1/rpc/commit_resume_generation_job', {
        method: 'POST', body: {p_owner_id: job.user_id, p_job_id: job.id, p_lease: job.lease_token,
          p_stage: job.stage, p_next: next, p_history: parameters},
      })
      if (result.conflict) {
        throw new ResumeHistoryCommitError(result.conflict === 'commit' ? 'RESUME_COMMIT_CONFLICT' : 'RESUME_VERSION_CONFLICT', '生成历史已更新')
      }
      return result.job ?? null
    }
    const db = sqliteResumeHistoryRepository.generationDatabase()
    return db.transaction(() => {
      const current = readSqliteJob(db, job.user_id, job.id)
      if (current?.status === 'completed' && next.status === 'completed' && history?.commit_id) {
        const receipt = db.query('SELECT 1 FROM resume_history_commits WHERE owner_id = ? AND commit_id = ? AND request_digest = ? AND history_id = ?')
          .get(job.user_id, history.commit_id, digest, historyId)
        if (receipt) return current
      }
      if (!current || current.status !== 'running' || current.stage !== job.stage || !job.lease_token ||
          current.lease_token !== job.lease_token || Date.parse(current.lease_expires_at) <= Date.now()) return null
      if ((current.history_id ?? `JD-${current.id}`) !== historyId) return null
      const saved = db.query('SELECT optimized_content FROM resume_histories WHERE user_id = ? AND id = ?')
        .get(job.user_id, historyId) as {optimized_content: string} | null
      if (history) {
        if (saved?.optimized_content.trim()) throw new ResumeHistoryCommitError('RESUME_VERSION_CONFLICT', '生成历史已更新')
        const written = sqliteResumeHistoryRepository.saveGenerationHistory(db, context, history)
        if (written.id !== historyId) throw new Error('GENERATION_HISTORY_MISMATCH')
      } else if (!saved) {
        return null
      }
      if (next.interviewRecovery) {
        const recovery = next.interviewRecovery
        const updated = db.query(`UPDATE resume_histories SET process_result_json = json_set(process_result_json,
          '$.server_interview_task', ?), updated_at = ?
          WHERE user_id = ? AND id = ? AND updated_at = ? AND json_extract(process_result_json, '$.server_interview_task') IS NULL
          AND json_extract(process_result_json, '$.server_interview_basis.version') = 'interview-generation-basis-v1'
          AND json_type(process_result_json, '$.interview') IS NULL`)
          .run(recovery.version, new Date().toISOString(), job.user_id, historyId, recovery.expectedUpdatedAt)
        if (!updated.changes) throw new ResumeHistoryCommitError('RESUME_VERSION_CONFLICT', '生成历史已更新')
      }
      return decode(db.query(`UPDATE resume_generation_jobs SET stage = ?, payload = ?, status = ?, history_id = ?,
        error = NULL, lease_token = ?, updated_at = ? WHERE user_id = ? AND id = ? RETURNING *`)
        .get(next.stage, JSON.stringify(next.payload), next.status, historyId,
          next.status === 'completed' ? null : current.lease_token, new Date().toISOString(), job.user_id, job.id) as GenerationJob)
    }).immediate()
  }

  async stop(userId: string, id: string, failure?: {lease: string; stage: GenerationJob['stage']; error: string; payload: GenerationJob['payload']}): Promise<GenerationJob | null> {
    if (env.DATABASE_PROVIDER === 'supabase') {
      const result = await service().request<{job?: GenerationJob}>('/rest/v1/rpc/stop_resume_generation_job', {
        method: 'POST', body: {p_owner_id: userId, p_job_id: id, p_failure: failure ?? null},
      })
      return result.job ?? null
    }
    const db = sqliteResumeHistoryRepository.generationDatabase()
    return db.transaction(() => {
      const job = readSqliteJob(db, userId, id)
      if (!job || job.status === 'completed') return null
      if (failure && (job.status !== 'running' || job.lease_token !== failure.lease || job.stage !== failure.stage ||
          Date.parse(job.lease_expires_at) <= Date.now())) return null
      if (job.status === 'cancelled') return job
      const now = new Date().toISOString()
      db.query(`UPDATE resume_histories SET progress_json = (
          SELECT json_group_object(key, CASE value WHEN 'generating' THEN 'failed' ELSE value END) FROM json_each(progress_json)
        ), updated_at = ? WHERE user_id = ? AND id = ? AND trim(optimized_content) = ''
        AND EXISTS (SELECT 1 FROM json_each(progress_json) WHERE value = 'generating')`)
        .run(now, userId, job.history_id ?? `JD-${job.id}`)
      return decode(db.query(`UPDATE resume_generation_jobs SET status = ?, payload = ?, error = ?, lease_token = NULL,
        updated_at = ? WHERE user_id = ? AND id = ? RETURNING *`)
        .get(failure ? 'failed' : 'cancelled', JSON.stringify(failure?.payload ?? job.payload), failure?.error ?? job.error,
          now, userId, id) as GenerationJob)
    }).immediate()
  }

  async create(userId: string, id: string, input: GenerationJobInput, releaseFingerprint?: string) {
    const now = new Date().toISOString()
    const job: GenerationJob = {id, user_id: userId, status: 'queued', stage: 'analysis', background: false,
      read_at: null, confirmed_at: null, history_id: null, error: null, created_at: now, updated_at: now,
      lease_token: null, lease_expires_at: now, quota_charged: false,
      payload: {input, ...(releaseFingerprint ? {releaseFingerprint} : {})}}
    if (env.DATABASE_PROVIDER === 'supabase') {
      await service().request(table, {method: 'POST', searchParams: {on_conflict: 'id'},
        prefer: 'resolution=ignore-duplicates', body: job})
    } else {
      database().query(`INSERT OR IGNORE INTO resume_generation_jobs
        (id,user_id,status,stage,created_at,updated_at,lease_expires_at,payload) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, userId, job.status, job.stage, now, now, now, JSON.stringify(job.payload))
    }
    const stored = await this.get(userId, id)
    if (!stored) throw new Error('任务编号不可用')
    return stored
  }

  async get(userId: string, id: string): Promise<GenerationJob | null> {
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await service().request<GenerationJob[]>(table, {searchParams: {id: `eq.${id}`, user_id: `eq.${userId}`, limit: 1}})
      return rows[0] ?? null
    }
    return decode(database().query('SELECT * FROM resume_generation_jobs WHERE id = ? AND user_id = ?').get(id, userId) as GenerationJob | null)
  }

  async list(userId: string): Promise<GenerationJob[]> {
    if (env.DATABASE_PROVIDER === 'supabase') {
      return service().request<GenerationJob[]>(table, {searchParams: {user_id: `eq.${userId}`, confirmed_at: 'is.null',
        status: 'neq.cancelled', order: 'created_at.desc', limit: 100}})
    }
    return (database().query(`SELECT * FROM resume_generation_jobs WHERE user_id = ? AND confirmed_at IS NULL
      AND status != 'cancelled' ORDER BY created_at DESC LIMIT 100`).all(userId) as GenerationJob[]).map(row => decode(row)!)
  }

  async patch(userId: string, id: string, changes: Partial<GenerationJob>, guard: {lease?: string; status?: string} = {}) {
    const now = new Date().toISOString()
    const update = {...changes, updated_at: now}
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await service().request<GenerationJob[]>(table, {method: 'PATCH', prefer: 'return=representation',
        searchParams: {id: `eq.${id}`, user_id: `eq.${userId}`, ...(guard.lease ? {lease_token: `eq.${guard.lease}`, lease_expires_at: `gt.${now}`} : {}),
          ...(guard.status ? {status: `eq.${guard.status}`} : {})}, body: update})
      return rows[0] ?? null
    }
    const entries = Object.entries(update)
    const values = entries.map(([key, value]) => key === 'payload' ? JSON.stringify(value)
      : typeof value === 'boolean' ? Number(value) : value) as Array<string | number | null>
    const row = database().query(`UPDATE resume_generation_jobs SET ${entries.map(([key]) => `${key} = ?`).join(',')}
      WHERE id = ? AND user_id = ? ${guard.lease ? 'AND lease_token = ? AND lease_expires_at > ?' : ''} ${guard.status ? 'AND status = ?' : ''} RETURNING *`)
      .get(...values, id, userId, ...(guard.lease ? [guard.lease, now] : []), ...(guard.status ? [guard.status] : [])) as GenerationJob | null
    return decode(row)
  }

  async claim(): Promise<GenerationJob | null> {
    const now = new Date().toISOString()
    const token = randomUUID()
    const expires = new Date(Date.now() + leaseDuration).toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      const candidates = await service().request<GenerationJob[]>(table, {searchParams: {
        status: 'in.(queued,running)', lease_expires_at: `lte.${now}`, order: 'created_at.asc', limit: 1}})
      const candidate = candidates[0]
      if (!candidate) return null
      const rows = await service().request<GenerationJob[]>(table, {method: 'PATCH', prefer: 'return=representation',
        searchParams: {id: `eq.${candidate.id}`, status: 'in.(queued,running)', lease_expires_at: `lte.${now}`},
        body: {status: 'running', lease_token: token, lease_expires_at: expires, updated_at: now}})
      return rows[0] ?? null
    }
    return decode(database().query(`UPDATE resume_generation_jobs SET status = 'running', lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = (SELECT id FROM resume_generation_jobs WHERE status IN ('queued','running') AND lease_expires_at <= ?
      ORDER BY created_at LIMIT 1) RETURNING *`).get(token, expires, now, now) as GenerationJob | null)
  }

  renew(job: GenerationJob) {
    return this.patch(job.user_id, job.id, {lease_expires_at: new Date(Date.now() + leaseDuration).toISOString()},
      {lease: job.lease_token!, status: 'running'})
  }

  async quota(job: GenerationJob, consume: boolean) {
    if (env.APP_ENV === 'local' || env.RESUME_QUOTA_UNLIMITED_USER_IDS.includes(job.user_id)) return
    if (env.DATABASE_PROVIDER === 'supabase') {
      // 邀请奖励额度优先：消费时先扣奖励余额，检查时余额大于零直接放行。
      if (consume) {
        if (await referralRewardRepository.consumeBonus(job.user_id)) return
      } else if (await referralRewardRepository.getBonus(job.user_id) > 0) {
        return
      }
    }
    const date = new Intl.DateTimeFormat('en-CA', {timeZone: env.RESUME_QUOTA_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date())
    const rows = await service().request<Array<{allowed: boolean; daily_limit: number; used_count: number}>>(
      '/rest/v1/rpc/consume_generation_job_quota', {method: 'POST', body: {p_job_id: job.id, p_lease_token: job.lease_token,
        p_quota_date: date, p_daily_limit: env.RESUME_DAILY_LIMIT, p_consume: consume}})
    if (!rows[0]?.allowed) throw new ResumeQuotaError(rows[0]?.daily_limit || env.RESUME_DAILY_LIMIT, rows[0]?.used_count || 0)
  }
}

export const generationJobRepository = new GenerationJobRepository()
