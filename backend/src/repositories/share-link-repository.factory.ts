import { env } from '@/config/env'
import type { ShareLinkRepositoryContract } from '@/repositories/share-link-repository'
import { sqliteShareLinkRepository } from '@/repositories/share-link-repository.sqlite'
import { supabaseShareLinkRepository } from '@/repositories/share-link-repository.supabase'

function createShareLinkRepository(): ShareLinkRepositoryContract {
  if (env.DATABASE_PROVIDER === 'sqlite') {
    if (env.APP_ENV !== 'local') {
      throw new Error('SQLite 数据存储仅允许在 local 环境使用')
    }
    return sqliteShareLinkRepository
  }

  if (env.DATABASE_PROVIDER === 'supabase') {
    return supabaseShareLinkRepository
  }

  throw new Error(`Unsupported DATABASE_PROVIDER: ${String(env.DATABASE_PROVIDER)}`)
}

export const shareLinkRepository = createShareLinkRepository()
