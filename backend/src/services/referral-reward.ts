import { env } from '@/config/env'
import type { RequestUserContext } from '@/auth/request-context'
import { referralRewardRepository, type ReferralRewardRepositoryContract } from '@/repositories/referral-reward-repository'
import { shareLinkRepository } from '@/repositories/share-link-repository.factory'
import type { ShareLinkRepositoryContract } from '@/repositories/share-link-repository'
import { hashShareToken, verifyShareToken } from '@/shared/share-link-token'
import type { ReferralClaimResult } from '@/types/referral-reward'

export const REFERRAL_BONUS_COUNT = 3

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

/**
 * 注册即送：邀请人和被邀请人各得 REFERRAL_BONUS_COUNT 次跨天可用额度。
 * 本地调试环境跳过（不建奖励记录），只有 Supabase 生产链路发奖。
 */
export async function claimReferralReward(
  context: RequestUserContext,
  token: string,
  email: string,
  repository: ReferralRewardRepositoryContract = referralRewardRepository,
  shareLinks: ShareLinkRepositoryContract = shareLinkRepository,
  /** 测试注入：本地环境跳过发奖的判断开关。 */
  isLocalEnvironment: boolean = env.APP_ENV === 'local',
): Promise<ReferralClaimResult> {
  if (isLocalEnvironment) {
    return {claimed: false, reason: 'local_skipped'}
  }

  const parts = token.split('.')
  if (parts.length !== 3) return {claimed: false, reason: 'invalid_token'}
  const shareId = parts[1]
  if (!verifyShareToken(token, shareId, env.SHARE_LINK_TOKEN_SECRET)) {
    return {claimed: false, reason: 'invalid_token'}
  }

  const record = await shareLinks.findByTokenHash(hashShareToken(token))
  if (!record || record.id !== shareId || record.revoked_at) {
    return {claimed: false, reason: 'invalid_token'}
  }
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    return {claimed: false, reason: 'invalid_token'}
  }
  if (record.user_id === context.userId) {
    return {claimed: false, reason: 'self_invite'}
  }

  const outcome = await repository.claim({
    inviteeUserId: context.userId,
    inviterUserId: record.user_id,
    inviteeEmail: normalizeEmail(email),
    bonusCount: REFERRAL_BONUS_COUNT,
  })
  if (outcome === 'claimed') return {claimed: true, bonusCount: REFERRAL_BONUS_COUNT}
  return {claimed: false, reason: outcome === 'email_duplicate' ? 'email_duplicate' : 'already_claimed'}
}
