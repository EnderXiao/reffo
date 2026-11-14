import {upgradeResumeCompletion} from '@/services/resume-completion-upgrade'
import { Elysia, t } from 'elysia'
import { RequestAuthError, resolveRequestUser } from '@/auth/request-context'
import { resumeHistoryRepository } from '@/repositories/resume-history-repository'
import type { ApiResponse, ResumeHistoryRecord, ResumeHistorySummaryRecord } from '@/types'
import { buildResumeValueSummary } from '@/shared/resume-strategy'
import {completionDocumentFromSnapshot, ResumeCompletionSnapshotError} from '@/services/resume-completion-snapshot'
import {loadCompletionBaselineBundle} from '@/services/resume-completion-baseline'
import {ResumeHistoryCommitError} from '@/services/resume-history-commit'
import {clearOwnerResumeExtractionCache} from '@/v5/single-step-adapter'
import {reviewSidecar} from '@/services/resume-review-service'
import {assessResumeDelivery} from '@/services/resume-delivery-assessment'
import type {ResumeActionReview, ResumeIdentityState, ResolvedResumeActionPlan, ResumeChangeManifest} from '@/shared/resume-actions'
import type {ResumeCompletionDocument} from '@/shared/resume-completion'
import {projectResumeHistoryScore} from '@/services/resume-history-score'
import {projectHistoryInterviewPresentation} from '@/services/interview-history-presentation'

const resultStepStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('generating'),
  t.Literal('done'),
  t.Literal('failed'),
])

const resultContextSchema = t.Object({
  company: t.String({ description: '公司名称' }),
  position: t.String({ description: '岗位名称' }),
  location: t.Optional(t.String({ description: '工作地点' })),
  resumeContent: t.String({ description: '原始简历内容' }),
  jdContent: t.String({ description: 'JD 内容' }),
  resumeParseId: t.Optional(t.String({format: 'uuid'})),
  jdParseId: t.Optional(t.String({format: 'uuid'})),
})

const progressSchema = t.Object({
  analysis: resultStepStatusSchema,
  matching: resultStepStatusSchema,
  optimized: resultStepStatusSchema,
  interview: t.Optional(resultStepStatusSchema),
})

const resumeHistoryBodySchema = t.Object({
  id: t.Optional(t.Union([t.String({ description: '历史记录 ID' }), t.Null()])),
  position: t.String({ description: '岗位名称', minLength: 1 }),
  company: t.String({ description: '公司名称', minLength: 1 }),
  name: t.String({ description: '候选人姓名，缺失时为空' }),
  created_at: t.String({ description: '生成时间 ISO 字符串', minLength: 1 }),
  quality_score: t.Number({ description: '简历质量评分' }),
  match_score: t.Union([t.Number({ description: '岗位匹配评分' }), t.Null()]),
  tags: t.Array(t.String(), { description: '卡片标签' }),
  resume_content: t.String({ description: '原始简历内容' }),
  jd_content: t.String({ description: 'JD 内容' }),
  optimized_content: t.String({ description: '优化后的简历内容' }),
  optimization_suggestions: t.Optional(t.Array(t.String())),
  changes_summary: t.Optional(t.Array(t.String())),
  process_result: t.Optional(t.Any({ description: '完整生成结果快照' })),
  completion_edit: t.Optional(t.Unknown({description: '可核对的填写操作记录'})),
  commit_id: t.Optional(t.String({minLength: 8, maxLength: 128})),
  expected_document: t.Optional(t.Object({documentId: t.String(), revision: t.Number({minimum: 0}), resolvedDigest: t.Optional(t.String())})),
  result_context: t.Optional(resultContextSchema),
  progress: t.Optional(progressSchema),
  card_color: t.Optional(t.Union([t.String(), t.Null()])),
  card_pattern: t.Optional(t.Union([t.String(), t.Null()])),
})

const resumeHistoryUpdateBodySchema = t.Object({
  position: t.Optional(t.String({ description: '岗位名称', minLength: 1 })),
  company: t.Optional(t.String({ description: '公司名称', minLength: 1 })),
  name: t.Optional(t.String({ description: '候选人姓名，缺失时为空' })),
  created_at: t.Optional(t.String({ description: '生成时间 ISO 字符串', minLength: 1 })),
  quality_score: t.Optional(t.Number({ description: '简历质量评分' })),
  match_score: t.Optional(t.Union([t.Number({ description: '岗位匹配评分' }), t.Null()])),
  tags: t.Optional(t.Array(t.String(), { description: '卡片标签' })),
  resume_content: t.Optional(t.String({ description: '原始简历内容' })),
  jd_content: t.Optional(t.String({ description: 'JD 内容' })),
  optimized_content: t.Optional(t.String({ description: '优化后的简历内容' })),
  optimization_suggestions: t.Optional(t.Array(t.String())),
  changes_summary: t.Optional(t.Array(t.String())),
  process_result: t.Optional(t.Any({ description: '完整生成结果快照' })),
  completion_edit: t.Optional(t.Unknown({description: '可核对的填写操作记录'})),
  commit_id: t.Optional(t.String({minLength: 8, maxLength: 128})),
  expected_document: t.Optional(t.Object({documentId: t.String(), revision: t.Number({minimum: 0}), resolvedDigest: t.Optional(t.String())})),
  result_context: t.Optional(resultContextSchema),
  progress: t.Optional(progressSchema),
  card_color: t.Optional(t.Union([t.String(), t.Null()])),
  card_pattern: t.Optional(t.Union([t.String(), t.Null()])),
})

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

function toCompletionErrorResponse(error: ResumeCompletionSnapshotError | ResumeHistoryCommitError, set: {status?: unknown}) {
  set.status = error.status
  return {success: false, error: {code: error.code, message: error.message}} satisfies ApiResponse<never>
}

function extractLocation(record: ResumeHistoryRecord) {
  const location = record.result_context?.location?.trim()
  if (location) return location

  const match = record.jd_content.match(
    /(?:工作地点|工作地|办公地点|办公地|地点|城市|Base地|base地|Base|base)[：:]\s*(.+?)(?:\n|\r|$)/i,
  )
  return match?.[1]?.trim() || '--'
}

export function toSummary(record: ResumeHistoryRecord): ResumeHistorySummaryRecord {
  record = projectResumeHistoryScore(record)
  const processResult = record.process_result as {
    matching?: {optimization_suggestions?: string[]}
    optimized?: {strategy_review?: unknown}
    analysis?: {suggestions?: string[]}
  } | undefined
  const summary = buildResumeValueSummary({
    markdown: record.optimized_content,
    review: processResult?.optimized?.strategy_review,
    advice: [record.optimization_suggestions, processResult?.matching?.optimization_suggestions,
      processResult?.analysis?.suggestions].flatMap(values => Array.isArray(values) ? values : []),
  })

  return {
    id: record.id,
    position: record.position,
    company: record.company,
    name: record.name,
    created_at: record.created_at,
    updated_at: record.updated_at,
    quality_score: record.quality_score,
    match_score: record.match_score,
    tags: record.tags,
    location: extractLocation(record),
    strategy_title: summary.title,
    strategy_body: summary.body,
    ...(record.card_color ? {card_color: record.card_color} : {}),
    ...(record.card_pattern ? {card_pattern: record.card_pattern} : {}),
  }
}

/** P10 generation basis is repository data and cannot become an editable public sidecar. */
export function publicResumeHistory(record: ResumeHistoryRecord): ResumeHistoryRecord {
  record = projectResumeHistoryScore(record)
  record = projectHistoryInterviewPresentation(record)
  if (!record.process_result || typeof record.process_result !== 'object' || Array.isArray(record.process_result)) return record
  const {server_interview_basis: _privateBasis, server_completion_upgrade_archive: _privateArchive, ...processResult} = record.process_result as Record<string, unknown>
  const optimized = processResult.optimized && typeof processResult.optimized === 'object' && !Array.isArray(processResult.optimized)
    ? processResult.optimized as Record<string, unknown> : undefined
  if (!optimized?.completion_document) return {...record, process_result: processResult}
  const delivery = assessResumeDelivery({document: optimized.completion_document as ResumeCompletionDocument,
    identity: optimized.identity_state as ResumeIdentityState | undefined, review: optimized.action_review as ResumeActionReview | undefined,
    resolvedPlan: optimized.resolved_action_plan as ResolvedResumeActionPlan | undefined, changeManifest: optimized.change_manifest as ResumeChangeManifest | undefined, previous: optimized.delivery_state})
  return {...record, process_result: {...processResult, optimized: {...optimized, delivery_state: delivery}}}
}

export const resumeHistoryRoutes = new Elysia({ prefix: '/api/v1/resume-history' })
  .get(
    '/',
    async ({ headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const response: ApiResponse<ResumeHistoryRecord[]> = {
          success: true,
          data: (await resumeHistoryRepository.list(userContext)).map(publicResumeHistory),
        }

        return response
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        console.error('获取生成卡片历史失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_LIST_FAILED',
            message: '获取生成卡片历史失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      detail: {
        summary: '获取生成卡片历史',
        description: '返回已生成的一岗一简历卡片历史，用于首页卡片列表展示。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .get(
    '/summaries',
    async ({ headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const response: ApiResponse<ResumeHistorySummaryRecord[]> = {
          success: true,
          data: (await resumeHistoryRepository.list(userContext)).map(toSummary),
        }

        return response
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        console.error('获取生成卡片摘要失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_SUMMARY_LIST_FAILED',
            message: '获取生成卡片摘要失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      detail: {
        summary: '获取生成卡片摘要',
        description: '只返回首页卡片展示所需的元数据和策略摘要。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const document = completionDocumentFromSnapshot(body.process_result)
        const existing = body.id ? await resumeHistoryRepository.findById(userContext, body.id) : null
        const bundle = !existing && document && document.schemaVersion !== 'resume-completion-v1'
          ? await loadCompletionBaselineBundle(userContext.userId, body.process_result) : undefined
        const result = await resumeHistoryRepository.save(userContext, {...body, completion_baseline: bundle?.document, action_baseline: bundle?.actionBaseline})

        const response: ApiResponse<ResumeHistoryRecord> = {
          success: true,
          data: publicResumeHistory(result),
        }

        return response
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        if (error instanceof ResumeCompletionSnapshotError || error instanceof ResumeHistoryCommitError) return toCompletionErrorResponse(error, set)
        console.error('保存生成卡片历史失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'RESUME_HISTORY_SAVE_FAILED',
            message: '保存生成卡片历史失败，请稍后重试',
          },
        }

        return response
      }
    },
    {
      body: resumeHistoryBodySchema,
      detail: {
        summary: '保存生成卡片历史',
        description: '保存结果页生成的完整历史快照，供首页重新拉取。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .post('/:id/completion-upgrade', async ({params, body, headers, set}) => {
    try {
      const context = await resolveRequestUser(headers)
      const history = await resumeHistoryRepository.findById(context, params.id)
      if (!history) {set.status = 404; return {success: false, error: {code: 'RESUME_HISTORY_NOT_FOUND', message: '生成历史不存在或已删除'}}}
      const next = upgradeResumeCompletion(history, body.expected_document)
      const saved = next === history ? history : await resumeHistoryRepository.upgradeCompletion(context, history, next)
      set.headers['Cache-Control'] = 'no-store'
      return {success: true, data: publicResumeHistory(saved)} satisfies ApiResponse<ResumeHistoryRecord>
    } catch (error) {
      if (error instanceof RequestAuthError) return toAuthErrorResponse(error, set)
      if (error instanceof ResumeCompletionSnapshotError || error instanceof ResumeHistoryCommitError) return toCompletionErrorResponse(error, set)
      console.error('填写文档升级失败:', error instanceof Error ? error.name : 'unknown')
      set.status = 500
      return {success: false, error: {code: 'RESUME_COMPLETION_UPGRADE_FAILED', message: '当前稿升级暂未完成，原始内容与填写已保留'}} satisfies ApiResponse<never>
    }
  }, {body: t.Object({expected_document: t.Object({documentId: t.String({minLength: 1}), revision: t.Number({minimum: 0}), digest: t.String({minLength: 1})})}),
    detail: {summary: '升级填写文档', description: '对归属当前用户的旧填写文档执行幂等、无模型调用的兼容升级。', tags: ['ResumeHistory']}})
  .get('/:id/action-review', async ({params, headers, query, set}) => {
    try {
      const context = await resolveRequestUser(headers)
      const history = await resumeHistoryRepository.findById(context, params.id)
      if (!history) {set.status = 404; return {success: false, error: {code: 'RESUME_HISTORY_NOT_FOUND', message: '生成历史不存在'}}}
      const sidecar = reviewSidecar(history)
      if (query.revision !== undefined && Number(query.revision) !== sidecar.review?.revision) {set.status = 409; return {success: false, error: {code: 'RESUME_VERSION_CONFLICT', message: '当前稿已更新'}}}
      set.headers['Cache-Control'] = 'no-store'
      return {success: true, data: {action_review: sidecar.review ?? null}}
    } catch (error) {
      if (error instanceof RequestAuthError) return toAuthErrorResponse(error, set)
      set.status = 500; return {success: false, error: {code: 'RESUME_REVIEW_UNAVAILABLE', message: '暂时无法获取核对状态'}}
    }
  }, {query: t.Object({revision: t.Optional(t.String())})})
  .get(
    '/:id',
    async ({ params, headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const result = await resumeHistoryRepository.findById(userContext, params.id)

        if (!result) {
          set.status = 404
          return {
            success: false,
            error: {
              code: 'RESUME_HISTORY_NOT_FOUND',
              message: '生成卡片历史不存在或已删除',
            },
          } satisfies ApiResponse<never>
        }

        return {
          success: true,
          data: publicResumeHistory(result),
        } satisfies ApiResponse<ResumeHistoryRecord>
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        console.error('获取单条生成卡片历史失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_GET_FAILED',
            message: '获取生成卡片历史失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      params: t.Object({
        id: t.String({ description: '历史记录 ID', minLength: 1 }),
      }),
      detail: {
        summary: '获取单条生成卡片历史',
        description: '按 ID 返回生成历史详情，用于结果页详情还原。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .put(
    '/:id',
    async ({ params, body, headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const result = await resumeHistoryRepository.update(userContext, params.id, {...body, completion_baseline: undefined})

        if (!result) {
          set.status = 404
          return {
            success: false,
            error: {
              code: 'RESUME_HISTORY_NOT_FOUND',
              message: '生成卡片历史不存在或已删除',
            },
          } satisfies ApiResponse<never>
        }

        return {
          success: true,
          data: publicResumeHistory(result),
        } satisfies ApiResponse<ResumeHistoryRecord>
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        if (error instanceof ResumeCompletionSnapshotError || error instanceof ResumeHistoryCommitError) return toCompletionErrorResponse(error, set)
        console.error('更新生成卡片历史失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_UPDATE_FAILED',
            message: '更新生成卡片历史失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      params: t.Object({
        id: t.String({ description: '历史记录 ID', minLength: 1 }),
      }),
      body: resumeHistoryUpdateBodySchema,
      detail: {
        summary: '更新生成卡片历史',
        description: '更新指定生成历史的元信息或结果快照。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .delete(
    '/',
    async ({ headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const deleted = await resumeHistoryRepository.clear(userContext)
        clearOwnerResumeExtractionCache(userContext.userId)

        return {
          success: true,
          data: { deleted },
        } satisfies ApiResponse<{ deleted: number }>
      } catch (error) {
        if (error instanceof RequestAuthError) {
          return toAuthErrorResponse(error, set)
        }

        console.error('清空生成卡片历史失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_CLEAR_FAILED',
            message: '清空生成卡片历史失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      detail: {
        summary: '清空生成卡片历史',
        description: '清空所有生成历史，用于历史记录管理。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .delete(
    '/:id',
    async ({ params, headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        const deleted = await resumeHistoryRepository.delete(userContext, params.id)
        if (deleted) clearOwnerResumeExtractionCache(userContext.userId)

        if (!deleted) {
          set.status = 404
          return {
            success: false,
            error: {
              code: 'RESUME_HISTORY_NOT_FOUND',
              message: '生成卡片历史不存在或已删除',
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

        console.error('删除生成卡片历史失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_DELETE_FAILED',
            message: '删除生成卡片历史失败，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      params: t.Object({
        id: t.String({ description: '历史记录 ID', minLength: 1 }),
      }),
      detail: {
        summary: '删除生成卡片历史',
        description: '删除指定生成历史记录。',
        tags: ['ResumeHistory'],
      },
    }
  )
