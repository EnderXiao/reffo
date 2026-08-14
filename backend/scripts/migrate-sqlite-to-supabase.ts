import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'

interface SourceResumeSqliteRow {
  id: string
  title: string
  resume_markdown: string
  source_type: string
  original_file_name: string | null
  created_at: string
  updated_at: string
}

interface ResumeHistorySqliteRow {
  id: string
  position: string
  company: string
  name: string
  created_at: string
  updated_at: string
  quality_score: number
  match_score: number
  tags_json: string
  resume_content: string
  jd_content: string
  optimized_content: string
  optimization_suggestions_json: string | null
  changes_summary_json: string | null
  process_result_json: string | null
  result_context_json: string | null
  progress_json: string | null
  card_color: string | null
  card_pattern: string | null
}

interface MigrationConfig {
  sqlitePath: string
  supabaseUrl: string
  supabaseSecretKey: string
  migrationUserId: string
  dryRun: boolean
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function getConfig(): MigrationConfig {
  return {
    sqlitePath: resolve(process.env.SQLITE_DATABASE_PATH || 'data/reffo.sqlite'),
    supabaseUrl: requireEnv('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseSecretKey: requireEnv('SUPABASE_SECRET_KEY'),
    migrationUserId: requireEnv('MIGRATION_USER_ID'),
    dryRun: process.env.DRY_RUN === 'true',
  }
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch (error) {
    console.warn('[migrate-sqlite-to-supabase] failed to parse JSON column', error)
    return fallback
  }
}

function parseOptionalJson(value: string | null | undefined) {
  if (!value) {
    return null
  }

  return parseJson<unknown>(value, null)
}

async function requestSupabase<T>(
  config: MigrationConfig,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    searchParams?: Record<string, string>
    body?: unknown
    prefer?: string
  } = {}
) {
  const url = new URL(`${config.supabaseUrl}${path}`)

  Object.entries(options.searchParams ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: `Bearer ${config.supabaseSecretKey}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) as unknown : null

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${JSON.stringify(payload)}`)
  }

  return payload as T
}

function readSourceResumeRows(db: Database) {
  const table = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_resumes'")
    .get()

  if (!table) {
    return []
  }

  return db.query('SELECT * FROM source_resumes ORDER BY datetime(updated_at) DESC').all() as SourceResumeSqliteRow[]
}

function readResumeHistoryRows(db: Database) {
  const table = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'resume_histories'")
    .get()

  if (!table) {
    return []
  }

  return db.query('SELECT * FROM resume_histories ORDER BY datetime(created_at) ASC').all() as ResumeHistorySqliteRow[]
}

function mapSourceResume(row: SourceResumeSqliteRow, userId: string) {
  return {
    id: row.id,
    user_id: userId,
    title: row.title,
    resume_markdown: row.resume_markdown,
    source_type: row.source_type === 'file' ? 'file' : 'manual',
    original_file_name: row.original_file_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapResumeHistory(row: ResumeHistorySqliteRow, userId: string) {
  return {
    id: row.id,
    user_id: userId,
    position: row.position,
    company: row.company,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    quality_score: row.quality_score,
    match_score: row.match_score,
    tags: parseJson<string[]>(row.tags_json, []),
    resume_content: row.resume_content,
    jd_content: row.jd_content,
    optimized_content: row.optimized_content,
    optimization_suggestions: parseOptionalJson(row.optimization_suggestions_json),
    changes_summary: parseOptionalJson(row.changes_summary_json),
    process_result: parseOptionalJson(row.process_result_json),
    result_context: parseOptionalJson(row.result_context_json),
    progress: parseOptionalJson(row.progress_json),
    card_color: row.card_color,
    card_pattern: row.card_pattern,
  }
}

async function migrate() {
  const config = getConfig()

  if (!existsSync(config.sqlitePath)) {
    throw new Error(`SQLite database not found: ${config.sqlitePath}`)
  }

  const db = new Database(config.sqlitePath, { readonly: true })

  try {
    const sourceResumeRows = readSourceResumeRows(db)
    const resumeHistoryRows = readResumeHistoryRows(db)
    const sourceResumes = sourceResumeRows.map(row => mapSourceResume(row, config.migrationUserId)).slice(0, 1)
    const resumeHistories = resumeHistoryRows.map(row => mapResumeHistory(row, config.migrationUserId))

    console.log(`SQLite path: ${config.sqlitePath}`)
    console.log(`Target user: ${config.migrationUserId}`)
    console.log(`Source resumes to migrate: ${sourceResumes.length}`)
    console.log(`Resume histories to migrate: ${resumeHistories.length}`)

    if (config.dryRun) {
      console.log('DRY_RUN=true, no data written.')
      return
    }

    if (sourceResumes.length > 0) {
      await requestSupabase(config, '/rest/v1/source_resumes', {
        method: 'POST',
        searchParams: { on_conflict: 'user_id' },
        prefer: 'resolution=merge-duplicates',
        body: sourceResumes,
      })
    }

    if (resumeHistories.length > 0) {
      await requestSupabase(config, '/rest/v1/resume_histories', {
        method: 'POST',
        searchParams: { on_conflict: 'user_id,id' },
        prefer: 'resolution=merge-duplicates',
        body: resumeHistories,
      })
    }

    console.log('SQLite to Supabase migration completed.')
  } finally {
    db.close()
  }
}

migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
