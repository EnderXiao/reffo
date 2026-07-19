import { Elysia } from 'elysia'
import { env } from '@/config/env'
import type { ApiResponse } from '@/types'

interface PublicConfig {
  appEnv: typeof env.APP_ENV
  databaseProvider: typeof env.DATABASE_PROVIDER
  supabase: {
    url: string
    publishableKey: string
    storageBucket: string
    projectEnv: typeof env.SUPABASE_PROJECT_ENV
  }
}

export const systemRoutes = new Elysia({ prefix: '/api/v1/system' })
  .get(
    '/public-config',
    () => ({
      success: true,
      data: {
        appEnv: env.APP_ENV,
        databaseProvider: env.DATABASE_PROVIDER,
        supabase: {
          url: env.SUPABASE_URL,
          publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
          storageBucket: env.SUPABASE_STORAGE_BUCKET,
          projectEnv: env.SUPABASE_PROJECT_ENV,
        },
      },
    } satisfies ApiResponse<PublicConfig>),
    {
      detail: {
        summary: '公开运行配置',
        description: '返回前端运行所需的非敏感公开配置，例如当前环境和 Supabase Publishable key。',
        tags: ['System'],
      },
    }
  )
