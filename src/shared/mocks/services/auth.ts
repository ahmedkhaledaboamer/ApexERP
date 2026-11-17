import type { Role, Session, User } from '@/shared/types'
import type { LoginResult } from '@/modules/auth/types'
import { ApiError } from '@/shared/lib/apiError'
import { DEMO_USER_BY_ROLE } from '@/shared/lib/constants'
import { users } from '@/shared/mocks/db'
import { passwordMatches } from '@/shared/mocks/data/passwords'
import { loginChallenges } from '@/shared/mocks/data/security'
import { checkSecondFactor } from '@/shared/mocks/services/security'
import { recordAudit } from '@/shared/mocks/data/audit'
import { delay, tokenFor } from '@/shared/mocks/server'

const CHALLENGE_TTL_MS = 5 * 60_000
const MAX_ATTEMPTS = 5
const DEACTIVATED = 'This account is deactivated.'

function startSession(user: User): Promise<Session> {
  user.lastLoginAt = new Date().toISOString()
  return delay({ token: tokenFor(user), user })
}

/** Password check. Users with 2FA get a challenge instead of a session (finish with `loginTwoFactor`). */
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = users.find((u) => u.email.toLowerCase() === String(email ?? '').trim().toLowerCase())
  if (!user || !passwordMatches(user.id, password)) {
    await delay(null)
    throw new ApiError('That email and password don’t match an account.', 401)
  }
  if (!user.active) {
    await delay(null)
    throw new ApiError(DEACTIVATED, 403)
  }
  if (user.twoFactorEnabled) {
    const challengeId = `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    loginChallenges.set(challengeId, { userId: user.id, expiresAt: Date.now() + CHALLENGE_TTL_MS, attempts: 0 })
    return delay({ twoFactorRequired: true as const, challengeId })
  }
  return startSession(user)
}

/** Second step: a 6-digit code (or an unused recovery code) for a challenge from `login`. */
export async function loginTwoFactor(challengeId: string, code: string): Promise<Session> {
  const challenge = loginChallenges.get(String(challengeId ?? ''))
  if (!challenge || challenge.expiresAt < Date.now()) {
    loginChallenges.delete(String(challengeId ?? ''))
    await delay(null)
    throw new ApiError('This sign-in has expired. Enter your password again.', 410)
  }
  const user = users.find((u) => u.id === challenge.userId)
  if (!user) throw new ApiError('Account not found.', 404)
  if (!user.active) {
    loginChallenges.delete(challengeId)
    await delay(null)
    throw new ApiError(DEACTIVATED, 403)
  }
  const kind = checkSecondFactor(user.id, code)
  if (!kind) {
    challenge.attempts += 1
    await delay(null)
    if (challenge.attempts >= MAX_ATTEMPTS) {
      loginChallenges.delete(challengeId)
      throw new ApiError('Too many wrong codes. Enter your password again.', 429)
    }
    throw new ApiError('That code didn’t match. Try the newest code from your app.', 401)
  }
  loginChallenges.delete(challengeId)
  if (kind === 'recovery') {
    recordAudit(user, {
      action: 'security',
      entity: 'security',
      entityId: '2fa',
      summary: `${user.name} signed in with a recovery code`,
      changes: [],
    })
  }
  return startSession(user)
}

/** Dev helper behind the role switcher: signs in as the seeded user for a role (skips 2FA). */
export async function switchRole(role: Role): Promise<Session> {
  const user = users.find((u) => u.id === DEMO_USER_BY_ROLE[role])
  if (!user) throw new ApiError('No demo user for that role.', 404)
  if (!user.active) throw new ApiError(DEACTIVATED, 403)
  return startSession(user)
}

/** Synchronous session for a role, used to start a screen already signed in. */
export function demoSessionFor(role: Role): Session {
  const user = users.find((u) => u.id === DEMO_USER_BY_ROLE[role]) ?? users[0]
  return { token: tokenFor(user), user: { ...user } }
}

export async function getUsers(): Promise<User[]> {
  return delay(users)
}
