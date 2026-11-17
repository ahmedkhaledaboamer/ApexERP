import type { User } from '@/shared/types'
import type { AccountInfo, ChangePasswordInput, PasswordChanged } from '@/modules/account/types'
import { passwordProblem } from '@/modules/account/lib/passwordRules'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { passwordChangedAt, passwordMatches, setPassword } from '@/shared/mocks/data/passwords'
import { securityPolicy, sessionsFor, setSessionsFor } from '@/shared/mocks/data/security'
import { recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'

/* Every endpoint here acts on the signed-in user from the token; any role may call them. */

export async function getAccount(user: User): Promise<AccountInfo> {
  return delay({
    user,
    departmentName: departments.find((d) => d.id === user.departmentId)?.name ?? null,
    managerName: user.managerId ? (users.find((u) => u.id === user.managerId)?.name ?? null) : null,
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: passwordChangedAt(user.id),
  })
}

/**
 * Changes the user's own password. A wrong current password is 422, not 401 (401 means
 * "session expired" to the app). On success the user's other sessions are signed out.
 * The password itself never reaches the audit log.
 */
export async function changePassword(user: User, input: Partial<ChangePasswordInput>): Promise<PasswordChanged> {
  const current = typeof input.currentPassword === 'string' ? input.currentPassword : ''
  const next = typeof input.newPassword === 'string' ? input.newPassword : ''
  if (!current) return fail('Enter your current password.', 422)
  if (!passwordMatches(user.id, current)) return fail('Your current password isn’t right.', 422)
  if (!next) return fail('Enter a new password.', 422)
  const problem = passwordProblem(next, securityPolicy.passwordMinLength)
  if (problem) return fail(problem, 422)
  if (next === current) return fail('Choose a password different from your current one.', 422)

  const changedAt = setPassword(user.id, next)
  const sessions = sessionsFor(user.id)
  const others = sessions.filter((s) => !s.current)
  setSessionsFor(
    user.id,
    sessions.filter((s) => s.current),
  )
  const signedOut = others.length
    ? ` and signed out ${others.length} other session${others.length === 1 ? '' : 's'}`
    : ''
  recordAudit(user, {
    action: 'security',
    entity: 'security',
    entityId: 'password',
    summary: `${user.name} changed their password${signedOut}`,
    changes: [{ field: 'password', from: '—', to: 'Changed' }],
  })
  return delay({ changedAt, signedOutSessions: others.length })
}
