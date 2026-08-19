import { env } from '@/config/env'
import type { SourceResumeRepositoryContract } from '@/repositories/interfaces'
import { sqliteSourceResumeRepository } from '@/repositories/source-resume-repository.sqlite'
import { supabaseSourceResumeRepository } from '@/repositories/source-resume-repository.supabase'

function createSourceResumeRepository(): SourceResumeRepositoryContract {
  if (env.DATABASE_PROVIDER === 'sqlite') {
    if (env.APP_ENV !== 'local') {
      throw new Error('SQLite 数据存储仅允许在 local 环境使用')
    }

    return sqliteSourceResumeRepository
  }

  if (env.DATABASE_PROVIDER === 'supabase') {
    return supabaseSourceResumeRepository
  }

  throw new Error(`Unsupported DATABASE_PROVIDER: ${String(env.DATABASE_PROVIDER)}`)
}

export const sourceResumeRepository = createSourceResumeRepository()
