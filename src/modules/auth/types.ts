import type { Session } from '@/shared/types'

/** Password accepted, but the account has 2FA: finish with POST /auth/login/2fa. */
export interface TwoFactorChallenge {
  twoFactorRequired: true
  challengeId: string
}

export type LoginResult = Session | TwoFactorChallenge

export function isTwoFactorChallenge(r: LoginResult): r is TwoFactorChallenge {
  return 'twoFactorRequired' in r && r.twoFactorRequired === true
}
