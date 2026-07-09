import { Elysia, t } from 'elysia'
import { JDParserAgent } from '@/agents/jd-parser'
import { ResumeAnalyzerAgent } from '@/agents/resume-analyzer'
import { MatchingAgent } from '@/agents/matching-agent'
import { ResumeGeneratorAgent } from '@/agents/resume-generator'
import { InterviewAdvisorAgent } from '@/agents/interview-advisor'
import { ResumeRevisionAgent } from '@/agents/resume-revision'
import { createHarnessEvent } from '@/harness/events'
import {
  evaluateInterviewSuggestionsBusiness,
  evaluateMatchAnalysisBusiness,
  evaluateResumeAnalysisBusiness,
  evaluateSourceResumeForGeneration,
} from '@/harness/evaluators/business-evaluators'
import { assertBusinessEvaluation, publishEvaluationCompleted } from '@/harness/evaluators/evaluation-events'
import { evaluateMarkdownResume } from '@/harness/evaluators/markdown-resume-evaluator'
import { runHarnessedRequest, runHarnessedStep } from '@/harness/harnessed-request'
import { buildQualityGateAttempt, classifyAttemptResult, decideNextAction } from '@/harness/runtime-state'
import { runStep } from '@/harness/run-step'
import { HarnessRunRepository } from '@/repositories/harness-run-repository'
import { normalizeMarkdownText } from '@/services/text-normalizer'
import { ResumeOptimizationWorkflow } from '@/workflows/resume-optimization-workflow'
import type { ApiResponse, MvpProcessResponse } from '@/types'

function getHarnessRunRepository() {
  return new HarnessRunRepository()
}

/**
 * MVP 路由
 * 提供完整的简历优化流程接口
 */
export const mvpRoutes = new Elysia({ prefix: '/api/v1/mvp' })
  /**
   * POST /api/v1/mvp/process
   * 完整流程：简历分析 -> 匹配分析 -> 简历生成 -> 面试建议
   */
  .post(
    '/process',
    async ({ body, set }) => {
      try {
        const { prompt_variant, enable_llm_judge } = body
        const resume_markdown = normalizeMarkdownText(body.resume_markdown)
        const jd_text = normalizeMarkdownText(body.jd_text)

        const workflow = new ResumeOptimizationWorkflow()
        const result = await workflow.run({ resume_markdown, jd_text, prompt_variant, enable_llm_judge })

        const response: ApiResponse<MvpProcessResponse> = {
          success: true,
          data: result,
        }

        return response
      } catch (error) {
        console.error('流程处理失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'PROCESS_FAILED',
            message: error instanceof Error ? error.message : '处理失败',
          },
        }

        return response
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
        prompt_variant: t.Optional(t.Union([t.Literal('v1'), t.Literal('v2')], {
          description: 'Prompt A/B 版本，默认 v1',
        })),
        enable_llm_judge: t.Optional(t.Boolean({
          description: '是否异步触发 LLM Judge，不默认阻塞主链路',
        })),
      }),
      detail: {
        summary: 'MVP 完整流程',
        description: '串联 Agent 完成简历优化：1) 分析简历 2) 匹配分析 3) 生成优化简历 4) 生成面试建议',
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
    () => ({
      success: true,
      data: getHarnessRunRepository().getDashboardMetrics(),
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
    ({ query }) => ({
      success: true,
      data: getHarnessRunRepository().buildRegressionDataset(Number(query.limit ?? 20)),
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
    ({ params, set }) => {
      const result = getHarnessRunRepository().getRun(params.run_id)

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
    ({ params, set }) => {
      const result = getHarnessRunRepository().replayRun(params.run_id)

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
    ({ params, body, set }) => {
      const result = getHarnessRunRepository().createFailureSample(params.run_id, body.reason)

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
    async ({ body, set }) => {
      try {
        const resumeMarkdown = normalizeMarkdownText(body.resume_markdown)
        const analyzer = new ResumeAnalyzerAgent()
        const { result, meta } = await runHarnessedStep({
          workflowVersion: 'single:v1:analyze_resume',
          stepName: 'analyze_resume',
          inputDigestSource: { resume_markdown: resumeMarkdown },
          stepTimeoutMs: 120000,
          execute: async (stepContext, { eventBus }) => {
            const analysis = await analyzer.analyze(resumeMarkdown, {
              eventBus,
              stepContext,
            })
            await assertBusinessEvaluation({
              eventBus,
              stepContext,
              evaluation: evaluateResumeAnalysisBusiness(analysis),
              errorPrefix: '简历分析业务校验失败',
            })

            return analysis
          },
        })

        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
          meta: { harness: meta },
        }

        return response
      } catch (error) {
        console.error('简历分析失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'ANALYSIS_FAILED',
            message: error instanceof Error ? error.message : '分析失败',
          },
        }

        return response
      }
    },
    {
      body: t.Object({
        resume_markdown: t.String({
          description: 'Markdown 格式的简历内容',
          minLength: 10,
        }),
      }),
      detail: {
        summary: '分析简历',
        description: '仅执行简历分析步骤',
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
    async ({ body, set }) => {
      try {
        const jdText = normalizeMarkdownText(body.jd_text)
        const parser = new JDParserAgent()
        const matcher = new MatchingAgent()
        const { result, meta } = await runHarnessedRequest({
          workflowVersion: 'single:v1:match_resume_to_jd',
          inputDigestSource: {
            structured_resume: body.structured_resume,
            jd_text: jdText,
          },
          execute: async ({ runContext, eventBus, steps, getRemainingWorkflowTimeout }) => {
            const jdStep = await runStep({
              runContext,
              eventBus,
              stepName: 'parse_jd',
              timeoutMs: Math.min(90000, getRemainingWorkflowTimeout()),
              execute: (stepContext) =>
                parser.parse(jdText, {
                  eventBus,
                  stepContext,
                }),
            })
            steps.push(jdStep.step)

            const matchingStep = await runStep({
              runContext,
              eventBus,
              stepName: 'match_resume_to_jd',
              timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
              execute: async (stepContext) => {
                const matchAnalysis = await matcher.match(body.structured_resume, jdStep.result, {
                  eventBus,
                  stepContext,
                })
                await assertBusinessEvaluation({
                  eventBus,
                  stepContext,
                  evaluation: evaluateMatchAnalysisBusiness(matchAnalysis),
                  errorPrefix: '匹配分析业务校验失败',
                })

                return matchAnalysis
              },
            })
            steps.push(matchingStep.step)

            return matchingStep.result
          },
        })

        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
          meta: { harness: meta },
        }

        return response
      } catch (error) {
        console.error('匹配分析失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'MATCH_FAILED',
            message: error instanceof Error ? error.message : '匹配分析失败',
          },
        }

        return response
      }
    },
    {
      body: t.Object({
        structured_resume: t.Any({
          description: '结构化简历数据',
        }),
        jd_text: t.String({
          description: '岗位描述（JD）文本',
          minLength: 10,
        }),
      }),
      detail: {
        summary: '匹配分析',
        description: '基于结构化简历和 JD 执行岗位匹配分析',
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
    async ({ body, set }) => {
      try {
        const generator = new ResumeGeneratorAgent()
        const reviser = new ResumeRevisionAgent()
        const { result: optimizedResume, meta } = await runHarnessedRequest({
          workflowVersion: 'single:v1:generate_resume',
          inputDigestSource: {
            structured_resume: body.structured_resume,
            matching: body.matching,
          },
          execute: async ({ runContext, eventBus, steps, getRemainingWorkflowTimeout }) => {
            const precheckStep = await runStep({
              runContext,
              eventBus,
              stepName: 'validate_source_resume_for_generation',
              timeoutMs: Math.min(30000, getRemainingWorkflowTimeout()),
              execute: async (stepContext) => {
                const evaluation = evaluateSourceResumeForGeneration(body.structured_resume)
                await assertBusinessEvaluation({
                  eventBus,
                  stepContext,
                  evaluation,
                  errorPrefix: '优化简历生成前置校验失败',
                })

                return evaluation
              },
            })
            steps.push(precheckStep.step)

            const generationStep = await runStep({
              runContext,
              eventBus,
              stepName: 'generate_resume',
              timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
              execute: (stepContext) =>
                generator.generate(
                  body.structured_resume,
                  body.matching.jd_structure,
                  body.matching,
                  {
                    eventBus,
                    stepContext,
                  }
                ),
            })
            steps.push(generationStep.step)

            let optimizedResume = generationStep.result
            let revisionAttempts = 0
            const maxRevisionAttempts = 2

            while (revisionAttempts <= maxRevisionAttempts) {
              const validationStep = await runStep({
                runContext,
                eventBus,
                stepName: 'validate_resume',
                timeoutMs: Math.min(30000, getRemainingWorkflowTimeout()),
                execute: async (stepContext) => {
                  const evaluation = evaluateMarkdownResume(optimizedResume, body.structured_resume)
                  await publishEvaluationCompleted({ eventBus, stepContext, evaluation })
                  return evaluation
                },
              })
              steps.push(validationStep.step)

              const qualityGateAttempt = buildQualityGateAttempt({
                stepName: validationStep.step.stepName,
                attemptNumber: revisionAttempts + 1,
                evaluation: validationStep.result,
              })
              const decision = decideNextAction(classifyAttemptResult(qualityGateAttempt))

              if (decision.action === 'accept') {
                if (revisionAttempts > 0) {
                  await eventBus.publish(createHarnessEvent({
                    type: 'recovery.succeeded',
                    runId: runContext.runId,
                    requestId: runContext.requestId,
                    payload: {
                      triggerStep: 'validate_resume',
                      action: 'revise_output',
                      attempts: revisionAttempts,
                      maxAttempts: maxRevisionAttempts,
                      reason: `第 ${revisionAttempts} 次修订后通过质量门禁`,
                    },
                  }))
                }
                return optimizedResume
              }

              if (decision.action !== 'revise_output' || revisionAttempts >= maxRevisionAttempts) {
                await eventBus.publish(createHarnessEvent({
                  type: 'recovery.failed',
                  runId: runContext.runId,
                  requestId: runContext.requestId,
                  payload: {
                    triggerStep: 'validate_resume',
                    action: decision.action,
                    attempts: revisionAttempts,
                    maxAttempts: maxRevisionAttempts,
                    reason: qualityGateAttempt.error?.message ?? '优化简历质量门禁未通过',
                  },
                }))
                throw new Error(qualityGateAttempt.error?.message ?? '优化简历质量门禁未通过')
              }

              revisionAttempts += 1
              const recoveryPayload = {
                triggerStep: 'validate_resume',
                action: decision.action,
                revisionStep: decision.revisionStep,
                attempts: revisionAttempts,
                maxAttempts: maxRevisionAttempts,
                issueCodes: validationStep.result.issues.map((issue) => issue.code),
                reason: decision.reason,
              }
              await eventBus.publish(createHarnessEvent({
                type: 'recovery.planned',
                runId: runContext.runId,
                requestId: runContext.requestId,
                payload: recoveryPayload,
              }))
              await eventBus.publish(createHarnessEvent({
                type: 'recovery.started',
                runId: runContext.runId,
                requestId: runContext.requestId,
                payload: recoveryPayload,
              }))
              const revisionStep = await runStep({
                runContext,
                eventBus,
                stepName: decision.revisionStep,
                timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
                execute: (stepContext) =>
                  reviser.revise(
                    body.structured_resume,
                    body.matching.jd_structure,
                    body.matching,
                    optimizedResume,
                    validationStep.result,
                    {
                      eventBus,
                      stepContext,
                    }
                  ),
              })
              steps.push(revisionStep.step)
              optimizedResume = revisionStep.result
            }

            return optimizedResume
          },
        })

        const response: ApiResponse<{
          optimized_resume: string
          changes_summary: string[]
          improvement_score: number
        }> = {
          success: true,
          data: {
            optimized_resume: optimizedResume,
            changes_summary: Array.isArray(body.matching.optimization_suggestions)
              ? body.matching.optimization_suggestions
              : Array.isArray(body.matching.weaknesses)
                ? body.matching.weaknesses
              : [],
            improvement_score: Math.max(0, (body.matching.match_score ?? 0) - 75),
          },
          meta: { harness: meta },
        }

        return response
      } catch (error) {
        console.error('简历生成失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'GENERATE_FAILED',
            message: error instanceof Error ? error.message : '简历生成失败',
          },
        }

        return response
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
      }),
      detail: {
        summary: '生成优化简历',
        description: '基于结构化简历和岗位匹配分析生成优化后的 Markdown 简历',
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
    async ({ body, set }) => {
      try {
        const advisor = new InterviewAdvisorAgent()
        const { result, meta } = await runHarnessedStep({
          workflowVersion: 'single:v1:generate_interview_advice',
          stepName: 'generate_interview_advice',
          inputDigestSource: {
            analysis: body.analysis,
            matching: body.matching,
            optimized_resume: body.optimized_resume,
          },
          stepTimeoutMs: 120000,
          execute: async (stepContext, { eventBus }) => {
            const suggestions = await advisor.advise(
              body.analysis,
              body.matching,
              body.optimized_resume,
              {
                eventBus,
                stepContext,
              }
            )
            await assertBusinessEvaluation({
              eventBus,
              stepContext,
              evaluation: evaluateInterviewSuggestionsBusiness(suggestions),
              errorPrefix: '面试建议业务校验失败',
            })

            return suggestions
          },
        })

        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
          meta: { harness: meta },
        }

        return response
      } catch (error) {
        console.error('面试建议生成失败:', error)
        set.status = 500

        const response: ApiResponse<never> = {
          success: false,
          error: {
            code: 'INTERVIEW_FAILED',
            message: error instanceof Error ? error.message : '面试建议生成失败',
          },
        }

        return response
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
      }),
      detail: {
        summary: '生成面试建议',
        description: '基于简历分析、岗位匹配分析和优化后的简历生成面试建议',
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
