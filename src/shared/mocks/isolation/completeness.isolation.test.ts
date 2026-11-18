import { describe, expect, it } from 'vitest'
import { API } from '@/shared/mocks/handlers/utils'
import { ALL_HANDLERS } from './harness'
import { ENDPOINTS, isCompany, keyOf } from './endpoints'
import { SHARDS } from './endpointSuite'

/**
 * §7 Completeness guard. Every registered MSW handler (the `handlers` array + the dev-only billing
 * handlers) must have exactly one entry in the coverage table (endpoints.ts), and every entry must
 * still match a handler. A new endpoint without an isolation entry fails here.
 */

const API_PATH = new URL(API || '/', 'http://mock.local').pathname.replace(/\/$/, '')

function registered(): string[] {
  return ALL_HANDLERS.map((h) => {
    const info = h.info as { method: string | RegExp; path: string | RegExp }
    const method = typeof info.method === 'string' ? info.method.toUpperCase() : 'ALL'
    const raw = String(info.path)
    const path = raw.startsWith(API_PATH) ? raw.slice(API_PATH.length) : raw
    return keyOf(method, path)
  })
}

describe('§7 Completeness: the coverage table lists every registered handler', () => {
  it('every handler has a table entry', () => {
    const table = new Set(ENDPOINTS.map((e) => keyOf(e.method, e.path)))
    const missing = registered().filter((k) => !table.has(k))
    expect(
      missing,
      missing.length
        ? `These handlers have no entry in src/shared/mocks/isolation/endpoints.ts. Add one per handler to ENDPOINTS, e.g.\n` +
            missing
              .map((k) => {
                const [method, path] = k.split(' ')
                return `  { method: '${method}', path: '${path}', kind: 'company-…', module: '…', sample: (co) => ({ … }) },  // or kind 'public' | 'platform' | 'auth' | 'dev' with a reason`
              })
              .join('\n') +
            '\nSee docs/TESTING.md › Isolation suite.'
        : undefined,
    ).toEqual([])
  })

  it('every table entry still matches a handler (no stale entries)', () => {
    const live = new Set(registered())
    const stale = ENDPOINTS.map((e) => keyOf(e.method, e.path)).filter((k) => !live.has(k))
    expect(stale, stale.length ? `Remove (or fix) these entries of ENDPOINTS: no handler is registered for them:\n  ${stale.join('\n  ')}` : undefined).toEqual([])
  })

  it('no handler is listed twice', () => {
    const keys = ENDPOINTS.map((e) => keyOf(e.method, e.path))
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes, 'Each handler needs exactly one entry in ENDPOINTS').toEqual([])
    const handlerKeys = registered()
    expect(handlerKeys.filter((k, i) => handlerKeys.indexOf(k) !== i), 'Two handlers registered for the same method + path (the second is dead code)').toEqual([])
  })

  it('every non-company entry carries a written reason; every company entry a sample', () => {
    const noReason = ENDPOINTS.filter((e) => !isCompany(e) && !(e as { reason?: string }).reason?.trim()).map((e) => keyOf(e.method, e.path))
    expect(noReason, 'public / platform / auth / dev entries need a non-empty `reason`').toEqual([])
    const noSample = ENDPOINTS.filter((e) => isCompany(e) && typeof e.sample !== 'function').map((e) => keyOf(e.method, e.path))
    expect(noSample, 'company-* entries need a `sample(co)`').toEqual([])
  })

  it('platform entries are exactly the /platform/* handlers (except the sign-in)', () => {
    for (const e of ENDPOINTS) {
      if (e.path.startsWith('/platform/') && e.path !== '/platform/auth/login') expect(e.kind, keyOf(e.method, e.path)).toBe('platform')
      if (e.kind === 'platform') expect(e.path.startsWith('/platform/'), keyOf(e.method, e.path)).toBe(true)
    }
  })

  it(`the table-driven suite runs every shard (endpoints.0…${SHARDS - 1}.isolation.test.ts)`, () => {
    const files = Object.keys(import.meta.glob('./endpoints.*.isolation.test.ts')).sort()
    expect(files).toEqual(Array.from({ length: SHARDS }, (_, i) => `./endpoints.${i}.isolation.test.ts`))
  })

  it('table counts (for the report)', () => {
    const by = (k: string) => ENDPOINTS.filter((e) => (k === 'company' ? isCompany(e) : e.kind === k)).length
    const counts = { total: ENDPOINTS.length, company: by('company'), public: by('public'), platform: by('platform'), auth: by('auth'), dev: by('dev') }
    expect(counts.company + counts.public + counts.platform + counts.auth + counts.dev).toBe(counts.total)
    expect(counts.total).toBe(registered().length)
  })
})
