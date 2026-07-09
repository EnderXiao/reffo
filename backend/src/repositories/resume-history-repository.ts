import { getDatabase, resetDatabaseConnection } from '@/repositories/database'
import type { ResumeHistoryRecord, SaveResumeHistoryInput, UpdateResumeHistoryInput } from '@/types'

const HISTORY_ID_PREFIX = 'JD'
const HISTORY_ID_SEQUENCE_LENGTH = 5
const HISTORY_ID_MAX_SEQUENCE = 99999

function ensureDatabase() {
  const database = getDatabase()
  database.exec(`
    CREATE TABLE IF NOT EXISTS resume_histories (
      id TEXT PRIMARY KEY,
      position TEXT NOT NULL,
      company TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      quality_score INTEGER NOT NULL,
      match_score INTEGER NOT NULL,
      tags_json TEXT NOT NULL,
      resume_content TEXT NOT NULL,
      jd_content TEXT NOT NULL,
      optimized_content TEXT NOT NULL,
      optimization_suggestions_json TEXT,
      changes_summary_json TEXT,
      process_result_json TEXT,
      result_context_json TEXT,
      progress_json TEXT,
      card_color TEXT,
      card_pattern TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_resume_histories_created_at
    ON resume_histories(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_resume_histories_updated_at
    ON resume_histories(updated_at DESC);
  `)

  return database
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

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch (error) {
    console.warn('[ResumeHistoryRepository] failed to parse json column', error)
    return fallback
  }
}

function parseOptionalJson<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined
  }

  try {
    return JSON.parse(value) as T
  } catch (error) {
    console.warn('[ResumeHistoryRepository] failed to parse optional json column', error)
    return undefined
  }
}

function stringifyOptional(value: unknown) {
  return value === undefined ? null : JSON.stringify(value)
}

function mapRowToRecord(row: Record<string, unknown> | null | undefined): ResumeHistoryRecord | null {
  if (!row) {
    return null
  }

  const optimizationSuggestions = parseOptionalJson<string[]>(row.optimization_suggestions_json)
  const changesSummary = parseOptionalJson<string[]>(row.changes_summary_json)
  const processResult = parseOptionalJson<unknown>(row.process_result_json)
  const resultContext = parseOptionalJson<ResumeHistoryRecord['result_context']>(row.result_context_json)
  const progress = parseOptionalJson<ResumeHistoryRecord['progress']>(row.progress_json)
  const cardColor = row.card_color ? String(row.card_color) : undefined
  const cardPattern = row.card_pattern ? String(row.card_pattern) : undefined

  return {
    id: String(row.id),
    position: String(row.position),
    company: String(row.company),
    name: String(row.name),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    quality_score: Number(row.quality_score) || 0,
    match_score: Number(row.match_score) || 0,
    tags: parseJson<string[]>(row.tags_json, []),
    resume_content: String(row.resume_content),
    jd_content: String(row.jd_content),
    optimized_content: String(row.optimized_content),
    ...(optimizationSuggestions ? { optimization_suggestions: optimizationSuggestions } : {}),
    ...(changesSummary ? { changes_summary: changesSummary } : {}),
    ...(processResult ? { process_result: processResult } : {}),
    ...(resultContext ? { result_context: resultContext } : {}),
    ...(progress ? { progress } : {}),
    ...(cardColor ? { card_color: cardColor } : {}),
    ...(cardPattern ? { card_pattern: cardPattern } : {}),
  }
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

export class ResumeHistoryRepository {
  private executeWithRecovery<T>(operation: () => T): T {
    try {
      return operation()
    } catch (error) {
      console.error('[ResumeHistoryRepository] database operation failed', error)
      resetDatabaseConnection()
      return operation()
    }
  }

  private getExistingIds(createdAt?: string) {
    const db = ensureDatabase()
    const idPrefix = `${HISTORY_ID_PREFIX}${formatHistoryIdDate(createdAt)}`
    const rows = db
      .query('SELECT id FROM resume_histories WHERE id LIKE ?')
      .all(`${idPrefix}%`) as Array<{ id: string }>

    return rows.map(row => row.id)
  }

  save(input: SaveResumeHistoryInput): ResumeHistoryRecord {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const now = new Date().toISOString()
      const id = input.id?.trim() || createHistoryId(this.getExistingIds(input.created_at), input.created_at)

      db.query(`
        INSERT INTO resume_histories (
          id,
          position,
          company,
          name,
          created_at,
          updated_at,
          quality_score,
          match_score,
          tags_json,
          resume_content,
          jd_content,
          optimized_content,
          optimization_suggestions_json,
          changes_summary_json,
          process_result_json,
          result_context_json,
          progress_json,
          card_color,
          card_pattern
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          position = excluded.position,
          company = excluded.company,
          name = excluded.name,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          quality_score = excluded.quality_score,
          match_score = excluded.match_score,
          tags_json = excluded.tags_json,
          resume_content = excluded.resume_content,
          jd_content = excluded.jd_content,
          optimized_content = excluded.optimized_content,
          optimization_suggestions_json = excluded.optimization_suggestions_json,
          changes_summary_json = excluded.changes_summary_json,
          process_result_json = excluded.process_result_json,
          result_context_json = excluded.result_context_json,
          progress_json = excluded.progress_json,
          card_color = excluded.card_color,
          card_pattern = excluded.card_pattern
      `).run(
        id,
        input.position,
        input.company,
        input.name,
        input.created_at,
        now,
        input.quality_score,
        input.match_score,
        JSON.stringify(input.tags),
        input.resume_content,
        input.jd_content,
        input.optimized_content,
        stringifyOptional(input.optimization_suggestions),
        stringifyOptional(input.changes_summary),
        stringifyOptional(input.process_result),
        stringifyOptional(input.result_context),
        stringifyOptional(input.progress),
        input.card_color ?? null,
        input.card_pattern ?? null
      )

      const saved = this.findById(id)

      if (!saved) {
        throw new Error('保存历史记录失败')
      }

      return saved
    })
  }

  list(limit = 100): ResumeHistoryRecord[] {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const rows = db.query(`
        SELECT *
        FROM resume_histories
        ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>

      return rows
        .map(row => mapRowToRecord(row))
        .filter((record): record is ResumeHistoryRecord => Boolean(record))
    })
  }

  findById(id: string): ResumeHistoryRecord | null {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const row = db
        .query('SELECT * FROM resume_histories WHERE id = ? LIMIT 1')
        .get(id) as Record<string, unknown> | null

      return mapRowToRecord(row)
    })
  }

  update(id: string, updates: UpdateResumeHistoryInput): ResumeHistoryRecord | null {
    const existing = this.findById(id)

    if (!existing) {
      return null
    }

    return this.save({
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

  delete(id: string): boolean {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const result = db.query('DELETE FROM resume_histories WHERE id = ?').run(id)

      return result.changes > 0
    })
  }

  clear(): number {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const result = db.query('DELETE FROM resume_histories').run()

      return result.changes
    })
  }
}

export const resumeHistoryRepository = new ResumeHistoryRepository()
