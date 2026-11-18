import { users } from '@/shared/mocks/db'

/**
 * Platform-wide identity rule: one email = one company (for now). A person's login is their email,
 * so the same address can't belong to users in two companies. Memberships stay a separate entity
 * (user ↔ company ↔ role); this only guards the email.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

/** The user (in any company) that owns this email, if any. */
export function userWithEmail(email: string, exceptUserId?: string) {
  const e = normalizeEmail(email)
  return users.find((u) => u.id !== exceptUserId && normalizeEmail(u.email) === e)
}

/** Shown when the email belongs to a user in another company. Never names that company. */
export const EMAIL_IN_OTHER_COMPANY =
  'This email is already used by another Apex CRM account. Ask the person for a different work email.'
