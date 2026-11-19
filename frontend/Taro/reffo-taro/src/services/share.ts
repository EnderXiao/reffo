import {apiClient} from '@/services/api'
import {track} from '@/utils/analytics'
import type {
  CreateShareLinkInput,
  CreatedShareLink,
  PublicShareLink,
} from '@/types/share'

export interface ReferralClaimRewardResult {
  claimed: boolean
  reason: string | null
  bonus_count: number
}

export class ShareApi {
  async claimReferralReward(token: string, email: string): Promise<ReferralClaimRewardResult> {
    const result = await apiClient.post<ReferralClaimRewardResult>('/share-links/claim-reward', {token, email})
    if (result.claimed) {
      track('referral_reward_claimed', {bonus_count: result.bonus_count})
    }
    return result
  }

  async createLink(input: CreateShareLinkInput, idempotencyKey: string): Promise<CreatedShareLink> {
    const link = await apiClient.post<CreatedShareLink>('/share-links', input, {
      header: {'Idempotency-Key': idempotencyKey},
    })
    track('share_created', {share_id: link.id})
    return link
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
