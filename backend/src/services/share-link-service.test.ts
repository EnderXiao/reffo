import { describe, expect, test } from 'bun:test'
import { env } from '@/config/env'
import type { RequestUserContext } from '@/auth/request-context'
import type { ShareLinkRepositoryContract } from '@/repositories/share-link-repository'
import { hashShareToken } from '@/shared/share-link-token'
import { ShareLinkService } from '@/services/share-link-service'
import type { ResumeHistoryRecord } from '@/types'
import type {
  CreateShareLinkInput,
  ShareContentMode,
  ShareLinkRecord,
} from '@/types/share-link'

const context: RequestUserContext = {
  userId: 'user-1',
  useServiceRole: true,
}

function createHistory(): ResumeHistoryRecord {
  return {
    id: 'JD2026102500001',
    position: 'AI Product Manager',
    company: 'Echo',
    name: 'Jeremy Smith',
    created_at: '2025-12-15T10:00:00.000Z',
    updated_at: '2025-12-15T10:00:00.000Z',
    quality_score: 86,
    match_score: 88,
    tags: [],
    resume_content: 'private resume',
    jd_content: '工作地点：北京',
    optimized_content: '突出复杂项目经验。',
  }
}

class MemoryShareLinkRepository implements ShareLinkRepositoryContract {
  records: ShareLinkRecord[] = []

  create(_context: RequestUserContext, input: CreateShareLinkInput): ShareLinkRecord {
    const now = new Date().toISOString()
    const record: ShareLinkRecord = {
      ...input,
      revoked_at: null,
      created_at: now,
      updated_at: now,
      last_viewed_at: null,
      view_count: 0,
    }
    this.records.push(record)
    return record
  }

  findByTokenHash(tokenHash: string) {
    return this.records.find(record => record.token_hash === tokenHash) || null
  }

  findActive(_context: RequestUserContext, sourceHistoryId: string, mode: ShareContentMode) {
    return this.records.find(record =>
      record.source_history_id === sourceHistoryId
      && record.mode === mode
      && !record.revoked_at
    ) || null
  }

  findByIdempotencyKeyHash(_context: RequestUserContext, idempotencyKeyHash: string) {
    return this.records.find(record => record.idempotency_key_hash === idempotencyKeyHash) || null
  }

  revoke(_context: RequestUserContext, id: string) {
    const record = this.records.find(item => item.id === id && item.user_id === context.userId)
    if (!record || record.revoked_at) return false
    record.revoked_at = new Date().toISOString()
    return true
  }
}

describe('ShareLinkService', () => {
  test('creates one reusable active share for the same history and mode', async () => {
    const originalSecret = env.SHARE_LINK_TOKEN_SECRET
    env.SHARE_LINK_TOKEN_SECRET = 'test-secret'
    try {
      const repository = new MemoryShareLinkRepository()
      const service = new ShareLinkService(repository)

      const first = await service.create(context, createHistory(), 'job', 'image')
      const second = await service.create(context, createHistory(), 'job', 'link')

      expect(first.created).toBe(true)
      expect(second.created).toBe(false)
      expect(second.id).toBe(first.id)
      expect(second.token).toBe(first.token)
      expect(second.share_url).toBe(first.share_url)
      expect(repository.records).toHaveLength(1)
    } finally {
      env.SHARE_LINK_TOKEN_SECRET = originalSecret
    }
  })

  test('returns only the public snapshot and reports revoked links', async () => {
    const originalSecret = env.SHARE_LINK_TOKEN_SECRET
    env.SHARE_LINK_TOKEN_SECRET = 'test-secret'
    try {
      const repository = new MemoryShareLinkRepository()
      const service = new ShareLinkService(repository)
      const created = await service.create(context, createHistory(), 'job', 'link')

      const loaded = await service.getByToken(created.token)
      expect(loaded.status).toBe('ok')
      if (loaded.status !== 'ok') throw new Error('expected share')
      expect(loaded.data).not.toHaveProperty('user_id')
      expect(loaded.data).not.toHaveProperty('source_history_id')
      expect(JSON.stringify(loaded.data)).not.toContain('private resume')

      await service.revoke(context, created.id)
      await expect(service.getByToken(created.token)).resolves.toEqual({status: 'revoked'})
    } finally {
      env.SHARE_LINK_TOKEN_SECRET = originalSecret
    }
  })

  test('rejects forged and mismatched tokens', async () => {
    const originalSecret = env.SHARE_LINK_TOKEN_SECRET
    env.SHARE_LINK_TOKEN_SECRET = 'test-secret'
    try {
      const repository = new MemoryShareLinkRepository()
      const service = new ShareLinkService(repository)
      const created = await service.create(context, createHistory(), 'blank', 'image')
      const tampered = `${created.token}x`

      await expect(service.getByToken(tampered)).resolves.toEqual({status: 'invalid'})
      expect(hashShareToken(tampered)).not.toBe(hashShareToken(created.token))
    } finally {
      env.SHARE_LINK_TOKEN_SECRET = originalSecret
    }
  })
})
