import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { env, validateEnv } from '@/config/env'
import { getV5ReleaseDescriptor } from '@/v5/release'
import { mvpRoutes } from '@/routes/mvp'
import { parseRoutes } from '@/routes/parse'
import { sourceResumeRoutes } from '@/routes/source-resume'
import { resumeHistoryRoutes } from '@/routes/resume-history'
import { systemRoutes } from '@/routes/system'
import { authRoutes } from '@/routes/auth'
import { profileRoutes } from '@/routes/profile'
import { startSupabaseHarnessCleanup } from '@/harness/supabase-cleanup'

/**
 * 启动应用
 */
async function bootstrap() {
  // 验证环境变量
  try {
    validateEnv()
    getV5ReleaseDescriptor()
  } catch (error) {
    console.error('❌ 环境变量验证失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  }

  // 创建 Elysia 应用
  const app = new Elysia()
    // Swagger 文档
    .use(
      swagger({
        documentation: {
          info: {
            title: 'Reffo MVP API',
            version: '0.1.0',
            description: 'AI-powered resume optimization service - MVP version',
          },
          tags: [
            { name: 'MVP', description: 'MVP 核心功能接口' },
            { name: 'Analysis', description: '简历分析相关接口' },
            { name: 'Parse', description: '文件和 OCR 解析接口' },
            { name: 'SourceResume', description: '源简历存储与查询接口' },
            { name: 'ResumeHistory', description: '生成卡片历史接口' },
            { name: 'System', description: '系统接口' },
            { name: 'Auth', description: '账号认证辅助接口' },
          ],
        },
      })
    )
    // CORS 支持
    .use(
      cors({
        origin: env.CORS_ORIGIN,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
      })
    )
    // 全局错误处理
    .onError(({ code, error, set }) => {
      console.error('Global error handler:', code, error)

      if (code === 'VALIDATION') {
        set.status = 400
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '请求参数验证失败',
          },
        }
      }

      if (code === 'NOT_FOUND') {
        set.status = 404
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: '请求的资源不存在',
          },
        }
      }

      set.status = 500
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务暂时不可用，请稍后重试',
        },
      }
    })
    // 根路径
    .get('/', () => ({
      message: 'Welcome to Reffo MVP API',
      version: '0.1.0',
      docs: '/swagger',
      health: '/api/v1/mvp/health',
    }))
    // 注册路由
    .use(systemRoutes)
    .use(authRoutes)
    .use(profileRoutes)
    .use(mvpRoutes)
    .use(parseRoutes)
    .use(sourceResumeRoutes)
    .use(resumeHistoryRoutes)
    // 启动服务
    .listen({
      hostname: env.HOST,
      port: env.PORT,
    })

  startSupabaseHarnessCleanup()

  console.log('\n🚀 Reffo MVP 服务启动成功！')
  console.log('========================================')
  console.log(`📡 服务地址: http://${env.HOST}:${env.PORT}`)
  console.log(`📚 API 文档: http://${env.HOST}:${env.PORT}/swagger`)
  console.log(`💚 健康检查: http://${env.HOST}:${env.PORT}/api/v1/mvp/health`)
  console.log('========================================')
  console.log(`🤖 AI 模型: ${env.AI_MODEL}`)
  console.log(`🔗 API 地址: ${env.OPENAI_BASE_URL}`)
  console.log(`📄 OCR 模型: ${env.GLM_OCR_MODEL}`)
  console.log('========================================\n')
}

// 启动应用
bootstrap().catch((error) => {
  console.error('❌ 应用启动失败:', error)
  process.exit(1)
})
