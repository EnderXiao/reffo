import {env} from '@/config/env'
import {getDatabase} from './database'
import {createSupabaseRestClient} from './supabase/client'
import type {ResumePdfModel} from '@/services/pdf/resume-template'
import type {ResumeDeliveryState} from '@/shared/resume-actions'

export type ResumeExportStatus = 'pending' | 'ready' | 'failed' | 'revoked'
export interface ResumeExportRow {
  id: string
  owner_id: string
  history_id: string
  request_id: string
  request_digest: string
  document_id: string
  revision: number
  template_version: string
  eligibility_digest?: string
  lease_token?: string | null
  lease_expires_at?: string | null
  omitted_gap_ids?: string[]
  omitted_claim_ids?: string[]
  delivery_state?: ResumeDeliveryState
  status: ResumeExportStatus
  disposition: 'application_ready' | 'draft_only'
  file_name: string
  reason_codes: string[]
  omitted_count: number
  omitted_claim_count: number
  model: ResumePdfModel | null
  file_base64: string | null
  created_at: string
  expires_at: string
}

export interface ResumeExportStorage {
  findRequest(owner: string, requestId: string): Promise<ResumeExportRow | null>
  find(owner: string, id: string): Promise<ResumeExportRow | null>
  insert(row: ResumeExportRow): Promise<ResumeExportRow>
  finish(owner: string, id: string, status: 'ready' | 'failed', file: string | null, leaseToken?: string): Promise<ResumeExportRow | null>
  claim?(owner: string, id: string, leaseToken: string, leaseExpiresAt: string): Promise<ResumeExportRow | null>
  revokeHistory(owner: string, historyId?: string): Promise<void>
  cleanup(): Promise<void>
}

const table = '/rest/v1/resume_exports'
const service = () => createSupabaseRestClient({useServiceRole: true})
function database() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS resume_exports (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, history_id TEXT NOT NULL,
    request_id TEXT NOT NULL, request_digest TEXT NOT NULL, document_id TEXT NOT NULL,
    revision INTEGER NOT NULL, template_version TEXT NOT NULL, status TEXT NOT NULL,
    disposition TEXT NOT NULL, file_name TEXT NOT NULL, reason_codes TEXT NOT NULL,
    omitted_count INTEGER NOT NULL, omitted_claim_count INTEGER NOT NULL,
    model TEXT, file_base64 TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    UNIQUE(owner_id, request_id)
  ); CREATE INDEX IF NOT EXISTS resume_exports_expiry ON resume_exports(expires_at);
  CREATE INDEX IF NOT EXISTS resume_exports_owner_history ON resume_exports(owner_id, history_id);`)
  if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resume_histories'").get()) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS revoke_deleted_resume_exports AFTER DELETE ON resume_histories
      BEGIN UPDATE resume_exports SET status = 'revoked', model = NULL, file_base64 = NULL
      WHERE owner_id = OLD.user_id AND history_id = OLD.id; END;`)
  }
  const columns = db.query('PRAGMA table_info(resume_exports)').all() as Array<{name:string}>
  for (const [column,type] of [['eligibility_digest','TEXT'],['lease_token','TEXT'],['lease_expires_at','TEXT'],['omitted_gap_ids','TEXT'],['omitted_claim_ids','TEXT'],['delivery_state','TEXT']]) {
    if (!columns.some(item=>item.name===column)) db.exec(`ALTER TABLE resume_exports ADD COLUMN ${column} ${type}`)
  }
  return db
}
function decode(row: Record<string, unknown> | null): ResumeExportRow | null {
  if (!row) return null
  return {...row, model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model,
    reason_codes: typeof row.reason_codes === 'string' ? JSON.parse(row.reason_codes) : row.reason_codes,
    omitted_gap_ids: typeof row.omitted_gap_ids === 'string' ? JSON.parse(row.omitted_gap_ids) : row.omitted_gap_ids ?? [],
    omitted_claim_ids: typeof row.omitted_claim_ids === 'string' ? JSON.parse(row.omitted_claim_ids) : row.omitted_claim_ids ?? [],
    delivery_state: typeof row.delivery_state === 'string' ? JSON.parse(row.delivery_state) : row.delivery_state} as unknown as ResumeExportRow
}

export class ResumeExportRepository implements ResumeExportStorage {
  async findRequest(owner: string, requestId: string) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await service().request<ResumeExportRow[]>(table, {searchParams: {owner_id: `eq.${owner}`, request_id: `eq.${requestId}`, limit: 1}})
      return rows[0] ?? null
    }
    return decode(database().query('SELECT * FROM resume_exports WHERE owner_id = ? AND request_id = ?').get(owner, requestId) as Record<string, unknown> | null)
  }
  async find(owner: string, id: string) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await service().request<ResumeExportRow[]>(table, {searchParams: {owner_id: `eq.${owner}`, id: `eq.${id}`, limit: 1}})
      return rows[0] ?? null
    }
    return decode(database().query('SELECT * FROM resume_exports WHERE owner_id = ? AND id = ?').get(owner, id) as Record<string, unknown> | null)
  }
  async insert(row: ResumeExportRow) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      await service().request(table, {method: 'POST', searchParams: {on_conflict: 'owner_id,request_id'}, prefer: 'resolution=ignore-duplicates', body: row})
    } else {
      database().query(`INSERT OR IGNORE INTO resume_exports (id, owner_id, history_id, request_id, request_digest,
        document_id, revision, template_version, status, disposition, file_name, reason_codes, omitted_count,
        omitted_claim_count, model, file_base64, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(row.id, row.owner_id, row.history_id, row.request_id, row.request_digest, row.document_id, row.revision,
          row.template_version, row.status, row.disposition, row.file_name, JSON.stringify(row.reason_codes), row.omitted_count,
          row.omitted_claim_count, JSON.stringify(row.model), row.file_base64, row.created_at, row.expires_at)
    }
    if (env.DATABASE_PROVIDER !== 'supabase') database().query(`UPDATE resume_exports SET eligibility_digest=?,lease_token=?,lease_expires_at=?,omitted_gap_ids=?,omitted_claim_ids=?,delivery_state=? WHERE owner_id=? AND id=?`).run(
      row.eligibility_digest ?? null,row.lease_token ?? null,row.lease_expires_at ?? null,JSON.stringify(row.omitted_gap_ids ?? []),JSON.stringify(row.omitted_claim_ids ?? []),JSON.stringify(row.delivery_state ?? null),row.owner_id,row.id)
    const stored = await this.findRequest(row.owner_id, row.request_id)
    if (!stored) throw new Error('EXPORT_STORAGE_UNAVAILABLE')
    return stored
  }
  async finish(owner: string, id: string, status: 'ready' | 'failed', file: string | null, leaseToken?: string) {
    const now = new Date().toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await service().request<ResumeExportRow[]>(table, {method: 'PATCH', prefer: 'return=representation',
        searchParams: {owner_id: `eq.${owner}`, id: `eq.${id}`, status: 'eq.pending', expires_at: `gt.${now}`, ...(leaseToken ? {lease_token:`eq.${leaseToken}`,lease_expires_at:`gt.${now}`} : {})},
        body: {status, file_base64: file, model: null, lease_token: null, lease_expires_at: null}})
      return rows[0] ?? null
    }
    return decode(database().query(`UPDATE resume_exports SET status = ?, file_base64 = ?, model = NULL, lease_token=NULL, lease_expires_at=NULL
      WHERE owner_id = ? AND id = ? AND status = 'pending' AND expires_at > ? ${leaseToken ? 'AND lease_token = ? AND lease_expires_at > ?' : ''} RETURNING *`)
      .get(status, file, owner, id, now,...(leaseToken ? [leaseToken,now] : [])) as Record<string, unknown> | null)
  }
  async claim(owner: string,id: string,leaseToken: string,leaseExpiresAt: string) {
    const now=new Date().toISOString()
    if (env.DATABASE_PROVIDER==='supabase') {
      const rows=await service().request<ResumeExportRow[]>(table,{method:'PATCH',prefer:'return=representation',
        searchParams:{owner_id:`eq.${owner}`,id:`eq.${id}`,status:'eq.pending',expires_at:`gt.${now}`,or:`(lease_expires_at.is.null,lease_expires_at.lte.${now})`},
        body:{lease_token:leaseToken,lease_expires_at:leaseExpiresAt}})
      return rows[0]??null
    }
    return decode(database().query(`UPDATE resume_exports SET lease_token=?,lease_expires_at=? WHERE owner_id=? AND id=? AND status='pending'
      AND expires_at>? AND (lease_expires_at IS NULL OR lease_expires_at<=?) RETURNING *`).get(leaseToken,leaseExpiresAt,owner,id,now,now) as Record<string,unknown>|null)
  }
  async revokeHistory(owner: string, historyId?: string) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      await service().request(table, {method: 'PATCH', prefer: 'return=minimal',
        searchParams: {owner_id: `eq.${owner}`, ...(historyId ? {history_id: `eq.${historyId}`} : {})},
        body: {status: 'revoked', model: null, file_base64: null}})
    } else database().query(`UPDATE resume_exports SET status = 'revoked', model = NULL, file_base64 = NULL
      WHERE owner_id = ? ${historyId ? 'AND history_id = ?' : ''}`).run(owner, ...(historyId ? [historyId] : []))
  }
  async cleanup() {
    const now = new Date().toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      await service().request(table, {method: 'DELETE', searchParams: {expires_at: `lte.${now}`}, prefer: 'return=minimal'})
    } else database().query('DELETE FROM resume_exports WHERE expires_at <= ?').run(now)
  }
}

export const resumeExportRepository = new ResumeExportRepository()
