export type ReferralClaimOutcome = 'claimed' | 'invitee_duplicate' | 'email_duplicate'

export interface ReferralClaimInput {
  inviteeUserId: string
  inviterUserId: string
  inviteeEmail: string
  bonusCount: number
}

export interface ReferralClaimResult {
  claimed: boolean
  reason?: 'already_claimed' | 'invalid_token' | 'self_invite' | 'local_skipped' | 'email_duplicate'
  bonusCount?: number
}
