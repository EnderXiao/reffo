import { Elysia, t } from 'elysia'
import { ResumeAnalyzerAgent } from '@/agents/resume-analyzer'
import { MatchingAgent } from '@/agents/matching-agent'
import { ResumeGeneratorAgent } from '@/agents/resume-generator'
import { InterviewAdvisorAgent } from '@/agents/interview-advisor'
import type { ApiResponse, MvpProcessResponse } from '@/types'

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
        const { resume_markdown, jd_text } = body

        console.log('========================================')
        console.log('开始处理简历优化流程')
        console.log('========================================')

        // Step 1: 分析源简历
        console.log('\n[Step 1/4] 正在分析简历...')
        const analyzer = new ResumeAnalyzerAgent()
        const analysisResult = await analyzer.analyze(resume_markdown)
        console.log('✓ 简历分析完成')
        console.log(`  - 质量评分: ${analysisResult.quality_score}/100`)
        console.log(`  - 优势点: ${analysisResult.strengths.length} 个`)
        console.log(`  - 问题点: ${analysisResult.weaknesses.length} 个`)

        // Step 2: 匹配分析
        console.log('\n[Step 2/4] 正在分析匹配度...')
        const matcher = new MatchingAgent()
        const matchResult = await matcher.match(analysisResult.structured_resume, jd_text)
        console.log('✓ 匹配分析完成')
        console.log(`  - 匹配度评分: ${matchResult.match_score}/100`)
        console.log(`  - 已匹配技能: ${matchResult.skill_match.matched.length} 个`)
        console.log(`  - 缺失技能: ${matchResult.skill_match.missing.length} 个`)

        // Step 3: 生成优化简历
        console.log('\n[Step 3/4] 正在生成优化简历...')
        const generator = new ResumeGeneratorAgent()
        const optimizedResume = await generator.generate(
          analysisResult.structured_resume,
          matchResult.jd_structure,
          matchResult
        )
        console.log('✓ 简历生成完成')
        console.log(`  - 优化简历长度: ${optimizedResume.length} 字符`)

        // Step 4: 生成面试建议
        console.log('\n[Step 4/4] 正在生成面试建议...')
        const advisor = new InterviewAdvisorAgent()
        const interviewSuggestions = await advisor.advise(
          analysisResult,
          matchResult,
          optimizedResume
        )
        console.log('✓ 面试建议生成完成')
        console.log(`  - 面试问题: ${interviewSuggestions.questions.length} 个`)

        console.log('\n========================================')
        console.log('流程处理完成！')
        console.log('========================================\n')

        const response: ApiResponse<MvpProcessResponse> = {
          success: true,
          data: {
            step1_analysis: analysisResult,
            step2_matching: matchResult,
            step3_optimized_resume: optimizedResume,
            step4_interview_suggestions: interviewSuggestions,
          },
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
      }),
      detail: {
        summary: 'MVP 完整流程',
        description: '串联 Agent 完成简历优化：1) 分析简历 2) 匹配分析 3) 生成优化简历 4) 生成面试建议',
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
        const analyzer = new ResumeAnalyzerAgent()
        const result = await analyzer.analyze(body.resume_markdown)

        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
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
        const matcher = new MatchingAgent()
        const result = await matcher.match(body.structured_resume, body.jd_text)

        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
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
        const optimizedResume = await generator.generate(
          body.structured_resume,
          body.matching.jd_structure,
          body.matching
        )

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
        const result = await advisor.advise(
          body.analysis,
          body.matching,
          body.optimized_resume
        )

        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
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
