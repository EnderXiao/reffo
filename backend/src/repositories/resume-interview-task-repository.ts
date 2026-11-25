import {randomUUID} from 'node:crypto'
import type {Database} from 'bun:sqlite'
import {env} from '@/config/env'
import {getDatabase} from '@/repositories/database'
import {createSupabaseRestClient} from '@/repositories/supabase/client'
import type {InterviewSuggestions} from '@/types'

export interface ResumeInterviewTask {
  user_id: string
  history_id: string
  version: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'stale'
  lease_token: string | null
  available_at: string
  updated_at: string
  result: InterviewSuggestions | null
}

const table = '/rest/v1/resume_interview_tasks'
const service = () => createSupabaseRestClient({useServiceRole: true})
const usesSupabase = env.DATABASE_PROVIDER === 'supabase'
const leaseUntil = () => new Date(Date.now() + 90000).toISOString()
const readDeadline = () => AbortSignal.timeout(2000)

export function ensureResumeInterviewTasks(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resume_interview_tasks (
      user_id TEXT NOT NULL, history_id TEXT NOT NULL REFERENCES resume_histories(id) ON DELETE CASCADE,
      version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', lease_token TEXT,
      available_at TEXT NOT NULL, updated_at TEXT NOT NULL, result TEXT,
      PRIMARY KEY (user_id, history_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_resume_interview_tasks_pending
      ON resume_interview_tasks(available_at) WHERE status IN ('pending','running');
  `)
}

export function ensureResumeInterviewEnqueueTrigger(db: Database) {
  ensureResumeInterviewTasks(db)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS enqueue_resume_interview AFTER INSERT ON resume_histories
    WHEN json_type(NEW.process_result_json, '$.server_interview_task') = 'text'
    BEGIN
      INSERT INTO resume_interview_tasks(user_id, history_id, version, available_at, updated_at)
      VALUES(NEW.user_id, NEW.id, json_extract(NEW.process_result_json, '$.server_interview_task'), NEW.updated_at, NEW.updated_at);
    END;
    CREATE TRIGGER IF NOT EXISTS enqueue_resume_interview_on_delivery AFTER UPDATE OF process_result_json ON resume_histories
    WHEN json_type(NEW.process_result_json, '$.server_interview_task') = 'text'
      AND json_extract(OLD.process_result_json, '$.server_interview_task') IS NULL
    BEGIN
      INSERT INTO resume_interview_tasks(user_id, history_id, version, available_at, updated_at)
      VALUES(NEW.user_id, NEW.id, json_extract(NEW.process_result_json, '$.server_interview_task'), NEW.updated_at, NEW.updated_at);
    END;
  `)
}

function database() {
  const db = getDatabase()
  ensureResumeInterviewTasks(db)
  return db
}

function decode(row: unknown): ResumeInterviewTask | null {
  if (!row) return null
  const task = row as ResumeInterviewTask
  return typeof task.result === 'string' ? {...task, result: JSON.parse(task.result)} : task
}

const identity = (task: Pick<ResumeInterviewTask, 'user_id' | 'history_id' | 'version'>) => ({
  user_id: `eq.${task.user_id}`, history_id: `eq.${task.history_id}`, version: `eq.${task.version}`,
})

export class ResumeInterviewTaskRepository {
  async find(userId: string, historyId: string, version: string) {
    if (usesSupabase) {
      const rows = await service().request<ResumeInterviewTask[]>(table, {
        searchParams: identity({user_id: userId, history_id: historyId, version}), signal: readDeadline(),
      })
      return rows[0] ?? null
    }
    return decode(database().query('SELECT * FROM resume_interview_tasks WHERE user_id = ? AND history_id = ? AND version = ?')
      .get(userId, historyId, version))
  }

  async findByVersions(userId: string, versions: string[]) {
    if (!versions.length) return []
    if (usesSupabase) {
      const batches = []
      for (let start = 0; start < versions.length; start += 30) {
        batches.push(service().request<ResumeInterviewTask[]>(table, {
          searchParams: {user_id: `eq.${userId}`, version: `in.(${versions.slice(start, start + 30).join(',')})`},
          signal: readDeadline(),
        }))
      }
      return (await Promise.all(batches)).flat()
    }
    const parameters = versions.map(() => '?').join(',')
    return database().query(`SELECT * FROM resume_interview_tasks WHERE user_id = ? AND version IN (${parameters})`)
      .all(userId, ...versions).map(row => decode(row)!)
  }

  async claim() {
    const now = new Date().toISOString()
    const token = randomUUID()
    const until = leaseUntil()
    if (usesSupabase) {
      const filter = {status: 'in.(pending,running)', available_at: `lte.${now}`}
      const [candidate] = await service().request<ResumeInterviewTask[]>(table, {
        searchParams: {...filter, order: 'available_at.asc', limit: 1},
      })
      if (!candidate) return null
      const [task] = await service().request<ResumeInterviewTask[]>(table, {
        method: 'PATCH', prefer: 'return=representation', searchParams: {...identity(candidate), ...filter},
        body: {status: 'running', lease_token: token, available_at: until, updated_at: now},
      })
      return task ?? null
    }
    return decode(database().query(`UPDATE resume_interview_tasks SET status = 'running', lease_token = ?, available_at = ?, updated_at = ?
      WHERE rowid = (SELECT rowid FROM resume_interview_tasks WHERE status IN ('pending','running') AND available_at <= ?
      ORDER BY available_at LIMIT 1) RETURNING *`).get(token, until, now, now))
  }

  async renew(task: ResumeInterviewTask) {
    const now = new Date().toISOString()
    if (usesSupabase) {
      const [updated] = await service().request<ResumeInterviewTask[]>(table, {
        method: 'PATCH', prefer: 'return=representation',
        searchParams: {...identity(task), status: 'eq.running', lease_token: `eq.${task.lease_token}`, available_at: `gt.${now}`},
        body: {available_at: leaseUntil()},
      })
      return Boolean(updated)
    }
    return database().query(`UPDATE resume_interview_tasks SET available_at = ?
      WHERE user_id = ? AND history_id = ? AND version = ? AND status = 'running' AND lease_token = ? AND available_at > ?`)
      .run(leaseUntil(), task.user_id, task.history_id, task.version, task.lease_token, now).changes > 0
  }

  async finish(task: ResumeInterviewTask, status: 'done' | 'failed' | 'stale', result: InterviewSuggestions | null = null) {
    const now = new Date().toISOString()
    if (usesSupabase) {
      const [updated] = await service().request<ResumeInterviewTask[]>(table, {
        method: 'PATCH', prefer: 'return=representation',
        searchParams: {...identity(task), status: 'eq.running', lease_token: `eq.${task.lease_token}`, available_at: `gt.${now}`},
        body: {status, result, lease_token: null, updated_at: now},
      })
      return Boolean(updated)
    }
    return database().query(`UPDATE resume_interview_tasks SET status = ?, result = ?, lease_token = NULL, updated_at = ?
      WHERE user_id = ? AND history_id = ? AND version = ? AND status = 'running' AND lease_token = ? AND available_at > ?`)
      .run(status, result ? JSON.stringify(result) : null, now, task.user_id, task.history_id, task.version, task.lease_token, now).changes > 0
  }

  async retry(userId: string, historyId: string, version: string, previous: ResumeInterviewTask | null) {
    if (previous && previous.status !== 'failed' && previous.status !== 'stale') return
    const now = new Date().toISOString()
    const key = {user_id: userId, history_id: historyId, version}
    if (usesSupabase) {
      const body = {status: 'pending', available_at: now, updated_at: now, lease_token: null, result: null}
      if (!previous) {
        await service().request(table, {method: 'POST', prefer: 'resolution=ignore-duplicates', body: {...key, ...body}})
      } else {
        await service().request(table, {method: 'PATCH', searchParams: {...identity(key),
          status: `eq.${previous.status}`, updated_at: `eq.${previous.updated_at}`}, body})
      }
    } else if (!previous) {
      database().query(`INSERT INTO resume_interview_tasks(user_id, history_id, version, available_at, updated_at)
        SELECT user_id,id,?,?,? FROM resume_histories WHERE user_id = ? AND id = ? ON CONFLICT DO NOTHING`)
        .run(version, now, now, userId, historyId)
    } else {
      database().query(`UPDATE resume_interview_tasks SET status = 'pending', available_at = ?, updated_at = ?, lease_token = NULL, result = NULL
        WHERE user_id = ? AND history_id = ? AND version = ? AND status = ? AND updated_at = ?`)
        .run(now, now, userId, historyId, version, previous.status, previous.updated_at)
    }
  }
}

export const resumeInterviewTaskRepository = new ResumeInterviewTaskRepository()
