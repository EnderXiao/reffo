import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { env } from '@/config/env'

const DATABASE_PATH = process.env.SQLITE_DATABASE_PATH || join(process.cwd(), 'data', 'reffo.sqlite')
const HARNESS_DATABASE_PATH = env.HARNESS_DATABASE_PATH || join(process.cwd(), 'data', 'harness.sqlite')

let database: Database | null = null
let harnessDatabase: Database | null = null

function configureDatabase(db: Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `)
}

function ensureColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export function getDatabase() {
  if (database) {
    return database
  }

  mkdirSync(dirname(DATABASE_PATH), { recursive: true })
  database = new Database(DATABASE_PATH, { create: true })
  configureDatabase(database)

  return database
}

export function resetDatabaseConnection() {
  if (!database) {
    return
  }

  try {
    database.close()
  } catch (error) {
    console.error('[Database] close failed', error)
  } finally {
    database = null
  }
}

export function getHarnessDatabase() {
  if (harnessDatabase) {
    return harnessDatabase
  }

  mkdirSync(dirname(HARNESS_DATABASE_PATH), { recursive: true })
  harnessDatabase = new Database(HARNESS_DATABASE_PATH, { create: true })
  configureDatabase(harnessDatabase)

  return harnessDatabase
}

export function resetHarnessDatabaseConnection() {
  if (!harnessDatabase) {
    return
  }

  try {
    harnessDatabase.close()
  } catch (error) {
    console.error('[HarnessDatabase] close failed', error)
  } finally {
    harnessDatabase = null
  }
}

function deleteHarnessRuns(db: Database, runIds: string[]) {
  if (runIds.length === 0) {
    return
  }

  const placeholders = runIds.map(() => '?').join(',')

  db.transaction(() => {
    db.query(`
      DELETE FROM evaluations
      WHERE step_run_id IN (
        SELECT id FROM step_runs WHERE run_id IN (${placeholders})
      )
    `).run(...runIds)
    db.query(`
      DELETE FROM step_attempts
      WHERE step_run_id IN (
        SELECT id FROM step_runs WHERE run_id IN (${placeholders})
      )
    `).run(...runIds)
    db.query(`DELETE FROM artifacts WHERE run_id IN (${placeholders})`).run(...runIds)
    db.query(`DELETE FROM harness_events WHERE run_id IN (${placeholders})`).run(...runIds)
    db.query(`DELETE FROM failure_samples WHERE run_id IN (${placeholders})`).run(...runIds)
    db.query(`DELETE FROM step_runs WHERE run_id IN (${placeholders})`).run(...runIds)
    db.query(`DELETE FROM process_runs WHERE id IN (${placeholders})`).run(...runIds)
  })()
}

function enforceHarnessRetention(db: Database) {
  const runIds = new Set<string>()

  if (env.HARNESS_RETENTION_DAYS > 0) {
    const cutoff = new Date(Date.now() - env.HARNESS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const rows = db
      .query('SELECT id FROM process_runs WHERE started_at < ?')
      .all(cutoff) as Array<{ id: string }>

    rows.forEach(row => runIds.add(row.id))
  }

  if (env.HARNESS_MAX_RUNS > 0) {
    const rows = db
      .query(`
        SELECT id
        FROM process_runs
        ORDER BY started_at DESC
        LIMIT -1 OFFSET ?
      `)
      .all(env.HARNESS_MAX_RUNS) as Array<{ id: string }>

    rows.forEach(row => runIds.add(row.id))
  }

  deleteHarnessRuns(db, Array.from(runIds))
}

export function initializeHarnessDatabase() {
  const db = getHarnessDatabase()

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO schema_versions (name, version, updated_at)
    VALUES ('harness', 1, datetime('now'))
    ;

    CREATE TABLE IF NOT EXISTS process_runs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      workflow_version TEXT NOT NULL,
      status TEXT NOT NULL,
      input_digest TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_process_runs_started_at
    ON process_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS step_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL,
      input_artifact_id TEXT,
      output_artifact_id TEXT,
      started_at TEXT,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      FOREIGN KEY(run_id) REFERENCES process_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_step_runs_run_id
    ON step_runs(run_id);

    CREATE TABLE IF NOT EXISTS step_attempts (
      id TEXT PRIMARY KEY,
      step_run_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      provider TEXT,
      model TEXT,
      prompt_version TEXT,
      temperature REAL,
      provider_request_id TEXT,
      finish_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      raw_output_digest TEXT,
      parsed_output_digest TEXT,
      is_repair_attempt INTEGER NOT NULL DEFAULT 0,
      retry_reason TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY(step_run_id) REFERENCES step_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_step_attempts_step_run_id
    ON step_attempts(step_run_id);

    CREATE TABLE IF NOT EXISTS harness_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      version INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      step_run_id TEXT,
      attempt_id TEXT,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_harness_events_run_id
    ON harness_events(run_id, occurred_at ASC);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_run_id TEXT,
      type TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      summary TEXT,
      storage_ref TEXT,
      redaction_policy TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES process_runs(id),
      FOREIGN KEY(step_run_id) REFERENCES step_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_run_id
    ON artifacts(run_id);

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      step_run_id TEXT NOT NULL,
      evaluator_name TEXT NOT NULL,
      evaluator_version TEXT NOT NULL,
      passed INTEGER NOT NULL,
      score REAL,
      issues_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(step_run_id) REFERENCES step_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_evaluations_step_run_id
    ON evaluations(step_run_id);

    CREATE TABLE IF NOT EXISTS failure_samples (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES process_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_failure_samples_run_id
    ON failure_samples(run_id);
  `)

  ensureColumn(db, 'process_runs', 'agent_state', 'TEXT')
  ensureColumn(db, 'process_runs', 'release_status', 'TEXT')
  ensureColumn(db, 'process_runs', 'used_safe_fallback', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'step_attempts', 'max_output_tokens', 'INTEGER')
  ensureColumn(db, 'step_attempts', 'compiled_prompt_sha256', 'TEXT')
  ensureColumn(db, 'step_attempts', 'schema_version', 'TEXT')
  ensureColumn(db, 'step_attempts', 'validator_version', 'TEXT')
  ensureColumn(db, 'step_attempts', 'adaptive_policy_version', 'TEXT')
  ensureColumn(db, 'step_attempts', 'score_formula_version', 'TEXT')
  ensureColumn(db, 'step_attempts', 'component_prompt_id', 'TEXT')
  ensureColumn(db, 'step_attempts', 'component_prompt_version', 'TEXT')
  db.query(`
    INSERT INTO schema_versions (name, version, updated_at)
    VALUES ('harness', 2, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at
  `).run()

  enforceHarnessRetention(db)

  return db
}
