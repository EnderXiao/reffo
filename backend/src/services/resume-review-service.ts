import {randomUUID} from 'node:crypto'
import type {Database} from 'bun:sqlite'
import {env} from '@/config/env'
import {getDatabase} from '@/repositories/database'
import {createSupabaseRestClient} from '@/repositories/supabase/client'
import {actionContentDigest, buildChangeManifest, type ResumeChangeManifest, type ResumeActionOutcome, type ResumeActionReview, type ResolvedResumeActionPlan} from '@/shared/resume-actions'
import {historyDocumentRef} from './resume-history-commit'
import type {ResumeHistoryRecord} from '@/types'

export interface ResumeReviewTask {
  id: string
  ownerId: string
  historyId: string
  documentId: string
  revision: number
  resolvedDigest: string
  actionId: string
  inputDigest: string
  taskGeneration: number
  status: 'pending' | 'running' | 'completed' | 'superseded' | 'failed'
  leaseToken: string | null
  leaseExpiresAt: string | null
  attempts: number
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function reviewSidecar(history: Pick<ResumeHistoryRecord, 'process_result'>) {
  const optimized = record(record(history.process_result).optimized)
  return {review: optimized.action_review as ResumeActionReview | undefined,
    plan: optimized.resolved_action_plan as ResolvedResumeActionPlan | undefined}
}
export function reviewActionInputDigest(history: Pick<ResumeHistoryRecord, 'process_result'>, actionId: string) {
  const {review, plan} = reviewSidecar(history)
  const optimized = record(record(history.process_result).optimized)
  return actionContentDigest({action: plan?.actions.find(action => action.actionId === actionId),
    outcome: review?.outcomes.find(outcome => outcome.actionId === actionId), document: optimized.completion_document,
    resolvedDigest: plan?.resolvedDigest})
}
/** Include every still-pending action after each save, so a later unrelated edit cannot strand it. */
export function buildResumeReviewTasks(ownerId: string, history: ResumeHistoryRecord): ResumeReviewTask[] {
  const {review, plan} = reviewSidecar(history)
  if (!review || !plan || review.documentId !== historyDocumentRef(history.process_result).documentId) return []
  return review.outcomes.filter(outcome => outcome.state === 'pending_review').map(outcome => ({id: randomUUID(), ownerId,
    historyId: history.id, documentId: review.documentId, revision: review.revision, resolvedDigest: plan.resolvedDigest,
    actionId: outcome.actionId, inputDigest: reviewActionInputDigest(history, outcome.actionId),
    taskGeneration: review.revision, status: 'pending', leaseToken: null, leaseExpiresAt: null, attempts: 0}))
}

export function ensureResumeReviewTables(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS resume_history_commits (
    owner_id TEXT NOT NULL, commit_id TEXT NOT NULL, request_digest TEXT NOT NULL,
    history_id TEXT NOT NULL, acknowledgement_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(owner_id, commit_id));
    CREATE TABLE IF NOT EXISTS resume_review_tasks (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, history_id TEXT NOT NULL, document_id TEXT NOT NULL,
    revision INTEGER NOT NULL, resolved_digest TEXT NOT NULL, action_id TEXT NOT NULL, input_digest TEXT NOT NULL,
    task_generation INTEGER NOT NULL, status TEXT NOT NULL, lease_token TEXT, lease_expires_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    UNIQUE(owner_id, history_id, document_id, revision, resolved_digest, action_id, input_digest));
    CREATE INDEX IF NOT EXISTS resume_review_pending ON resume_review_tasks(status, available_at);
    CREATE TRIGGER IF NOT EXISTS revoke_deleted_resume_review AFTER DELETE ON resume_histories BEGIN
      UPDATE resume_review_tasks SET status = 'superseded', lease_token = NULL WHERE owner_id = OLD.user_id AND history_id = OLD.id;
      DELETE FROM resume_history_commits WHERE owner_id = OLD.user_id AND history_id = OLD.id;
    END;`)
}
export function enqueueResumeReviewTasks(db: Database, owner: string, history: ResumeHistoryRecord) {
  ensureResumeReviewTables(db)
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + env.DIAGNOSTIC_RETENTION_MS).toISOString()
  db.query(`UPDATE resume_review_tasks SET status = 'superseded', lease_token = NULL
    WHERE owner_id = ? AND history_id = ? AND status IN ('pending', 'running')`).run(owner, history.id)
  for (const task of buildResumeReviewTasks(owner, history)) {
    db.query(`INSERT INTO resume_review_tasks (id,owner_id,history_id,document_id,revision,resolved_digest,action_id,input_digest,
      task_generation,status,attempts,available_at,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',0,?,?,?)
      ON CONFLICT(owner_id,history_id,document_id,revision,resolved_digest,action_id,input_digest)
      DO UPDATE SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, available_at = excluded.available_at`).run(
      task.id, owner, history.id, task.documentId, task.revision, task.resolvedDigest, task.actionId, task.inputDigest,
      task.taskGeneration, now, now, expires)
  }
}
function taskFromRow(row: Record<string, unknown>): ResumeReviewTask {
  return {id: String(row.id), ownerId: String(row.owner_id), historyId: String(row.history_id), documentId: String(row.document_id),
    revision: Number(row.revision), resolvedDigest: String(row.resolved_digest), actionId: String(row.action_id), inputDigest: String(row.input_digest),
    taskGeneration: Number(row.task_generation), status: row.status as ResumeReviewTask['status'], leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null, attempts: Number(row.attempts)}
}
function reviewClient() {return createSupabaseRestClient({useServiceRole: true})}
export class ResumeReviewQueue {
  async claim(): Promise<ResumeReviewTask | null> {
    const leaseToken = randomUUID()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 60_000).toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await reviewClient().request<Record<string, unknown>[]>('/rest/v1/rpc/claim_resume_review_task', {
        method: 'POST', body: {p_lease_token: leaseToken, p_lease_expires_at: expires}})
      return rows[0] ? taskFromRow(rows[0]) : null
    }
    const db = getDatabase()
    if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='resume_histories'").get()) return null
    ensureResumeReviewTables(db)
    const row = db.query(`UPDATE resume_review_tasks SET status = 'running', lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM resume_review_tasks WHERE expires_at > ? AND available_at <= ? AND attempts < 3
        AND (status = 'pending' OR (status = 'running' AND lease_expires_at <= ?)) ORDER BY created_at LIMIT 1) RETURNING *`).get(
      leaseToken, expires, now, now, now) as Record<string, unknown> | null
    return row ? taskFromRow(row) : null
  }

  async finish(task: ResumeReviewTask, outcome: ResumeActionOutcome): Promise<boolean> {
    if (outcome.actionId !== task.actionId || outcome.state === 'pending_review') return false
    if (env.DATABASE_PROVIDER === 'supabase') {
      return reviewClient().request<boolean>('/rest/v1/rpc/finish_resume_review_task', {method: 'POST',
        body: {p_task_id: task.id, p_lease_token: task.leaseToken, p_input_digest: task.inputDigest,
          p_task_generation: task.taskGeneration, p_outcome: outcome}})
    }
    const db = getDatabase()
    return db.transaction(() => {
      const lease = db.query(`SELECT * FROM resume_review_tasks WHERE id = ? AND owner_id = ? AND status = 'running'
        AND lease_token = ? AND lease_expires_at > ? AND input_digest = ? AND task_generation = ?`).get(
        task.id, task.ownerId, task.leaseToken, new Date().toISOString(), task.inputDigest, task.taskGeneration)
      if (!lease) return false
      const row = db.query('SELECT process_result_json FROM resume_histories WHERE user_id = ? AND id = ?').get(task.ownerId, task.historyId) as {process_result_json: string} | null
      if (!row) return false
      const history = {process_result: JSON.parse(row.process_result_json)}
      const {review, plan} = reviewSidecar(history)
      if (!review || !plan || review.documentId !== task.documentId || review.revision !== task.revision
        || plan.resolvedDigest !== task.resolvedDigest || reviewActionInputDigest(history, task.actionId) !== task.inputDigest) return false
      const next = {...review, reviewRevision: review.reviewRevision + 1,
        outcomes: review.outcomes.map(current => current.actionId === task.actionId ? outcome : current)}
      db.query(`UPDATE resume_histories SET process_result_json = json_set(process_result_json,
        '$.optimized.action_review', json(?), '$.optimized.change_manifest', json(?)) WHERE user_id = ? AND id = ?`).run(
        JSON.stringify(next), JSON.stringify(buildChangeManifest(next, plan, {previous: record(record(history.process_result).optimized).change_manifest as ResumeChangeManifest | undefined})), task.ownerId, task.historyId)
      db.query("UPDATE resume_review_tasks SET status = 'completed', lease_token = NULL, lease_expires_at = NULL WHERE id = ?").run(task.id)
      return true
    }).immediate()
  }
  async retry(task: ResumeReviewTask) {
    const available = new Date(Date.now() + Math.min(30_000, 1000 * 2 ** task.attempts)).toISOString()
    const status = task.attempts >= 3 ? 'failed' : 'pending'
    if (env.DATABASE_PROVIDER === 'supabase') {
      await reviewClient().request('/rest/v1/resume_review_tasks', {method: 'PATCH',
        searchParams: {id: `eq.${task.id}`, status: 'eq.running', lease_token: `eq.${task.leaseToken}`},
        body: {status, available_at: available, lease_token: null, lease_expires_at: null}, prefer: 'return=minimal'})
    } else getDatabase().query(`UPDATE resume_review_tasks SET status = ?, available_at = ?, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'running' AND lease_token = ?`).run(status, available, task.id, task.leaseToken)
  }
}

export type ResumeActionEvaluator = (task: ResumeReviewTask, history: ResumeHistoryRecord) => Promise<ResumeActionOutcome | null>
let evaluator: ResumeActionEvaluator | undefined
export function registerResumeActionEvaluator(next: ResumeActionEvaluator) {evaluator = next}
export const resumeReviewQueue = new ResumeReviewQueue()
let timer: ReturnType<typeof setInterval> | undefined
let busy = false
export async function runResumeReviewOnce() {
  if (!evaluator || busy) return
  busy = true
  let task: ResumeReviewTask | null = null
  try {
    task = await resumeReviewQueue.claim()
    if (!task) return
    const {resumeHistoryRepository} = await import('@/repositories/resume-history-repository')
    const history = await resumeHistoryRepository.findById({userId: task.ownerId, useServiceRole: true}, task.historyId)
    const result = history ? await evaluator(task, history) : null
    if (!result || !await resumeReviewQueue.finish(task, result)) await resumeReviewQueue.retry(task)
  } catch {
    if (task) await resumeReviewQueue.retry(task).catch(() => undefined)
    console.error('[ResumeReview] 复核任务暂未完成，待核对状态已保留')
  } finally {busy = false}
}
export function startResumeReviewWorker() {
  if (timer) return
  timer = setInterval(() => {void runResumeReviewOnce()}, 1500)
  timer.unref?.()
}
