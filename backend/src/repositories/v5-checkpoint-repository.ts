import { randomBytes } from 'node:crypto'
import { createDigest } from '@/harness/run-context'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { createSupabaseRestClient } from '@/repositories/supabase/client'

export const V5_CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000
export interface V5CheckpointRow {
  id: string
  owner_id: string
  fingerprint: string
  expires_at: string
  payload: unknown
}

export interface V5CheckpointStorage {
  read(id: string, owner: string): Promise<V5CheckpointRow | null>
  write(row: V5CheckpointRow): Promise<void>
  cleanup(): Promise<void>
}

export class V5CheckpointError extends Error {
  readonly code = 'V5_CHECKPOINT_UNAVAILABLE'
  readonly status = 409
  constructor() {
    super('分析上下文已过期或不匹配，请重新开始简历分析')
  }
}

function sqlite() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS v5_checkpoints (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    expires_at TEXT NOT NULL, payload TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_v5_checkpoints_expiry ON v5_checkpoints(expires_at);`)
  return db
}

export const v5CheckpointStorage: V5CheckpointStorage = {
  async read(id, owner) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await createSupabaseRestClient({useServiceRole: true}).request<V5CheckpointRow[]>('/rest/v1/v5_checkpoints', {
        searchParams: {id: `eq.${id}`, owner_id: `eq.${owner}`, expires_at: `gt.${new Date().toISOString()}`, select: '*', limit: 1},
      })
      return rows[0] ?? null
    }
    const row = sqlite().query('SELECT * FROM v5_checkpoints WHERE id = ? AND owner_id = ? AND expires_at > ?').get(id, owner, new Date().toISOString()) as (V5CheckpointRow & {payload: string}) | null
    return row ? {...row, payload: JSON.parse(row.payload)} : null
  },
  async write(row) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      await createSupabaseRestClient({useServiceRole: true}).request('/rest/v1/v5_checkpoints', {
        method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=minimal',
      })
      return
    }
    sqlite().query(`INSERT INTO v5_checkpoints (id, owner_id, fingerprint, expires_at, payload)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`).run(
      row.id, row.owner_id, row.fingerprint, row.expires_at, JSON.stringify(row.payload),
    )
  },
  async cleanup() {
    const now = new Date().toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      await createSupabaseRestClient({useServiceRole: true}).request('/rest/v1/v5_checkpoints', {
        method: 'DELETE', searchParams: {expires_at: `lte.${now}`}, prefer: 'return=minimal',
      })
    } else sqlite().query('DELETE FROM v5_checkpoints WHERE expires_at <= ?').run(now)
  },
}

/** 原文和证据只保存在服务端。前端拿到随机句柄，数据库只保存句柄哈希。 */
export class V5CheckpointRepository {
  constructor(private readonly fingerprint: string, private readonly storage: V5CheckpointStorage = v5CheckpointStorage) {}

  async save(owner: string, payload: unknown) {
    await this.storage.cleanup()
    const token = randomBytes(32).toString('hex')
    await this.storage.write({id: createDigest(token), owner_id: owner, fingerprint: this.fingerprint,
      expires_at: new Date(Date.now() + V5_CHECKPOINT_TTL_MS).toISOString(), payload})
    return token
  }

  async load(token: unknown, owner: string) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new V5CheckpointError()
    const row = await this.storage.read(createDigest(token), owner)
    if (!row || row.owner_id !== owner || row.fingerprint !== this.fingerprint
      || Date.parse(row.expires_at) <= Date.now() || !Number.isFinite(Date.parse(row.expires_at))) throw new V5CheckpointError()
    return row
  }

  async update(row: V5CheckpointRow, payload: unknown) {
    await this.storage.write({...row, payload})
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | undefined
export function startV5CheckpointCleanup() {
  if (cleanupTimer) return
  let inFlight = false
  const cleanup = async () => {
    if (inFlight) return
    inFlight = true
    try { await v5CheckpointStorage.cleanup() }
    catch { console.error('[V5Checkpoint] 检查点清理失败，请检查数据库连接和迁移状态') }
    finally { inFlight = false }
  }
  void cleanup()
  cleanupTimer = setInterval(() => { void cleanup() }, 60 * 60 * 1000)
  cleanupTimer.unref?.()
}
