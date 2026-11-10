import {beforeEach, describe, expect, test} from 'bun:test'
import {SqliteReferralRewardRepository} from '@/repositories/referral-reward-repository'
import {getDatabase} from '@/repositories/database'

function createRepository() {
  return new SqliteReferralRewardRepository()
}

beforeEach(() => {
  getDatabase().exec('DELETE FROM resume_referral_rewards; DELETE FROM resume_bonus_quotas;')
})

describe('SqliteReferralRewardRepository', () => {
  test('首次领取：双方各得奖励额度，记录去重字段', () => {
    const repo = createRepository()
    const outcome = repo.claim({inviteeUserId: 'invitee-1', inviterUserId: 'inviter-1', inviteeEmail: 'a@b.com', bonusCount: 3})
    expect(outcome).toBe('claimed')
    expect(repo.getBonus('invitee-1')).toBe(3)
    expect(repo.getBonus('inviter-1')).toBe(3)
  })

  test('同一用户重复领取返回 invitee_duplicate', () => {
    const repo = createRepository()
    repo.claim({inviteeUserId: 'invitee-1', inviterUserId: 'inviter-1', inviteeEmail: 'a@b.com', bonusCount: 3})
    const second = repo.claim({inviteeUserId: 'invitee-1', inviterUserId: 'inviter-2', inviteeEmail: 'a@b.com', bonusCount: 3})
    expect(second).toBe('invitee_duplicate')
    expect(repo.getBonus('invitee-1')).toBe(3)
  })

  test('同一邮箱换账号注册返回 email_duplicate，邀请人不重复得奖', () => {
    const repo = createRepository()
    repo.claim({inviteeUserId: 'invitee-1', inviterUserId: 'inviter-1', inviteeEmail: 'A@B.com ', bonusCount: 3})
    const second = repo.claim({inviteeUserId: 'invitee-2', inviterUserId: 'inviter-1', inviteeEmail: 'a@b.com', bonusCount: 3})
    expect(second).toBe('email_duplicate')
    expect(repo.getBonus('inviter-1')).toBe(3)
    expect(repo.getBonus('invitee-2')).toBe(0)
  })

  test('奖励额度可消费，余额为零后返回 false', () => {
    const repo = createRepository()
    repo.claim({inviteeUserId: 'invitee-1', inviterUserId: 'inviter-1', inviteeEmail: 'a@b.com', bonusCount: 2})
    expect(repo.consumeBonus('invitee-1')).toBe(true)
    expect(repo.consumeBonus('invitee-1')).toBe(true)
    expect(repo.consumeBonus('invitee-1')).toBe(false)
    expect(repo.getBonus('invitee-1')).toBe(0)
  })

  test('无奖励记录的用户余额为零且不可消费', () => {
    const repo = createRepository()
    expect(repo.getBonus('nobody')).toBe(0)
    expect(repo.consumeBonus('nobody')).toBe(false)
  })
})
