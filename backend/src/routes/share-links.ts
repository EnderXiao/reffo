import { Elysia, t } from 'elysia'
import { RequestAuthError, resolveRequestUser } from '@/auth/request-context'
import { resumeHistoryRepository } from '@/repositories/resume-history-repository'
import { ShareHistoryIncompleteError } from '@/shared/share-link-snapshot'
import { shareLinkService } from '@/services/share-link-service'
import type { ApiResponse } from '@/types'
import type {
  CreatedShareLink,
  PublicShareLink,
  ShareContentMode,
  ShareCreatedVia,
} from '@/types/share-link'

const createShareBodySchema = t.Object({
  history_id: t.String({description: '来源历史记录 ID', minLength: 1, maxLength: 100}),
  mode: t.Union([t.Literal('job'), t.Literal('blank')], {description: '分享内容模式'}),
  created_via: t.Union([t.Literal('image'), t.Literal('link')], {description: '首次创建意图'}),
})

function toAuthErrorResponse(error: RequestAuthError, set: {status?: unknown}) {
  set.status = error.status
  return {
    success: false,
    error: {code: error.code, message: error.message},
  } satisfies ApiResponse<never>
}

function readIdempotencyKey(headers: Record<string, string | undefined>) {
  return headers['idempotency-key'] || headers['Idempotency-Key']
}

export const shareLinkRoutes = new Elysia({prefix: '/api/v1/share-links'})
  .post(
    '/',
    async ({body, headers, set}) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const history = await resumeHistoryRepository.findById(userContext, body.history_id)
        if (!history) {
          set.status = 404
          return {
            success: false,
            error: {
              code: 'RESUME_HISTORY_NOT_FOUND',
              message: '生成卡片历史不存在或已删除',
            },
          } satisfies ApiResponse<never>
        }

        const result = await shareLinkService.create(
          userContext,
          history,
          body.mode as ShareContentMode,
          body.created_via as ShareCreatedVia,
          readIdempotencyKey(headers),
        )
        set.status = result.created ? 201 : 200
        return {
          success: true,
          data: {
            id: result.id,
            token: result.token,
            share_url: result.share_url,
            mode: result.mode,
            schema_version: result.schema_version,
            expires_at: result.expires_at,
          },
        } satisfies ApiResponse<CreatedShareLink>
      } catch (error) {
        if (error instanceof RequestAuthError) return toAuthErrorResponse(error, set)
        if (error instanceof ShareHistoryIncompleteError) {
          set.status = 422
          return {
            success: false,
            error: {code: 'SHARE_HISTORY_INCOMPLETE', message: error.message},
          } satisfies ApiResponse<never>
        }

        console.error('创建分享链接失败:', error)
        set.status = 500
        return {
          success: false,
          error: {
            code: 'SHARE_LINK_CREATE_FAILED',
            message: '创建分享链接失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      body: createShareBodySchema,
      detail: {
        summary: '创建公开分享链接',
        description: '从当前用户的生成历史创建脱敏分享快照，支持岗位信息和空白两种模式。',
        tags: ['ShareLink'],
      },
    },
  )
  .get(
    '/public/:token',
    async ({params, set}) => {
      const result = await shareLinkService.getByToken(params.token)
      if (result.status === 'ok') {
        set.headers['cache-control'] = 'no-store'
        return {
          success: true,
          data: result.data,
        } satisfies ApiResponse<PublicShareLink>
      }

      set.status = result.status === 'invalid' ? 404 : 410
      return {
        success: false,
        error: {
          code: `SHARE_LINK_${result.status.toUpperCase()}`,
          message: result.status === 'invalid'
            ? '分享内容不存在'
            : result.status === 'expired'
              ? '分享已过期'
              : '分享已被作者取消',
        },
      } satisfies ApiResponse<never>
    },
    {
      params: t.Object({
        token: t.String({description: '公开分享 token', minLength: 20, maxLength: 300}),
      }),
      detail: {
        summary: '公开读取分享 Landing 快照',
        description: '无需登录，只返回分享快照白名单，不返回原始简历或 JD。',
        tags: ['ShareLink'],
      },
    },
  )
  .delete(
    '/:id',
    async ({params, headers, set}) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const revoked = await shareLinkService.revoke(userContext, params.id)
        if (!revoked) {
          set.status = 404
          return {
            success: false,
            error: {
              code: 'SHARE_LINK_NOT_FOUND',
              message: '分享链接不存在或已取消',
            },
          } satisfies ApiResponse<never>
        }

        return {
          success: true,
          data: {revoked: true},
        } satisfies ApiResponse<{revoked: boolean}>
      } catch (error) {
        if (error instanceof RequestAuthError) return toAuthErrorResponse(error, set)

        console.error('撤销分享链接失败:', error)
        set.status = 500
        return {
          success: false,
          error: {
            code: 'SHARE_LINK_REVOKE_FAILED',
            message: '撤销分享链接失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      params: t.Object({
        id: t.String({description: '分享记录 ID', minLength: 1, maxLength: 100}),
      }),
      detail: {
        summary: '撤销分享链接',
        description: '作者撤销自己的公开分享，撤销后公开 Landing 不再显示快照。',
        tags: ['ShareLink'],
      },
    },
  )
