import {apiClient} from '@/services/api'
import type {
  CreateShareLinkInput,
  CreatedShareLink,
  PublicShareLink,
} from '@/types/share'

export class ShareApi {
  async createLink(input: CreateShareLinkInput, idempotencyKey: string): Promise<CreatedShareLink> {
    return apiClient.post<CreatedShareLink>('/share-links', input, {
      header: {'Idempotency-Key': idempotencyKey},
    })
  }

  async getPublicLink(token: string): Promise<PublicShareLink> {
    return apiClient.get<PublicShareLink>(
      `/share-links/public/${encodeURIComponent(token)}`,
    )
  }

  async revokeLink(shareId: string): Promise<void> {
    await apiClient.delete(`/share-links/${encodeURIComponent(shareId)}`)
  }
}

export const shareApi = new ShareApi()
