import { subDays } from 'date-fns'
import { DEMO_PASSWORD } from '@/shared/lib/constants'
import { registerMap } from '@/shared/mocks/persist/registry'

/**
 * Mock password store. Every seeded user starts with the demo password; a change lives in
 * memory until the page reloads. A real backend stores only a salted hash.
 */
const passwords = registerMap('passwords', new Map<string, string>())

/** When each user last set their password. */
const changedAt = registerMap('passwords.changedAt', new Map<string, string>())

export function passwordMatches(userId: string, candidate: string): boolean {
  return String(candidate ?? '') === (passwords.get(userId) ?? DEMO_PASSWORD)
}

/** Stores the new password and returns when it was set. */
export function setPassword(userId: string, password: string): string {
  passwords.set(userId, password)
  const at = new Date().toISOString()
  changedAt.set(userId, at)
  return at
}

export function passwordChangedAt(userId: string): string {
  const known = changedAt.get(userId)
  if (known) return known
  // Seeded users: stable per user, between 20 and 140 days ago.
  let h = 0
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const seeded = subDays(new Date(), 20 + (h % 121)).toISOString()
  changedAt.set(userId, seeded)
  return seeded
}
