import { Elysia, t } from 'elysia'
import { RequestAuthError, resolveRequestUser } from '@/auth/request-context'
import { sourceResumeRepository } from '@/repositories/source-resume-repository'
import type { ApiResponse, SourceResumeRecord } from '@/types'

function toAuthErrorResponse(error: RequestAuthError, set: { status?: unknown }) {
  set.status = error.status

  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  } satisfies ApiResponse<never>
}

export const sourceResumeRoutes = new Elysia({ prefix: '/api/v1/source-resume' })
  .post(
    '/',
    async ({ body, headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const result = await sourceResumeRepository.save(userContext, body)

        const response: ApiResponse<SourceResumeRecord> = {
          success: true,
          data: result,
        }

        return response
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        console.error('保存源简历失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'SOURCE_RESUME_SAVE_FAILED',
            message: error instanceof Error ? error.message : '保存源简历失败',
          },
        }

        return response
      }
    },
    {
      body: t.Object({
        title: t.String({
          description: '源简历标题',
          minLength: 1,
        }),
        resume_markdown: t.String({
          description: 'Markdown 格式的源简历内容',
          minLength: 1,
        }),
        source_type: t.Union([t.Literal('manual'), t.Literal('file')], {
          description: '源简历来源类型',
        }),
        original_file_name: t.Optional(
          t.Union([t.String({ description: '原始文件名' }), t.Null()])
        ),
      }),
      detail: {
        summary: '保存源简历',
        description: '保存用户当前的源简历 markdown 内容，并写入 SQLite 供首页展示与索引。',
        tags: ['SourceResume'],
      },
    }
  )
  .get(
    '/latest',
    async ({ headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const result = await sourceResumeRepository.getLatest(userContext)

        const response: ApiResponse<SourceResumeRecord | null> = {
          success: true,
          data: result,
        }

        return response
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        console.error('获取源简历失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'SOURCE_RESUME_GET_FAILED',
            message: error instanceof Error ? error.message : '获取源简历失败',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      detail: {
        summary: '获取最新源简历',
        description: '返回最近一次保存的源简历元信息，用于首页左上角状态展示。',
        tags: ['SourceResume'],
      },
    }
  )
  .delete(
    '/:id',
    async ({ params, headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const deleted = await sourceResumeRepository.delete(userContext, params.id)

        if (!deleted) {
          set.status = 404
          return {
            success: false,
            error: {
              code: 'SOURCE_RESUME_NOT_FOUND',
              message: '源简历不存在或已删除',
            },
          } satisfies ApiResponse<never>
        }

        return {
          success: true,
          data: { deleted: true },
        } satisfies ApiResponse<{ deleted: boolean }>
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        console.error('删除源简历失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'SOURCE_RESUME_DELETE_FAILED',
            message: error instanceof Error ? error.message : '删除源简历失败',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      params: t.Object({
        id: t.String({ description: '源简历 ID', minLength: 1 }),
      }),
      detail: {
        summary: '删除源简历',
        description: '删除指定源简历记录，用于用户重新上传新的源简历。',
        tags: ['SourceResume'],
      },
    }
  )
