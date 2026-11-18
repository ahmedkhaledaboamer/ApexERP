import { afterEach, beforeEach, expect } from 'vitest'
import { getResponse, type HttpHandler } from 'msw'
import type { User } from '@/shared/types'
import type { ImpersonationInfo } from '@/modules/tenancy/types'
import { DEMO_PASSWORD } from '@/shared/lib/constants'
import { handlers } from '@/shared/mocks/handlers'
import { devBillingHandlers } from '@/shared/mocks/handlers/devBilling'
import { restoreSnapshot, takeSnapshot, type MockSnapshot } from '@/shared/mocks/persist/registry'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { resetClock } from '@/shared/mocks/clock'
import { platformTokenFor, tokenFor } from '@/shared/mocks/server'

/**
 * Shared harness of the server-side isolation suite (src/shared/mocks/isolation). Requests go through
 * the real MSW handlers (the same code the browser worker runs) with `getResponse`, so the suite
 * tests the API contract, not the service functions. Every response passes the secrets guard
 * (`secretsIn`) on the way out, so any test of the suite that produces a secret fails right there.
 */

// MSW resolves the handlers' relative paths (`/api/...`) against document.baseURI; give node one.
;(globalThis as { document?: unknown }).document ??= { baseURI: 'http://localhost/' }

export const APEX = APEX_ID
export const CREST = CREST_ID
export type Co = typeof APEX_ID | typeof CREST_ID
export const COMPANIES: Co[] = [APEX, CREST]
export const other = (co: Co): Co => (co === APEX ? CREST : APEX)
export const label = (co: Co) => (co === APEX ? 'Apex' : 'Crest')

/** Every handler the mock can answer with, including the dev-only billing simulation. */
export const ALL_HANDLERS: HttpHandler[] = [...handlers, ...devBillingHandlers]

/** Seed users per company and role. */
export const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
export const PLATFORM = { owner: 'p1', support: 'p2', billing: 'p3' } as const

export const userById = (id: string): User => {
  const found = users.find((x) => x.id === id)
  if (!found) throw new Error(`Seed user ${id} is missing`)
  return found
}
/** Every active seed user of a company (one per role at least). */
export const usersOf = (co: Co): User[] => users.filter((x) => x.companyId === co && x.active !== false)
export const userToken = (id: string, imp: ImpersonationInfo | null = null) => tokenFor(userById(id), imp)
export const adminToken = (co: Co) => userToken(ADMIN[co])
export const platformToken = (id: string = PLATFORM.owner) => platformTokenFor(id)
export const subdomainOf = (co: Co) => (co === APEX ? 'apexaora' : 'crest')

/* ---------------- Snapshot hooks ---------------- */

/** The seed DB, taken when the harness loads (every store is registered by then: handlers are imported above). */
export const SEED: MockSnapshot = takeSnapshot(true)

/** Installs beforeEach/afterEach: every test starts from the seed DB and real time (order-independent). */
export function useSeedPerTest(): void {
  // Restored after every test (the first test of a file starts from the fresh module seed).
  beforeEach(() => {
    resetClock()
  })
  afterEach(() => {
    expect(restoreSnapshot(SEED)).toBe(true)
    resetClock()
  })
}

/* ---------------- api() ---------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Res = { status: number; body: any; text: string; method: string; path: string }

export interface ApiOptions {
  body?: unknown
  headers?: Record<string, string>
  /** Raw body text instead of JSON (e.g. an empty body). */
  rawBody?: string
}

/**
 * MSW's own matching costs ~0.2 ms per handler scanned; the suite sends thousands of requests. So the
 * handlers whose method and path could match are picked first (cached regex per handler, a superset
 * of MSW's match), in registration order, and MSW still decides among them (first match wins). When
 * no candidate answers, the full list is tried, so behaviour is exactly MSW's.
 */
const matchers = ALL_HANDLERS.map((h) => {
  const info = h.info as { method: string | RegExp; path: string | RegExp }
  const method = typeof info.method === 'string' ? info.method.toUpperCase() : null
  const raw = String(info.path)
  const re = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+').replace(/\*/g, '.*')}/?$`)
  return { handler: h, method, re }
})

function candidates(method: string, pathname: string): HttpHandler[] {
  return matchers.filter((m) => (m.method === null || m.method === method) && m.re.test(pathname)).map((m) => m.handler)
}

/** Every response of the current test file (method, path, status, body text), for the secrets sweep. */
export const recorded: Res[] = []

/**
 * Sends a request through the real MSW handlers. Every JSON response is checked by the secrets guard
 * (`secretsIn`), which fails the calling test with the offending paths.
 */
export async function api(token: string | null, method: string, path: string, opts: ApiOptions = {}): Promise<Res> {
  const m = method.toUpperCase()
  const req = new Request(`http://localhost/api${path}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
    body: m === 'GET' || m === 'HEAD' ? undefined : opts.rawBody !== undefined ? opts.rawBody : opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const url = new URL(req.url)
  const pick = candidates(m, url.pathname)
  const res = (pick.length ? await getResponse(pick, req.clone()) : undefined) ?? (await getResponse(ALL_HANDLERS, req))
  if (!res) throw new Error(`No handler for ${m} ${path}`)
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  const out: Res = { status: res.status, body, text, method: m, path }
  recorded.push(out)
  const leaks = secretsIn(body, `${m} ${path}`)
  if (leaks.length) throw new Error(`Secrets guard: ${m} ${path} answered with secrets:\n  ${leaks.join('\n  ')}`)
  return out
}

/** Shortcut: the company admin of `co` calls an endpoint. */
export const asAdmin = (co: Co, method: string, path: string, opts?: ApiOptions) => api(adminToken(co), method, path, opts)

/* ---------------- Secrets guard (§8) ---------------- */

/** Keys that must never appear in a response. `token` is allowed only in a session payload (auth responses). */
const SECRET_KEY = /^(password|passwordHash|hash|salt|secret|clientSecret|apiSecret|privateKey|accessToken|refreshToken|apiKey|cvc|cvv|cardNumber|pan|otpSecret|totpSecret|recoveryCodes?)$/i
/** The key without underscores, so snake_case keys (password_hash, recovery_codes, two_factor_secret…) are checked too. */
const bare = (k: string) => k.replace(/_/g, '')
const SESSION_TOKEN_KEY = /^token$/i

/** Luhn check: a 13–19 digit run that passes it looks like a card number. */
export function luhn(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

/** Paths whose answer is a session (the session token is the point of the call). */
const SESSION_PATHS = [
  /^POST \/auth\/login(\/2fa)?$/,
  /^POST \/auth\/switch-role$/,
  /^POST \/auth\/dev\/sign-in$/,
  /^POST \/auth\/impersonation\//,
  /^POST \/platform\/auth\/login$/,
  /^POST \/platform\/impersonations$/,
  /^POST \/public\/signup\/[^/]+\/complete$/,
  /^POST \/public\/checkout$/,
]

/**
 * Accepted exceptions (by design, shown once to the signed-in user about their own account):
 * the TOTP enrollment secret (needed to type the key into an authenticator app) and the one-time
 * recovery codes when 2FA is turned on. Never stored in, or served by, any other response.
 */
const ALLOWED_SECRET_KEYS: Record<string, string[]> = {
  'POST /security/2fa/setup': ['secret'],
  'POST /security/2fa/verify': ['recovery_codes'],
}

/**
 * Secrets in a response body: secret-looking keys (except the session token of an auth response and
 * the ALLOWED_SECRET_KEYS exceptions), card-number-like digit runs (13–19 digits passing Luhn;
 * separators allowed), and the demo password. Integration secrets must be masked (the guard rejects
 * an `apiKey`/`secret` key outright).
 */
export function secretsIn(body: unknown, where: string): string[] {
  const out: string[] = []
  const route = where.replace(/\?.*$/, '')
  const sessionCall = SESSION_PATHS.some((re) => re.test(route))
  const allowed = ALLOWED_SECRET_KEYS[route] ?? []
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (v.includes(DEMO_PASSWORD)) out.push(`${path}: contains the demo password`)
      for (const m of v.matchAll(/\d[\d -]{11,}\d/g)) {
        const digits = m[0].replace(/[ -]/g, '')
        if (digits.length >= 13 && digits.length <= 19 && luhn(digits) && !/^\+/.test(v.slice(Math.max(0, (m.index ?? 0) - 1)))) {
          out.push(`${path}: card-number-like value "${m[0]}"`)
        }
      }
      return
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`))
      return
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (SECRET_KEY.test(bare(k)) && x !== null && x !== undefined && x !== '' && !(path === '$' && allowed.includes(k))) out.push(`${path}.${k}: secret field`)
        if (SESSION_TOKEN_KEY.test(bare(k)) && !sessionCall && typeof x === 'string') out.push(`${path}.${k}: token outside an auth response`)
        walk(x, `${path}.${k}`)
      }
    }
  }
  walk(body, '$')
  return out
}

/* ---------------- Ownership of the mock DB ---------------- */

type Owned = Map<string, Co>

const isCo = (v: unknown): v is Co => v === APEX || v === CREST

/**
 * Walks every registered store and attributes rows to a company:
 *  - a row with `companyId` (or the companies store's own row) belongs to that company;
 *  - a row/entry keyed by a user id, lead id or other owned id (sessionsByUser, passwords, leadWebsites…)
 *    belongs to that id's company; a perTenant map entry belongs to its key.
 * Returns the owned slice of each company (store name → owned parts) and every owned `id`.
 */
export function ownership(snap: MockSnapshot = takeSnapshot(true)): { slice: Record<Co, Record<string, unknown[]>>; ids: Record<Co, Set<string>> } {
  const idOwner: Owned = new Map()
  const slice: Record<Co, Record<string, unknown[]>> = { co_apex: {}, co_crest: {} }
  const ids: Record<Co, Set<string>> = { co_apex: new Set(), co_crest: new Set() }
  const add = (co: Co, store: string, part: unknown) => {
    ;(slice[co][store] ??= []).push(part)
  }
  const collectIds = (co: Co, v: unknown) => {
    if (Array.isArray(v)) v.forEach((x) => collectIds(co, x))
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'id' || k === 'sessionId') && typeof x === 'string') ids[co].add(x)
        else collectIds(co, x)
      }
    }
  }
  const rowOwner = (store: string, row: unknown): Co | null => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const r = row as Record<string, unknown>
    if (store === 'companies' && isCo(r.id)) return r.id
    if (isCo(r.companyId)) return r.companyId
    return null
  }
  // Pass 1: rows with an explicit company.
  for (const [store, value] of Object.entries(snap.stores)) {
    if (!Array.isArray(value)) continue
    for (const row of value) {
      const co = rowOwner(store, row)
      if (!co) continue
      const id = (row as { id?: unknown }).id
      if (typeof id === 'string') idOwner.set(id, co)
    }
  }
  // Keys like `co_apex␟key` (won idempotency) or `co_apex|usage|…` (billing sent keys) belong to their prefix.
  const ownerOfKey = (k: unknown): Co | null => {
    if (isCo(k)) return k
    if (typeof k !== 'string') return null
    const prefix = k.split(/[␟|]/)[0]
    return idOwner.get(k) ?? (isCo(prefix) ? prefix : idOwner.get(prefix) ?? null)
  }
  // Pass 2: attribute everything.
  for (const [store, value] of Object.entries(snap.stores)) {
    if (Array.isArray(value)) {
      for (const row of value) {
        // registerMap stores save as [key, value] tuples; registerSet as plain values.
        if (Array.isArray(row) && row.length === 2) {
          const co = ownerOfKey(row[0])
          if (co) {
            add(co, store, row)
            if (store.startsWith('perTenant:') || isCo(row[0])) collectIds(co, row[1])
          }
          continue
        }
        if (typeof row === 'string') {
          const co = ownerOfKey(row)
          if (co) add(co, store, row)
          continue
        }
        const co = rowOwner(store, row) ?? ownerOfKey((row as { userId?: unknown })?.userId)
        if (co) {
          add(co, store, row)
          if (rowOwner(store, row)) collectIds(co, row)
        }
      }
    } else if (value && typeof value === 'object') {
      for (const [k, x] of Object.entries(value)) {
        const co = ownerOfKey(k)
        if (co) add(co, store, [k, x])
      }
    }
  }
  return { slice, ids }
}

/** Deep-comparable copy of everything a company owns right now. */
export function sliceOf(co: Co): Record<string, unknown[]> {
  return structuredClone(ownership(takeSnapshot(false)).slice[co])
}

/** Everything a company owns right now, serialized (fast deep-equal before/after a request). */
export function sliceText(co: Co): string {
  return JSON.stringify(ownership(takeSnapshot(false)).slice[co])
}

/** Both companies' owned data, serialized, from one walk of the DB. */
export function slicesText(): Record<Co, string> {
  const { slice } = ownership(takeSnapshot(false))
  return { co_apex: JSON.stringify(slice.co_apex), co_crest: JSON.stringify(slice.co_crest) }
}

/* ---------------- Foreign data detection ---------------- */

interface Markers {
  ids: Set<string>
  strings: string[]
}
let markerCache: Record<Co, Markers> | null = null

/** Strings that only one company's seed has: lead company/contact names, user names and emails, its own names. */
function seedMarkers(): Record<Co, Markers> {
  if (markerCache) return markerCache
  const snap = SEED
  const { slice, ids } = ownership(snap)
  const text: Record<Co, string> = { co_apex: JSON.stringify(slice.co_apex), co_crest: JSON.stringify(slice.co_crest) }
  // Global (company-less) data: anything in it is shared by design.
  const owned = new Set([...Object.values(slice.co_apex), ...Object.values(slice.co_crest)].flat())
  const ownedKeys = new Set(
    [...Object.values(slice.co_apex), ...Object.values(slice.co_crest)].flat().filter(Array.isArray).map((t) => (t as unknown[])[0]),
  )
  const globalParts: unknown[] = []
  for (const value of Object.values(snap.stores)) {
    if (Array.isArray(value)) globalParts.push(...value.filter((r) => !owned.has(r)))
    else if (value && typeof value === 'object') globalParts.push(Object.entries(value).filter(([k]) => !ownedKeys.has(k)))
    else globalParts.push(value)
  }
  const globalText = JSON.stringify(globalParts)
  const stores = snap.stores as Record<string, unknown[]>
  const candidates = (co: Co): string[] => {
    const leads = (stores.leads as { companyId: string; company: string; contactName: string; contactEmail: string }[]).filter((l) => l.companyId === co)
    const us = (stores.users as User[]).filter((u) => u.companyId === co)
    const comp = (stores.companies as { id: string; name: string; branding: { displayName: string } }[]).find((c) => c.id === co)!
    return [
      comp.name,
      comp.branding.displayName,
      co === APEX ? '@apexaora.ae' : '@crestlogistics.sa',
      ...leads.flatMap((l) => [l.company, l.contactName, l.contactEmail]),
      ...us.flatMap((u) => [u.name, u.email]),
    ].filter((s) => s && s.length >= 6)
  }
  const build = (co: Co): Markers => {
    const foreign = other(co)
    return {
      ids: new Set([...ids[foreign]].filter((id) => !ids[co].has(id) && id.length >= 3 && !globalText.includes(JSON.stringify(id)))),
      strings: [...new Set(candidates(foreign))].filter((s) => !text[co].includes(s) && !globalText.includes(s)),
    }
  }
  markerCache = { co_apex: build(APEX), co_crest: build(CREST) }
  return markerCache
}

/** Markers of the OTHER company that must never appear in a response to `co`. */
export function foreignMarkers(co: Co): Markers {
  return seedMarkers()[co]
}

/**
 * Every trace of the other company in a response to `co`: a string value (or key) equal to one of its
 * ids, or containing one of its seed-unique strings (names, emails, lead companies).
 */
export function leaksIn(body: unknown, co: Co): string[] {
  const { ids, strings } = foreignMarkers(co)
  const out = new Set<string>()
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (ids.has(v)) out.add(`${path}: foreign id "${v}"`)
      for (const s of strings) if (v.includes(s)) out.add(`${path}: foreign marker "${s}"`)
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (ids.has(k)) out.add(`${path}: foreign id as key "${k}"`)
        walk(x, `${path}.${k}`)
      }
    }
  }
  walk(body, '$')
  return [...out]
}

/** Seed ids of a company's rows in one store (live). */
export function idsIn<T extends { id: string; companyId: string }>(rows: readonly T[], co: Co): string[] {
  return rows.filter((r) => r.companyId === co).map((r) => r.id)
}

export { DEMO_PASSWORD }
