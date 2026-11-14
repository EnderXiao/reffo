import {afterEach, expect, mock, spyOn, test} from 'bun:test'
import {Elysia} from 'elysia'
import {env} from '@/config/env'
import {resumeExportRoutes} from './resume-export'
import {resumeExportService, ResumeExportError} from '@/services/resume-export-service'
import {ResumePdfRenderError} from '@/services/pdf/chromium-renderer'

const old = {APP_ENV: env.APP_ENV, AUTH_REQUIRED: env.AUTH_REQUIRED}
afterEach(() => {mock.restore();Object.assign(env, old)})
test('PDF domain failures retain their recoverable status even inside a generic parent error handler', async () => {
  env.APP_ENV = 'local';env.AUTH_REQUIRED = false
  const app = new Elysia().onError(({set}) => {set.status = 500;return {success:false,error:{code:'INTERNAL_ERROR'}}}).use(resumeExportRoutes)
  spyOn(resumeExportService, 'create').mockRejectedValue(new ResumePdfRenderError())
  const failed = await app.handle(new Request('http://localhost/api/v1/resume-history/history/exports', {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({request_id:'test-request-123',document_id:'doc',expected_revision:0,format:'pdf'})}))
  expect(failed.status).toBe(503)
  expect(failed.headers.get('cache-control')).toBe('no-store')
  expect(await failed.json()).toMatchObject({success:false,error:{code:'PDF_RENDER_UNAVAILABLE'}})
  spyOn(resumeExportService,'file').mockRejectedValue(new ResumeExportError('RESUME_EXPORT_PENDING','稍后重试',409))
  const pending = await app.handle(new Request('http://localhost/api/v1/resume-history/history/exports/file-id/file'))
  expect(pending.status).toBe(409)
  expect(await pending.json()).toMatchObject({success:false,error:{code:'RESUME_EXPORT_PENDING'}})
})
