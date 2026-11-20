import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { campaigns } from '@/shared/mocks/data/marketing'
import { audiences, landingPages, leadForms, seoKeywords, sitePages, utmLinks } from '@/shared/mocks/data/marketingGrowth'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * Marketing › growth per role (lead generation, audiences, website & SEO), TABLE-DRIVEN FROM
 * PERMISSION_MATRIX (Marketing column), for every role in both companies, through the real handlers:
 *  - marketing hidden → 403 on every endpoint (reads, writes, exports);
 *  - view → reads 200 (incl. the live audience preview), writes and the audience export 403;
 *  - full → reads and writes 200;
 *  - another company's form / audience / page / keyword is 404 for every role that can see marketing
 *    (403 before for hidden), and its ids inside a body are refused exactly like missing ones;
 *  - the public form / landing page endpoints answer the same whoever calls (no role involved).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const WORKSPACE: Record<Co, string> = { co_apex: 'apexaora', co_crest: 'crest' }

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-grw-${co}-${slug}`,
        companyId: co,
        name: `Growth ${role} ${co}`,
        email: `grw-${slug}@${co}.test`,
        role,
        title: role,
        managerId: null,
        mobile: '',
        departmentId: dept?.id ?? '',
        active: true,
        twoFactorEnabled: false,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})

const userFor = (co: Co, role: Role) => {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role)
  if (!u) throw new Error(`No ${role} in ${co}`)
  return u
}
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
const firstOf = <T extends { companyId: string; id: string }>(rows: readonly T[], co: Co) => rows.find((r) => r.companyId === co)!.id
const ids = (co: Co) => ({
  form: leadForms.find((f) => f.companyId === co && f.status === 'active')!.id,
  page: firstOf(landingPages, co),
  link: firstOf(utmLinks, co),
  audience: firstOf(audiences, co),
  site: firstOf(sitePages, co),
  keyword: firstOf(seoKeywords, co),
  campaign: firstOf(campaigns, co),
})
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
let n = 0

describe('Marketing growth per role, derived from PERMISSION_MATRIX (both companies)', () => {
  it('the matrix only uses marketing scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'marketing'))
  })

  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}`, async () => {
        const u = userFor(co, role)
        const token = tokenFor(u)
        const where = `${u.id} (${role}, marketing=${scopeOf(role, 'marketing')})`
        const read = can(role, 'marketing', 'view') ? 200 : 403
        const write = can(role, 'marketing', 'edit') ? 200 : 403
        const id = ids(co)

        const reads: [string, string, unknown?][] = [
          ['GET', '/marketing/forms'],
          ['GET', `/marketing/forms/${id.form}`],
          ['GET', `/marketing/forms/${id.form}/submissions`],
          ['GET', '/marketing/landing-pages'],
          ['GET', '/marketing/utm-links'],
          ['GET', '/marketing/audiences'],
          ['GET', '/marketing/audiences/options'],
          ['GET', `/marketing/audiences/${id.audience}`],
          ['POST', '/marketing/audiences/preview', { rules: { status_types: ['open'] } }],
          ['GET', '/marketing/seo/pages'],
          ['GET', '/marketing/seo/keywords'],
          ['GET', `/marketing/seo/website-leads?from=${day(-365)}&to=${day(0)}`],
        ]
        for (const [method, path, body] of reads) expect((await callApi(token, method, path, body)).status, `${where} ${method} ${path}`).toBe(read)

        const tag = `${role}-${++n}`
        const writes: [string, string, unknown?][] = [
          ['POST', '/marketing/forms', { name: `Probe ${tag}`, default_source_id: 'Website', field_map: [{ key: 'email', type: 'email', label: 'Email', required: true }, { key: 'contact_name', type: 'contact_name', label: 'Name', required: true }] }],
          ['PATCH', `/marketing/forms/${id.form}`, { success_message: 'Probe' }],
          ['POST', '/marketing/landing-pages', { slug: `probe-${n}`, title: 'Probe' }],
          ['PATCH', `/marketing/landing-pages/${id.page}`, { headline: 'Probe' }],
          ['POST', '/marketing/utm-links', { base_url: 'https://example.org', utm_source: 'probe', utm_medium: 'test' }],
          ['POST', '/marketing/audiences', { name: `Probe ${tag}`, rules: {} }],
          ['PATCH', `/marketing/audiences/${id.audience}`, { description: 'Probe' }],
          ['POST', `/marketing/audiences/${id.audience}/freeze`],
          ['GET', `/marketing/audiences/${id.audience}/export?hashed=true`],
          ['POST', '/marketing/seo/pages', { url: `/probe-${n}`, title: 'Probe page' }],
          ['PATCH', `/marketing/seo/pages/${id.site}`, { status: 'draft' }],
          ['POST', '/marketing/seo/keywords', { keyword: `probe ${tag}` }],
          ['POST', `/marketing/seo/keywords/${id.keyword}/positions`, { date: day(-1), position: 9 }],
          ['POST', '/marketing/seo/keywords/import', { rows: [{ row: 2, keyword: `probe import ${tag}`, date: day(-1), position: '5' }] }],
          ['DELETE', `/marketing/utm-links/${id.link}`],
        ]
        for (const [method, path, body] of writes) {
          const r = await callApi(token, method, path, body)
          expect(r.status, `${where} ${method} ${path}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(write)
        }

        // Another company's records: invisible (404) to anyone who can see marketing.
        const theirs = ids(other(co))
        for (const path of [`/marketing/forms/${theirs.form}`, `/marketing/audiences/${theirs.audience}`, `/marketing/forms/${theirs.form}/submissions`]) {
          expect((await callApi(token, 'GET', path)).status, `${where} foreign ${path}`).toBe(read === 200 ? 404 : 403)
        }
        expect((await callApi(token, 'PATCH', `/marketing/seo/keywords/${theirs.keyword}`, { search_volume: 1 })).status, `${where} foreign keyword`).toBe(read === 200 ? 404 : 403)
      })
    }
  }

  for (const co of COMPANIES) {
    it(`${co}: another company’s ids inside a body answer exactly like missing ones (full role)`, async () => {
      const token = tokenFor(userFor(co, 'Company Admin'))
      const theirs = ids(other(co))
      const theirUser = users.find((u) => u.companyId === other(co) && u.role === 'Sales Agent' && u.active)!.id
      const fields = [{ key: 'email', type: 'email', label: 'Email', required: true }, { key: 'contact_name', type: 'contact_name', label: 'Name', required: true }]
      const cases: [string, string, (x: string) => unknown][] = [
        ['POST', '/marketing/forms', (x) => ({ name: 'Ref', default_source_id: 'Website', field_map: fields, campaign_id: x })],
        ['POST', '/marketing/forms', (x) => ({ name: 'Ref', default_source_id: 'Website', field_map: fields, default_owner_ids: [x] })],
        ['POST', '/marketing/landing-pages', (x) => ({ slug: 'ref-page', title: 'Ref', form_id: x })],
        ['POST', '/marketing/utm-links', (x) => ({ base_url: 'https://example.org', utm_source: 'a', utm_medium: 'b', campaign_id: x })],
        ['POST', '/marketing/audiences', (x) => ({ name: 'Ref', rules: { campaign_ids: [x] } })],
        ['POST', '/marketing/audiences/preview', (x) => ({ rules: { owner_ids: [x] } })],
        ['POST', '/marketing/emails', (x) => ({ name: 'Ref', filters: { audience_id: x } })],
      ]
      const foreignIds = [theirs.campaign, theirUser, theirs.form, theirs.campaign, theirs.campaign, theirUser, theirs.audience]
      for (const [i, [method, path, body]] of cases.entries()) {
        const snap = takeSnapshot(true)
        const a = await callApi(token, method, path, body(foreignIds[i]))
        restoreSnapshot(snap)
        ensureRoleUsers()
        const b = await callApi(token, method, path, body('zz-missing'))
        expect(a.status, `${co} ${path} #${i}`).toBe(422)
        expect(JSON.stringify(a.body), `${co} ${path} #${i}`).toBe(JSON.stringify(b.body))
      }
    })

    it(`${co}: public form and landing page endpoints need no role and only serve ${co}’s own records`, async () => {
      const form = leadForms.find((f) => f.companyId === co && f.status === 'active')!
      const asNobody = await callApi(null, 'GET', `/public/forms/${form.publicKey}`)
      expect(asNobody.status).toBe(200)
      expect(asNobody.body.name).toBe(form.name)
      const page = landingPages.find((p) => p.companyId === co && p.published)!
      const res = await (async () => {
        ;(globalThis as { document?: unknown }).document ??= { baseURI: 'http://localhost/' }
        const [{ getResponse }, { handlers }] = await Promise.all([import('msw'), import('@/shared/mocks/handlers')])
        const r = await getResponse(handlers, new Request(`http://localhost/api/public/pages/${page.slug}`, { headers: { 'X-Workspace': WORKSPACE[other(co)] } }))
        return r!.status
      })()
      // The other company's workspace never resolves this company's slug (unless it has its own page with that slug).
      const theirsHasSlug = landingPages.some((p) => p.companyId === other(co) && p.slug === page.slug && p.published)
      expect(res).toBe(theirsHasSlug ? 200 : 404)
    })
  }
})
