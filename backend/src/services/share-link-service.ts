import { createHash, randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import type { RequestUserContext } from '@/auth/request-context'
import type { ShareLinkRepositoryContract } from '@/repositories/share-link-repository'
import { shareLinkRepository } from '@/repositories/share-link-repository.factory'
import { buildShareSnapshot } from '@/shared/share-link-snapshot'
import { createShareToken, hashShareToken, verifyShareToken } from '@/shared/share-link-token'
import type { ResumeHistoryRecord } from '@/types'
import type {
  CreatedShareLink,
  PublicShareLink,
  ShareContentMode,
  ShareCreatedVia,
  ShareLinkRecord,
} from '@/types/share-link'

export type PublicShareLookup =
  | {status: 'ok'; data: PublicShareLink}
  | {status: 'invalid'}
  | {status: 'expired'}
  | {status: 'revoked'}

function hashIdempotencyKey(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function toCreatedShareLink(record: ShareLinkRecord): CreatedShareLink {
  const token = createShareToken(record.id, env.SHARE_LINK_TOKEN_SECRET)
  return {
    id: record.id,
    token,
    share_url: buildShareUrl(token),
    mode: record.mode,
    schema_version: record.schema_version,
    expires_at: record.expires_at,
  }
}

export function buildShareUrl(token: string) {
  const baseUrl = env.PUBLIC_WEB_BASE_URL.replace(/\/+$/, '')
  return `${baseUrl}/#/pages/share-landing/index?shareToken=${encodeURIComponent(token)}`
}

export function toPublicShareLink(record: ShareLinkRecord): PublicShareLink {
  return {
    share_id: record.id,
    schema_version: record.snapshot.schema_version,
    mode: record.snapshot.mode,
    theme: record.snapshot.theme,
    card: record.snapshot.card,
    landing: record.snapshot.landing,
  }
}

export class ShareLinkService {
  constructor(
    private readonly repository: ShareLinkRepositoryContract = shareLinkRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    context: RequestUserContext,
    history: ResumeHistoryRecord,
    mode: ShareContentMode,
    createdVia: ShareCreatedVia,
    idempotencyKeyInput?: string,
  ): Promise<CreatedShareLink & {created: boolean}> {
    const idempotencyKey = idempotencyKeyInput?.trim().slice(0, 200)
      || `${context.userId}:${history.id}:${mode}`
    const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey)
    const existingByIdempotency = await this.repository.findByIdempotencyKeyHash(context, idempotencyKeyHash)
    if (existingByIdempotency) return {...toCreatedShareLink(existingByIdempotency), created: false}

    const activeRecord = await this.repository.findActive(context, history.id, mode)
    if (activeRecord) return {...toCreatedShareLink(activeRecord), created: false}

    const shareId = randomUUID()
    const token = createShareToken(shareId, env.SHARE_LINK_TOKEN_SECRET)
    const createdAt = this.now()
    const expiresAt = new Date(
      createdAt.getTime() + env.SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
    )
    let record: ShareLinkRecord
    try {
      record = await this.repository.create(context, {
        id: shareId,
        user_id: context.userId,
        source_history_id: history.id,
        mode,
        token_hash: hashShareToken(token),
        idempotency_key_hash: idempotencyKeyHash,
        snapshot: buildShareSnapshot(history, mode),
        schema_version: 1,
        created_via: createdVia,
        expires_at: expiresAt.toISOString(),
      })
    } catch (error) {
      const concurrentRecord = await this.repository.findByIdempotencyKeyHash(context, idempotencyKeyHash)
      if (!concurrentRecord) throw error
      return {...toCreatedShareLink(concurrentRecord), created: false}
    }

    return {...toCreatedShareLink(record), created: true}
  }

  async getByToken(token: string): Promise<PublicShareLookup> {
    const parts = token.split('.')
    if (parts.length !== 3) return {status: 'invalid'}

    const [, shareId] = parts
    if (!verifyShareToken(token, shareId, env.SHARE_LINK_TOKEN_SECRET)) {
      return {status: 'invalid'}
    }

    const record = await this.repository.findByTokenHash(hashShareToken(token))
    if (!record || record.id !== shareId) return {status: 'invalid'}
    if (record.revoked_at) return {status: 'revoked'}
    if (new Date(record.expires_at).getTime() <= this.now().getTime()) return {status: 'expired'}

    return {status: 'ok', data: toPublicShareLink(record)}
  }

  async revoke(context: RequestUserContext, shareId: string) {
    return this.repository.revoke(context, shareId)
  }
}

export const shareLinkService = new ShareLinkService()
