import {describe, expect, test} from 'bun:test'
import {createShareToken} from '@/shared/share-link-token'
import type {ReferralClaimInput} from '@/types/referral-reward'

// env 保持 local 默认即可：本地跳过开关通过参数注入 false，走真实业务分支。
const {env} = await import('@/config/env')
const {claimReferralReward} = await import('@/services/referral-reward')

function createFakeShareLinks(record: {id: string; user_id: string; revoked_at: string | null; expires_at: string}) {
  return {
    async findByTokenHash() { return record },
  }
}

function createFakeRewardRepository() {
  const claims: ReferralClaimInput[] = []
  let outcome: 'claimed' | 'invitee_duplicate' | 'email_duplicate' = 'claimed'
  return {
    claims,
    setOutcome(next: typeof outcome) { outcome = next },
    repository: {
      async claim(input: ReferralClaimInput) {
        claims.push(input)
        return outcome
      },
      async getBonus() { return 0 },
      async consumeBonus() { return false },
    },
  }
}

const shareId = 'aaaaaaaa-0000-4000-8000-000000000001'
const validToken = createShareToken(shareId, env.SHARE_LINK_TOKEN_SECRET)
const futureExpiresAt = new Date(Date.now() + 3600_000).toISOString()

describe('claimReferralReward', () => {
  test('有效 token 首次领取：双方各得 3 次额度', async () => {
    const fake = createFakeRewardRepository()
    const result = await claimReferralReward(
      {userId: 'invitee-1', useServiceRole: true},
      validToken,
      '  New@Example.COM ',
      fake.repository,
      createFakeShareLinks({id: shareId, user_id: 'inviter-1', revoked_at: null, expires_at: futureExpiresAt}) as never,
      false,
    )
    expect(result).toEqual({claimed: true, bonusCount: 3})
    expect(fake.claims).toHaveLength(1)
    expect(fake.claims[0].inviterUserId).toBe('inviter-1')
    expect(fake.claims[0].inviteeEmail).toBe('new@example.com')
  })

  test('自己邀请自己返回 self_invite，不建奖励记录', async () => {
    const fake = createFakeRewardRepository()
    const result = await claimReferralReward(
      {userId: 'inviter-1', useServiceRole: true},
      validToken,
      'new@example.com',
      fake.repository,
      createFakeShareLinks({id: shareId, user_id: 'inviter-1', revoked_at: null, expires_at: futureExpiresAt}) as never,
      false,
    )
    expect(result).toEqual({claimed: false, reason: 'self_invite'})
    expect(fake.claims).toHaveLength(0)
  })

  test('伪造 token 返回 invalid_token', async () => {
    const fake = createFakeRewardRepository()
    const result = await claimReferralReward(
      {userId: 'invitee-1', useServiceRole: true},
      'forged.token.value',
      'new@example.com',
      fake.repository,
      createFakeShareLinks({id: shareId, user_id: 'inviter-1', revoked_at: null, expires_at: futureExpiresAt}) as never,
      false,
    )
    expect(result).toEqual({claimed: false, reason: 'invalid_token'})
  })

  test('邮箱重复返回 email_duplicate，重复领取返回 already_claimed', async () => {
    const fake = createFakeRewardRepository()
    fake.setOutcome('email_duplicate')
    const emailDuplicate = await claimReferralReward(
      {userId: 'invitee-2', useServiceRole: true},
      validToken,
      'new@example.com',
      fake.repository,
      createFakeShareLinks({id: shareId, user_id: 'inviter-1', revoked_at: null, expires_at: futureExpiresAt}) as never,
      false,
    )
    expect(emailDuplicate).toEqual({claimed: false, reason: 'email_duplicate'})
    fake.setOutcome('invitee_duplicate')
    const repeated = await claimReferralReward(
      {userId: 'invitee-1', useServiceRole: true},
      validToken,
      'new@example.com',
      fake.repository,
      createFakeShareLinks({id: shareId, user_id: 'inviter-1', revoked_at: null, expires_at: futureExpiresAt}) as never,
      false,
    )
    expect(repeated).toEqual({claimed: false, reason: 'already_claimed'})
  })
})
