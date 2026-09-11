import type { StepRunSnapshot } from '@/harness/run-step'
import { Elysia, t } from 'elysia'
import { RequestAuthError, resolveRequestUser } from '@/auth/request-context'
import { getV5ReleaseDescriptor } from '@/v5/release'
import { getBusinessEvaluationErrorDetails } from '@/harness/business-recovery'
import { recoveryAdviceForErrorCode } from '@/harness/recovery-advice'
import { HarnessRunRepository } from '@/repositories/harness-run-repository'
import { getHarnessDatabaseHealth } from '@/repositories/database'
import { normalizeMarkdownText } from '@/services/text-normalizer'
import { isLandingPresetJobId, resolveLandingPresetJob } from '@/config/landing-presets'
import { ResumeOptimizationWorkflow } from '@/workflows/resume-optimization-workflow'
import { V5CheckpointError } from '@/repositories/v5-checkpoint-repository'
import { v5SingleStepAdapter } from '@/v5/single-step-adapter'
import { V5_WORKFLOW_VERSION } from '@/v5/types'
import { V5WorkflowBlockedError } from '@/v5/errors'
import type { ApiResponse, MvpProcessResponse } from '@/types'
import {consumeResumeQuota, ensureResumeQuotaAvailable, ResumeQuotaError} from '@/services/resume-quota'

function getHarnessRunRepository() {
  return new HarnessRunRepository()
}

function buildErrorPayload(code: string, fallbackMessage: string, error: unknown): ApiResponse<never>['error'] {
  const errorCode = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
  const details = error instanceof V5WorkflowBlockedError
    ? {
        agent_state: error.state,
        issue_codes: [...new Set(error.issues.map(item => item.code))],
        retryable: error.retryable,
        run_id: error.runId,
      }
    : getBusinessEvaluationErrorDetails(error)
  const recoveryAdvice = recoveryAdviceForErrorCode(errorCode)
  return {
    code,
    message: fallbackMessage,
    details: {
      ...(details && typeof details === 'object' && !Array.isArray(details) ? details : {}),
      ...(errorCode ? { error_code: errorCode } : {}),
        recovery_advice: recoveryAdvice,
        ...(error instanceof V5WorkflowBlockedError && error.providerStatus
          ? { provider_status: error.providerStatus }
          : {}),
    },
  }
}

export function buildMvpProcessErrorResponse(error: unknown) {
  const status = error instanceof V5WorkflowBlockedError ? error.httpStatus : 500
  const message = error instanceof V5WorkflowBlockedError
    ? error.state === 'provider_failure'
      ? error.retryable
        ? '模型服务暂时不可用'
        : '模型请求未完成'
      : error.state === 'workflow_failure'
        ? '服务处理异常'
        : error.state === 'blocked_quality_validation'
          ? '本次结果未达到可投递质量标准，已停止交付不完整简历'
          : '生成结果未通过本地事实或结构安全校验'
    : '处理失败'
  return {
    status,
    response: {
      success: false,
      error: buildErrorPayload(
        error instanceof V5WorkflowBlockedError ? error.code : 'PROCESS_FAILED',
        message,
        error
      ),
    } satisfies ApiResponse<never>,
  }
}

function singleStepFailure(error: unknown, code: string, message: string) {
  if (error instanceof RequestAuthError || error instanceof ResumeQuotaError || error instanceof V5CheckpointError) {
    return {status: error.status, response: {success: false, error: {
      code: error.code, message: error.message,
      ...(error instanceof ResumeQuotaError ? {details: {limit: error.limit, used: error.used}} : {}),
    }} satisfies ApiResponse<never>}
  }
  return {status: error instanceof V5WorkflowBlockedError ? error.httpStatus : 500,
    response: {success: false, error: buildErrorPayload(code, message, error)} satisfies ApiResponse<never>}
}

function singleStepSuccess<T>(result: {runId: string; data: T; steps: StepRunSnapshot[]}, startedAt: number) {
  return {success: true, data: result.data, meta: {harness: {
    run_id: result.runId, workflow_version: V5_WORKFLOW_VERSION, workflow_status: 'succeeded', step_statuses: result.steps, duration_ms: Date.now() - startedAt,
  }}} satisfies ApiResponse<T>
}

async function stepOwner(headers: Record<string, string | undefined>, landing: boolean) {
  return landing ? 'guest' : (await resolveRequestUser(headers)).userId
}

/**
 * MVP 路由
 * 提供完整的简历优化流程接口
 */
export const mvpRoutes = new Elysia({ prefix: '/api/v1/mvp' })
  .onBeforeHandle(async ({ headers, path, body, set }) => {
    if (path === '/api/v1/mvp/health') {
      return
    }

    const requestBody = body && typeof body === 'object'
      ? body as Record<string, unknown>
      : null
    const isGuestLandingRequest = (
      path === '/api/v1/mvp/analyze'
      && requestBody?.landing === true
    ) || (
      path === '/api/v1/mvp/match'
      && requestBody?.landing === true
      && isLandingPresetJobId(requestBody?.preset_jd_id)
    ) || (
      (path === '/api/v1/mvp/generate' || path === '/api/v1/mvp/interview')
      && requestBody?.landing === true
      && isLandingPresetJobId(requestBody?.preset_jd_id)
    )

    if (isGuestLandingRequest) {
      return
    }

    try {
      await resolveRequestUser(headers)
    } catch (error) {
      if (!(error instanceof RequestAuthError)) {
        throw error
      }

      set.status = error.status
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      } satisfies ApiResponse<never>
    }
  })
  /**
   * POST /api/v1/mvp/process
   * 多步统一测试入口：简历分析 -> 匹配分析 -> 简历生成 -> 面试建议。
   * 前端生产流程继续使用 /analyze、/match、/generate、/interview 单步接口。
   */
  .post(
    '/process',
    async ({ body, headers, set }) => {
      try {
        const userContext = await resolveRequestUser(headers)
        await ensureResumeQuotaAvailable(userContext)
        const { enable_llm_judge, output_language } = body
        const resume_markdown = normalizeMarkdownText(body.resume_markdown)
        const jd_text = normalizeMarkdownText(body.jd_text)

        const workflow = new ResumeOptimizationWorkflow()
        const result = await workflow.run({
          resume_markdown,
          jd_text,
          enable_llm_judge,
          output_language,
          onAnalysisSucceeded: async () => {
            await consumeResumeQuota(userContext)
          },
        })

        const response: ApiResponse<MvpProcessResponse> = {
          success: true,
          data: result,
        }

        return response
      } catch (error) {
        if (error instanceof ResumeQuotaError) {
          set.status = error.status
          return {success: false, error: {code: error.code, message: error.message, details: {limit: error.limit, used: error.used}}} satisfies ApiResponse<never>
        }
        if (error instanceof V5WorkflowBlockedError) {
          console.error('流程处理失败:', {
            code: error.code,
            state: error.state,
            runId: error.runId,
            issueCodes: [...new Set(error.issues.map(item => item.code))],
          })
        } else {
          console.error('流程处理失败:', error)
        }
        const failure = buildMvpProcessErrorResponse(error)
        set.status = failure.status
        return failure.response
      }
    },
    {
      body: t.Object({
        resume_markdown: t.String({
          description: 'Markdown 格式的简历内容',
          minLength: 10,
        }),
        jd_text: t.String({
          description: '岗位描述（JD）文本',
          minLength: 10,
        }),
        enable_llm_judge: t.Optional(t.Boolean({
          description: '兼容保留字段；V5 放行由本地代码控制，不会触发额外的 LLM Judge。',
        })),
        output_language: t.Optional(t.String({
          description: 'v5 输出语言偏好，例如 zh-CN 或 en-US。',
          minLength: 2,
          maxLength: 32,
        })),
      }),
      detail: {
        summary: 'MVP 多步统一测试流程',
        description: '仅用于多步工作流测试和回归验证，固定执行 V5 R2；前端生产流程不调用此接口，继续使用单步接口。',
        tags: ['MVP'],
      },
    }
  )

  /**
   * GET /api/v1/mvp/dashboard
   * Harness 质量指标概览
   */
  .get(
    '/dashboard',
    async () => ({
      success: true,
      data: await getHarnessRunRepository().getDashboardMetrics(),
    }),
    {
      detail: {
        summary: 'Harness 指标概览',
        description: '返回 run 状态、step 状态、attempt 延迟/token 和失败样本数量等基础指标',
        tags: ['MVP'],
      },
    }
  )

  /**
   * GET /api/v1/mvp/regression-dataset
   * 导出失败/部分成功运行的回归数据集摘要
   */
  .get(
    '/regression-dataset',
    async ({ query }) => ({
      success: true,
      data: await getHarnessRunRepository().buildRegressionDataset(Number(query.limit ?? 20)),
    }),
    {
      query: t.Object({
        limit: t.Optional(t.String({ description: '最多导出条数，默认 20' })),
      }),
      detail: {
        summary: '导出 Harness 回归数据集',
        description: '基于 failed/partial run 的事件流、摘要 artifact 和 evaluation 生成回归数据集',
        tags: ['MVP'],
      },
    }
  )

  /**
   * GET /api/v1/mvp/runs/:run_id
   * 查询 Harness 运行记录
   */
  .get(
    '/runs/:run_id',
    async ({ params, set }) => {
      const result = await getHarnessRunRepository().getRun(params.run_id)

      if (!result) {
        set.status = 404
        return {
          success: false,
          error: {
            code: 'RUN_NOT_FOUND',
            message: '未找到对应运行记录',
          },
        }
      }

      return {
        success: true,
        data: result,
      }
    },
    {
      params: t.Object({
        run_id: t.String({ description: 'Harness runId' }),
      }),
      detail: {
        summary: '查询 Harness 运行记录',
        description: '按 runId 查询流程状态、step、attempt、artifact、evaluation 和事件流摘要',
        tags: ['MVP'],
      },
    }
  )

  /**
   * GET /api/v1/mvp/runs/:run_id/replay
   * 按事件流 replay 一次 run
   */
  .get(
    '/runs/:run_id/replay',
    async ({ params, set }) => {
      const result = await getHarnessRunRepository().replayRun(params.run_id)

      if (!result) {
        set.status = 404
        return {
          success: false,
          error: {
            code: 'RUN_NOT_FOUND',
            message: '未找到对应运行记录',
          },
        }
      }

      return {
        success: true,
        data: result,
      }
    },
    {
      params: t.Object({
        run_id: t.String({ description: 'Harness runId' }),
      }),
      detail: {
        summary: 'Replay Harness 事件流',
        description: '按 runId 返回可重放的事件流，不包含完整简历/JD/prompt 原文',
        tags: ['MVP'],
      },
    }
  )

  /**
   * POST /api/v1/mvp/runs/:run_id/failure-samples
   * 将失败样本回流到回归数据集
   */
  .post(
    '/runs/:run_id/failure-samples',
    async ({ params, body, set }) => {
      const result = await getHarnessRunRepository().createFailureSample(params.run_id, body.reason)

      if (!result) {
        set.status = 404
        return {
          success: false,
          error: {
            code: 'RUN_NOT_FOUND',
            message: '未找到对应运行记录',
          },
        }
      }

      return {
        success: true,
        data: result,
      }
    },
    {
      params: t.Object({
        run_id: t.String({ description: 'Harness runId' }),
      }),
      body: t.Object({
        reason: t.Optional(t.String({ description: '回流原因' })),
      }),
      detail: {
        summary: '回流失败样本',
        description: '把 run 的摘要和事件流标记为失败样本，用于后续回归数据集',
        tags: ['MVP'],
      },
    }
  )

  /**
   * POST /api/v1/mvp/analyze
   * 单独调用：仅分析简历
   */
  .post(
    '/analyze',
    async ({ body, headers, set }) => {
      const startedAt = Date.now()
      try {
        const user = body.landing === true ? null : await resolveRequestUser(headers)
        if (user) await ensureResumeQuotaAvailable(user)
        const result = await v5SingleStepAdapter.analyze(normalizeMarkdownText(body.resume_markdown), user?.userId ?? 'guest')
        if (user) await consumeResumeQuota(user)
        return singleStepSuccess(result, startedAt)
      } catch (error) {
        const failure = singleStepFailure(error, 'ANALYSIS_FAILED', '分析失败')
        set.status = failure.status
        return failure.response
      }
    },
    {
      body: t.Object({
        resume_markdown: t.String({
          description: 'Markdown 格式的简历内容',
          minLength: 10,
        }),
        landing: t.Optional(t.Boolean({
          description: '是否为未登录 Landing 体验流程',
        })),
      }),
      detail: {
        summary: '分析简历',
        description: '执行 V5 P01/P01R 简历分析并返回兼容结构；结构中的上下文句柄需原样透传给后续接口',
        tags: ['MVP', 'Analysis'],
      },
    }
  )

  /**
   * POST /api/v1/mvp/match
   * 单独调用：基于结构化简历和 JD 执行匹配分析
   */
  .post(
    '/match',
    async ({ body, headers, set }) => {
      const startedAt = Date.now()
      try {
        const presetJob = resolveLandingPresetJob(body.preset_jd_id)
        const jd = normalizeMarkdownText(presetJob || body.jd_text || '')
        if (jd.trim().length < 10) {
          set.status = 400
          return {success: false, error: {code: 'INVALID_JD', message: '请提供有效的目标岗位描述'}}
        }
        const owner = await stepOwner(headers, body.landing === true && isLandingPresetJobId(body.preset_jd_id))
        return singleStepSuccess(await v5SingleStepAdapter.match(body.structured_resume, jd, owner), startedAt)
      } catch (error) {
        const failure = singleStepFailure(error, 'MATCH_FAILED', '匹配分析失败')
        set.status = failure.status
        return failure.response
      }
    },
    {
      body: t.Object({
        structured_resume: t.Any({
          description: '结构化简历数据',
        }),
        jd_text: t.Optional(t.String({
          description: '岗位描述（JD）文本',
          minLength: 10,
        })),
        preset_jd_id: t.Optional(t.String({
          description: 'Landing 预设岗位 ID',
        })),
        landing: t.Optional(t.Boolean({description: '是否为未登录 Landing 体验流程'})),
      }),
      detail: {
        summary: '匹配分析',
        description: '基于 V5 服务端简历检查点执行 P02/P03；保持结构化简历与 JD 请求格式',
        tags: ['MVP', 'Matching'],
      },
    }
  )

  /**
   * POST /api/v1/mvp/generate
   * 单独调用：基于匹配分析生成优化简历
   */
  .post(
    '/generate',
    async ({ body, headers, set }) => {
      const startedAt = Date.now()
      try {
        const owner = await stepOwner(headers, body.landing === true && isLandingPresetJobId(body.preset_jd_id))
        return singleStepSuccess(await v5SingleStepAdapter.generate(body.structured_resume, body.matching, owner), startedAt)
      } catch (error) {
        const failure = singleStepFailure(error, 'GENERATE_FAILED', '简历生成失败')
        set.status = failure.status
        return failure.response
      }
    },
    {
      body: t.Object({
        structured_resume: t.Any({
          description: '结构化简历数据',
        }),
        matching: t.Any({
          description: '匹配分析结果，需包含 jd_structure',
        }),
        landing: t.Optional(t.Boolean({description: '是否为未登录 Landing 体验流程'})),
        preset_jd_id: t.Optional(t.String({description: 'Landing 预设岗位 ID'})),
      }),
      detail: {
        summary: '生成优化简历',
        description: '从 V5 匹配检查点继续执行 R5 Writer 和交付门禁，不重复分析与匹配',
        tags: ['MVP', 'Generation'],
      },
    }
  )

  /**
   * POST /api/v1/mvp/interview
   * 单独调用：基于优化后的简历生成面试建议
   */
  .post(
    '/interview',
    async ({ body, headers, set }) => {
      const startedAt = Date.now()
      try {
        const owner = await stepOwner(headers, body.landing === true && isLandingPresetJobId(body.preset_jd_id))
        return singleStepSuccess(await v5SingleStepAdapter.interview(body.analysis, body.matching, body.optimized_resume, owner), startedAt)
      } catch (error) {
        const failure = singleStepFailure(error, 'INTERVIEW_FAILED', '面试建议生成失败')
        set.status = failure.status
        return failure.response
      }
    },
    {
      body: t.Object({
        analysis: t.Any({
          description: '简历分析结果',
        }),
        matching: t.Any({
          description: '岗位匹配分析结果',
        }),
        optimized_resume: t.String({
          description: '优化后的 Markdown 简历',
          minLength: 10,
        }),
        landing: t.Optional(t.Boolean({description: '是否为未登录 Landing 体验流程'})),
        preset_jd_id: t.Optional(t.String({description: 'Landing 预设岗位 ID'})),
      }),
      detail: {
        summary: '生成面试建议',
        description: '基于已交付的 V5 简历执行按需 P10/P10R 面试建议；不自动加入 /process',
        tags: ['MVP', 'Interview'],
      },
    }
  )

  /**
   * GET /api/v1/mvp/health
   * 健康检查接口
   */
  .get(
    '/health',
    () => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'reffo-mvp',
        generation: getV5ReleaseDescriptor(),
        dependencies: {
          harnessDatabase: getHarnessDatabaseHealth(),
        },
      }
    },
    {
      detail: {
        summary: '健康检查',
        description: '检查服务是否正常运行',
        tags: ['System'],
      },
    }
  )
