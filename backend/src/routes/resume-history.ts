import { Elysia, t } from 'elysia'
import { resumeHistoryRepository } from '@/repositories/resume-history-repository'
import type { ApiResponse, ResumeHistoryRecord } from '@/types'

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
  name: t.String({ description: '候选人姓名', minLength: 1 }),
  created_at: t.String({ description: '生成时间 ISO 字符串', minLength: 1 }),
  quality_score: t.Number({ description: '简历质量评分' }),
  match_score: t.Number({ description: '岗位匹配评分' }),
  tags: t.Array(t.String(), { description: '卡片标签' }),
  resume_content: t.String({ description: '原始简历内容' }),
  jd_content: t.String({ description: 'JD 内容' }),
  optimized_content: t.String({ description: '优化后的简历内容' }),
  optimization_suggestions: t.Optional(t.Array(t.String())),
  changes_summary: t.Optional(t.Array(t.String())),
  process_result: t.Optional(t.Any({ description: '完整生成结果快照' })),
  result_context: t.Optional(resultContextSchema),
  progress: t.Optional(progressSchema),
  card_color: t.Optional(t.Union([t.String(), t.Null()])),
  card_pattern: t.Optional(t.Union([t.String(), t.Null()])),
})

const resumeHistoryUpdateBodySchema = t.Object({
  position: t.Optional(t.String({ description: '岗位名称', minLength: 1 })),
  company: t.Optional(t.String({ description: '公司名称', minLength: 1 })),
  name: t.Optional(t.String({ description: '候选人姓名', minLength: 1 })),
  created_at: t.Optional(t.String({ description: '生成时间 ISO 字符串', minLength: 1 })),
  quality_score: t.Optional(t.Number({ description: '简历质量评分' })),
  match_score: t.Optional(t.Number({ description: '岗位匹配评分' })),
  tags: t.Optional(t.Array(t.String(), { description: '卡片标签' })),
  resume_content: t.Optional(t.String({ description: '原始简历内容' })),
  jd_content: t.Optional(t.String({ description: 'JD 内容' })),
  optimized_content: t.Optional(t.String({ description: '优化后的简历内容' })),
  optimization_suggestions: t.Optional(t.Array(t.String())),
  changes_summary: t.Optional(t.Array(t.String())),
  process_result: t.Optional(t.Any({ description: '完整生成结果快照' })),
  result_context: t.Optional(resultContextSchema),
  progress: t.Optional(progressSchema),
  card_color: t.Optional(t.Union([t.String(), t.Null()])),
  card_pattern: t.Optional(t.Union([t.String(), t.Null()])),
})

export const resumeHistoryRoutes = new Elysia({ prefix: '/api/v1/resume-history' })
  .get(
    '/',
    () => {
      const response: ApiResponse<ResumeHistoryRecord[]> = {
        success: true,
        data: resumeHistoryRepository.list(),
      }

      return response
    },
    {
      detail: {
        summary: '获取生成卡片历史',
        description: '返回已生成的一岗一简历卡片历史，用于首页卡片列表展示。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .post(
    '/',
    ({ body, set }) => {
      try {
        const result = resumeHistoryRepository.save(body)

        const response: ApiResponse<ResumeHistoryRecord> = {
          success: true,
          data: result,
        }

        return response
      } catch (error) {
        console.error('保存生成卡片历史失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'RESUME_HISTORY_SAVE_FAILED',
            message: error instanceof Error ? error.message : '保存生成卡片历史失败',
          },
        }

        return response
      }
    },
    {
      body: resumeHistoryBodySchema,
      detail: {
        summary: '保存生成卡片历史',
        description: '保存结果页生成的完整历史快照，并写入 SQLite 供首页重新拉取。',
        tags: ['ResumeHistory'],
      },
    }
  )
  .get(
    '/:id',
    ({ params, set }) => {
      const result = resumeHistoryRepository.findById(params.id)

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
        data: result,
      } satisfies ApiResponse<ResumeHistoryRecord>
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
    ({ params, body, set }) => {
      try {
        const result = resumeHistoryRepository.update(params.id, body)

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
          data: result,
        } satisfies ApiResponse<ResumeHistoryRecord>
      } catch (error) {
        console.error('更新生成卡片历史失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_UPDATE_FAILED',
            message: error instanceof Error ? error.message : '更新生成卡片历史失败',
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
    () => {
      const deleted = resumeHistoryRepository.clear()

      return {
        success: true,
        data: { deleted },
      } satisfies ApiResponse<{ deleted: number }>
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
    ({ params, set }) => {
      try {
        const deleted = resumeHistoryRepository.delete(params.id)

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
        console.error('删除生成卡片历史失败:', error)
        set.status = 500

        return {
          success: false,
          error: {
            code: 'RESUME_HISTORY_DELETE_FAILED',
            message: error instanceof Error ? error.message : '删除生成卡片历史失败',
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
