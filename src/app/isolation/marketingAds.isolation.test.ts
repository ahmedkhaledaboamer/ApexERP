import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { campaigns } from '@/shared/mocks/data/marketing'
import { adCampaigns, adConnections } from '@/shared/mocks/data/ads'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { accountsFor } from '@/shared/mocks/services/ads'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { callApi } from './helpers'
// Every mock store registered before the snapshot (callApi imports the handlers lazily).
import '@/shared/mocks/handlers'

/**
 * Ads integrations and Marketing analytics per role, TABLE-DRIVEN FROM PERMISSION_MATRIX (Marketing
 * and Reports columns), for every role in both companies, through the real MSW handlers:
 *  - marketing hidden → 403 everywhere;
 *  - view → connections list / detail 200; account list, connect, sync, disconnect, mapping 403;
 *  - full → all 200 (connect also needs the plan module `integrations`: without it 403
 *    module_not_in_plan for account list / connect / sync / disconnect, while the list still answers);
 *  - analytics: marketing view AND Reports full / marketing, else 403;
 *  - another company's connection / ad campaign → 404 for every role that can see marketing.
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
        id: `u-ads-${co}-${slug}`,
        companyId: co,
        name: `Ads ${role} ${co}`,
        email: `ads-${slug}@${co}.test`,
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
  ;(globalThis as { __apexAdsSync?: string }).__apexAdsSync = 'ok'
})
afterEach(() => {
  delete (globalThis as { __apexAdsSync?: string }).__apexAdsSync
})

const userFor = (co: Co, role: Role) => {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role)
  if (!u) throw new Error(`No ${role} in ${co}`)
  return u
}
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
const connectionOf = (co: Co) => adConnections.find((c) => c.companyId === co && c.status !== 'disconnected')!.id
const adCampaignOf = (co: Co) => adCampaigns.find((c) => c.companyId === co)!.id
const campaignOf = (co: Co) => campaigns.find((c) => c.companyId === co)!.id

describe('Ads integrations and analytics per role, derived from PERMISSION_MATRIX (both companies)', () => {
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
        const conn = connectionOf(co)

        expect((await callApi(token, 'GET', '/marketing/ads/connections')).status, `${where} list`).toBe(read)
        expect((await callApi(token, 'GET', `/marketing/ads/connections/${conn}`)).status, `${where} detail`).toBe(read)
        expect((await callApi(token, 'GET', '/marketing/ads/providers/tiktok/accounts')).status, `${where} accounts`).toBe(write)
        const analytics = await callApi(token, 'GET', '/marketing/analytics?preset=last_30_days')
        expect(analytics.status, `${where} analytics`).toBe(read === 200 && canSeeMarketingReportsRole(role) ? 200 : 403)

        const connect = await callApi(token, 'POST', '/marketing/ads/connections', { provider: 'tiktok', account_id: accountsFor(co, 'tiktok')[0].accountId, consent: true })
        expect(connect.status, `${where} connect`).toBe(write)
        expect((await callApi(token, 'POST', `/marketing/ads/connections/${conn}/sync`)).status, `${where} sync`).toBe(write)
        expect((await callApi(token, 'PATCH', `/marketing/ads/campaigns/${adCampaignOf(co)}`, { campaign_id: campaignOf(co) })).status, `${where} map`).toBe(write)
        expect((await callApi(token, 'DELETE', `/marketing/ads/connections/${conn}`)).status, `${where} disconnect`).toBe(write)

        // Another company's connection and ad campaign: invisible (404) to anyone who can see marketing.
        const foreign = await callApi(token, 'GET', `/marketing/ads/connections/${connectionOf(other(co))}`)
        expect(foreign.status, `${where} foreign connection`).toBe(read === 200 ? 404 : 403)
        const foreignMap = await callApi(token, 'PATCH', `/marketing/ads/campaigns/${adCampaignOf(other(co))}`, { campaign_id: null })
        expect(foreignMap.status, `${where} foreign ad campaign`).toBe(read === 200 ? 404 : 403)
      })
    }
  }

  for (const co of COMPANIES) {
    it(`${co}: without the plan module "integrations" full roles can't connect, sync or disconnect; reads still work`, async () => {
      moduleOverrides.push({ companyId: co, module: 'integrations', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
      for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
        if (!can(role, 'marketing', 'edit')) continue
        const token = tokenFor(userFor(co, role))
        const conn = connectionOf(co)
        expect((await callApi(token, 'GET', '/marketing/ads/connections')).status, role).toBe(200)
        expect((await callApi(token, 'GET', `/marketing/ads/connections/${conn}`)).status, role).toBe(200)
        const accounts = await callApi(token, 'GET', '/marketing/ads/providers/meta/accounts')
        expect(accounts.status, role).toBe(403)
        expect((accounts.body as { code: string }).code).toBe('module_not_in_plan')
        const connect = await callApi(token, 'POST', '/marketing/ads/connections', { provider: 'tiktok', account_id: accountsFor(co, 'tiktok')[0].accountId, consent: true })
        expect(connect.status, role).toBe(403)
        expect((connect.body as { code: string }).code).toBe('module_not_in_plan')
        expect((await callApi(token, 'POST', `/marketing/ads/connections/${conn}/sync`)).status, role).toBe(403)
        expect((await callApi(token, 'DELETE', `/marketing/ads/connections/${conn}`)).status, role).toBe(403)
        // Mapping is CRM data (no provider call): still allowed.
        expect((await callApi(token, 'PATCH', `/marketing/ads/campaigns/${adCampaignOf(co)}`, { campaign_id: null })).status, role).toBe(200)
      }
    })
  }
})
