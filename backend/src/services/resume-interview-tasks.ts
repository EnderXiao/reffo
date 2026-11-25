import {createCanonicalDigest} from '@/harness/run-context'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {resumeInterviewTaskRepository, type ResumeInterviewTask, type ResumeInterviewTaskRepository} from '@/repositories/resume-interview-task-repository'
import {validateCompletionDocument, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {ResumeHistoryRecord} from '@/types'
import {v5SingleStepAdapter} from '@/v5/single-step-adapter'
import {generationJobFailure} from './generation-job-failure'
import {recordGenerationLifecycle} from './generation-lifecycle'
import {historyDocumentRef} from './resume-history-commit'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

export function resumeInterviewVersion(document: ResumeCompletionDocument, markdown: string) {
  return createCanonicalDigest({document, markdown})
}

function currentInterviewVersion(history: ResumeHistoryRecord) {
  const document = object(object(history.process_result).optimized).completion_document
  const checked = validateCompletionDocument(document, history.optimized_content)
  return checked.ok ? resumeInterviewVersion(checked.document, history.optimized_content) : undefined
}

export function hasManagedInterview(history: ResumeHistoryRecord) {
  const version = object(history.process_result).server_interview_task
  return typeof version === 'string' && /^[a-f0-9]{64}$/.test(version)
}

type InterviewRepository = Pick<ResumeInterviewTaskRepository, 'find' | 'retry' | 'claim' | 'renew' | 'finish'>
const owner = (task: ResumeInterviewTask) => ({userId: task.user_id, useServiceRole: true})

export function applyInterviewTask(history: ResumeHistoryRecord, task: ResumeInterviewTask | null): ResumeHistoryRecord {
  const {interview: _interview, ...result} = object(history.process_result)
  const status = !task || task.status === 'stale' ? 'stale'
    : task.status === 'done' ? task.result ? 'done' : 'failed'
      : task.status === 'failed' ? 'failed' : 'pending'
  return {...history, interview_task: {status},
    process_result: {...result, ...(status === 'done' ? {interview: task!.result} : {})},
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: status === 'stale' ? 'pending' : status}}
}

function pendingInterviewProjection(history: ResumeHistoryRecord): ResumeHistoryRecord {
  const projected = applyInterviewTask(history, null)
  return {...projected, interview_task: {status: 'pending'}}
}

export async function projectManagedInterview(userId: string, history: ResumeHistoryRecord,
  repository: Pick<InterviewRepository, 'find'> = resumeInterviewTaskRepository): Promise<ResumeHistoryRecord> {
  if (!hasManagedInterview(history)) return history
  const version = currentInterviewVersion(history)
  try {
    return applyInterviewTask(history, version ? await repository.find(userId, history.id, version) : null)
  } catch {
    console.error('读取面试任务状态失败')
    // A sidecar read outage must not prevent the owner from opening a saved resume.
    return pendingInterviewProjection(history)
  }
}

export async function projectManagedInterviews(userId: string, histories: ResumeHistoryRecord[]) {
  const managed = histories.filter(hasManagedInterview)
  const versions = new Map(managed.map(history => [history.id, currentInterviewVersion(history)]))
  try {
    const tasks = await resumeInterviewTaskRepository.findByVersions(userId, [...new Set([...versions.values()].filter(version => version !== undefined))])
    const byVersion = new Map(tasks.map(task => [`${task.history_id}:${task.version}`, task]))
    return histories.map(history => {
      if (!versions.has(history.id)) return history
      return applyInterviewTask(history, byVersion.get(`${history.id}:${versions.get(history.id)}`) ?? null)
    })
  } catch {
    console.error('读取面试任务列表状态失败')
    return histories.map(history => versions.has(history.id) ? pendingInterviewProjection(history) : history)
  }
}

export async function retryManagedInterview(userId: string, history: ResumeHistoryRecord) {
  if (!hasManagedInterview(history)) return false
  const version = currentInterviewVersion(history)
  if (!version) return false
  const originalVersion = object(history.process_result).server_interview_task as string
  const original = await resumeInterviewTaskRepository.find(userId, history.id, originalVersion)
  if (!original) return false
  const previous = version === originalVersion ? original : await resumeInterviewTaskRepository.find(userId, history.id, version)
  await resumeInterviewTaskRepository.retry(userId, history.id, version, previous)
  return true
}

export class ResumeInterviewWorker {
  private active = false
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly repository: Pick<InterviewRepository, 'claim' | 'renew' | 'finish'> = resumeInterviewTaskRepository,
    private readonly histories: Pick<typeof resumeHistoryRepository, 'findById'> = resumeHistoryRepository,
    private readonly adapter: Pick<typeof v5SingleStepAdapter, 'interview'> = v5SingleStepAdapter,
  ) {}

  async execute(task: ResumeInterviewTask) {
    let lostLease = false
    const heartbeat = setInterval(() => {
      void this.repository.renew(task).then(renewed => { if (!renewed) lostLease = true }).catch(() => { lostLease = true })
    }, 20000)
    heartbeat.unref?.()
    const load = async () => {
      const history = await this.histories.findById(owner(task), task.history_id)
      return history && hasManagedInterview(history) && currentInterviewVersion(history) === task.version ? history : null
    }
    const elapsedFrom = Date.now()
    let result: Awaited<ReturnType<typeof v5SingleStepAdapter.interview>> | undefined
    let failed = false
    let failure: ReturnType<typeof generationJobFailure>['failure'] | undefined
    try {
      const history = await load()
      if (lostLease) return
      if (!history) {
        if (await this.repository.finish(task, 'stale')) recordGenerationLifecycle('interview_stale', {historyId: task.history_id})
        return
      }
      try {
        const process = object(history.process_result)
        result = await this.adapter.interview(process.analysis, process.matching, history.optimized_content,
          task.user_id, {history})
      } catch (error) {
        failed = true
        failure = generationJobFailure(error, 'interview').failure
      }
      if (lostLease) return
      const current = await load()
      if (lostLease) return
      const status = !current ? 'stale' : failed ? 'failed' : 'done'
      const reference = current && historyDocumentRef(current.process_result)
      const data = result && reference?.documentId && reference.revision !== null ? {...result.data,
        based_on_document: {documentId: reference.documentId, revision: reference.revision,
          ...(reference.resolvedDigest ? {resolvedDigest: reference.resolvedDigest} : {})}} : result?.data
      if (await this.repository.finish(task, status, status === 'done' ? data : null)) {
        recordGenerationLifecycle(status === 'done' ? 'interview_ready' : status === 'failed' ? 'interview_failed' : 'interview_stale',
          {historyId: task.history_id, durationMs: Date.now() - elapsedFrom, runId: result?.runId ?? failure?.runId, code: failure?.code})
      }
    } finally {
      clearInterval(heartbeat)
    }
  }

  async tick() {
    if (this.active) return
    this.active = true
    try {
      const task = await this.repository.claim()
      if (task) await this.execute(task)
    } catch {
      console.error('处理面试任务队列失败')
    } finally {
      this.active = false
    }
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 2000)
    this.timer.unref?.()
    void this.tick()
  }
}

export const resumeInterviewWorker = new ResumeInterviewWorker()
