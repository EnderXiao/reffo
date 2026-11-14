import type { RequestUserContext } from '@/auth/request-context'
import {env} from '@/config/env'
import { getDatabase, resetDatabaseConnection } from '@/repositories/database'
import type { ResumeHistoryRepositoryContract } from '@/repositories/interfaces'
import type { ResumeHistoryRecord, SaveResumeHistoryInput, UpdateResumeHistoryInput } from '@/types'
import {assertResumeCompletionSnapshot, prepareResumeHistorySnapshot, ResumeCompletionSnapshotError, withoutPendingCompletionEdits} from '@/services/resume-completion-snapshot'

import {assertExpectedHistory, historyCommitAck, historyCommitDigest, ResumeHistoryCommitError} from '@/services/resume-history-commit'
import {ensureResumeStageCacheTables} from '@/repositories/resume-stage-cache-repository'
import {canonicalizeSourceDocument} from '@/v5/canonical-source'
import {enqueueResumeReviewTasks, ensureResumeReviewTables} from '@/services/resume-review-service'

const HISTORY_ID_PREFIX = 'JD'
const HISTORY_ID_SEQUENCE_LENGTH = 5
const HISTORY_ID_MAX_SEQUENCE = 99999

function ensureDatabase() {
  const database = getDatabase()
  const defaultUserId = env.DEV_USER_ID.replaceAll("'", "''")
  database.exec(`
    CREATE TABLE IF NOT EXISTS resume_histories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '${defaultUserId}',
      position TEXT NOT NULL,
      company TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      quality_score INTEGER NOT NULL,
      match_score INTEGER,
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

  const scoreColumn = (database.query('PRAGMA table_info(resume_histories)').all() as Array<{name: string; notnull: number}>).find(column => column.name === 'match_score')
  if (scoreColumn?.notnull) {
    // SQLite cannot drop a NOT NULL constraint. Rebuild transactionally and preserve every row/index/trigger.
    database.transaction(() => {
      const schema = database.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'resume_histories'").get() as {sql: string}
      const dependents = database.query("SELECT sql FROM sqlite_master WHERE tbl_name = 'resume_histories' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{sql: string}>
      database.exec(schema.sql.replace(/CREATE TABLE(?: IF NOT EXISTS)?\s+["`]?resume_histories["`]?/iu, 'CREATE TABLE resume_histories_nullable')
        .replace(/match_score\s+INTEGER\s+NOT NULL/iu, 'match_score INTEGER'))
      database.exec('INSERT INTO resume_histories_nullable SELECT * FROM resume_histories')
      database.exec('DROP TABLE resume_histories')
      database.exec('ALTER TABLE resume_histories_nullable RENAME TO resume_histories')
      for (const dependent of dependents) database.exec(dependent.sql)
    }).immediate()
  }

  const columns = database.query('PRAGMA table_info(resume_histories)').all() as Array<{name: string}>
  if (!columns.some(column => column.name === 'user_id')) {
    database.exec(`ALTER TABLE resume_histories ADD COLUMN user_id TEXT NOT NULL DEFAULT '${defaultUserId}'`)
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_resume_histories_user_id ON resume_histories(user_id)')

  ensureResumeReviewTables(database)
  ensureResumeStageCacheTables()
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
    match_score: row.match_score === null ? null : Number(row.match_score) || 0,
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

export class SqliteResumeHistoryRepository implements ResumeHistoryRepositoryContract {
  private executeWithRecovery<T>(operation: () => T): T {
    try {
      return operation()
    } catch (error) {
      if (error instanceof ResumeCompletionSnapshotError || error instanceof ResumeHistoryCommitError) throw error
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

  save(context: RequestUserContext, input: SaveResumeHistoryInput, requestDigestOverride?: string): ResumeHistoryRecord {
    const requestedId = input.id?.trim()
    const requestDigest = requestDigestOverride ?? historyCommitDigest(input)
    if (requestedId) {
      const db = ensureDatabase()
      const confirmed = input.commit_id && db.query('SELECT 1 FROM resume_history_commits WHERE owner_id = ? AND commit_id = ?').get(context.userId,input.commit_id)
      if (!confirmed) assertResumeCompletionSnapshot(input,this.findById(context,requestedId))
    }
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      return db.transaction(() => {
      if (input.commit_id) {
        const commit = db.query('SELECT request_digest, acknowledgement_json FROM resume_history_commits WHERE owner_id = ? AND commit_id = ?').get(context.userId, input.commit_id) as {request_digest: string; acknowledgement_json: string} | null
        if (commit) {
          if (commit.request_digest !== requestDigest) throw new ResumeHistoryCommitError('RESUME_COMMIT_CONFLICT', '本次提交编号已用于其他修改，请重新保存')
          return JSON.parse(commit.acknowledgement_json) as ResumeHistoryRecord
        }
      }
      const now = new Date().toISOString()
      const owner = requestedId
        ? db.query('SELECT user_id FROM resume_histories WHERE id = ?').get(requestedId) as {user_id: string} | null
        : null
      const id = requestedId && (!owner || owner.user_id === context.userId)
        ? requestedId
        : createHistoryId(this.getExistingIds(input.created_at), input.created_at)
      const previous = mapRowToRecord(db.query('SELECT * FROM resume_histories WHERE user_id = ? AND id = ?').get(context.userId, id) as Record<string, unknown> | null)
      assertExpectedHistory(input, previous)
      input = prepareResumeHistorySnapshot(input, previous)

      db.query(`
        INSERT INTO resume_histories (
          id,
          user_id,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
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
        WHERE resume_histories.user_id = excluded.user_id
      `).run(
        id,
        context.userId,
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
        stringifyOptional(withoutPendingCompletionEdits(input.process_result)),
        stringifyOptional(input.result_context),
        stringifyOptional(input.progress),
        input.card_color ?? null,
        input.card_pattern ?? null
      )

      const saved = mapRowToRecord(db.query('SELECT * FROM resume_histories WHERE user_id = ? AND id = ?').get(context.userId, id) as Record<string, unknown> | null)

      if (!saved) {
        throw new Error('保存历史记录失败')
      }

      const acknowledgement = {...saved, ...(historyCommitAck(input, saved) ? {commit_ack: historyCommitAck(input, saved)} : {})}
      enqueueResumeReviewTasks(db, context.userId, saved)
      const sourceDigest = canonicalizeSourceDocument(saved.resume_content,'stage-source').canonicalDocument.sha256
      db.query('INSERT OR IGNORE INTO resume_stage_refs (owner_id,history_id,source_digest) VALUES (?,?,?)').run(context.userId,saved.id,sourceDigest)
      if (input.commit_id) db.query('INSERT INTO resume_history_commits (owner_id,commit_id,request_digest,history_id,acknowledgement_json,created_at) VALUES (?,?,?,?,?,?)').run(
        context.userId, input.commit_id, requestDigest, saved.id, JSON.stringify(acknowledgement), now)
      return acknowledgement
      }).immediate()
    })
  }

  list(context: RequestUserContext, limit = 100): ResumeHistoryRecord[] {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const rows = db.query(`
        SELECT *
        FROM resume_histories
        WHERE user_id = ?
        ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC
        LIMIT ?
      `).all(context.userId, limit) as Array<Record<string, unknown>>

      return rows
        .map(row => mapRowToRecord(row))
        .filter((record): record is ResumeHistoryRecord => Boolean(record))
    })
  }

  findById(context: RequestUserContext, id: string): ResumeHistoryRecord | null {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const row = db
        .query('SELECT * FROM resume_histories WHERE user_id = ? AND id = ? LIMIT 1')
        .get(context.userId, id) as Record<string, unknown> | null

      return mapRowToRecord(row)
    })
  }

  update(context: RequestUserContext, id: string, updates: UpdateResumeHistoryInput): ResumeHistoryRecord | null {
    const existing = this.findById(context, id)

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
      match_score: updates.match_score === undefined ? existing.match_score : updates.match_score,
      tags: updates.tags ?? existing.tags,
      resume_content: updates.resume_content ?? existing.resume_content,
      jd_content: updates.jd_content ?? existing.jd_content,
      optimized_content: updates.optimized_content ?? existing.optimized_content,
      optimization_suggestions: updates.optimization_suggestions ?? existing.optimization_suggestions,
      changes_summary: updates.changes_summary ?? existing.changes_summary,
      process_result: updates.process_result ?? existing.process_result,
      completion_edit: updates.completion_edit,
      commit_id: updates.commit_id,
      expected_document: updates.expected_document,
      action_baseline: updates.action_baseline,
      completion_baseline: updates.completion_baseline,
      result_context: updates.result_context ?? existing.result_context,
      progress: updates.progress ?? existing.progress,
      card_color: updates.card_color ?? existing.card_color,
      card_pattern: updates.card_pattern ?? existing.card_pattern,
    }, historyCommitDigest({id, ...updates} as SaveResumeHistoryInput))
  }

  upgradeCompletion(context: RequestUserContext, previous: ResumeHistoryRecord, next: ResumeHistoryRecord): ResumeHistoryRecord {
    const db = ensureDatabase()
    return db.transaction(() => {
      const current = this.findById(context, previous.id)
      if (!current || current.updated_at !== previous.updated_at || JSON.stringify(current.process_result) !== JSON.stringify(previous.process_result)) {
        throw new ResumeHistoryCommitError('RESUME_VERSION_CONFLICT', '当前稿已更新，请保留本地修改并重新打开')
      }
      db.query('UPDATE resume_histories SET optimized_content = ?, process_result_json = ?, changes_summary_json = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(
        next.optimized_content, JSON.stringify(next.process_result), stringifyOptional(next.changes_summary), new Date().toISOString(), context.userId, previous.id)
      const saved = this.findById(context, previous.id)!
      enqueueResumeReviewTasks(db, context.userId, saved)
      return saved
    }).immediate()
  }

  delete(context: RequestUserContext, id: string): boolean {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const result = db.query('DELETE FROM resume_histories WHERE user_id = ? AND id = ?').run(context.userId, id)

      return result.changes > 0
    })
  }

  clear(context: RequestUserContext): number {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const result = db.query('DELETE FROM resume_histories WHERE user_id = ?').run(context.userId)

      return result.changes
    })
  }
}

export const sqliteResumeHistoryRepository = new SqliteResumeHistoryRepository()
