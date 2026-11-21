import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { finBills, finPurchaseOrders, finSupplierProfiles } from '@/shared/mocks/data/financePurchases'
import { departmentHeadOf } from '@/shared/mocks/services/financeApprovals'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Purchases & payables — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting` column;
 * docs/API.md › Finance › Suppliers / Purchase orders / Bills / Approval rules):
 *   full    (Company Admin, Management, Accountant) every read and write; IBAN reveal
 *   view    (Sales Manager) reads suppliers, POs, bills, payments, payables; every write 403
 *   hidden  suppliers / bills / payments / payables / rules 403 — BUT purchase orders are self-service: any employee
 *           creates a request for their OWN department and sees their own requests; a department head also sees their
 *           department's and approves the step waiting for them (without accounting access).
 * Every role × both companies; the plan gate; foreign ids 404 like missing; a spoofed company is ignored.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const EMPLOYEE: Record<Co, string> = { co_apex: 'u11', co_crest: 'u107' }
const HEAD: Record<Co, string> = { co_apex: 'u10', co_crest: 'u106' }
const VENDOR: Record<Co, string> = { co_apex: 'VND-1002', co_crest: 'VND-5002' }
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

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
      const user: User = {
        id: `u-fpur-${co}-${slug}`, companyId: co, name: `Purchases ${role} ${co}`, email: `fpur-${slug}@${co}.test`, role, title: role,
        managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString(),
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

const byId = (id: string) => users.find((u) => u.id === id)!
const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)
const own = <T extends { companyId: string }>(rows: readonly T[], co: Co, pred: (r: T) => boolean = () => true) => rows.find((r) => r.companyId === co && pred(r))!
const poBody = (co: Co, extra: Record<string, unknown> = {}) => ({ vendor_id: VENDOR[co], lines: [{ description: 'Role probe', quantity: 2, unit_price: 100 }], ...extra })

describe('the accounting column only uses handled scopes', () => {
  it('every role’s accounting scope is one this suite understands', () => {
    for (const role of ROLES) expect(HANDLED, role).toContain(PERMISSION_MATRIX[role].accounting)
  })
})

describe('scopes per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].accounting})`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'accounting')
        const bill = own(finBills, co, (b) => b.status === 'open' && b.balanceDue > 10 && b.exchangeRate === 1)
        const vendor = own(finSupplierProfiles, co, (p) => !!p.iban).vendorId
        const reads = ['/finance/suppliers', `/finance/suppliers/${vendor}`, `/finance/suppliers/${vendor}/statement`, '/finance/debit-notes', '/finance/bill-payments', '/finance/payment-runs', '/finance/payables/aging', '/finance/payables/due', '/finance/payables/overview', '/finance/approval-rules']
        for (const p of reads) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        // Bills: finance reads all; anyone else only the bills waiting for their approval step (none here) — a bill id is 404.
        const bills = await call(u, 'GET', '/finance/bills')
        expect(bills.status).toBe(200)
        if (scope === 'hidden') expect(bills.body).toEqual([])
        else expect((bills.body as unknown[]).length).toBe(finBills.filter((b) => b.companyId === co).length)
        expect((await call(u, 'GET', `/finance/bills/${bill.id}`)).status, `${role} bill detail`).toBe(scope === 'hidden' ? 404 : 200)
        // Self-service for everyone: the pickers, the PO list, and a request for their own department.
        expect((await call(u, 'GET', '/finance/purchases/meta')).status, `${role} meta`).toBe(200)
        const list = await call(u, 'GET', '/finance/purchase-orders')
        expect(list.status).toBe(200)
        const ids = (list.body as { id: string }[]).map((x) => x.id).sort()
        if (scope !== 'hidden') {
          expect(ids).toEqual(finPurchaseOrders.filter((p) => p.companyId === co).map((p) => p.id).sort())
        } else {
          for (const id of ids) {
            const po = finPurchaseOrders.find((p) => p.id === id)!
            expect(po.requesterId === u.id || departmentHeadOf(co, po.departmentId) === u.id || po.decisions.some((d) => d.by === u.id) || po.status === 'pending_approval', `${role} sees ${id}`).toBe(true)
          }
        }
        const created = await call(u, 'POST', '/finance/purchase-orders', poBody(co))
        expect(created.status, `${role} PO request: ${JSON.stringify(created.body).slice(0, 200)}`).toBe(200)
        expect(created.body.requester_id).toBe(u.id)
        expect(created.body.department_id).toBe(u.departmentId || null)
        expect((await call(u, 'POST', `/finance/purchase-orders/${created.body.id}/submit`)).status).toBe(200)

        const writes: [string, string, unknown?][] = [
          ['POST', '/finance/bills', { vendor_id: VENDOR[co], supplier_invoice_number: `ROLE-${role}`, lines: [{ description: 'x', quantity: 1, unit_price: 10 }] }],
          ['PATCH', `/finance/suppliers/${vendor}`, { notes: 'Role probe' }],
          ['POST', `/finance/suppliers/${vendor}/reveal-iban`],
          ['POST', '/finance/debit-notes', { bill_id: bill.id, reason: 'Role probe', amount: 1 }],
          ['POST', '/finance/bill-payments', { vendor_id: bill.vendorId, payment_account_id: 'ACC-1120', allocations: [{ bill_id: bill.id, amount: 1 }] }],
          ['POST', '/finance/suppliers', { name: `Role supplier ${role} ${co}` }],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(scope === 'full' ? 200 : 403)
        }
        const rules = await call(u, 'PUT', '/finance/approval-rules', { doc_type: 'purchase_order', rules: [{ min_amount: 0, approver: 'department_head' }] })
        expect(rules.status, `${role} rules`).toBe(scope === 'full' && (roleOf(u) === 'Company Admin' || roleOf(u) === 'Accountant') ? 200 : 403)
      })
    }
  }
})

describe('employee purchase requests (self-service)', () => {
  for (const co of COMPANIES) {
    it(`${co}: own department only; sees own requests; no bills; can’t approve own`, async () => {
      const emp = byId(EMPLOYEE[co])
      expect(scopeOf(roleOf(emp), 'accounting')).toBe('hidden')
      const otherDept = co === 'co_apex' ? 'd-sales' : 'c2-sales'
      const wrong = await call(emp, 'POST', '/finance/purchase-orders', poBody(co, { department_id: otherDept }))
      expect(wrong.status).toBe(403)
      expect(wrong.body.code).toBe('own_department_only')
      const po = await call(emp, 'POST', '/finance/purchase-orders', poBody(co))
      expect(po.status).toBe(200)
      expect(po.body.department_id).toBe(emp.departmentId)
      expect(po.body.can.edit).toBe(true)
      const mine = await call(emp, 'GET', '/finance/purchase-orders?view=mine')
      expect((mine.body as { id: string }[]).map((x) => x.id)).toContain(po.body.id)
      await call(emp, 'POST', `/finance/purchase-orders/${po.body.id}/submit`)
      const self = await call(emp, 'POST', `/finance/purchase-orders/${po.body.id}/approve`)
      expect(self.status).toBe(403)
      expect(self.body.code).toBe('own_request')
      expect((await call(emp, 'GET', '/finance/bills')).body).toEqual([])
      expect((await call(emp, 'GET', '/finance/suppliers')).status).toBe(403)
      // Another department's PO is invisible (404 like a missing id).
      const foreignDept = own(finPurchaseOrders, co, (p) => p.departmentId !== emp.departmentId && p.requesterId !== emp.id)
      expect((await call(emp, 'GET', `/finance/purchase-orders/${foreignDept.id}`)).status).toBe(404)
      // A colleague (not the head) can't see it either.
      const colleague = users.find((u) => u.companyId === co && u.active && u.departmentId === emp.departmentId && u.id !== emp.id && u.id !== HEAD[co] && scopeOf(roleOf(u), 'accounting') === 'hidden')
      if (colleague) expect((await call(colleague, 'GET', `/finance/purchase-orders/${po.body.id}`)).status).toBe(404)
    })
  }
})

describe('department heads approve their step without accounting access', () => {
  for (const co of COMPANIES) {
    it(`${co}: the head sees the request awaiting them and the department’s, approves step 1; the next step goes to finance`, async () => {
      const emp = byId(EMPLOYEE[co])
      const head = byId(HEAD[co])
      expect(scopeOf(roleOf(head), 'accounting')).toBe('hidden')
      const po = await call(emp, 'POST', '/finance/purchase-orders', { vendor_id: VENDOR[co], lines: [{ description: 'Big order', quantity: 1, unit_price: 12000 }] })
      await call(emp, 'POST', `/finance/purchase-orders/${po.body.id}/submit`)
      const awaiting = await call(head, 'GET', '/finance/purchase-orders?view=awaiting')
      expect((awaiting.body as { id: string; awaiting_me: boolean }[]).find((x) => x.id === po.body.id)?.awaiting_me).toBe(true)
      const dept = await call(head, 'GET', '/finance/purchase-orders')
      for (const row of dept.body as { id: string; department_id: string | null; requester_id: string }[]) {
        const rec = finPurchaseOrders.find((p) => p.id === row.id)!
        expect(rec.departmentId === head.departmentId || rec.requesterId === head.id || rec.decisions.some((d) => d.by === head.id) || departmentHeadOf(co, rec.departmentId) === head.id).toBe(true)
      }
      const ok = await call(head, 'POST', `/finance/purchase-orders/${po.body.id}/approve`)
      expect(ok.status).toBe(200)
      expect(ok.body.status).toBe('pending_approval')
      expect(ok.body.pending_step).toBe('Accountant')
      // The head can't take the accountant step too (one step per user, and not their role).
      expect((await call(head, 'POST', `/finance/purchase-orders/${po.body.id}/approve`)).status).toBe(403)
      // Another department's head (a Sales Manager: accounting view, so the PO is visible) can't act on it.
      const otherHead = byId(co === 'co_apex' ? 'u3' : 'u103')
      const notTheirs = await call(otherHead, 'POST', `/finance/purchase-orders/${po.body.id}/approve`)
      expect(notTheirs.status).toBe(403)
      expect(notTheirs.body.code).toBe('not_your_step')
      // Finance finishes the chain.
      const finance = byId(co === 'co_apex' ? 'u8' : 'u102')
      const done = await call(finance, 'POST', `/finance/purchase-orders/${po.body.id}/approve`)
      expect(done.status).toBe(200)
      expect(done.body.status).toBe('approved')
    })
  }
})

describe('plan gate', () => {
  it('without the accounting module every role answers 403 module_not_in_plan (also PO requests); the other company still answers', async () => {
    moduleOverrides.push({ companyId: 'co_apex', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    for (const role of ROLES) {
      for (const p of ['/finance/purchase-orders', '/finance/bills']) {
        const r = await call(userFor('co_apex', role), 'GET', p)
        expect(r.status, `${role} ${p}`).toBe(403)
        expect(r.body.code).toBe('module_not_in_plan')
      }
    }
    expect((await call(userFor('co_crest', 'Employee'), 'GET', '/finance/purchase-orders')).status).toBe(200)
  })
})

describe('ids of the other company behave like missing ids; a spoofed company is ignored', () => {
  const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
  for (const co of COMPANIES) {
    it(`${co}: foreign PO / bill / supplier / payment ids → 404 like missing`, async () => {
      const admin = byId(ADMIN[co])
      const them = other(co)
      const paths = [
        `/finance/purchase-orders/${own(finPurchaseOrders, them).id}`,
        `/finance/bills/${own(finBills, them).id}`,
        `/finance/suppliers/${own(finSupplierProfiles, them).vendorId}`,
      ]
      for (const p of paths) {
        const foreign = await call(admin, 'GET', p)
        const missing = await call(admin, 'GET', p.replace(/[^/]+$/, 'ZZ-404'))
        expect(foreign.status, p).toBe(404)
        expect(foreign.body).toEqual(missing.body)
      }
    })
    it(`${co}: a spoofed company_id in the body is ignored`, async () => {
      const emp = byId(EMPLOYEE[co])
      const r = await call(emp, 'POST', '/finance/purchase-orders', { ...poBody(co), company_id: other(co), companyId: other(co) })
      expect(r.status).toBe(200)
      expect(finPurchaseOrders.find((p) => p.id === r.body.id)?.companyId).toBe(co)
    })
  }
})
