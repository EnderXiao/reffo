import { randomUUID } from 'node:crypto'
import { getDatabase, resetDatabaseConnection } from '@/repositories/database'
import type { SaveSourceResumeInput, SourceResumeRecord } from '@/types'

function ensureDatabase() {
  const database = getDatabase()
  database.exec(`
    CREATE TABLE IF NOT EXISTS source_resumes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      resume_markdown TEXT NOT NULL,
      source_type TEXT NOT NULL,
      original_file_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_source_resumes_updated_at
    ON source_resumes(updated_at DESC);
  `)

  return database
}

function mapRowToRecord(row: Record<string, unknown> | null | undefined): SourceResumeRecord | null {
  if (!row) {
    return null
  }

  return {
    id: String(row.id),
    title: String(row.title),
    resume_markdown: String(row.resume_markdown),
    source_type: row.source_type === 'file' ? 'file' : 'manual',
    original_file_name: row.original_file_name ? String(row.original_file_name) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export class SourceResumeRepository {
  private executeWithRecovery<T>(operation: () => T): T {
    try {
      return operation()
    } catch (error) {
      console.error('[SourceResumeRepository] database operation failed', error)
      resetDatabaseConnection()
      return operation()
    }
  }

  save(input: SaveSourceResumeInput): SourceResumeRecord {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const now = new Date().toISOString()
      const id = randomUUID()

      const statement = db.query(`
        INSERT INTO source_resumes (
          id,
          title,
          resume_markdown,
          source_type,
          original_file_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      statement.run(
        id,
        input.title,
        input.resume_markdown,
        input.source_type,
        input.original_file_name ?? null,
        now,
        now
      )

      return {
        id,
        title: input.title,
        resume_markdown: input.resume_markdown,
        source_type: input.source_type,
        original_file_name: input.original_file_name ?? null,
        created_at: now,
        updated_at: now,
      }
    })
  }

  getLatest(): SourceResumeRecord | null {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const statement = db.query(`
        SELECT
          id,
          title,
          resume_markdown,
          source_type,
          original_file_name,
          created_at,
          updated_at
        FROM source_resumes
        ORDER BY updated_at DESC
        LIMIT 1
      `)

      return mapRowToRecord(statement.get() as Record<string, unknown> | null)
    })
  }

  delete(id: string): boolean {
    return this.executeWithRecovery(() => {
      const db = ensureDatabase()
      const result = db.query('DELETE FROM source_resumes WHERE id = ?').run(id)

      return result.changes > 0
    })
  }
}

export const sourceResumeRepository = new SourceResumeRepository()
