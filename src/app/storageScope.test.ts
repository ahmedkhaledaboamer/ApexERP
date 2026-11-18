import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Session } from '@/shared/types'
import type { Company } from '@/modules/tenancy/types'

/**
 * Client storage rules (docs/API.md "Client storage"): UI preferences are scoped by
 * company + user and survive sign-out and switches; user data (drafts, cached records) is wiped
 * on sign-out and tenant switch; nobody reads another user's or company's keys.
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
  keys() {
    return [...this.map.keys()]
  }
}

const local = new MemoryStorage()
const session = new MemoryStorage()
;(globalThis as unknown as { window: unknown }).window = { localStorage: local, sessionStorage: session }

// Imported after the fake window exists.
const { makeStore } = await import('@/app/store')
const { watchSessionTransitions } = await import('@/app/sessionTransitions')
const { signedIn, signedOut } = await import('@/store/authSlice')
const { tablePrefsChanged } = await import('@/store/tablePrefsSlice')
const { themeToggled } = await import('@/store/uiSlice')
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
    branding: { displayName: id, logoUrl: null, monogram: 'X', palette: {} as Company['branding']['palette'], emailSenderName: id, emailSenderAddress: `${id}@x.test` },
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Company
}

function sessionFor(userId: string, companyId: string): Session {
  return {
    token: `t-${userId}`,
    user: { id: userId, companyId, name: userId, role: 'Sales Agent' } as Session['user'],
    tenant: company(companyId),
    impersonation: null,
  }
}

const A = sessionFor('uA', 'co_one') // user A, company one
const B = sessionFor('uB', 'co_one') // user B, same company
const C = sessionFor('uC', 'co_two') // user C, other company
const A_IN_TWO = sessionFor('uA', 'co_two') // same user id, other company

const VIEW = { columnVisibility: { email: false }, columnOrder: ['name', 'owner', 'email'], sorting: [{ id: 'name', desc: true }], columnFilters: [{ id: 'status', value: 'Won' }], pageSize: 50 }

function setup() {
  const store = makeStore(undefined, { persistSession: true })
  watchSessionTransitions(store, new QueryClient(), { persist: true })
  return store
}

describe('client storage scoping', () => {
  beforeEach(() => {
    local.clear()
    session.clear()
  })

  it("user A's table views are not visible to user B (same company) or to a user of another company", () => {
    const store = setup()
    store.dispatch(signedIn(A))
    store.dispatch(tablePrefsChanged({ id: 'leads', prefs: VIEW }))
    store.dispatch(themeToggled())
    expect(store.getState().tablePrefs.leads).toEqual(VIEW)
    expect(store.getState().ui.theme).toBe('dark')
    expect(local.keys()).toContain('co_one:uA:apexcrm.pref.ui')

    // Same company, other user: starts from defaults, A's view and theme aren't carried over.
    store.dispatch(signedIn(B))
    expect(store.getState().tablePrefs.leads).toBeUndefined()
    expect(store.getState().ui.theme).toBe('light')
    expect(userStorage.pref.get('ui')).toBeNull()

    // Other company.
    store.dispatch(signedIn(C))
    expect(store.getState().tablePrefs.leads).toBeUndefined()
    expect(userStorage.pref.get('ui')).toBeNull()

    // Same user id but in another company: still a different scope.
    store.dispatch(signedIn(A_IN_TWO))
    expect(store.getState().tablePrefs.leads).toBeUndefined()

    // A's view was never overwritten by the others and comes back for A.
    store.dispatch(signedIn(A))
    expect(store.getState().tablePrefs.leads).toEqual(VIEW)
    expect(store.getState().ui.theme).toBe('dark')
  })

  it('preferences survive sign-out, sign-in and a tenant switch; a reload restores them', () => {
    const store = setup()
    store.dispatch(signedIn(A))
    store.dispatch(tablePrefsChanged({ id: 'customers', prefs: { pageSize: 100 } }))
    store.dispatch(signedOut())
    expect(store.getState().tablePrefs).toEqual({})
    expect(local.getItem('co_one:uA:apexcrm.pref.ui')).not.toBeNull()
    store.dispatch(signedIn(C))
    store.dispatch(signedIn(A))
    expect(store.getState().tablePrefs.customers).toEqual({ pageSize: 100 })

    // Reload: a new store reads the saved session and A's own prefs.
    const reloaded = setup()
    expect(reloaded.getState().auth.session?.user.id).toBe('uA')
    expect(reloaded.getState().tablePrefs.customers).toEqual({ pageSize: 100 })
  })

  it('user data (drafts, cached records) is wiped on sign-out and tenant switch, not on a same-company user switch', () => {
    const store = setup()
    store.dispatch(signedIn(A))
    userStorage.data.set('draft.lead', '{"company":"Acme"}')
    userStorage.data.set('alerts.seen', '["x"]', 'session')
    expect(local.getItem('co_one:uA:apexcrm.data.draft.lead')).not.toBeNull()

    store.dispatch(signedIn(B)) // same company: A's draft stays (scoped to A, unreadable by B)
    expect(userStorage.data.get('draft.lead')).toBeNull()
    expect(local.getItem('co_one:uA:apexcrm.data.draft.lead')).not.toBeNull()

    store.dispatch(signedIn(C)) // tenant switch: all user data gone
    expect(local.keys().some((k) => k.includes(':apexcrm.data.'))).toBe(false)
    expect(session.keys().some((k) => k.includes(':apexcrm.data.'))).toBe(false)

    userStorage.data.set('draft.lead', '{"company":"Beta"}')
    store.dispatch(signedOut()) // sign-out: gone too, prefs kept
    expect(local.keys().some((k) => k.includes(':apexcrm.data.'))).toBe(false)
  })

  it('nothing is readable while signed out', () => {
    const store = setup()
    store.dispatch(signedIn(A))
    userStorage.pref.set('onboarding.dismissed', '1')
    store.dispatch(signedOut())
    expect(userStorage.pref.get('onboarding.dismissed')).toBeNull()
    store.dispatch(signedIn(A))
    expect(userStorage.pref.get('onboarding.dismissed')).toBe('1')
  })
})
