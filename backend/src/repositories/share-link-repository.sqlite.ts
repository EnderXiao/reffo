import { env } from '@/config/env'
import type { RequestUserContext } from '@/auth/request-context'
import { getDatabase } from '@/repositories/database'
import type { ShareLinkRepositoryContract } from '@/repositories/share-link-repository'
import type {
  CreateShareLinkInput,
  ShareContentMode,
  ShareLinkRecord,
  ShareSnapshot,
} from '@/types/share-link'

interface ShareLinkRow {
  id: string
  user_id: string
  source_history_id: string
  mode: ShareContentMode
  token_hash: string
  idempotency_key_hash: string
  snapshot_json: string
  schema_version: number
  created_via: 'image' | 'link'
  expires_at: string
  revoked_at: string | null
  created_at: string
  updated_at: string
  last_viewed_at: string | null
  view_count: number
}

function ensureDatabase() {
  const database = getDatabase()
  const defaultUserId = env.DEV_USER_ID.replaceAll("'", "''")
  database.exec(`
    CREATE TABLE IF NOT EXISTS resume_share_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '${defaultUserId}',
      source_history_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('job', 'blank')),
      token_hash TEXT NOT NULL UNIQUE,
      idempotency_key_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_via TEXT NOT NULL CHECK (created_via IN ('image', 'link')),
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_viewed_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_share_links_user_idempotency
    ON resume_share_links(user_id, idempotency_key_hash);

    CREATE INDEX IF NOT EXISTS idx_resume_share_links_user_created_at
    ON resume_share_links(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_resume_share_links_source_mode
    ON resume_share_links(user_id, source_history_id, mode);
  `)
  return database
}

function parseSnapshot(value: string): ShareSnapshot {
  return JSON.parse(value) as ShareSnapshot
}

function mapRow(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    source_history_id: row.source_history_id,
    mode: row.mode,
    token_hash: row.token_hash,
    idempotency_key_hash: row.idempotency_key_hash,
    snapshot: parseSnapshot(row.snapshot_json),
    schema_version: Number(row.schema_version) || 1,
    created_via: row.created_via,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_viewed_at: row.last_viewed_at,
    view_count: Number(row.view_count) || 0,
  }
}

function findOne(rows: ShareLinkRow[]) {
  return rows[0] ? mapRow(rows[0]) : null
}

export class SqliteShareLinkRepository implements ShareLinkRepositoryContract {
  create(context: RequestUserContext, input: CreateShareLinkInput): ShareLinkRecord {
    const database = ensureDatabase()
    const now = new Date().toISOString()
    database.query(`
      INSERT INTO resume_share_links (
        id, user_id, source_history_id, mode, token_hash, idempotency_key_hash,
        snapshot_json, schema_version, created_via, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      context.userId,
      input.source_history_id,
      input.mode,
      input.token_hash,
      input.idempotency_key_hash,
      JSON.stringify(input.snapshot),
      input.schema_version,
      input.created_via,
      input.expires_at,
      now,
      now,
    )

    const row = database.query('SELECT * FROM resume_share_links WHERE id = ?').get(input.id) as ShareLinkRow | null
    if (!row) throw new Error('保存分享链接失败')
    return mapRow(row)
  }

  findByTokenHash(tokenHash: string): ShareLinkRecord | null {
    const database = ensureDatabase()
    const row = database
      .query('SELECT * FROM resume_share_links WHERE token_hash = ? LIMIT 1')
      .get(tokenHash) as ShareLinkRow | null
    return row ? mapRow(row) : null
  }

  findActive(
    context: RequestUserContext,
    sourceHistoryId: string,
    mode: ShareContentMode
  ): ShareLinkRecord | null {
    const database = ensureDatabase()
    const now = new Date().toISOString()
    const row = database.query(`
      SELECT * FROM resume_share_links
      WHERE user_id = ? AND source_history_id = ? AND mode = ?
        AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(context.userId, sourceHistoryId, mode, now) as ShareLinkRow | null
    return row ? mapRow(row) : null
  }

  findByIdempotencyKeyHash(
    context: RequestUserContext,
    idempotencyKeyHash: string
  ): ShareLinkRecord | null {
    const database = ensureDatabase()
    const row = database.query(`
      SELECT * FROM resume_share_links
      WHERE user_id = ? AND idempotency_key_hash = ?
      LIMIT 1
    `).get(context.userId, idempotencyKeyHash) as ShareLinkRow | null
    return row ? mapRow(row) : null
  }

  revoke(context: RequestUserContext, id: string): boolean {
    const database = ensureDatabase()
    const now = new Date().toISOString()
    const result = database.query(`
      UPDATE resume_share_links
      SET revoked_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    `).run(now, now, id, context.userId)
    return result.changes > 0
  }
}

export const sqliteShareLinkRepository = new SqliteShareLinkRepository()
