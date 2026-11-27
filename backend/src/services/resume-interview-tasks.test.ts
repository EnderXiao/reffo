import {randomUUID} from 'node:crypto'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect, test} from 'bun:test'
import {getDatabase} from '@/repositories/database'
import {generationJobRepository} from '@/repositories/generation-job-repository'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {V5CheckpointRepository} from '@/repositories/v5-checkpoint-repository'
import {V5AnalysisCacheRepository} from '@/repositories/v5-analysis-cache-repository'
import {publicResumeHistory} from '@/routes/resume-history'
import {applyCompletionCommand, collectGaps, serializeDraft, type ResumeCompletionDocument} from '@/shared/resume-completion'
import {V5SingleStepAdapter} from '@/v5/single-step-adapter'
import {MemoryAnalysisCacheStorage} from '@/v5/tests/analysis-cache-storage-fixture'
import {MemoryCheckpointStorage} from '@/v5/tests/checkpoint-storage-fixture'
import {FIXTURE_JD, FIXTURE_RESUME} from '@/v5/tests/fixtures'
import {createSingleStepFixture} from '@/v5/tests/single-step-fixtures'
import {GenerationJobWorker} from './generation-jobs'
import {historyDocumentRef} from './resume-history-commit'
import {projectManagedInterview, ResumeInterviewWorker, retryManagedInterview} from './resume-interview-tasks'
import {generationJobRoutes} from '@/routes/generation-jobs'
import {env} from '@/config/env'
import {subscribeGenerationJobUpdates} from './generation-job-events'

test('SQLite delivers before P10 and retains the first resume version through edits, retry and lease recovery', async () => {
  if (!process.env.REFFO_INTERVIEW_TASK_TEST_DATABASE) {
    const directory = mkdtempSync(join(tmpdir(), 'reffo-interview-task-'))
    try {
      const child = Bun.spawn([process.execPath, 'test', '--no-env-file', import.meta.path], {
        cwd: join(import.meta.dir, '../..'),
        env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: 'sqlite', OPENAI_API_KEY: '',
          SQLITE_DATABASE_PATH: join(directory, 'history.sqlite'), REFFO_INTERVIEW_TASK_TEST_DATABASE: '1'},
        stdout: 'pipe', stderr: 'pipe',
      })
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      if (exitCode) throw new Error(stderr)
    } finally {
      rmSync(directory, {recursive: true, force: true})
    }
    return
  }

  const context = {userId: 'interview-task-owner', useServiceRole: true}
  const fixture = createSingleStepFixture({inlineGap: true})
  const adapter = new V5SingleStepAdapter(new V5CheckpointRepository('async-interview-test', new MemoryCheckpointStorage()),
    fixture.createWorkflow, new V5AnalysisCacheRepository(new MemoryAnalysisCacheStorage()), {
      resolve: async input => ({value: await input.compute({timeoutMs: 200000, signal: AbortSignal.timeout(200000)}), cacheStatus: 'disabled'}),
    })
  const id = randomUUID()
  const input = {resume_markdown: FIXTURE_RESUME, jd_text: FIXTURE_JD, company: '示例公司', position: '产品经理', location: ''}
  await generationJobRepository.create(context.userId, id, input)
  const job = await generationJobRepository.claim()
  expect(job?.id).toBe(id)
  await new GenerationJobWorker(generationJobRepository, adapter, resumeHistoryRepository).execute(job!)
  const complete = await generationJobRepository.get(context.userId, id)
  expect(complete?.status).toBe('completed')
  expect(fixture.interviewInputs).toHaveLength(0)
  const historyId = complete!.history_id!
  const read = async () => projectManagedInterview((await resumeHistoryRepository.findById(context, historyId))!)
  const initial = await read()
  expect(initial.optimized_content).toContain('团队交付3个功能')
  expect(initial.interview_task?.status).toBe('pending')
  expect(publicResumeHistory(initial).process_result).not.toHaveProperty('server_interview_task')

  const first = (await generationJobRepository.claimInterview())!
  expect(first.id).toBe(id)
  const initialVersion = historyDocumentRef(initial.process_result)
  const original = initial.process_result as {optimized: {completion_document: ResumeCompletionDocument}}
  const work = original.optimized.completion_document
  const publicResult = publicResumeHistory(initial).process_result as Record<string, unknown>
  const gap = collectGaps(work).find(item => item.kind === 'optional_gap_clause')!
  const change = applyCompletionCommand(work, {documentId: work.documentId, baseRevision: work.revision,
    gapId: gap.gapId, type: 'fill', value: '梳理交互流程'})
  if (!change.ok || !change.operation) throw new Error('fixture edit failed')
  const markdown = serializeDraft(change.document)
  await resumeHistoryRepository.update(context, historyId, {
    optimized_content: markdown,
    process_result: {...publicResult, optimized: {...original.optimized, completion_document: change.document, optimized_resume: markdown}},
    completion_edit: {documentId: work.documentId, baseRevision: work.revision, operations: [change.operation]},
    expected_document: {documentId: work.documentId, revision: work.revision, resolvedDigest: initialVersion.resolvedDigest!},
  })
  expect((await read()).interview_task?.status).toBe('pending')
  await new ResumeInterviewWorker(generationJobRepository, resumeHistoryRepository, {
    interview: async () => { throw new Error('fixture provider timeout') },
  }).execute(first)
  const failed = await read()
  expect(failed.interview_task?.status).toBe('failed')
  expect(failed.optimized_content).toBe(markdown)
  expect((await generationJobRepository.get(context.userId, id))?.status).toBe('completed')
  expect(await retryManagedInterview('different-owner', failed)).toBe(false)
  await Promise.all([retryManagedInterview(context.userId, failed), retryManagedInterview(context.userId, failed)])
  const retry = (await generationJobRepository.claimInterview())!
  expect(retry.id).toBe(first.id)
  expect(await generationJobRepository.claimInterview()).toBeNull()
  expect(await generationJobRepository.finishInterview(first, 'failed')).toBeNull()
  getDatabase().query('UPDATE resume_generation_jobs SET interview_available_at = ? WHERE id = ?')
    .run('2026-11-10T00:00:00.000Z', retry.id)
  const reclaimed = (await generationJobRepository.claimInterview())!
  expect(reclaimed.interview_lease_token).not.toBe(retry.interview_lease_token)
  expect(await generationJobRepository.finishInterview(retry, 'failed')).toBeNull()
  const notifications: Array<{status: string | null | undefined; resultWritten: boolean}> = []
  const unsubscribe = subscribeGenerationJobUpdates(event => {
    if (event.job.id !== id) return
    const resultWritten = getDatabase().query(`SELECT 1 FROM resume_histories WHERE user_id = ? AND id = ?
      AND json_type(process_result_json, '$.interview') = 'object'`).get(context.userId, historyId) != null
    notifications.push({status: event.job.interview_status, resultWritten})
  })
  await new ResumeInterviewWorker(generationJobRepository, resumeHistoryRepository, adapter).execute(reclaimed)
  unsubscribe()
  const done = await read()
  expect(done.interview_task?.status).toBe('done')
  const reference = historyDocumentRef(done.process_result)
  expect(reference.revision).toBe(change.document.revision)
  expect(done.optimized_content).toBe(markdown)
  expect(done.process_result).toHaveProperty('interview.based_on_document', initialVersion)
  expect(fixture.interviewInputs).toHaveLength(1)
  expect(notifications).toEqual([{status: 'done', resultWritten: true}])
  await resumeHistoryRepository.update(context, historyId, {
    process_result: {...publicResumeHistory(done).process_result as Record<string, unknown>, interview: {}, server_interview_task: 'forged'},
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'failed'},
    expected_document: {documentId: work.documentId, revision: change.document.revision, resolvedDigest: reference.resolvedDigest!},
  })
  const saved = await read()
  expect(saved.process_result).toHaveProperty('interview.based_on_document', initialVersion)
  expect(await retryManagedInterview(context.userId, saved)).toBe(true)
  expect(await generationJobRepository.claimInterview()).toBeNull()
  expect(await resumeHistoryRepository.delete(context, historyId)).toBe(true)
  expect(await generationJobRepository.finishInterview(reclaimed, 'failed')).toBeNull()
  expect(await resumeHistoryRepository.findById(context, historyId)).toBeNull()

  const cancel = (id: string) => generationJobRoutes.handle(new Request(
    `http://localhost/api/v1/generation-jobs/${id}/cancel`, {method: 'POST'},
  ))
  const cancelledId = randomUUID()
  const cancelledHistoryId = `JD-${cancelledId}`
  const localContext = {userId: env.DEV_USER_ID, useServiceRole: true}
  await generationJobRepository.create(localContext.userId, cancelledId, input)
  const beforeDelivery = await generationJobRepository.claim()
  expect(beforeDelivery?.id).toBe(cancelledId)
  const workerRepository: ConstructorParameters<typeof GenerationJobWorker>[0] = {
    claim: () => generationJobRepository.claim(),
    renew: job => generationJobRepository.renew(job),
    quota: (job, consume) => generationJobRepository.quota(job, consume),
    patch: (...args) => generationJobRepository.patch(...args),
    stop: (...args) => generationJobRepository.stop(...args),
    commit: async (job, next, history) => {
      if (next.status === 'completed') expect((await cancel(cancelledId)).status).toBe(200)
      return generationJobRepository.commit(job, next, history)
    },
  }
  await new GenerationJobWorker(workerRepository, adapter).execute(beforeDelivery!)
  const cancelledHistory = await resumeHistoryRepository.findById(localContext, cancelledHistoryId)
  expect(cancelledHistory?.optimized_content).toBe('')
  expect(cancelledHistory?.progress).toMatchObject({analysis: 'done', matching: 'done', optimized: 'failed'})
  expect(cancelledHistory?.process_result).not.toHaveProperty('optimized')
  expect(await generationJobRepository.claimInterview()).toBeNull()
  expect((await generationJobRepository.get(localContext.userId, cancelledId))?.status).toBe('cancelled')

  const deliveredId = randomUUID()
  await generationJobRepository.create(localContext.userId, deliveredId, input)
  const afterDelivery = await generationJobRepository.claim()
  expect(afterDelivery?.id).toBe(deliveredId)
  await new GenerationJobWorker(generationJobRepository, adapter).execute(afterDelivery!)
  expect((await cancel(deliveredId)).status).toBe(409)
  const deliveredHistory = await resumeHistoryRepository.findById(localContext, `JD-${deliveredId}`)
  expect(projectManagedInterview(deliveredHistory!).interview_task?.status).toBe('pending')
  expect(deliveredHistory?.optimized_content).toContain('团队交付3个功能')

  // 模拟旧版本保存了正文和可信基线，任务确认及首版面试登记尚未完成。
  const legacyHistoryId = deliveredHistory!.id
  const db = getDatabase()
  db.query('UPDATE resume_generation_jobs SET interview_status = NULL, interview_available_at = NULL WHERE id = ?').run(deliveredId)
  db.query("UPDATE resume_histories SET process_result_json = json_remove(process_result_json, '$.server_interview_task') WHERE user_id = ? AND id = ?")
    .run(localContext.userId, legacyHistoryId)
  await generationJobRepository.patch(localContext.userId, deliveredId, {status: 'running', lease_token: 'legacy-recovery-lease',
    lease_expires_at: new Date(Date.now() + 90_000).toISOString()})
  const legacyJob = (await generationJobRepository.get(localContext.userId, deliveredId))!
  await new GenerationJobWorker(generationJobRepository, adapter).execute(legacyJob)
  const recovered = (await resumeHistoryRepository.findById(localContext, legacyHistoryId))!
  expect(recovered.optimized_content).toBe(deliveredHistory!.optimized_content)
  expect((await generationJobRepository.get(localContext.userId, deliveredId))?.status).toBe('completed')
  expect(projectManagedInterview(recovered).interview_task?.status).toBe('pending')
  expect((await generationJobRepository.get(localContext.userId, deliveredId))?.interview_status).toBe('pending')
})
