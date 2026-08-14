import { randomUUID } from 'node:crypto'
import type { RequestUserContext } from '@/auth/request-context'
import type { SourceResumeRepositoryContract } from '@/repositories/interfaces'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
import type { SaveSourceResumeInput, SourceResumeRecord } from '@/types'

interface SourceResumeRow {
  id: string
  user_id: string
  title: string
  resume_markdown: string
  source_type: 'manual' | 'file'
  original_file_name: string | null
  created_at: string
  updated_at: string
}

function createClient(context: RequestUserContext) {
  return createSupabaseRestClient({
    accessToken: context.accessToken,
    useServiceRole: context.useServiceRole,
  })
}

function mapRowToRecord(row: SourceResumeRow): SourceResumeRecord {
  return {
    id: row.id,
    title: row.title,
    resume_markdown: row.resume_markdown,
    source_type: row.source_type,
    original_file_name: row.original_file_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export class SupabaseSourceResumeRepository implements SourceResumeRepositoryContract {
  async save(context: RequestUserContext, input: SaveSourceResumeInput): Promise<SourceResumeRecord> {
    const now = new Date().toISOString()
    const rows = await createClient(context).request<SourceResumeRow[]>('/rest/v1/source_resumes', {
      method: 'POST',
      searchParams: {
        on_conflict: 'user_id',
      },
      prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        id: randomUUID(),
        user_id: context.userId,
        title: input.title,
        resume_markdown: input.resume_markdown,
        source_type: input.source_type,
        original_file_name: input.original_file_name ?? null,
        updated_at: now,
      },
    })

    const saved = rows[0]

    if (!saved) {
      throw new Error('保存源简历失败')
    }

    return mapRowToRecord(saved)
  }

  async getLatest(context: RequestUserContext): Promise<SourceResumeRecord | null> {
    const rows = await createClient(context).request<SourceResumeRow[]>('/rest/v1/source_resumes', {
      searchParams: {
        select: 'id,user_id,title,resume_markdown,source_type,original_file_name,created_at,updated_at',
        user_id: `eq.${context.userId}`,
        order: 'updated_at.desc',
        limit: 1,
      },
    })

    return rows[0] ? mapRowToRecord(rows[0]) : null
  }

  async delete(context: RequestUserContext, id: string): Promise<boolean> {
    const existing = await createClient(context).request<Array<{ id: string }>>('/rest/v1/source_resumes', {
      searchParams: {
        select: 'id',
        user_id: `eq.${context.userId}`,
        id: `eq.${id}`,
        limit: 1,
      },
    })

    if (!existing[0]) {
      return false
    }

    await createClient(context).request<unknown>('/rest/v1/source_resumes', {
      method: 'DELETE',
      searchParams: {
        user_id: `eq.${context.userId}`,
        id: `eq.${id}`,
      },
    })

    return true
  }
}

export const supabaseSourceResumeRepository = new SupabaseSourceResumeRepository()
