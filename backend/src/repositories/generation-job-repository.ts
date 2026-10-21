import {randomUUID} from 'node:crypto'
import {env} from '@/config/env'
import {getDatabase} from './database'
import {createSupabaseRestClient} from './supabase/client'
import {ResumeQuotaError} from '@/services/resume-quota'
import type {GenerationJob, GenerationJobInput} from '@/types/generation-job'

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

export class GenerationJobRepository {
  async create(userId: string, id: string, input: GenerationJobInput) {
    const now = new Date().toISOString()
    const job: GenerationJob = {id, user_id: userId, status: 'queued', stage: 'analysis', background: false,
      read_at: null, confirmed_at: null, history_id: null, error: null, created_at: now, updated_at: now,
      lease_token: null, lease_expires_at: now, quota_charged: false, payload: {input}}
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
    const update = {...changes, updated_at: new Date().toISOString()}
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await service().request<GenerationJob[]>(table, {method: 'PATCH', prefer: 'return=representation',
        searchParams: {id: `eq.${id}`, user_id: `eq.${userId}`, ...(guard.lease ? {lease_token: `eq.${guard.lease}`} : {}),
          ...(guard.status ? {status: `eq.${guard.status}`} : {})}, body: update})
      return rows[0] ?? null
    }
    const entries = Object.entries(update)
    const values = entries.map(([key, value]) => key === 'payload' ? JSON.stringify(value)
      : typeof value === 'boolean' ? Number(value) : value) as Array<string | number | null>
    const row = database().query(`UPDATE resume_generation_jobs SET ${entries.map(([key]) => `${key} = ?`).join(',')}
      WHERE id = ? AND user_id = ? ${guard.lease ? 'AND lease_token = ?' : ''} ${guard.status ? 'AND status = ?' : ''} RETURNING *`)
      .get(...values, id, userId, ...(guard.lease ? [guard.lease] : []), ...(guard.status ? [guard.status] : [])) as GenerationJob | null
    return decode(row)
  }

  async claim(): Promise<GenerationJob | null> {
    const now = new Date().toISOString()
    const token = randomUUID()
    const expires = new Date(Date.now() + leaseDuration).toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      const candidates = await service().request<GenerationJob[]>(table, {searchParams: {
        status: 'in.(queued,running)', lease_expires_at: `lt.${now}`, order: 'created_at.asc', limit: 1}})
      const candidate = candidates[0]
      if (!candidate) return null
      const rows = await service().request<GenerationJob[]>(table, {method: 'PATCH', prefer: 'return=representation',
        searchParams: {id: `eq.${candidate.id}`, status: 'in.(queued,running)', lease_expires_at: `lt.${now}`},
        body: {status: 'running', lease_token: token, lease_expires_at: expires, updated_at: now}})
      return rows[0] ?? null
    }
    return decode(database().query(`UPDATE resume_generation_jobs SET status = 'running', lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = (SELECT id FROM resume_generation_jobs WHERE status IN ('queued','running') AND lease_expires_at < ?
      ORDER BY created_at LIMIT 1) RETURNING *`).get(token, expires, now, now) as GenerationJob | null)
  }

  renew(job: GenerationJob) {
    return this.patch(job.user_id, job.id, {lease_expires_at: new Date(Date.now() + leaseDuration).toISOString()},
      {lease: job.lease_token!, status: 'running'})
  }

  async quota(job: GenerationJob, consume: boolean) {
    if (env.APP_ENV === 'local' || env.RESUME_QUOTA_UNLIMITED_USER_IDS.includes(job.user_id)) return
    const date = new Intl.DateTimeFormat('en-CA', {timeZone: env.RESUME_QUOTA_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date())
    const rows = await service().request<Array<{allowed: boolean; daily_limit: number; used_count: number}>>(
      '/rest/v1/rpc/consume_generation_job_quota', {method: 'POST', body: {p_job_id: job.id, p_lease_token: job.lease_token,
        p_quota_date: date, p_daily_limit: env.RESUME_DAILY_LIMIT, p_consume: consume}})
    if (!rows[0]?.allowed) throw new ResumeQuotaError(rows[0]?.daily_limit || env.RESUME_DAILY_LIMIT, rows[0]?.used_count || 0)
  }
}

export const generationJobRepository = new GenerationJobRepository()
