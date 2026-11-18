import { describe, expect, it } from 'vitest'
import {
  COMPANIES,
  PLATFORM,
  api,
  label,
  leaksIn,
  other,
  platformToken,
  sliceText,
  slicesText,
  subdomainOf,
  userToken,
  ADMIN,
  useSeedPerTest,
  type Co,
  type Res,
} from './harness'
import { ENDPOINTS, fill, isCompany, keyOf, paramsOf, type Endpoint, type Sample } from './endpoints'

/**
 * §1 Table-driven isolation tests: every company endpoint of the coverage table (endpoints.ts), in
 * both directions (Apex → Crest and Crest → Apex). Per endpoint:
 *   auth boundary   no token → 401, every platform role → 401
 *   per company     X-Workspace of the other company → 403 tenant_mismatch (other company unchanged)
 *                   the sample → expected status, no trace of the other company, other company unchanged,
 *                   list counts = own-company recomputation
 *                   companyId / company_id / tenantId / tenant_id / tenant = other company in body + query,
 *                   X-Company-Id / X-Tenant-Id headers → ignored or rejected; nothing stored anywhere
 *                   each owned :param = the other company's id → 404, byte-identical to a missing id
 */

const SPOOF_KEYS = ['companyId', 'company_id', 'tenantId', 'tenant_id', 'tenant'] as const

type Runnable = Endpoint & { sample: (co: Co) => Sample | Promise<Sample> }
const runnable = ENDPOINTS.filter((e): e is Runnable => typeof (e as { sample?: unknown }).sample === 'function')

const expected = (s: Sample) => (Array.isArray(s.expect) ? s.expect : [s.expect ?? 200])

interface Call {
  params?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
  token?: string | null
}

function send(e: Endpoint, co: Co, s: Sample, over: Call = {}): Promise<Res> {
  const method = e.method === 'ALL' ? 'GET' : e.method
  const token = over.token !== undefined ? over.token : userToken(s.as ?? ADMIN[co])
  return api(token, method, fill(e.path, over.params ?? s.params, over.query ?? s.query), {
    body: 'body' in over ? over.body : s.body,
    headers: over.headers,
  })
}

const stamp = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<t>')
const mentions = (text: string, co: Co) => text.split(`"${co}"`).length - 1

function expectNoLeak(res: Res, co: Co, what: string) {
  const leaks = leaksIn(res.body, co)
  expect(leaks, `${what}: the response to ${label(co)} contains ${label(other(co))} data`).toEqual([])
}

function defineEndpointTests(e: Runnable): void {
  const key = keyOf(e.method, e.path)
  const owned = paramsOf(e.path).filter((p) => !(isCompany(e) && e.notOwned?.includes(p)))

  describe(`${key} [${e.kind}]`, () => {
    it('no token and every platform role → 401', async () => {
      const s = await e.sample('co_apex')
      expect((await send(e, 'co_apex', s, { token: null })).status, `${key} without a token`).toBe(401)
      for (const id of Object.values(PLATFORM)) {
        const res = await send(e, 'co_apex', s, { token: platformToken(id) })
        expect(res.status, `${key} with platform user ${id}`).toBe(401)
      }
    })

    for (const co of COMPANIES) {
      const them = other(co)

      it(`${label(co)}: X-Workspace of ${label(them)} → 403 tenant_mismatch; the sample answers as expected, with no ${label(them)} data, and ${label(them)} is unchanged`, async () => {
        const s = await e.sample(co)
        const count = isCompany(e) && e.count ? e.count.expected(co) : null
        const before = sliceText(them)
        const mismatch = await send(e, co, s, { headers: { 'X-Workspace': subdomainOf(them) } })
        expect(mismatch.status, `${key} with X-Workspace ${subdomainOf(them)}`).toBe(403)
        expect(mismatch.body?.code, key).toBe('tenant_mismatch')
        const res = await send(e, co, s)
        expect(expected(s), `${key} as ${label(co)} answered ${res.status}: ${res.text.slice(0, 300)}`).toContain(res.status)
        expectNoLeak(res, co, key)
        expect(sliceText(them), `${key} by ${label(co)} changed ${label(them)} data`).toBe(before)
        if (count !== null && res.status === 200 && isCompany(e) && e.count) {
          expect(e.count.of(res.body), `${key}: rows for ${label(co)} vs own-company recomputation`).toBe(count)
        }
      })

      it(`${label(co)}: companyId / tenant fields of ${label(them)} in body, query and headers are ignored`, async () => {
        const s = await e.sample(co)
        const spoof = Object.fromEntries(SPOOF_KEYS.map((k) => [k, them]))
        const body = s.body && typeof s.body === 'object' && !Array.isArray(s.body) ? { ...(s.body as object), ...spoof } : s.body
        const headers = { 'X-Company-Id': them, 'X-Tenant-Id': them }
        const plain = e.method === 'GET' ? await send(e, co, s) : null
        const before = slicesText()
        const res = await send(e, co, s, { body, query: { ...(s.query ?? {}), ...spoof }, headers })
        // Ignored (same outcome as the plain sample) or rejected as invalid input; never applied to the other company.
        expect([...expected(s), 400, 422], `${key} spoofed as ${label(co)} answered ${res.status}: ${res.text.slice(0, 300)}`).toContain(res.status)
        expectNoLeak(res, co, `${key} (spoofed)`)
        const after = slicesText()
        expect(after[them], `${key} with spoofed company fields changed ${label(them)} data`).toBe(before[them])
        // No mass assignment: the spoofed fields were not stored on the caller's own rows either.
        expect(mentions(after[co], them), `${key}: a spoofed ${label(them)} company id was stored in ${label(co)} data`).toBe(mentions(before[co], them))
        if (plain) expect(stamp(res.text), `${key}: a spoofed GET answers differently`).toBe(stamp(plain.text))
      })

      for (const p of owned) {
        it(`${label(co)}: :${p} of ${label(them)} → 404, same answer as a missing id, ${label(them)} unchanged`, async () => {
          const own = await e.sample(co)
          const foreign = await e.sample(them)
          const foreignId = foreign.params?.[p]
          if (!foreignId) throw new Error(`${key}: the sample has no :${p}`)
          const missingId = `zz-missing-${p}`
          const before = sliceText(them)
          const theirs = await send(e, co, own, { params: { ...own.params, [p]: foreignId } })
          expect(theirs.status, `${key} with ${label(them)}'s :${p}=${foreignId} answered ${theirs.status}: ${theirs.text.slice(0, 300)}`).toBe(404)
          expect(sliceText(them), `${key}: ${label(them)}'s record changed`).toBe(before)
          const missing = await send(e, co, own, { params: { ...own.params, [p]: missingId } })
          expect(missing.status, key).toBe(404)
          // Same message and code: a foreign id is indistinguishable from a missing one.
          expect(theirs.text.split(foreignId).join('<id>'), `${key}: foreign vs missing answer`).toBe(missing.text.split(missingId).join('<id>'))
          expectNoLeak(theirs, co, key)
        })
      }
    }
  })
}

/** The table-driven suite is split over SHARDS files (endpoints.<n>.isolation.test.ts) so vitest runs them in parallel. */
export const SHARDS = 4

/** Registers the tests of every SHARDS-th runnable endpoint, starting at `shard`. */
export function defineEndpointSuite(shard: number): void {
  useSeedPerTest()
  runnable.filter((_, i) => i % SHARDS === shard).forEach(defineEndpointTests)
}
