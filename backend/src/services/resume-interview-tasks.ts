import {createCanonicalDigest} from '@/harness/run-context'
import {generationJobRepository, type GenerationJobRepository} from '@/repositories/generation-job-repository'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {serializeDraft, validateCompletionDocument, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {InterviewSuggestions, ResumeHistoryRecord} from '@/types'
import type {GenerationJob} from '@/types/generation-job'
import {savedInterviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {v5SingleStepAdapter} from '@/v5/single-step-adapter'
import {publishGenerationJobUpdate} from './generation-job-events'
import {generationJobFailure} from './generation-job-failure'
import {recordGenerationLifecycle} from './generation-lifecycle'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

export function resumeInterviewVersion(document: ResumeCompletionDocument, markdown: string) {
  return createCanonicalDigest({document, markdown})
}

export function hasManagedInterview(history: ResumeHistoryRecord) {
  const version = object(history.process_result).server_interview_task
  return typeof version === 'string' && /^[a-f0-9]{64}$/.test(version)
}

export function storedInterview(history: ResumeHistoryRecord): InterviewSuggestions | undefined {
  const interview = object(object(history.process_result).interview)
  if (Array.isArray(interview.questions) && Array.isArray(interview.story_recommendations)
    && (interview.questions.length || interview.story_recommendations.length || (Array.isArray(interview.follow_up_questions) && interview.follow_up_questions.length))) {
    return interview as unknown as InterviewSuggestions
  }
}

function initialInterviewSnapshot(history: ResumeHistoryRecord) {
  if (!hasManagedInterview(history)) return
  const process = object(history.process_result)
  const archive = object(process.server_completion_upgrade_archive)
  for (const entry of [process.server_interview_basis, {version: 'interview-generation-basis-v1', result: archive.originalInterviewBasis}]) {
    const snapshot = {...history, process_result: {...process, server_interview_basis: entry}}
    const basis = savedInterviewGenerationBasis(snapshot)
    if (!basis?.completionDocument) continue
    try {
      const markdown = serializeDraft(basis.completionDocument)
      const checked = validateCompletionDocument(basis.completionDocument, markdown)
      if (!checked.ok || resumeInterviewVersion(checked.document, markdown) !== process.server_interview_task) continue
      return {
        history: {...snapshot, optimized_content: markdown, process_result: {...snapshot.process_result,
          optimized: {...object(process.optimized), completion_document: checked.document}}},
        reference: {documentId: checked.document.documentId, revision: checked.document.revision,
          ...(basis.resolvedActionPlan ? {resolvedDigest: basis.resolvedActionPlan.resolvedDigest} : {})},
      }
    } catch {
      // An unverifiable legacy snapshot cannot supply input for a new model call.
    }
  }
}

export function projectManagedInterview(history: ResumeHistoryRecord): ResumeHistoryRecord {
  if (!hasManagedInterview(history)) return history
  const status = storedInterview(history) ? 'done'
    : history.progress?.interview === 'failed' ? initialInterviewSnapshot(history) ? 'failed' : 'stale' : 'pending'
  return {...history, interview_task: {status},
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: status === 'stale' ? 'failed' : status}}
}

export async function retryManagedInterview(userId: string, history: ResumeHistoryRecord) {
  if (storedInterview(history)) return true
  if (!initialInterviewSnapshot(history)) return false
  const job = await generationJobRepository.retryInterview(userId, history.id)
  if (!job || job.interview_status === 'unavailable') return false
  if (job.interview_status === 'pending') {
    publishGenerationJobUpdate(job)
  }
  return true
}

type InterviewRepository = Pick<GenerationJobRepository, 'claimInterview' | 'renewInterview' | 'finishInterview'>

export class ResumeInterviewWorker {
  private active = false
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly repository: InterviewRepository = generationJobRepository,
    private readonly histories: Pick<typeof resumeHistoryRepository, 'findById'> = resumeHistoryRepository,
    private readonly adapter: Pick<typeof v5SingleStepAdapter, 'interview'> = v5SingleStepAdapter,
  ) {}

  async execute(job: GenerationJob) {
    if (!job.history_id) return
    let lostLease = false
    const heartbeat = setInterval(() => {
      void this.repository.renewInterview(job).then(renewed => { if (!renewed) lostLease = true }).catch(() => { lostLease = true })
    }, 20000)
    heartbeat.unref?.()
    const start = Date.now()
    try {
      const history = await this.histories.findById({userId: job.user_id, useServiceRole: true}, job.history_id)
      const snapshot = history && initialInterviewSnapshot(history)
      const previous = history && storedInterview(history)
      if (lostLease) return
      let status: 'done' | 'failed' | 'unavailable' = previous ? 'done' : 'unavailable'
      let data: InterviewSuggestions | undefined = previous || undefined
      let failure: ReturnType<typeof generationJobFailure>['failure'] | undefined
      let runId: string | undefined
      if (snapshot && !previous) {
        try {
          const process = object(snapshot.history.process_result)
          const result = await this.adapter.interview(process.analysis, process.matching, snapshot.history.optimized_content,
            job.user_id, {history: snapshot.history})
          status = 'done'
          data = {...result.data, based_on_document: snapshot.reference}
          runId = result.runId
        } catch (error) {
          status = 'failed'
          failure = generationJobFailure(error, 'interview').failure
        }
      }
      if (lostLease) return
      const updated = await this.repository.finishInterview(job, status, data)
      if (updated) {
        publishGenerationJobUpdate(updated)
        recordGenerationLifecycle(updated.interview_status === 'done' ? 'interview_ready'
          : updated.interview_status === 'failed' ? 'interview_failed' : 'interview_stale',
        {historyId: job.history_id, durationMs: Date.now() - start, runId: runId ?? failure?.runId, code: failure?.code})
      }
    } finally {
      clearInterval(heartbeat)
    }
  }

  async tick() {
    if (this.active) return
    this.active = true
    try {
      const job = await this.repository.claimInterview()
      if (job) {
        publishGenerationJobUpdate(job)
        await this.execute(job)
      }
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
