import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { campaigns } from '@/shared/mocks/data/marketing'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { callApi } from './helpers'

/**
 * Marketing per role, TABLE-DRIVEN FROM PERMISSION_MATRIX (Marketing and Reports columns), for every
 * role in both companies, through the real MSW handlers:
 *  - marketing hidden → 403 on every /marketing endpoint (lists, items, writes, report);
 *  - view → reads 200, writes 403 (campaign create / update / cost, bulk email create / send);
 *  - full → reads and writes 200;
 *  - the cost-per-lead report additionally needs a Reports scope of `full` or `marketing`
 *    (reports/lib/marketingAccess.ts), else 403;
 *  - another company's campaign is 404 for every role that can see marketing (403 before for hidden).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']

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
        id: `u-mkt-${co}-${slug}`,
        companyId: co,
        name: `Marketing ${role} ${co}`,
        email: `mkt-${slug}@${co}.test`,
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
const campaignOf = (co: Co) => campaigns.find((c) => c.companyId === co)!.id
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')

describe('Marketing per role, derived from PERMISSION_MATRIX (both companies)', () => {
  it('the matrix only uses marketing scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'marketing'))
  })

  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}`, async () => {
        const u = userFor(co, role)
        const token = tokenFor(u)
        const scope = scopeOf(role, 'marketing')
        const where = `${u.id} (${role}, marketing=${scope})`
        const read = can(role, 'marketing', 'view') ? 200 : 403
        const write = can(role, 'marketing', 'edit') ? 200 : 403
        const id = campaignOf(co)

        for (const path of ['/marketing/campaigns', '/marketing/emails', '/marketing/options', `/marketing/campaigns/${id}`, `/marketing/campaigns/${id}/results`]) {
          expect((await callApi(token, 'GET', path)).status, `${where} GET ${path}`).toBe(read)
        }
        const report = await callApi(token, 'GET', '/marketing/reports/cost-per-lead?from=2026-01-01&to=2026-12-31')
        expect(report.status, `${where} report`).toBe(read === 200 && canSeeMarketingReportsRole(role) ? 200 : 403)

        const created = await callApi(token, 'POST', '/marketing/campaigns', { name: `Role probe ${role}`, channel: 'ads' })
        expect(created.status, `${where} create campaign`).toBe(write)
        expect((await callApi(token, 'PATCH', `/marketing/campaigns/${id}`, { goal: 'Role probe' })).status, `${where} patch`).toBe(write)
        expect((await callApi(token, 'POST', `/marketing/campaigns/${id}/costs`, { amount: 10, incurred_on: '2026-11-01' })).status, `${where} cost`).toBe(write)
        const email = await callApi(token, 'POST', '/marketing/emails', { name: `Role probe ${role}` })
        expect(email.status, `${where} create email`).toBe(write)

        // Another company's campaign: invisible (404) to anyone who can see marketing.
        const foreign = await callApi(token, 'GET', `/marketing/campaigns/${campaignOf(other(co))}`)
        expect(foreign.status, `${where} foreign`).toBe(read === 200 ? 404 : 403)
      })
    }
  }
})
