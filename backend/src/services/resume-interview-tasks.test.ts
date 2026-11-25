import {randomUUID} from 'node:crypto'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect, test} from 'bun:test'
import {getDatabase} from '@/repositories/database'
import {generationJobRepository} from '@/repositories/generation-job-repository'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {resumeInterviewTaskRepository} from '@/repositories/resume-interview-task-repository'
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

test('SQLite delivers a saved resume before P10 and keeps concurrent writes scoped to the saved version', async () => {
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
  const read = async () => projectManagedInterview(context.userId, (await resumeHistoryRepository.findById(context, historyId))!)
  const initial = await read()
  expect(initial.optimized_content).toContain('团队交付3个功能')
  expect(initial.interview_task?.status).toBe('pending')
  expect(publicResumeHistory(initial).process_result).not.toHaveProperty('server_interview_task')

  const first = (await resumeInterviewTaskRepository.claim())!
  await new ResumeInterviewWorker(resumeInterviewTaskRepository, resumeHistoryRepository, {
    interview: async () => { throw new Error('fixture provider timeout') },
  }).execute(first)
  const failed = await read()
  expect(failed.interview_task?.status).toBe('failed')
  expect(failed.optimized_content).toBe(initial.optimized_content)
  expect((await generationJobRepository.get(context.userId, id))?.status).toBe('completed')
  await Promise.all([retryManagedInterview(context.userId, failed), retryManagedInterview(context.userId, failed)])
  const retry = (await resumeInterviewTaskRepository.claim())!
  expect(retry.version).toBe(first.version)
  expect(await resumeInterviewTaskRepository.claim()).toBeNull()
  expect(await resumeInterviewTaskRepository.finish(first, 'failed')).toBe(false)
  await new ResumeInterviewWorker(resumeInterviewTaskRepository, resumeHistoryRepository, adapter).execute(retry)
  const done = await read()
  expect(done.interview_task?.status).toBe('done')
  const result = done.process_result as {optimized: {completion_document: ResumeCompletionDocument}}
  const reference = historyDocumentRef(done.process_result)
  expect(done.process_result).toHaveProperty('interview.based_on_document', reference)
  const work = result.optimized.completion_document

  const publicResult = publicResumeHistory(done).process_result as Record<string, unknown>
  await resumeHistoryRepository.update(context, historyId, {
    process_result: {...publicResult, interview: {}, server_interview_task: 'forged'},
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'failed'},
    expected_document: {documentId: work.documentId, revision: work.revision, resolvedDigest: reference.resolvedDigest!},
  })
  expect((await read()).process_result).toHaveProperty('interview.based_on_document', reference)

  const gap = collectGaps(work).find(item => item.kind === 'optional_gap_clause')!
  const change = applyCompletionCommand(work, {documentId: work.documentId, baseRevision: work.revision,
    gapId: gap.gapId, type: 'fill', value: '梳理交互流程'})
  if (!change.ok || !change.operation) throw new Error('fixture edit failed')
  const markdown = serializeDraft(change.document)
  await resumeHistoryRepository.update(context, historyId, {
    optimized_content: markdown,
    process_result: {...publicResult, optimized: {...result.optimized, completion_document: change.document, optimized_resume: markdown}},
    completion_edit: {documentId: work.documentId, baseRevision: work.revision, operations: [change.operation]},
    expected_document: {documentId: work.documentId, revision: work.revision, resolvedDigest: reference.resolvedDigest!},
  })
  const edited = await read()
  expect(edited.interview_task?.status).toBe('stale')
  expect(edited.process_result).not.toHaveProperty('interview')
  expect(await retryManagedInterview(context.userId, edited)).toBe(true)
  const oldLease = (await resumeInterviewTaskRepository.claim())!
  expect(oldLease.version).not.toBe(first.version)
  getDatabase().query('UPDATE resume_interview_tasks SET available_at = ? WHERE user_id = ? AND version = ?')
    .run('2026-11-10T00:00:00.000Z', context.userId, oldLease.version)
  const reclaimed = (await resumeInterviewTaskRepository.claim())!
  expect(reclaimed.lease_token).not.toBe(oldLease.lease_token)
  expect(await resumeInterviewTaskRepository.finish(oldLease, 'done')).toBe(false)
  expect(await resumeHistoryRepository.delete(context, historyId)).toBe(true)
  expect(await resumeInterviewTaskRepository.finish(reclaimed, 'done')).toBe(false)
  expect(await resumeInterviewTaskRepository.find(context.userId, historyId, first.version)).toBeNull()
  expect(await resumeHistoryRepository.findById(context, historyId)).toBeNull()
})
