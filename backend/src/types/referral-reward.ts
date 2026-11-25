export type ReferralClaimOutcome = 'claimed' | 'invitee_duplicate' | 'email_duplicate' | 'token_duplicate'

export interface ReferralClaimInput {
  inviteeUserId: string
  inviterUserId: string
  inviteeEmail: string
  shareLinkId: string
  bonusCount: number
}

export interface ReferralClaimResult {
  claimed: boolean
  reason?: 'already_claimed' | 'invalid_token' | 'self_invite' | 'local_skipped' | 'email_duplicate' | 'token_duplicate'
  bonusCount?: number
}
