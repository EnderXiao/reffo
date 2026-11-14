import {Elysia, t} from 'elysia'
import {RequestAuthError, resolveRequestUser} from '@/auth/request-context'
import {resumeExportService, resumeExportMetadata, ResumeExportError} from '@/services/resume-export-service'
import {ResumePdfRenderError} from '@/services/pdf/chromium-renderer'

const id = t.String({minLength: 1, maxLength: 200})
function exportFailure(error: unknown, set: {status?: unknown}) {
  if (!(error instanceof RequestAuthError || error instanceof ResumeExportError || error instanceof ResumePdfRenderError)) throw error
  set.status = error.status
  return {success: false as const, error: {code: error.code, message: error.message}}
}
export const resumeExportRoutes = new Elysia({prefix: '/api/v1/resume-history'})
  .onError(({error, set}) => {
    if (error instanceof RequestAuthError || error instanceof ResumeExportError || error instanceof ResumePdfRenderError) {
      set.status = error.status
      return {success: false, error: {code: error.code, message: error.message}}
    }
  })
  .post('/:id/exports', async ({params, body, headers, set}) => {
    set.headers['cache-control'] = 'no-store'
    try {
      const context = await resolveRequestUser(headers)
      const data = await resumeExportService.create(context, params.id, body)
      set.status = data.status === 'pending' ? 202 : 200
      return {success: true, data}
    } catch(error) {return exportFailure(error, set)}
  }, {params: t.Object({id}), body: t.Object({request_id: t.String({minLength: 8, maxLength: 100}),
    document_id: t.String({minLength: 1, maxLength: 512}), expected_revision: t.Integer({minimum: 0}), format: t.Literal('pdf')}),
    detail: {summary: '按已保存文档版本生成私有投递PDF', tags: ['ResumeHistory']}})
  .get('/:id/exports/:exportId', async ({params, headers, set}) => {
    set.headers['cache-control'] = 'no-store'
    try {
      const row = await resumeExportService.get(await resolveRequestUser(headers), params.id, params.exportId)
      return {success: true, data: resumeExportMetadata(row)}
    } catch(error) {return exportFailure(error, set)}
  }, {params: t.Object({id, exportId: id}), detail: {summary: '查询私有PDF导出状态', tags: ['ResumeHistory']}})
  .get('/:id/exports/:exportId/file', async ({params, headers, set}) => {
    set.headers['cache-control'] = 'no-store'
    try {
      const {row, bytes} = await resumeExportService.file(await resolveRequestUser(headers), params.id, params.exportId)
      return new Response(bytes, {headers: {'content-type': 'application/pdf', 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`}})
    } catch(error) {return exportFailure(error, set)}
  }, {params: t.Object({id, exportId: id}), detail: {summary: '鉴权下载已生成的文本PDF', tags: ['ResumeHistory']}})
