import { getActiveCompanyId, getActiveUserId } from '@/shared/lib/tenantContext'

/**
 * Browser storage rules (docs/API.md "Client storage"):
 *
 *  - Global keys `apexcrm.<key>`: the session token, the platform session, the workspace address
 *    and the last theme for screens shown before sign-in. No tenant data.
 *  - User preferences `<companyId>:<userId>:apexcrm.pref.<key>` (`userStorage.pref`): saved table
 *    views, column order, filters, sidebar, theme, dismissed hints. Kept across sign-in, sign-out
 *    and tenant switch, so they're there again when the same person comes back.
 *  - User data `<companyId>:<userId>:apexcrm.data.<key>` (`userStorage.data`): unsaved form
 *    drafts and any cached records (leads, customers…) or per-session flags. Wiped on sign-out
 *    and on tenant switch (`clearUserData`).
 *
 * Reads and writes only ever use the ACTIVE company and user: another company's or user's
 * scoped keys are never read. Never call window.localStorage / sessionStorage directly in
 * feature code.
 *
 * The dev mock database (IndexedDB) is separate and is not affected by any of this.
 */

export type Area = 'local' | 'session'
export type ScopedKind = 'pref' | 'data'

function area(which: Area): Storage | null {
  try {
    return which === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

/** Full key for a user-scoped value, or null when nobody is signed in. */
export function scopedKey(
  kind: ScopedKind,
  key: string,
  companyId: string | null = getActiveCompanyId(),
  userId: string | null = getActiveUserId(),
): string | null {
  return companyId && userId ? `${companyId}:${userId}:apexcrm.${kind}.${key}` : null
}

const DATA_KEY = /^[^:]+:[^:]+:apexcrm\.data\./

function scoped(kind: ScopedKind) {
  return {
    get(key: string, which: Area = 'local'): string | null {
      const k = scopedKey(kind, key)
      try {
        return k ? (area(which)?.getItem(k) ?? null) : null
      } catch {
        return null
      }
    },
    set(key: string, value: string, which: Area = 'local'): void {
      const k = scopedKey(kind, key)
      try {
        if (k) area(which)?.setItem(k, value)
      } catch {
        // Storage full or unavailable: the value lasts for this page only.
      }
    },
    remove(key: string, which: Area = 'local'): void {
      const k = scopedKey(kind, key)
      try {
        if (k) area(which)?.removeItem(k)
      } catch {
        // Ignore.
      }
    },
    /** For `storage` events from other tabs: is this the full key of `key` for the active user? */
    matches(fullKey: string | null, key: string): boolean {
      return !!fullKey && fullKey === scopedKey(kind, key)
    },
  }
}

export const userStorage = {
  /** Kept across sign-in/out and tenant switch. */
  pref: scoped('pref'),
  /** Drafts, cached records, per-session flags: wiped on sign-out and tenant switch. */
  data: scoped('data'),
}

export const globalStorage = {
  get(key: string): string | null {
    try {
      return area('local')?.getItem(`apexcrm.${key}`) ?? null
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      area('local')?.setItem(`apexcrm.${key}`, value)
    } catch {
      // Ignore.
    }
  },
  remove(key: string): void {
    try {
      area('local')?.removeItem(`apexcrm.${key}`)
    } catch {
      // Ignore.
    }
  },
}

/** Removes every user-data key (all companies and users) from local and session storage. Preferences stay. */
export function clearUserData(): void {
  for (const which of ['local', 'session'] as const) {
    const s = area(which)
    if (!s) continue
    try {
      const doomed: string[] = []
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k && DATA_KEY.test(k)) doomed.push(k)
      }
      doomed.forEach((k) => s.removeItem(k))
    } catch {
      // Ignore.
    }
  }
}
