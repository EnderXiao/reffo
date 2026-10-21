import {Elysia, t} from 'elysia'
import {RequestAuthError, resolveRequestUser} from '@/auth/request-context'
import {generationJobRepository} from '@/repositories/generation-job-repository'
import {ensureResumeQuotaAvailable, ResumeQuotaError} from '@/services/resume-quota'
import {generationJobWorker} from '@/services/generation-jobs'
import {normalizeMarkdownText} from '@/services/text-normalizer'
import {summarizeGenerationJob} from '@/types/generation-job'
import {publishGenerationJobUpdate, subscribeGenerationJobUpdates} from '@/services/generation-job-events'

const jobParams = t.Object({id: t.String({pattern: '^[a-f0-9-]{36}$'})})
export const generationJobRoutes = new Elysia({prefix: '/api/v1/generation-jobs'})
  .onError(({error, set}) => {
    if (error instanceof RequestAuthError || error instanceof ResumeQuotaError) {
      set.status = error.status
      return {success: false, error: {code: error.code, message: error.message}}
    }
  })
  .post('/', async ({body, headers, set}) => {
    const jobUser = await resolveRequestUser(headers)
    const existing = await generationJobRepository.get(jobUser.userId, body.request_id)
    if (existing) return {success: true, data: summarizeGenerationJob(existing)}
    await ensureResumeQuotaAvailable(jobUser)
    const job = await generationJobRepository.create(jobUser.userId, body.request_id, {
      resume_markdown: normalizeMarkdownText(body.resume_markdown), jd_text: normalizeMarkdownText(body.jd_text),
      company: body.company?.trim() || '', position: body.position?.trim() || '', location: body.location?.trim() || '',
    })
    set.status = 202
    publishGenerationJobUpdate(job)
    return {success: true, data: summarizeGenerationJob(job)}
  }, {body: t.Object({request_id: t.String({pattern: '^[a-f0-9-]{36}$'}),
    resume_markdown: t.String({minLength: 10, maxLength: 200000}), jd_text: t.String({minLength: 10, maxLength: 100000}),
    company: t.Optional(t.String({maxLength: 200})), position: t.Optional(t.String({maxLength: 200})), location: t.Optional(t.String({maxLength: 200}))}),
    detail: {summary: '创建可后台执行的简历生成任务', tags: ['MVP']}})
  .get('/', async ({headers}) => {
    const jobUser = await resolveRequestUser(headers)
    return {
      success: true,
      data: (await generationJobRepository.list(jobUser.userId)).map(summarizeGenerationJob),
    }
  },
  {detail: {summary: '获取当前用户生成任务与未读状态', tags: ['MVP']}})
  .get('/events', async ({headers, request, set}) => {
    const jobUser = await resolveRequestUser(headers)
    set.headers['content-type'] = 'text/event-stream; charset=utf-8'
    set.headers['cache-control'] = 'no-cache, no-transform'
    set.headers['connection'] = 'keep-alive'
    set.headers['x-accel-buffering'] = 'no'

    let cleanup: (() => void) | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const send = (payload: string) => {
          try {
            controller.enqueue(encoder.encode(payload))
          } catch {
            cleanup?.()
          }
        }
        const close = () => {
          cleanup?.()
          clearInterval(heartbeat)
          try {
            controller.close()
          } catch {}
        }
        const unsubscribe = subscribeGenerationJobUpdates(event => {
          if (event.userId !== jobUser.userId) return
          const eventId = `${event.job.id}:${event.job.updated_at}`
          send(`id: ${eventId}\nevent: job.updated\ndata: ${JSON.stringify(event.job)}\n\n`)
        })
        cleanup = () => {
          unsubscribe()
          cleanup = undefined
        }
        heartbeat = setInterval(() => send(': ping\n\n'), 20000)
        request.signal.addEventListener('abort', close, {once: true})
      },
      cancel() {
        cleanup?.()
        clearInterval(heartbeat)
      },
    })

    const responseHeaders = new Headers()
    for (const [key, value] of Object.entries(set.headers)) {
      if (value !== undefined) responseHeaders.set(key, String(value))
    }

    return new Response(stream, {headers: responseHeaders})
  }, {detail: {summary: '订阅当前用户生成任务实时状态', tags: ['MVP']}})
  .get('/:id', async ({params, headers, set}) => {
    const jobUser = await resolveRequestUser(headers)
    const job = await generationJobRepository.get(jobUser.userId, params.id)
    if (!job) {set.status = 404; return {success: false, error: {code: 'JOB_NOT_FOUND', message: '未找到生成任务'}}}
    return {success: true, data: summarizeGenerationJob(job)}
  }, {params: jobParams, detail: {summary: '查询生成进度', tags: ['MVP']}})
  .post('/:id/:action', async ({params, headers, set}) => {
    const jobUser = await resolveRequestUser(headers)
    const job = await generationJobRepository.get(jobUser.userId, params.id)
    if (!job) {set.status = 404; return {success: false, error: {code: 'JOB_NOT_FOUND', message: '未找到生成任务'}}}
    const action = params.action
    const invalidAction =
      (action === 'background' && !['queued', 'running'].includes(job.status))
      || ((action === 'read' || action === 'confirm') && job.status !== 'completed')
      || (action === 'retry' && job.status !== 'failed')
      || (action === 'cancel' && !['queued', 'running', 'failed', 'cancelled'].includes(job.status))
    if (invalidAction) {
      set.status = 409
      return {success: false, error: {code: 'JOB_STATE_CHANGED', message: '任务状态已更新，请刷新后重试'}}
    }
    const now = new Date().toISOString()
    const changes = action === 'background' ? {background: true}
      : action === 'read' ? {read_at: job.read_at || now}
        : action === 'confirm' ? {confirmed_at: job.confirmed_at || now, read_at: job.read_at || now}
          : action === 'cancel' ? {status: 'cancelled' as const, lease_token: null}
            : {status: 'queued' as const, error: null, lease_token: null, lease_expires_at: now}
    const updated = await generationJobRepository.patch(job.user_id, job.id, changes, {status: job.status})
    if (!updated) {set.status = 409; return {success: false, error: {code: 'JOB_STATE_CHANGED', message: '任务状态已更新，请重试'}}}
    publishGenerationJobUpdate(updated)
    if (action === 'retry') void generationJobWorker.tick()
    return {success: true, data: summarizeGenerationJob(updated)}
  }, {params: t.Object({id: jobParams.properties.id, action: t.Union([
    t.Literal('background'), t.Literal('read'), t.Literal('confirm'), t.Literal('retry'), t.Literal('cancel'),
  ])}), detail: {summary: '切换后台、已读、确认完成或重试任务', tags: ['MVP']}})
