import { env } from '@/config/env'
import { getDatabase } from './database'
import { createSupabaseRestClient } from './supabase/client'
import type { ReferralClaimInput, ReferralClaimOutcome } from '@/types/referral-reward'

/**
 * 分享邀请奖励仓储：注册即送，双方各得跨天可用的额外生成额度。
 * 邀请人按邀请邮箱去重防刷；仅 Supabase 生产环境执行奖励逻辑，本地调试跳过。
 */

export interface ReferralRewardRepositoryContract {
  claim(input: ReferralClaimInput): Promise<ReferralClaimOutcome> | ReferralClaimOutcome
  getBonus(userId: string): Promise<number> | number
  /** 乐观扣减 1 次奖励额度，余额不足返回 false。 */
  consumeBonus(userId: string): Promise<boolean> | boolean
}

export class SqliteReferralRewardRepository implements ReferralRewardRepositoryContract {
  constructor() {
    const db = getDatabase()
    db.exec(
      'CREATE TABLE IF NOT EXISTS resume_referral_rewards (' +
        'invitee_user_id TEXT PRIMARY KEY, inviter_user_id TEXT NOT NULL,' +
        'invitee_email TEXT NOT NULL UNIQUE, share_link_id TEXT NOT NULL UNIQUE,' +
        'bonus_count INTEGER NOT NULL, created_at TEXT NOT NULL);' +
      'CREATE INDEX IF NOT EXISTS referral_rewards_inviter ON resume_referral_rewards(inviter_user_id, created_at);' +
      'CREATE TABLE IF NOT EXISTS resume_bonus_quotas (' +
        'user_id TEXT PRIMARY KEY, bonus_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);',
    )
    // 旧版表结构升级：补充 share_link_id 列（幂等）。
    const columns = db.query('PRAGMA table_info(resume_referral_rewards)').all() as Array<{name: string}>
    if (!columns.some(item => item.name === 'share_link_id')) {
      db.exec('ALTER TABLE resume_referral_rewards ADD COLUMN share_link_id TEXT')
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_share_link ON resume_referral_rewards(share_link_id)')
    }
  }

  claim(input: ReferralClaimInput): ReferralClaimOutcome {
    const db = getDatabase()
    const now = new Date().toISOString()
    const email = input.inviteeEmail.trim().toLowerCase()
    const outcome = db.transaction((): ReferralClaimOutcome => {
      const existingInvitee = db.query('SELECT invitee_user_id FROM resume_referral_rewards WHERE invitee_user_id = ?').get(input.inviteeUserId)
      if (existingInvitee) return 'invitee_duplicate'
      const existingEmail = db.query('SELECT invitee_user_id FROM resume_referral_rewards WHERE invitee_email = ?').get(email)
      if (existingEmail) return 'email_duplicate'
      const existingToken = db.query('SELECT invitee_user_id FROM resume_referral_rewards WHERE share_link_id = ?').get(input.shareLinkId)
      if (existingToken) return 'token_duplicate'
      db.query('INSERT INTO resume_referral_rewards (invitee_user_id, inviter_user_id, invitee_email, share_link_id, bonus_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.inviteeUserId, input.inviterUserId, email, input.shareLinkId, input.bonusCount, now)
      for (const userId of [input.inviterUserId, input.inviteeUserId]) {
        db.query('INSERT INTO resume_bonus_quotas (user_id, bonus_count, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET bonus_count = bonus_count + excluded.bonus_count, updated_at = excluded.updated_at')
          .run(userId, input.bonusCount, now)
      }
      return 'claimed'
    })()
    return outcome
  }

  getBonus(userId: string): number {
    const row = getDatabase().query('SELECT bonus_count FROM resume_bonus_quotas WHERE user_id = ?').get(userId) as {bonus_count: number} | null
    return row?.bonus_count || 0
  }

  consumeBonus(userId: string): boolean {
    const db = getDatabase()
    const updatedAt = new Date().toISOString()
    const result = db.query('UPDATE resume_bonus_quotas SET bonus_count = bonus_count - 1, updated_at = ? WHERE user_id = ? AND bonus_count > 0').run(updatedAt, userId)
    return result.changes > 0
  }
}

class SupabaseReferralRewardRepository implements ReferralRewardRepositoryContract {
  async claim(input: ReferralClaimInput): Promise<ReferralClaimOutcome> {
    const rows = await createSupabaseRestClient({useServiceRole: true})
      .request<Array<{outcome: ReferralClaimOutcome}>>('/rest/v1/rpc/claim_referral_reward', {
        method: 'POST',
        body: {
          p_invitee_user_id: input.inviteeUserId,
          p_inviter_user_id: input.inviterUserId,
          p_invitee_email: input.inviteeEmail,
          p_share_link_id: input.shareLinkId,
          p_bonus_count: input.bonusCount,
        },
      })
    return rows[0]?.outcome ?? 'invitee_duplicate'
  }

  async getBonus(userId: string): Promise<number> {
    const rows = await createSupabaseRestClient({useServiceRole: true})
      .request<Array<{bonus_count: number}>>('/rest/v1/resume_bonus_quotas', {
        searchParams: {select: 'bonus_count', user_id: 'eq.' + userId, limit: 1},
      })
    return rows[0]?.bonus_count || 0
  }

  async consumeBonus(userId: string): Promise<boolean> {
    const rows = await createSupabaseRestClient({useServiceRole: true})
      .request<Array<{consumed: boolean}>>('/rest/v1/rpc/consume_referral_bonus', {
        method: 'POST',
        body: {p_user_id: userId},
      })
    return rows[0]?.consumed ?? false
  }
}

function createReferralRewardRepository(): ReferralRewardRepositoryContract {
  if (env.DATABASE_PROVIDER === 'sqlite') {
    if (env.APP_ENV !== 'local') {
      throw new Error('SQLite 数据存储仅允许在 local 环境使用')
    }
    return new SqliteReferralRewardRepository()
  }
  return new SupabaseReferralRewardRepository()
}

export const referralRewardRepository = createReferralRewardRepository()
