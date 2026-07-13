import { env } from '@/config/env'
import type { ResumeHistoryRepositoryContract } from '@/repositories/interfaces'
import { sqliteResumeHistoryRepository } from '@/repositories/resume-history-repository.sqlite'
import { supabaseResumeHistoryRepository } from '@/repositories/resume-history-repository.supabase'

function createResumeHistoryRepository(): ResumeHistoryRepositoryContract {
  if (env.DATABASE_PROVIDER === 'sqlite') {
    return sqliteResumeHistoryRepository
  }

  if (env.DATABASE_PROVIDER === 'supabase') {
    return supabaseResumeHistoryRepository
  }

  throw new Error(`Unsupported DATABASE_PROVIDER: ${String(env.DATABASE_PROVIDER)}`)
}

export const resumeHistoryRepository = createResumeHistoryRepository()
