import type { Role, Session, User } from '@/shared/types'
import type { LoginResult } from '@/modules/auth/types'
import { http } from '@/shared/lib/axios'

/** Returns a session, or a 2FA challenge when the account has two-factor turned on. */
export async function login(email: string, password: string): Promise<LoginResult> {
  return (await http.post<LoginResult>('/auth/login', { email, password })).data
}

/** Second sign-in step: the 6-digit code (or a recovery code) for the challenge from `login`. */
export async function loginTwoFactor(challengeId: string, code: string): Promise<Session> {
  return (await http.post<Session>('/auth/login/2fa', { challengeId, code })).data
}

/** Dev-only: sign in as the seeded user for a role (the role switcher in the topbar). */
export async function switchRole(role: Role): Promise<Session> {
  return (await http.post<Session>('/auth/switch-role', { role })).data
}

export async function getMe(): Promise<User> {
  return (await http.get<User>('/auth/me')).data
}

export async function getUsers(): Promise<User[]> {
  return (await http.get<User[]>('/users')).data
}
