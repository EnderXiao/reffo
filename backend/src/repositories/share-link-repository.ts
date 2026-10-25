import type { RequestUserContext } from '@/auth/request-context'
import type {
  CreateShareLinkInput,
  ShareContentMode,
  ShareLinkRecord,
} from '@/types/share-link'

export interface ShareLinkRepositoryContract {
  create(context: RequestUserContext, input: CreateShareLinkInput): Promise<ShareLinkRecord> | ShareLinkRecord
  findByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null> | ShareLinkRecord | null
  findActive(
    context: RequestUserContext,
    sourceHistoryId: string,
    mode: ShareContentMode
  ): Promise<ShareLinkRecord | null> | ShareLinkRecord | null
  findByIdempotencyKeyHash(
    context: RequestUserContext,
    idempotencyKeyHash: string
  ): Promise<ShareLinkRecord | null> | ShareLinkRecord | null
  revoke(context: RequestUserContext, id: string): Promise<boolean> | boolean
}
