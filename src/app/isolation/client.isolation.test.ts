import { beforeEach, describe, expect, it } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import type { Session } from '@/shared/types'
import type { Company, ImpersonationInfo, PlatformSession } from '@/modules/tenancy/types'
import { ALLOWED_GLOBAL_KEYS, SCOPED_KEY, installMemoryWindow } from './helpers'

/**
 * Client-side isolation (§3): what the browser keeps for one company / user / operator can never
 * be read by another one — the TanStack Query cache, user-scoped storage (preferences, drafts and
 * cached records), saved table views, the global keys, and the platform console session.
 */

const { local, session } = installMemoryWindow()

// Imported after the fake window exists.
const { makeStore } = await import('@/app/store')
const { makeQueryClient } = await import('@/app/queryClient')
const { transitionKind, watchSessionTransitions, WIPES_USER_DATA } = await import('@/app/sessionTransitions')
const { signedIn, signedOut } = await import('@/store/authSlice')
const { platformSignedIn, platformSignedOut } = await import('@/store/tenantSlice')
const { tablePrefsChanged, tablePrefsReset } = await import('@/store/tablePrefsSlice')
const { lastSourceUsed } = await import('@/store/prefsSlice')
const { userStorage } = await import('@/shared/lib/storage')
const { setActiveIdentity, tenantQueryKeyHash } = await import('@/shared/lib/tenantContext')

/* ---------------- Fixtures ---------------- */

const APEX_NAME = 'Apex Isolation Holdings'
const CREST_NAME = 'Crest Isolation Freight'

function company(id: string, name: string): Company {
  return {
    id,
    name,
    subdomain: id.replace('co_', ''),
    status: 'active',
    plan: 'business',
    enabledModules: ['sales'],
    regional: { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', language: 'en', dateFormat: 'd MMM yyyy', weekStartsOn: 1, weekend: [0, 6], vatPct: 5 },
    branding: { displayName: name, logoUrl: null, monogram: 'X', palette: {}, emailSenderName: name, emailSenderAddress: `${id}@x.test` },
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Company
}

const APEX = company('co_apex', APEX_NAME)
const CREST = company('co_crest', CREST_NAME)

const imp = (startedAt = '2026-11-18T10:00:00.000Z'): ImpersonationInfo =>
  ({
    platformUserId: 'p_support',
    platformUserName: 'Sam Support',
    platformRole: 'Platform Support',
    startedAt,
    sessionId: `imp_${startedAt}`,
    reason: 'Ticket 4411',
    expiresAt: '2026-11-18T10:30:00.000Z',
    mode: 'read',
  }) as ImpersonationInfo

function sessionFor(userId: string, tenant: Company, impersonation: ImpersonationInfo | null = null): Session {
  return {
    token: `company-token-${userId}-${tenant.id}${impersonation ? '-imp' : ''}`,
    user: { id: userId, companyId: tenant.id, name: `Name ${userId}`, role: 'Sales Agent' } as Session['user'],
    tenant,
    impersonation,
  }
}

/** User A and user B of Apex; user C of Crest; user A's id again, but in Crest. */
const A = sessionFor('uA', APEX)
const B = sessionFor('uB', APEX)
const C = sessionFor('uC', CREST)
const A_IN_CREST = sessionFor('uA', CREST)
const AS_A = sessionFor('uA', APEX, imp())

const PLATFORM: PlatformSession = {
  kind: 'platform',
  token: 'platform-token-SECRET-p2',
  platformUser: { id: 'p_support', name: 'Sam Support', email: 'support@apexcrm.app', platformRole: 'Platform Support' },
}

/** Business data of Apex that must never reach global storage. */
const APEX_LEAD_ID = 'L-1001'
const APEX_LEAD_COMPANY = 'Gulf Pearl Isolation Trading'

const VIEW_A = {
  columnVisibility: { email: false, mobile: false },
  columnOrder: ['company', 'owner', 'status'],
  sorting: [{ id: 'company', desc: true }],
  columnFilters: [{ id: 'status', value: 'Won' }, { id: 'company', value: APEX_LEAD_COMPANY }],
  pageSize: 50,
}

/** Seeds query keys like the ones the app uses (sales, billing, platform console). */
const SEEDED_KEYS: readonly (readonly unknown[])[] = [
  ['leads'],
  ['leads', APEX_LEAD_ID],
  ['billing'],
  ['billing', 'overview'],
  ['platform', 'companies'],
  ['platform', 'audit', { companyId: 'co_apex' }],
  ['tasks', { mine: true }],
]

function seedCache(qc: QueryClient, label: string) {
  for (const key of SEEDED_KEYS) qc.setQueryData(key, { from: label, key })
}

function setup() {
  const store = makeStore(undefined, { persistSession: true })
  const qc = makeQueryClient()
  watchSessionTransitions(store, qc, { persist: true })
  return { store, qc }
}

const allKeys = () => [...local.keys(), ...session.keys()]
const dataKeys = () => allKeys().filter((k) => SCOPED_KEY.exec(k)?.[3] === 'data')
const globalEntries = () => [...local.entries(), ...session.entries()].filter(([k]) => !SCOPED_KEY.test(k))

beforeEach(() => {
  local.clear()
  session.clear()
  setActiveIdentity(null, null)
})

/* ---------------- 1. Query cache on every transition ---------------- */

type Case = { kind: ReturnType<typeof transitionKind>; before: Session | null; after: Session | null; platform?: boolean }

const CASES: Case[] = [
  { kind: 'login', before: null, after: A },
  { kind: 'logout', before: A, after: null },
  { kind: 'tenant-switch', before: A, after: C },
  { kind: 'user-switch', before: A, after: B },
  { kind: 'impersonation-start', before: null, after: AS_A, platform: true },
  { kind: 'impersonation-start', before: A, after: AS_A },
  { kind: 'impersonation-stop', before: AS_A, after: null, platform: true },
]

describe('query cache: every session transition empties it', () => {
  it('covers every transition kind', () => {
    const kinds = new Set(CASES.map((c) => c.kind))
    for (const k of ['login', 'logout', 'tenant-switch', 'user-switch', 'impersonation-start', 'impersonation-stop'] as const) {
      expect(kinds.has(k), `no case for transition "${k}"`).toBe(true)
    }
  })

  for (const c of CASES) {
    it(`${c.kind}: ${c.before?.user.id ?? 'signed out'}@${c.before?.tenant.id ?? '-'} → ${c.after?.user.id ?? 'signed out'}@${c.after?.tenant.id ?? '-'}`, () => {
      expect(transitionKind(c.before, c.after)).toBe(c.kind)
      const { store, qc } = setup()
      if (c.platform) store.dispatch(platformSignedIn(PLATFORM))
      if (c.before) store.dispatch(signedIn(c.before))
      seedCache(qc, 'before')
      expect(qc.getQueryCache().getAll()).toHaveLength(SEEDED_KEYS.length)

      store.dispatch(c.after ? signedIn(c.after) : signedOut())

      expect(qc.getQueryCache().getAll()).toHaveLength(0)
      for (const key of SEEDED_KEYS) expect(qc.getQueryData(key), JSON.stringify(key)).toBeUndefined()
    })
  }

  it('a fetch that was in flight for company A never lands in the cache after the switch to B', async () => {
    const { store, qc } = setup()
    store.dispatch(signedIn(A))
    let release!: (v: unknown) => void
    const pending = qc.fetchQuery({ queryKey: ['leads'], queryFn: () => new Promise((r) => (release = r)) }).catch(() => 'cancelled')
    store.dispatch(signedIn(C))
    release([{ id: APEX_LEAD_ID, company: APEX_LEAD_COMPANY }])
    await pending
    expect(qc.getQueryData(['leads'])).toBeUndefined()
    expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })
})

describe('query keys are hashed with the company id', () => {
  it('the same key hashes differently for company A and company B (and signed out)', () => {
    for (const key of SEEDED_KEYS) {
      setActiveIdentity('co_apex', 'uA')
      const a = tenantQueryKeyHash(key)
      setActiveIdentity('co_crest', 'uC')
      const b = tenantQueryKeyHash(key)
      setActiveIdentity(null, null)
      const none = tenantQueryKeyHash(key)
      expect(new Set([a, b, none]).size, JSON.stringify(key)).toBe(3)
      expect(a).toContain('co_apex')
      expect(b).toContain('co_crest')
    }
  })

  it('even without the cache clear, a stale entry of company A is never served to company B', () => {
    const qc = makeQueryClient()
    setActiveIdentity('co_apex', 'uA')
    seedCache(qc, 'apex')
    // Simulate a missed clear: only the active company changes.
    setActiveIdentity('co_crest', 'uC')
    for (const key of SEEDED_KEYS) expect(qc.getQueryData(key), JSON.stringify(key)).toBeUndefined()
    // Back on A the entries are still A's (so the hash, not luck, is what separated them).
    setActiveIdentity('co_apex', 'uA')
    expect(qc.getQueryData(['leads'])).toEqual({ from: 'apex', key: ['leads'] })
  })
})

/* ---------------- 2. Scoped storage on every transition ---------------- */

describe('scoped storage: drafts / user data and preferences', () => {
  for (const c of CASES) {
    const wipes = WIPES_USER_DATA.has(c.kind)
    it(`${c.kind}: user data ${wipes ? 'wiped' : 'kept but unreadable'}, preferences kept and scoped`, () => {
      const { store } = setup()
      if (c.platform) store.dispatch(platformSignedIn(PLATFORM))
      // A crashed tab could leave an older draft behind for this user; seed one for every case.
      setActiveIdentity('co_apex', 'uA')
      userStorage.data.set('draft.lead.old', 'left over')
      setActiveIdentity(null, null)
      if (c.before) store.dispatch(signedIn(c.before))
      const prev = c.before ?? A
      setActiveIdentity(prev.tenant.id, prev.user.id)
      userStorage.data.set('draft.lead', JSON.stringify({ company: APEX_LEAD_COMPANY }))
      userStorage.data.set('cache.leads', JSON.stringify([APEX_LEAD_ID]), 'session')
      userStorage.pref.set('onboarding.dismissed', '1')
      const prefix = `${prev.tenant.id}:${prev.user.id}:apexcrm.`
      expect(local.getItem(`${prefix}data.draft.lead`)).not.toBeNull()
      expect(session.getItem(`${prefix}data.cache.leads`)).not.toBeNull()
      expect(local.getItem(`${prefix}pref.onboarding.dismissed`)).toBe('1')
      if (c.before) setActiveIdentity(c.before.tenant.id, c.before.user.id)
      else setActiveIdentity(null, null)

      store.dispatch(c.after ? signedIn(c.after) : signedOut())

      if (wipes) {
        expect(dataKeys(), 'user data left after the transition').toEqual([])
      } else {
        // Same-company user switch / login: the data stays under its owner's key...
        expect(local.getItem(`${prefix}data.draft.lead`)).not.toBeNull()
      }
      // ...and is never readable by whoever is active now, unless that is the same person.
      const samePerson = !!c.after && c.after.tenant.id === prev.tenant.id && c.after.user.id === prev.user.id
      if (!samePerson) {
        expect(userStorage.data.get('draft.lead')).toBeNull()
        expect(userStorage.data.get('cache.leads', 'session')).toBeNull()
        expect(userStorage.pref.get('onboarding.dismissed')).toBeNull()
      }
      // Preferences are never wiped and stay under the owner's company + user prefix.
      expect(local.getItem(`${prefix}pref.onboarding.dismissed`)).toBe('1')
      for (const k of allKeys().filter((k) => SCOPED_KEY.test(k))) {
        const [, co, user] = SCOPED_KEY.exec(k)!
        expect(['co_apex', 'co_crest']).toContain(co)
        expect(['uA', 'uB', 'uC']).toContain(user)
      }
    })
  }

  it('preferences of A are read back only by A in the same company', () => {
    const { store } = setup()
    store.dispatch(signedIn(A))
    userStorage.pref.set('hint', 'A')
    for (const other of [B, C, A_IN_CREST]) {
      store.dispatch(signedIn(other))
      expect(userStorage.pref.get('hint'), `${other.user.id}@${other.tenant.id}`).toBeNull()
    }
    store.dispatch(signedOut())
    expect(userStorage.pref.get('hint')).toBeNull()
    store.dispatch(signedIn(A))
    expect(userStorage.pref.get('hint')).toBe('A')
    expect(local.getItem('co_apex:uA:apexcrm.pref.hint')).toBe('A')
  })
})

/* ---------------- 3. Global storage ---------------- */

describe('global storage holds only the allowed global keys, never business data', () => {
  it('after a simulated session across two companies and a sign-out', () => {
    const { store } = setup()
    store.dispatch(signedIn(A))
    store.dispatch(tablePrefsChanged({ id: 'leads', prefs: VIEW_A }))
    store.dispatch(lastSourceUsed({ userId: 'uA', source: 'referral' }))
    userStorage.data.set('draft.lead', JSON.stringify({ id: APEX_LEAD_ID, company: APEX_LEAD_COMPANY }))
    userStorage.data.set('alerts.seen', JSON.stringify([APEX_LEAD_ID]), 'session')

    store.dispatch(signedIn(C)) // tenant switch
    store.dispatch(tablePrefsChanged({ id: 'leads', prefs: { pageSize: 25 } }))

    const leaksApex = (v: string) => [APEX_LEAD_ID, APEX_LEAD_COMPANY, APEX_NAME, 'co_apex', 'uA'].filter((s) => v.includes(s))
    for (const [k, v] of globalEntries()) {
      expect(ALLOWED_GLOBAL_KEYS.has(k), `unexpected global key ${k}`).toBe(true)
      expect(leaksApex(v), `${k} carries Apex data after switching to Crest`).toEqual([])
    }

    store.dispatch(signedOut())
    for (const [k, v] of globalEntries()) {
      expect(ALLOWED_GLOBAL_KEYS.has(k), `unexpected global key ${k}`).toBe(true)
      const leaks = [...leaksApex(v), ...[CREST_NAME, 'co_crest', 'uC'].filter((s) => v.includes(s))]
      expect(leaks, `${k} carries company data after sign-out`).toEqual([])
    }
    expect(local.getItem('apexcrm.session')).toBeNull()
    // Business data lives only in scoped preference keys (saved views), never in a global key.
    expect(local.getItem('co_apex:uA:apexcrm.pref.ui')).toContain(APEX_LEAD_COMPANY)
  })

  it('source code writes only allowed global keys (globalStorage and direct window storage)', () => {
    // Every app source file as text (Vite glob; tests excluded).
    const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    const found: string[] = []
    for (const [file, text] of Object.entries(sources)) {
      const constant = (name: string) => new RegExp(`const ${name}\\s*=\\s*'([^']+)'`).exec(text)?.[1]
      const resolve = (arg: string) => (arg.startsWith("'") ? arg.slice(1, -1) : constant(arg))
      for (const m of text.matchAll(/globalStorage\.set\(\s*('[^']+'|[A-Z_]+)/g)) {
        const key = resolve(m[1])
        expect(key, `${file}: can't resolve global key ${m[1]}`).toBeTruthy()
        found.push(`apexcrm.${key}`)
      }
      for (const m of text.matchAll(/window\.(?:localStorage|sessionStorage)\.setItem\(\s*('[^']+'|[A-Z_]+)/g)) {
        const key = resolve(m[1])
        expect(key, `${file}: can't resolve storage key ${m[1]}`).toBeTruthy()
        found.push(key!)
      }
    }
    expect(found.length).toBeGreaterThan(0)
    for (const key of found) expect(ALLOWED_GLOBAL_KEYS.has(key), `global key ${key} is not on the allowed list`).toBe(true)
  })
})

/* ---------------- 4. Saved views (table prefs) ---------------- */

describe('saved views are per company + user', () => {
  it("A's views are invisible to B (same company) and to A's id in another company; switching loads only the incoming user's", () => {
    const { store } = setup()
    store.dispatch(signedIn(A))
    store.dispatch(tablePrefsChanged({ id: 'leads', prefs: VIEW_A }))
    store.dispatch(tablePrefsChanged({ id: 'tasks', prefs: { sorting: [{ id: 'dueDate', desc: false }] } }))
    store.dispatch(lastSourceUsed({ userId: 'uA', source: 'referral' }))
    expect(store.getState().tablePrefs.leads).toEqual(VIEW_A)

    store.dispatch(signedIn(B))
    expect(store.getState().tablePrefs).toEqual({})
    expect(store.getState().prefs.lastSourceByUser).toEqual({})
    store.dispatch(tablePrefsChanged({ id: 'leads', prefs: { pageSize: 25 } }))
    // B's own view never picks up A's columns, order, sorting or filters.
    expect(store.getState().tablePrefs.leads).toEqual({ pageSize: 25 })

    store.dispatch(signedIn(A_IN_CREST))
    expect(store.getState().tablePrefs).toEqual({})
    store.dispatch(signedIn(C))
    expect(store.getState().tablePrefs).toEqual({})

    store.dispatch(signedIn(A))
    expect(store.getState().tablePrefs.leads).toEqual(VIEW_A)
    expect(store.getState().tablePrefs.tasks).toEqual({ sorting: [{ id: 'dueDate', desc: false }] })
    expect(store.getState().prefs.lastSourceByUser).toEqual({ uA: 'referral' })

    // Raw storage: one key per company + user, each holding only its owner's views.
    const savedA = JSON.parse(local.getItem('co_apex:uA:apexcrm.pref.ui')!)
    const savedB = JSON.parse(local.getItem('co_apex:uB:apexcrm.pref.ui')!)
    expect(savedA.tablePrefs.leads).toEqual(VIEW_A)
    expect(savedB.tablePrefs).toEqual({ leads: { pageSize: 25 } })
    expect(local.getItem('co_crest:uA:apexcrm.pref.ui')).toBeNull()

    // Resetting A's view touches only A's key.
    store.dispatch(tablePrefsReset('leads'))
    expect(JSON.parse(local.getItem('co_apex:uB:apexcrm.pref.ui')!).tablePrefs).toEqual({ leads: { pageSize: 25 } })
  })

  it('a reload as B loads only B’s views', () => {
    const first = setup().store
    first.dispatch(signedIn(A))
    first.dispatch(tablePrefsChanged({ id: 'leads', prefs: VIEW_A }))
    first.dispatch(signedIn(B))
    first.dispatch(tablePrefsChanged({ id: 'leads', prefs: { pageSize: 10 } }))

    const reloaded = setup().store
    expect(reloaded.getState().auth.session?.user.id).toBe('uB')
    expect(reloaded.getState().tablePrefs).toEqual({ leads: { pageSize: 10 } })
  })
})

/* ---------------- 5. Platform session vs company session ---------------- */

describe('platform session and company session never mix', () => {
  it('impersonation keeps the operator out of company storage, and stopping restores no company data', () => {
    const { store, qc } = setup()
    // The user once saved a view of their own.
    store.dispatch(signedIn(A))
    store.dispatch(tablePrefsChanged({ id: 'leads', prefs: VIEW_A }))
    store.dispatch(signedOut())
    const userPrefsBefore = local.getItem('co_apex:uA:apexcrm.pref.ui')

    store.dispatch(platformSignedIn(PLATFORM))
    expect(JSON.parse(local.getItem('apexcrm.platform')!)).toEqual(PLATFORM)
    expect(local.getItem('apexcrm.session')).toBeNull()

    store.dispatch(signedIn(AS_A)) // impersonation start
    expect(store.getState().tenant.platform).toEqual(PLATFORM)
    // The operator sees the user's own saved views...
    expect(store.getState().tablePrefs.leads).toEqual(VIEW_A)
    const companySession = local.getItem('apexcrm.session')!
    expect(companySession).not.toContain(PLATFORM.token)
    expect(local.getItem('apexcrm.platform')).not.toContain(AS_A.token)
    expect(local.getItem('apexcrm.platform')).not.toContain('co_apex')

    // ...but whatever they change during the support session is not saved over the user's views.
    store.dispatch(tablePrefsChanged({ id: 'leads', prefs: { pageSize: 100, sorting: [{ id: 'owner', desc: false }] } }))
    userStorage.data.set('draft.lead', 'typed by the operator')
    qc.setQueryData(['leads'], [APEX_LEAD_ID])
    expect(local.getItem('co_apex:uA:apexcrm.pref.ui')).toBe(userPrefsBefore)
    for (const [k, v] of [...local.entries(), ...session.entries()]) {
      if (k !== 'apexcrm.platform') expect(v, k).not.toContain(PLATFORM.token)
    }

    store.dispatch(signedOut()) // impersonation stop
    expect(store.getState().auth.session).toBeNull()
    expect(store.getState().tenant.platform).toEqual(PLATFORM)
    expect(store.getState().tablePrefs).toEqual({})
    expect(qc.getQueryCache().getAll()).toHaveLength(0)
    expect(dataKeys()).toEqual([])
    expect(local.getItem('apexcrm.session')).toBeNull()
    expect(JSON.parse(local.getItem('apexcrm.platform')!)).toEqual(PLATFORM)
    expect(local.getItem('co_apex:uA:apexcrm.pref.ui')).toBe(userPrefsBefore)

    store.dispatch(platformSignedOut())
    expect(local.getItem('apexcrm.platform')).toBeNull()
  })

  it('platform sign-in / sign-out never touches a company session in the same browser, and vice versa', () => {
    const { store } = setup()
    store.dispatch(signedIn(A))
    const saved = local.getItem('apexcrm.session')
    store.dispatch(platformSignedIn(PLATFORM))
    expect(local.getItem('apexcrm.session')).toBe(saved)
    expect(store.getState().auth.session?.token).toBe(A.token)
    store.dispatch(platformSignedOut())
    expect(local.getItem('apexcrm.session')).toBe(saved)

    store.dispatch(platformSignedIn(PLATFORM))
    store.dispatch(signedOut())
    expect(JSON.parse(local.getItem('apexcrm.platform')!)).toEqual(PLATFORM)
    expect(local.getItem('apexcrm.session')).toBeNull()

    // A reload keeps each where it was.
    const reloaded = setup().store
    expect(reloaded.getState().auth.session).toBeNull()
    expect(reloaded.getState().tenant.platform).toEqual(PLATFORM)
  })
})
