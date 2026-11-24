import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, User } from '@/shared/types'
import type { PlanModule } from '@/modules/billing/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { navItemVisible, routeDecision } from '@/modules/billing/gating'
import { NAV_SECTIONS } from '@/shared/components/layout/navigation'
import { MY_HR_SLOTS, PORTAL_SLOT_ORDER } from '@/modules/hr/selfservice/portalSlots'
import { users } from '@/shared/mocks/db'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { finBills, finPaymentRuns, finSupplierAdvances } from '@/shared/mocks/data/financePurchases'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
import '@/shared/mocks/handlers'

/**
 * Accounts & finance gaps — role table (PERMISSION_MATRIX `accounting` column):
 *   NAVIGATION  the "Accounts & finance" section shows only for accounting full / view; every other role reaches
 *               spending self-service from My HR / the user menu ("Request a purchase", "My expense claims",
 *               "Approvals") — the routes stay plan-gated, so a Sales Agent can still open the PO request form.
 *   ADVANCES / PAYMENT FILES / EOSB RUN  accounting full only (view reads advances and the EOSB totals; hidden 403).
 *   APPROVALS INBOX  a department head without accounting access lists what waits for them (view=awaiting).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const EMPLOYEE: Record<Co, string> = { co_apex: 'u11', co_crest: 'u107' }
const HEAD: Record<Co, string> = { co_apex: 'u10', co_crest: 'u106' }
const VENDOR: Record<Co, string> = { co_apex: 'VND-1002', co_crest: 'VND-5002' }
const ENTERPRISE = { modules: ['sales', 'services', 'tasks', 'departments', 'reports', 'settings', 'marketing', 'accounting', 'events', 'integrations', 'hr', 'ai'] as PlanModule[] }

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = { id: `u-fgap-${co}-${slug}`, companyId: co, name: `Gaps ${role} ${co}`, email: `fgap-${slug}@${co}.test`, role, title: role, managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}
beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})
const byId = (id: string) => users.find((u) => u.id === id)!
const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)

const financeSection = NAV_SECTIONS.find((s) => s.id === 'finance')!

describe('navigation: the Accounts & finance section is for finance roles only', () => {
  for (const role of ROLES) {
    const scope = PERMISSION_MATRIX[role].accounting
    it(`${role} (${scope})`, () => {
      const ctx = { role, entitlements: ENTERPRISE }
      const visible = financeSection.items.filter((i) => navItemVisible(i, ctx)).map((i) => i.label)
      if (scope === 'hidden') expect(visible, role).toEqual([])
      else {
        expect(visible).toContain('Purchase orders')
        expect(visible).toContain('Expenses')
        expect(visible).toContain('Bills')
      }
    })
  }

  it('a Sales Agent sees no finance item but the PO request form, My HR card and the approvals inbox stay reachable', async () => {
    expect(scopeOf('Sales Agent', 'accounting')).toBe('hidden')
    const ctx = { role: 'Sales Agent' as Role, entitlements: ENTERPRISE }
    expect(financeSection.items.some((i) => navItemVisible(i, ctx))).toBe(false)
    // The routes are plan-gated only (router.tsx ModuleGate): a plan-only gate allows every role.
    expect(routeDecision({ planModule: 'accounting' }, ctx)).toBe('allow')
    expect(PORTAL_SLOT_ORDER).toEqual(expect.arrayContaining(['purchases', 'approvals', 'expenses']))
    expect(MY_HR_SLOTS.purchases.component).not.toBeNull()
    expect(MY_HR_SLOTS.approvals.component).not.toBeNull()
    // "Request a purchase" through the API: own department, own requests.
    for (const co of COMPANIES) {
      const agent = userFor(co, 'Sales Agent')
      const po = await call(agent, 'POST', '/finance/purchase-orders', { vendor_id: VENDOR[co], lines: [{ description: 'Agent request', quantity: 1, unit_price: 250 }] })
      expect(po.status, JSON.stringify(po.body).slice(0, 200)).toBe(200)
      expect(po.body.requester_id).toBe(agent.id)
      const mine = await call(agent, 'GET', '/finance/purchase-orders?view=mine')
      expect((mine.body as { id: string }[]).map((x) => x.id)).toContain(po.body.id)
    }
  })
})

describe('approvals inbox: a department head without accounting access', () => {
  for (const co of COMPANIES) {
    it(`${co}: lists the request awaiting them (POs ?view=awaiting, bills ?status=awaiting, claims ?view=approvals)`, async () => {
      const head = byId(HEAD[co])
      expect(scopeOf(roleOf(head), 'accounting')).toBe('hidden')
      const emp = byId(EMPLOYEE[co])
      const po = await call(emp, 'POST', '/finance/purchase-orders', { vendor_id: VENDOR[co], lines: [{ description: 'Inbox probe', quantity: 1, unit_price: 500 }] })
      await call(emp, 'POST', `/finance/purchase-orders/${po.body.id}/submit`)
      const pos = await call(head, 'GET', '/finance/purchase-orders?view=awaiting')
      expect(pos.status).toBe(200)
      expect((pos.body as { id: string }[]).map((x) => x.id)).toContain(po.body.id)
      expect((await call(head, 'GET', '/finance/bills?status=awaiting')).status).toBe(200)
      expect((await call(head, 'GET', '/finance/expense-claims?view=approvals')).status).toBe(200)
      expect((await call(emp, 'GET', '/finance/purchase-orders?view=awaiting')).body.map((x: { id: string }) => x.id)).not.toContain(po.body.id)
    })
  }
})

describe('advances, payment files and the EOSB run: accounting full only', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].accounting})`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'accounting')
        const admin = userFor(co, 'Company Admin')
        await call(admin, 'GET', '/finance/payment-runs') // finance hooks (seeds)
        const run = finPaymentRuns.find((r) => r.companyId === co)!
        const adv = finSupplierAdvances.find((a) => a.companyId === co)!
        const bill = finBills.find((b) => b.companyId === co && b.status === 'open' && b.balanceDue > 10 && b.exchangeRate === 1)!
        const read = scope === 'hidden' ? 403 : 200
        expect((await call(u, 'GET', '/finance/supplier-advances')).status, `${role} advances`).toBe(read)
        expect((await call(u, 'GET', `/finance/supplier-advances/${adv.id}`)).status).toBe(read)
        expect((await call(u, 'GET', '/finance/eosb-provision')).status).toBe(read)
        const eosb = await call(u, 'GET', '/finance/eosb-provision')
        if (scope === 'view') expect(eosb.body.rows).toBeNull()
        if (scope === 'full') expect(Array.isArray(eosb.body.rows)).toBe(true)
        const write = scope === 'full' ? 200 : 403
        const file = await call(u, 'POST', `/finance/payment-runs/${run.id}/bank-file`)
        expect(file.status, `${role} bank file`).toBe(write)
        if (write !== 200) expect(JSON.stringify(file.body)).not.toMatch(/[A-Z]{2}\d{2}[A-Z0-9]{15,}/)
        expect((await call(u, 'POST', '/finance/supplier-advances', { vendor_id: VENDOR[co], payment_account_id: 'ACC-1120', amount: 5 })).status, `${role} pay advance`).toBe(write)
        expect((await call(u, 'POST', `/finance/supplier-advances/${adv.id}/apply`, { bill_id: bill.id, amount: 1 })).status === write || scope === 'full', `${role} apply`).toBe(true)
        expect((await call(u, 'POST', '/finance/eosb-provision/run', {})).status, `${role} eosb run`).toBe(write)
      })
    }
  }
})
