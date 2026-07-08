import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'

const DATABASE_PATH = join(process.cwd(), 'data', 'reffo.sqlite')

let database: Database | null = null

export function getDatabase() {
  if (database) {
    return database
  }

  mkdirSync(dirname(DATABASE_PATH), { recursive: true })
  database = new Database(DATABASE_PATH, { create: true })

  return database
}

export function initializeDatabase() {
  const db = getDatabase()

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

  return db
}
