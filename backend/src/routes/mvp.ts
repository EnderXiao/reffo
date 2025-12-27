import { Elysia, t } from 'elysia'
import { ResumeAnalyzerAgent } from '@/agents/resume-analyzer'
import { MatchingAgent } from '@/agents/matching-agent'
import { ResumeGeneratorAgent } from '@/agents/resume-generator'
import type { ApiResponse, MvpProcessResponse } from '@/types'

/**
 * MVP 路由
 * 提供完整的简历优化流程接口
 */
export const mvpRoutes = new Elysia({ prefix: '/api/v1/mvp' })
  /**
   * POST /api/v1/mvp/process
   * 完整流程：简历分析 -> 匹配分析 -> 简历生成
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
        console.log('\n[Step 1/3] 正在分析简历...')
        const analyzer = new ResumeAnalyzerAgent()
        const analysisResult = await analyzer.analyze(resume_markdown)
        console.log('✓ 简历分析完成')
        console.log(`  - 质量评分: ${analysisResult.quality_score}/100`)
        console.log(`  - 优势点: ${analysisResult.strengths.length} 个`)
        console.log(`  - 问题点: ${analysisResult.weaknesses.length} 个`)

        // Step 2: 匹配分析
        console.log('\n[Step 2/3] 正在分析匹配度...')
        const matcher = new MatchingAgent()
        const matchResult = await matcher.match(analysisResult.structured_resume, jd_text)
        console.log('✓ 匹配分析完成')
        console.log(`  - 匹配度评分: ${matchResult.match_score}/100`)
        console.log(`  - 已匹配技能: ${matchResult.skill_match.matched.length} 个`)
        console.log(`  - 缺失技能: ${matchResult.skill_match.missing.length} 个`)

        // Step 3: 生成优化简历
        console.log('\n[Step 3/3] 正在生成优化简历...')
        const generator = new ResumeGeneratorAgent()
        const optimizedResume = await generator.generate(
          analysisResult.structured_resume,
          matchResult.jd_structure,
          matchResult
        )
        console.log('✓ 简历生成完成')
        console.log(`  - 优化简历长度: ${optimizedResume.length} 字符`)

        console.log('\n========================================')
        console.log('流程处理完成！')
        console.log('========================================\n')

        const response: ApiResponse<MvpProcessResponse> = {
          success: true,
          data: {
            step1_analysis: analysisResult,
            step2_matching: matchResult,
            step3_optimized_resume: optimizedResume,
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
        description: '串联三个 Agent 完成简历优化：1) 分析简历 2) 匹配分析 3) 生成优化简历',
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
