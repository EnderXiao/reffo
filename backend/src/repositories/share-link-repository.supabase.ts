import type { RequestUserContext } from '@/auth/request-context'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
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
  snapshot: ShareSnapshot
  schema_version: number
  created_via: 'image' | 'link'
  expires_at: string
  revoked_at: string | null
  created_at: string
  updated_at: string
  last_viewed_at: string | null
  view_count: number
}

function mapRow(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    source_history_id: row.source_history_id,
    mode: row.mode,
    token_hash: row.token_hash,
    idempotency_key_hash: row.idempotency_key_hash,
    snapshot: row.snapshot,
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

function createClient(context: RequestUserContext) {
  return createSupabaseRestClient({
    accessToken: context.accessToken,
    useServiceRole: context.useServiceRole,
  })
}

export class SupabaseShareLinkRepository implements ShareLinkRepositoryContract {
  async create(context: RequestUserContext, input: CreateShareLinkInput): Promise<ShareLinkRecord> {
    const now = new Date().toISOString()
    const rows = await createClient(context).request<ShareLinkRow[]>('/rest/v1/resume_share_links', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        id: input.id,
        user_id: input.user_id,
        source_history_id: input.source_history_id,
        mode: input.mode,
        token_hash: input.token_hash,
        idempotency_key_hash: input.idempotency_key_hash,
        snapshot: input.snapshot,
        schema_version: input.schema_version,
        created_via: input.created_via,
        expires_at: input.expires_at,
        created_at: now,
        updated_at: now,
        last_viewed_at: null,
        view_count: 0,
      },
    })
    const row = rows[0]
    if (!row) throw new Error('保存分享链接失败')
    return mapRow(row)
  }

  async findByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null> {
    const rows = await createSupabaseRestClient({useServiceRole: true})
      .request<ShareLinkRow[]>('/rest/v1/resume_share_links', {
        searchParams: {
          select: '*',
          token_hash: `eq.${tokenHash}`,
          limit: 1,
        },
      })
    return rows[0] ? mapRow(rows[0]) : null
  }

  async findActive(
    context: RequestUserContext,
    sourceHistoryId: string,
    mode: ShareContentMode
  ): Promise<ShareLinkRecord | null> {
    const rows = await createClient(context).request<ShareLinkRow[]>('/rest/v1/resume_share_links', {
      searchParams: {
        select: '*',
        user_id: `eq.${context.userId}`,
        source_history_id: `eq.${sourceHistoryId}`,
        mode: `eq.${mode}`,
        revoked_at: 'is.null',
        expires_at: `gt.${new Date().toISOString()}`,
        order: 'created_at.desc',
        limit: 1,
      },
    })
    return rows[0] ? mapRow(rows[0]) : null
  }

  async findByIdempotencyKeyHash(
    context: RequestUserContext,
    idempotencyKeyHash: string
  ): Promise<ShareLinkRecord | null> {
    const rows = await createClient(context).request<ShareLinkRow[]>('/rest/v1/resume_share_links', {
      searchParams: {
        select: '*',
        user_id: `eq.${context.userId}`,
        idempotency_key_hash: `eq.${idempotencyKeyHash}`,
        limit: 1,
      },
    })
    return rows[0] ? mapRow(rows[0]) : null
  }

  async revoke(context: RequestUserContext, id: string): Promise<boolean> {
    const now = new Date().toISOString()
    const rows = await createClient(context).request<ShareLinkRow[]>('/rest/v1/resume_share_links', {
      method: 'PATCH',
      searchParams: {
        id: `eq.${id}`,
        user_id: `eq.${context.userId}`,
        revoked_at: 'is.null',
      },
      prefer: 'return=representation',
      body: {revoked_at: now, updated_at: now},
    })
    return rows.length > 0
  }
}

export const supabaseShareLinkRepository = new SupabaseShareLinkRepository()
