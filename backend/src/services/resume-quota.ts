import {env} from '@/config/env'
import type {RequestUserContext} from '@/auth/request-context'
import {getDatabase} from '@/repositories/database'
import {createSupabaseRestClient} from '@/repositories/supabase/client'

export class ResumeQuotaError extends Error {
  readonly code = 'RESUME_DAILY_LIMIT_REACHED'
  readonly status = 429
  constructor(public readonly limit: number, public readonly used: number) {
    super(`今日简历生成次数已用完（${limit} 次）`)
    this.name = 'ResumeQuotaError'
  }
}

function dayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.RESUME_QUOTA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function isUnlimited(userId: string) {
  // 本地调试不消费或执行生产配额。
  return env.APP_ENV === 'local' || env.RESUME_QUOTA_UNLIMITED_USER_IDS.includes(userId)
}

function ensureSqliteTable() {
  const db = getDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS resume_daily_quotas (
      user_id TEXT NOT NULL,
      quota_date TEXT NOT NULL,
      daily_limit INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, quota_date)
    )
  `)
  return db
}

async function consumeSupabase(context: RequestUserContext, date: string, checkOnly: boolean) {
  const client = createSupabaseRestClient({accessToken: context.accessToken, useServiceRole: context.useServiceRole})
  const rows = await client.request<Array<{allowed: boolean; daily_limit: number | null; used_count: number; unlimited: boolean}>>('/rest/v1/rpc/consume_resume_quota', {
    method: 'POST',
    body: {p_user_id: context.userId, p_quota_date: date, p_daily_limit: env.RESUME_DAILY_LIMIT, p_consume: !checkOnly},
  })
  const result = rows[0]
  if (result?.unlimited) return null
  if (!result?.allowed) throw new ResumeQuotaError(result?.daily_limit || env.RESUME_DAILY_LIMIT, result?.used_count || 0)
  return {limit: result.daily_limit || env.RESUME_DAILY_LIMIT, used: result.used_count}
}

export async function ensureResumeQuotaAvailable(context: RequestUserContext) {
  if (isUnlimited(context.userId)) return null
  const date = dayKey()
  if (env.DATABASE_PROVIDER === 'supabase') return consumeSupabase(context, date, true)
  const db = ensureSqliteTable()
  const row = db.query('SELECT daily_limit, used_count FROM resume_daily_quotas WHERE user_id = ? AND quota_date = ?').get(context.userId, date) as {daily_limit: number; used_count: number} | null
  if (row && row.used_count >= row.daily_limit) throw new ResumeQuotaError(row.daily_limit, row.used_count)
  return {limit: row?.daily_limit || env.RESUME_DAILY_LIMIT, used: row?.used_count || 0}
}

export async function getResumeQuota(context: RequestUserContext) {
  if (isUnlimited(context.userId)) return {unlimited: true as const, limit: null, used: 0, remaining: null}
  try {
    const current = await ensureResumeQuotaAvailable(context)
    if (!current) return {unlimited: true as const, limit: null, used: 0, remaining: null}
    return {unlimited: false as const, limit: current?.limit || env.RESUME_DAILY_LIMIT, used: current?.used || 0, remaining: Math.max(0, (current?.limit || env.RESUME_DAILY_LIMIT) - (current?.used || 0))}
  } catch (error) {
    if (error instanceof ResumeQuotaError) {
      return {unlimited: false as const, limit: error.limit, used: error.used, remaining: 0}
    }
    throw error
  }
}

export async function consumeResumeQuota(context: RequestUserContext) {
  if (isUnlimited(context.userId)) return null
  const date = dayKey()
  if (env.DATABASE_PROVIDER === 'supabase') return consumeSupabase(context, date, false)
  const db = ensureSqliteTable()
  const now = new Date().toISOString()
  const result = db.transaction(() => {
    const write = db.query(`INSERT INTO resume_daily_quotas (user_id, quota_date, daily_limit, used_count, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id, quota_date) DO UPDATE SET used_count = used_count + 1, updated_at = excluded.updated_at WHERE used_count < daily_limit`).run(context.userId, date, env.RESUME_DAILY_LIMIT, now)
    const current = db.query('SELECT daily_limit, used_count FROM resume_daily_quotas WHERE user_id = ? AND quota_date = ?').get(context.userId, date) as {daily_limit: number; used_count: number}
    return {current, changed: write.changes > 0}
  })()
  if (!result.changed) throw new ResumeQuotaError(result.current?.daily_limit || env.RESUME_DAILY_LIMIT, result.current?.used_count || 0)
  return {limit: result.current.daily_limit, used: result.current.used_count}
}
