import {randomUUID} from 'node:crypto'
import type {Database} from 'bun:sqlite'
import {env} from '@/config/env'
import {getDatabase} from './database'
import {createSupabaseRestClient} from './supabase/client'
import {ResumeQuotaError} from '@/services/resume-quota'
import {referralRewardRepository} from './referral-reward-repository'
import type {GenerationJob, GenerationJobInput} from '@/types/generation-job'
import type {InterviewSuggestions, SaveResumeHistoryInput} from '@/types'
import {sqliteResumeHistoryRepository} from './resume-history-repository.sqlite'
import {resumeHistoryCommitParameters, supabaseResumeHistoryRepository} from './resume-history-repository.supabase'
import {historyCommitDigest, ResumeHistoryCommitError} from '@/services/resume-history-commit'

const table = '/rest/v1/resume_generation_jobs'
const service = () => createSupabaseRestClient({useServiceRole: true})
const leaseDuration = 90000
const preparedJobDatabases = new WeakSet<Database>()

function database() {
  const db = getDatabase()
  if (preparedJobDatabases.has(db)) return db
  db.exec(`CREATE TABLE IF NOT EXISTS resume_generation_jobs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
    background INTEGER NOT NULL DEFAULT 0, read_at TEXT, confirmed_at TEXT, history_id TEXT, error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_token TEXT, lease_expires_at TEXT NOT NULL,
  quota_charged INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
  interview_status TEXT, interview_available_at TEXT, interview_lease_token TEXT
  ); CREATE INDEX IF NOT EXISTS generation_jobs_owner ON resume_generation_jobs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS generation_jobs_pending ON resume_generation_jobs(status, lease_expires_at);`)
  const columns = db.query('PRAGMA table_info(resume_generation_jobs)').all() as Array<{name: string}>
  if (['interview_status', 'interview_available_at', 'interview_lease_token'].some(column => !columns.some(item => item.name === column))) {
    db.transaction(() => {
      const current = db.query('PRAGMA table_info(resume_generation_jobs)').all() as Array<{name: string}>
      for (const column of ['interview_status', 'interview_available_at', 'interview_lease_token']) {
        if (!current.some(item => item.name === column)) db.exec(`ALTER TABLE resume_generation_jobs ADD COLUMN ${column} TEXT`)
      }
    }).immediate()
  }
  db.exec(`CREATE INDEX IF NOT EXISTS generation_jobs_interview_pending ON resume_generation_jobs(interview_available_at)
    WHERE interview_status IN ('pending', 'running');
    CREATE INDEX IF NOT EXISTS generation_jobs_history ON resume_generation_jobs(user_id, history_id)
    WHERE interview_status IS NOT NULL;`)
  preparedJobDatabases.add(db)
  return db
}

const checkedLegacyDatabases = new WeakSet<Database>()

function interviewDatabase() {
  const db = database()
  if (!checkedLegacyDatabases.has(db)) {
    sqliteResumeHistoryRepository.generationDatabase()
    importLegacyInterviews(db)
    checkedLegacyDatabases.add(db)
  }
  return db
}

function writeSqliteInterview(db: Database, userId: string, historyId: string | null,
  progress: 'pending' | 'done' | 'failed', result?: InterviewSuggestions) {
  return db.query(`UPDATE resume_histories
    SET progress_json = json_set(COALESCE(progress_json, '{}'), '$.interview', ?),
        process_result_json = CASE WHEN ? IS NULL THEN process_result_json
          ELSE json_set(process_result_json, '$.interview', json(?)) END,
        updated_at = CASE WHEN ? = 'done' THEN updated_at ELSE ? END
    WHERE user_id = ? AND id = ? AND json_type(process_result_json, '$.server_interview_task') = 'text'
      AND COALESCE(json_type(process_result_json, '$.interview'), 'null') = 'null'`)
    .run(progress, result ? 1 : null, result ? JSON.stringify(result) : null, progress,
      new Date().toISOString(), userId, historyId).changes > 0
}

function importLegacyInterviews(db: Database) {
  const legacy = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resume_interview_tasks'").get()
  if (!legacy) return
  db.transaction(() => {
    db.exec('DROP TRIGGER IF EXISTS enqueue_resume_interview; DROP TRIGGER IF EXISTS enqueue_resume_interview_on_delivery;')
    const histories = db.query(`SELECT h.id, h.user_id, h.created_at, h.company, h.position,
      json_type(h.process_result_json, '$.interview') AS existing,
      (SELECT result FROM resume_interview_tasks t WHERE t.user_id = h.user_id AND t.history_id = h.id
        AND t.status = 'done' AND json_type(t.result, '$.questions') = 'array'
        AND json_type(t.result, '$.story_recommendations') = 'array'
        ORDER BY t.updated_at DESC, t.version DESC LIMIT 1) AS result,
      initial.status, initial.available_at
      FROM resume_histories h LEFT JOIN resume_interview_tasks initial ON initial.user_id = h.user_id AND initial.history_id = h.id
        AND initial.version = json_extract(h.process_result_json, '$.server_interview_task')
      WHERE json_type(h.process_result_json, '$.server_interview_task') = 'text'`).all() as Array<{
        id: string; user_id: string; created_at: string; company: string; position: string; existing: string | null
        result: string | null; status: string | null; available_at: string | null
      }>
    const now = new Date().toISOString()
    for (const history of histories) {
      const job = db.query(`SELECT id, interview_status FROM resume_generation_jobs WHERE user_id = ? AND history_id = ?
        AND status = 'completed' ORDER BY interview_status IS NULL, created_at DESC, id DESC LIMIT 1`)
        .get(history.user_id, history.id) as {id: string; interview_status: string | null} | null
      if (job?.interview_status) continue
      const status = history.result || history.existing === 'object' ? 'done'
        : history.status === 'pending' || history.status === 'running' ? 'pending' : 'failed'
      writeSqliteInterview(db, history.user_id, history.id, status, history.result ? JSON.parse(history.result) : undefined)
      const availableAt = status === 'pending' ? history.available_at ?? now : null
      if (job) {
        db.query('UPDATE resume_generation_jobs SET interview_status = ?, interview_available_at = ?, updated_at = ? WHERE id = ?')
          .run(status, availableAt, now, job.id)
      } else if (status !== 'done') {
        db.query(`INSERT INTO resume_generation_jobs (id, user_id, status, stage, read_at, confirmed_at, history_id,
          created_at, updated_at, lease_expires_at, payload, interview_status, interview_available_at)
          VALUES (?, ?, 'completed', 'saving', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), history.user_id, now, now,
            history.id, history.created_at, now, now, JSON.stringify({input: {resume_markdown: '', jd_text: '', location: '',
              company: history.company, position: history.position}}), status, availableAt)
      }
    }
  }).immediate()
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
    const db = interviewDatabase()
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
      const now = new Date().toISOString()
      const enqueueInterview = Boolean(history?.interview_task_version || next.interviewRecovery)
      return decode(db.query(`UPDATE resume_generation_jobs SET stage = ?, payload = ?, status = ?, history_id = ?,
        error = NULL, lease_token = ?, updated_at = ?,
        interview_status = CASE WHEN ? THEN COALESCE(interview_status, 'pending') ELSE interview_status END,
        interview_available_at = CASE WHEN ? AND interview_status IS NULL THEN ? ELSE interview_available_at END
        WHERE user_id = ? AND id = ? RETURNING *`)
        .get(next.stage, JSON.stringify(next.payload), next.status, historyId,
          next.status === 'completed' ? null : current.lease_token, now, Number(enqueueInterview), Number(enqueueInterview), now,
          job.user_id, job.id) as GenerationJob)
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

  async claimInterview() {
    const now = new Date().toISOString()
    const token = randomUUID()
    const expires = new Date(Date.now() + leaseDuration).toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      const filter = {status: 'eq.completed', interview_status: 'in.(pending,running)', interview_available_at: `lte.${now}`}
      const [candidate] = await service().request<Array<Pick<GenerationJob, 'id' | 'user_id'>>>(table, {
        searchParams: {...filter, select: 'id,user_id', order: 'interview_available_at.asc,id.asc', limit: 1},
      })
      if (!candidate) return null
      const [job] = await service().request<GenerationJob[]>(table, {
        method: 'PATCH', prefer: 'return=representation',
        searchParams: {...filter, id: `eq.${candidate.id}`, user_id: `eq.${candidate.user_id}`},
        body: {interview_status: 'running', interview_lease_token: token, interview_available_at: expires, updated_at: now},
      })
      return job ?? null
    }
    return decode(interviewDatabase().query(`UPDATE resume_generation_jobs SET interview_status = 'running',
      interview_lease_token = ?, interview_available_at = ?, updated_at = ?
      WHERE id = (SELECT id FROM resume_generation_jobs WHERE status = 'completed' AND interview_status IN ('pending','running')
        AND interview_available_at <= ? ORDER BY interview_available_at, id LIMIT 1) RETURNING *`)
      .get(token, expires, now, now) as GenerationJob | null)
  }

  async renewInterview(job: GenerationJob) {
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + leaseDuration).toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      const [updated] = await service().request<GenerationJob[]>(table, {
        method: 'PATCH', prefer: 'return=representation',
        searchParams: {id: `eq.${job.id}`, user_id: `eq.${job.user_id}`, interview_status: 'eq.running',
          interview_lease_token: `eq.${job.interview_lease_token}`, interview_available_at: `gt.${now}`},
        body: {interview_available_at: expires},
      })
      return Boolean(updated)
    }
    return database().query(`UPDATE resume_generation_jobs SET interview_available_at = ?
      WHERE id = ? AND user_id = ? AND interview_status = 'running' AND interview_lease_token = ? AND interview_available_at > ?`)
      .run(expires, job.id, job.user_id, job.interview_lease_token ?? null, now).changes > 0
  }

  async finishInterview(job: GenerationJob, status: 'done' | 'failed' | 'unavailable', result?: InterviewSuggestions) {
    if (status === 'done' && !result) throw new Error('INTERVIEW_RESULT_MISSING')
    if (env.DATABASE_PROVIDER === 'supabase') {
      const response = await service().request<{job?: GenerationJob}>('/rest/v1/rpc/finish_resume_generation_interview', {
        method: 'POST', body: {p_owner_id: job.user_id, p_job_id: job.id, p_lease: job.interview_lease_token,
          p_status: status, p_result: result ?? null},
      })
      return response.job ?? null
    }
    const db = interviewDatabase()
    return db.transaction(() => {
      const now = new Date().toISOString()
      const current = readSqliteJob(db, job.user_id, job.id)
      if (current?.interview_status !== 'running' || !job.interview_lease_token ||
        current.interview_lease_token !== job.interview_lease_token || !current.interview_available_at ||
        current.interview_available_at <= now) return null
      const saved = writeSqliteInterview(db, job.user_id, current.history_id, status === 'done' ? 'done' : 'failed', result)
      const existing = !saved && db.query(`SELECT 1 FROM resume_histories WHERE user_id = ? AND id = ?
        AND json_type(process_result_json, '$.interview') = 'object'`).get(job.user_id, current.history_id)
      return decode(db.query(`UPDATE resume_generation_jobs SET interview_status = ?, interview_available_at = NULL,
        interview_lease_token = NULL, updated_at = ? WHERE user_id = ? AND id = ? RETURNING *`)
        .get(saved ? status : existing ? 'done' : 'unavailable', now, job.user_id, job.id) as GenerationJob)
    }).immediate()
  }

  async retryInterview(userId: string, historyId: string) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      const response = await service().request<{job?: GenerationJob}>('/rest/v1/rpc/retry_resume_generation_interview', {
        method: 'POST', body: {p_owner_id: userId, p_history_id: historyId},
      })
      return response.job ?? null
    }
    const db = interviewDatabase()
    return db.transaction(() => {
      const job = decode(db.query(`SELECT * FROM resume_generation_jobs WHERE user_id = ? AND history_id = ?
        AND status = 'completed' AND interview_status IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1`)
        .get(userId, historyId) as GenerationJob | null)
      if (job?.interview_status !== 'failed') return job
      if (!writeSqliteInterview(db, userId, historyId, 'pending')) return null
      const now = new Date().toISOString()
      return decode(db.query(`UPDATE resume_generation_jobs SET interview_status = 'pending', interview_available_at = ?,
        interview_lease_token = NULL, updated_at = ? WHERE user_id = ? AND id = ? RETURNING *`)
        .get(now, now, userId, job.id) as GenerationJob)
    }).immediate()
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
