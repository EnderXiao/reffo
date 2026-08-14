import { env } from '@/config/env'
import type { SourceResumeRepositoryContract } from '@/repositories/interfaces'
import { sqliteSourceResumeRepository } from '@/repositories/source-resume-repository.sqlite'
import { supabaseSourceResumeRepository } from '@/repositories/source-resume-repository.supabase'

function createSourceResumeRepository(): SourceResumeRepositoryContract {
  if (env.DATABASE_PROVIDER === 'sqlite') {
    return sqliteSourceResumeRepository
  }

  if (env.DATABASE_PROVIDER === 'supabase') {
    return supabaseSourceResumeRepository
  }

  throw new Error(`Unsupported DATABASE_PROVIDER: ${String(env.DATABASE_PROVIDER)}`)
}

export const sourceResumeRepository = createSourceResumeRepository()
