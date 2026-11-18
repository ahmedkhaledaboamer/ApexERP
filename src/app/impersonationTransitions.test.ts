import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Session } from '@/shared/types'
import type { Company, ImpersonationInfo } from '@/modules/tenancy/types'

/**
 * Impersonation start / stop are their own session transitions: both drop the whole query cache
 * and wipe the user data kept in storage (drafts, cached records), so nothing typed or seen as the
 * company user survives either way. Write mode (same support session) is not a transition.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
}

const local = new MemoryStorage()
const session = new MemoryStorage()
;(globalThis as unknown as { window: unknown }).window = { localStorage: local, sessionStorage: session }

const { makeStore } = await import('@/app/store')
const { transitionKind, watchSessionTransitions } = await import('@/app/sessionTransitions')
const { signedIn, signedOut } = await import('@/store/authSlice')
const { userStorage } = await import('@/shared/lib/storage')

function company(id: string): Company {
  return {
    id,
    name: id,
    subdomain: id,
    status: 'active',
    plan: 'business',
    enabledModules: ['sales'],
    regional: { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', language: 'en', dateFormat: 'd MMM yyyy', weekStartsOn: 1, weekend: [0, 6], vatPct: 5 },
    branding: { displayName: id, logoUrl: null, monogram: 'X', palette: {}, emailSenderName: id, emailSenderAddress: `${id}@x.test` },
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Company
}

const imp = (over: Partial<ImpersonationInfo> = {}): ImpersonationInfo =>
  ({
    platformUserId: 'p_support',
    platformUserName: 'Sam Support',
    platformRole: 'Platform Support',
    startedAt: '2026-11-18T10:00:00.000Z',
    sessionId: 'imp_1',
    reason: 'Ticket 4411: cannot see leads',
    expiresAt: '2026-11-18T10:30:00.000Z',
    mode: 'read',
    ...over,
  }) as ImpersonationInfo

function sessionFor(userId: string, companyId: string, impersonation: ImpersonationInfo | null = null): Session {
  return {
    token: `t-${userId}-${impersonation?.mode ?? 'x'}`,
    user: { id: userId, companyId, name: userId, role: 'Sales Agent' } as Session['user'],
    tenant: company(companyId),
    impersonation,
  }
}

const USER = sessionFor('uA', 'co_one')
const AS_USER = sessionFor('uA', 'co_one', imp())
const AS_USER_WRITE = sessionFor('uA', 'co_one', imp({ mode: 'write' }))
const AS_OTHER = sessionFor('uB', 'co_two', imp({ startedAt: '2026-11-18T11:00:00.000Z' }))

describe('transitionKind', () => {
  it('detects impersonation start and stop', () => {
    expect(transitionKind(null, AS_USER)).toBe('impersonation-start')
    expect(transitionKind(USER, AS_USER)).toBe('impersonation-start')
    expect(transitionKind(AS_USER, null)).toBe('impersonation-stop')
    expect(transitionKind(AS_USER, USER)).toBe('impersonation-stop')
  })
  it('a new support session is a new start; write mode is not a transition kind change', () => {
    expect(transitionKind(AS_USER, AS_OTHER)).toBe('impersonation-start')
    expect(transitionKind(AS_USER, AS_USER_WRITE)).toBe('user-switch')
  })
  it('keeps the other kinds', () => {
    expect(transitionKind(null, USER)).toBe('login')
    expect(transitionKind(USER, null)).toBe('logout')
    expect(transitionKind(USER, sessionFor('uC', 'co_two'))).toBe('tenant-switch')
  })
})

describe('impersonation start/stop clear the cache and user data', () => {
  beforeEach(() => {
    local.clear()
    session.clear()
  })

  function setup(qc: QueryClient) {
    const store = makeStore(undefined, { persistSession: true })
    watchSessionTransitions(store, qc, { persist: true })
    return store
  }

  it('start wipes stored drafts and the query cache; stop wipes what was saved during the session', () => {
    const qc = new QueryClient()
    const store = setup(qc)
    store.dispatch(signedIn(USER))
    userStorage.data.set('draft', 'company user draft')
    userStorage.pref.set('ui', '{"theme":"dark"}')
    qc.setQueryData(['leads'], [1, 2, 3])

    store.dispatch(signedIn(AS_USER))
    expect(qc.getQueryData(['leads'])).toBeUndefined()
    expect(local.getItem('co_one:uA:apexcrm.data.draft')).toBeNull()
    // Preferences are not user data: kept.
    expect(local.getItem('co_one:uA:apexcrm.pref.ui')).not.toBeNull()

    userStorage.data.set('draft', 'typed while impersonating')
    qc.setQueryData(['leads'], ['seen as the user'])
    store.dispatch(signedOut())
    expect(qc.getQueryData(['leads'])).toBeUndefined()
    expect(local.getItem('co_one:uA:apexcrm.data.draft')).toBeNull()
  })

  it('switching to write mode keeps the cache (same support session)', () => {
    const qc = new QueryClient()
    const store = setup(qc)
    store.dispatch(signedIn(AS_USER))
    qc.setQueryData(['leads'], [1])
    store.dispatch(signedIn(AS_USER_WRITE))
    expect(qc.getQueryData(['leads'])).toEqual([1])
  })
})
