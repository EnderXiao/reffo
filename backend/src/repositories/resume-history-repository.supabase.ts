import type { RequestUserContext } from '@/auth/request-context'
import type { ResumeHistoryRepositoryContract } from '@/repositories/interfaces'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
import type { ResumeHistoryRecord, SaveResumeHistoryInput, UpdateResumeHistoryInput } from '@/types'

const HISTORY_ID_PREFIX = 'JD'
const HISTORY_ID_SEQUENCE_LENGTH = 5
const HISTORY_ID_MAX_SEQUENCE = 99999

interface ResumeHistoryRow {
  id: string
  user_id: string
  position: string
  company: string
  name: string
  created_at: string
  updated_at: string
  quality_score: number
  match_score: number
  tags: string[] | null
  resume_content: string
  jd_content: string
  optimized_content: string
  optimization_suggestions: string[] | null
  changes_summary: string[] | null
  process_result: unknown | null
  result_context: ResumeHistoryRecord['result_context'] | null
  progress: ResumeHistoryRecord['progress'] | null
  card_color: string | null
  card_pattern: string | null
}

function createClient(context: RequestUserContext) {
  return createSupabaseRestClient({
    accessToken: context.accessToken,
    useServiceRole: context.useServiceRole,
  })
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function formatHistoryIdDate(dateInput?: string) {
  const date = dateInput ? new Date(dateInput) : new Date()
  const resolvedDate = Number.isNaN(date.getTime()) ? new Date() : date

  return [
    resolvedDate.getFullYear(),
    padDatePart(resolvedDate.getMonth() + 1),
    padDatePart(resolvedDate.getDate()),
  ].join('')
}

function createHistoryId(existingIds: string[], createdAt?: string) {
  const datePart = formatHistoryIdDate(createdAt)
  const idPrefix = `${HISTORY_ID_PREFIX}${datePart}`
  const pattern = new RegExp(`^${idPrefix}(\\d{${HISTORY_ID_SEQUENCE_LENGTH}})$`)
  const maxSequence = existingIds.reduce((currentMax, id) => {
    const match = id.match(pattern)

    if (!match) {
      return currentMax
    }

    return Math.max(currentMax, Number.parseInt(match[1], 10))
  }, 0)
  const nextSequence = maxSequence + 1

  if (nextSequence > HISTORY_ID_MAX_SEQUENCE) {
    throw new Error('当日历史记录编号已超过上限')
  }

  return `${idPrefix}${String(nextSequence).padStart(HISTORY_ID_SEQUENCE_LENGTH, '0')}`
}

function mapRowToRecord(row: ResumeHistoryRow): ResumeHistoryRecord {
  return {
    id: row.id,
    position: row.position,
    company: row.company,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    quality_score: Number(row.quality_score) || 0,
    match_score: Number(row.match_score) || 0,
    tags: Array.isArray(row.tags) ? row.tags : [],
    resume_content: row.resume_content,
    jd_content: row.jd_content,
    optimized_content: row.optimized_content,
    ...(row.optimization_suggestions ? { optimization_suggestions: row.optimization_suggestions } : {}),
    ...(row.changes_summary ? { changes_summary: row.changes_summary } : {}),
    ...(row.process_result ? { process_result: row.process_result } : {}),
    ...(row.result_context ? { result_context: row.result_context } : {}),
    ...(row.progress ? { progress: row.progress } : {}),
    ...(row.card_color ? { card_color: row.card_color } : {}),
    ...(row.card_pattern ? { card_pattern: row.card_pattern } : {}),
  }
}

function toSaveRow(context: RequestUserContext, id: string, input: SaveResumeHistoryInput, updatedAt: string) {
  return {
    id,
    user_id: context.userId,
    position: input.position,
    company: input.company,
    name: input.name,
    created_at: input.created_at,
    updated_at: updatedAt,
    quality_score: input.quality_score,
    match_score: input.match_score,
    tags: input.tags,
    resume_content: input.resume_content,
    jd_content: input.jd_content,
    optimized_content: input.optimized_content,
    optimization_suggestions: input.optimization_suggestions ?? null,
    changes_summary: input.changes_summary ?? null,
    process_result: input.process_result ?? null,
    result_context: input.result_context ?? null,
    progress: input.progress ?? null,
    card_color: input.card_color ?? null,
    card_pattern: input.card_pattern ?? null,
  }
}

export class SupabaseResumeHistoryRepository implements ResumeHistoryRepositoryContract {
  private async getExistingIds(context: RequestUserContext, createdAt?: string) {
    const idPrefix = `${HISTORY_ID_PREFIX}${formatHistoryIdDate(createdAt)}`
    const rows = await createClient(context).request<Array<{ id: string }>>('/rest/v1/resume_histories', {
      searchParams: {
        select: 'id',
        user_id: `eq.${context.userId}`,
        id: `like.${idPrefix}%`,
      },
    })

    return rows.map(row => row.id)
  }

  async save(context: RequestUserContext, input: SaveResumeHistoryInput): Promise<ResumeHistoryRecord> {
    const now = new Date().toISOString()
    const id = input.id?.trim() || createHistoryId(await this.getExistingIds(context, input.created_at), input.created_at)
    const rows = await createClient(context).request<ResumeHistoryRow[]>('/rest/v1/resume_histories', {
      method: 'POST',
      searchParams: {
        on_conflict: 'user_id,id',
      },
      prefer: 'resolution=merge-duplicates,return=representation',
      body: toSaveRow(context, id, input, now),
    })
    const saved = rows[0]

    if (!saved) {
      throw new Error('保存历史记录失败')
    }

    return mapRowToRecord(saved)
  }

  async list(context: RequestUserContext, limit = 100): Promise<ResumeHistoryRecord[]> {
    const rows = await createClient(context).request<ResumeHistoryRow[]>('/rest/v1/resume_histories', {
      searchParams: {
        select: '*',
        user_id: `eq.${context.userId}`,
        order: 'created_at.desc,updated_at.desc',
        limit,
      },
    })

    return rows.map(row => mapRowToRecord(row))
  }

  async findById(context: RequestUserContext, id: string): Promise<ResumeHistoryRecord | null> {
    const rows = await createClient(context).request<ResumeHistoryRow[]>('/rest/v1/resume_histories', {
      searchParams: {
        select: '*',
        user_id: `eq.${context.userId}`,
        id: `eq.${id}`,
        limit: 1,
      },
    })

    return rows[0] ? mapRowToRecord(rows[0]) : null
  }

  async update(
    context: RequestUserContext,
    id: string,
    updates: UpdateResumeHistoryInput
  ): Promise<ResumeHistoryRecord | null> {
    const existing = await this.findById(context, id)

    if (!existing) {
      return null
    }

    return this.save(context, {
      id,
      position: updates.position ?? existing.position,
      company: updates.company ?? existing.company,
      name: updates.name ?? existing.name,
      created_at: updates.created_at ?? existing.created_at,
      quality_score: updates.quality_score ?? existing.quality_score,
      match_score: updates.match_score ?? existing.match_score,
      tags: updates.tags ?? existing.tags,
      resume_content: updates.resume_content ?? existing.resume_content,
      jd_content: updates.jd_content ?? existing.jd_content,
      optimized_content: updates.optimized_content ?? existing.optimized_content,
      optimization_suggestions: updates.optimization_suggestions ?? existing.optimization_suggestions,
      changes_summary: updates.changes_summary ?? existing.changes_summary,
      process_result: updates.process_result ?? existing.process_result,
      result_context: updates.result_context ?? existing.result_context,
      progress: updates.progress ?? existing.progress,
      card_color: updates.card_color ?? existing.card_color,
      card_pattern: updates.card_pattern ?? existing.card_pattern,
    })
  }

  async delete(context: RequestUserContext, id: string): Promise<boolean> {
    const existing = await this.findById(context, id)

    if (!existing) {
      return false
    }

    await createClient(context).request<unknown>('/rest/v1/resume_histories', {
      method: 'DELETE',
      searchParams: {
        user_id: `eq.${context.userId}`,
        id: `eq.${id}`,
      },
    })

    return true
  }

  async clear(context: RequestUserContext): Promise<number> {
    const existing = await this.list(context)

    if (existing.length === 0) {
      return 0
    }

    await createClient(context).request<unknown>('/rest/v1/resume_histories', {
      method: 'DELETE',
      searchParams: {
        user_id: `eq.${context.userId}`,
      },
    })

    return existing.length
  }
}

export const supabaseResumeHistoryRepository = new SupabaseResumeHistoryRepository()
