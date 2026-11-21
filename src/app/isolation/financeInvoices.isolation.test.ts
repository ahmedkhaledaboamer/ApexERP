import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { financeCreditNotes, financeRecurring, invoiceRecords } from '@/shared/mocks/data/financeInvoices'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Invoices, credit notes, recurring invoices, ZATCA — TABLE-DRIVEN FROM PERMISSION_MATRIX
 * (`accounting` column; docs/API.md › Finance › Invoices):
 *   full    (Company Admin, Management, Accountant) every read and write
 *   view    (Sales Manager) every read of the company's invoices / credit notes / schedules; every write 403;
 *           the detail says `can.issue = false` (no Issue button)
 *   hidden  403 everywhere
 * Every role × both companies; the plan gate (module `accounting` removed → 403 module_not_in_plan); foreign
 * ids answer 404 like missing ones; a spoofed company in the body is ignored.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const CUSTOMER: Record<Co, string> = { co_apex: 'C-1030', co_crest: 'C-5010' }

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
        id: `u-finv-${co}-${slug}`,
        companyId: co,
        name: `Invoices ${role} ${co}`,
        email: `finv-${slug}@${co}.test`,
        role,
        title: role,
        managerId: null,
        mobile: '',
        departmentId: '',
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

const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)
const own = <T extends { companyId: string }>(rows: readonly T[], co: Co, pred: (r: T) => boolean = () => true) => rows.find((r) => r.companyId === co && pred(r))!
const draftBody = (co: Co) => ({ customer_id: CUSTOMER[co], lines: [{ description: 'Role probe', quantity: 1, unit_price: 100 }] })

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
        const issued = own(invoiceRecords, co, (i) => i.status === 'issued' && i.balanceDue > 10)
        const draft = own(invoiceRecords, co, (i) => i.status === 'draft')
        const cn = own(financeCreditNotes, co)
        const rec = own(financeRecurring, co)
        const reads: string[] = [
          '/finance/invoices',
          '/finance/invoices?status=overdue',
          `/finance/invoices/${issued.id}`,
          '/finance/invoices/meta',
          '/finance/invoices/sources',
          '/finance/credit-notes',
          `/finance/credit-notes/${cn.id}`,
          '/finance/recurring-invoices',
          `/finance/recurring-invoices/${rec.id}`,
        ]
        for (const p of reads) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        if (scope !== 'hidden') {
          const list = await call(u, 'GET', '/finance/invoices')
          expect((list.body as { id: string }[]).map((x) => x.id).sort()).toEqual(invoiceRecords.filter((i) => i.companyId === co).map((i) => i.id).sort())
          const detail = await call(u, 'GET', `/finance/invoices/${draft.id}`)
          expect((detail.body as { can: { issue: boolean; edit: boolean } }).can.issue).toBe(scope === 'full')
          expect((detail.body as { can: { issue: boolean; edit: boolean } }).can.edit).toBe(scope === 'full')
        }
        const writes: [string, string, unknown?][] = [
          ['POST', '/finance/invoices', draftBody(co)],
          ['PATCH', `/finance/invoices/${draft.id}`, { notes: 'Role probe' }],
          ['POST', `/finance/invoices/${issued.id}/send`, { to: 'probe@example.org' }],
          ['POST', '/finance/credit-notes', { invoice_id: issued.id, reason: 'Role probe', lines: [{ invoice_line_id: issued.lines[0].id, amount: 1 }] }],
          ['PATCH', `/finance/recurring-invoices/${rec.id}`, { mode: 'draft' }],
          ['POST', `/finance/invoices/${draft.id}/issue`],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(scope === 'full' ? 200 : 403)
        }
        // ZATCA XML: KSA only; a write-level (audited) download.
        const xml = await call(u, 'POST', `/finance/invoices/${issued.id}/zatca-xml`)
        expect(xml.status, `${role} xml`).toBe(scope === 'full' ? (co === 'co_crest' ? 200 : 409) : 403)
      })
    }
  }
})

describe('plan gate', () => {
  it('without the accounting module every role answers 403 module_not_in_plan; the other company still answers', async () => {
    moduleOverrides.push({ companyId: 'co_apex', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    for (const role of ROLES) {
      const r = await call(userFor('co_apex', role), 'GET', '/finance/invoices')
      expect(r.status, role).toBe(403)
      expect(r.body.code).toBe('module_not_in_plan')
    }
    expect((await call(userFor('co_crest', 'Company Admin'), 'GET', '/finance/invoices')).status).toBe(200)
  })
})

describe('ids of the other company behave like missing ids; a spoofed company is ignored', () => {
  const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!
  const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
  for (const co of COMPANIES) {
    it(`${co}: foreign invoice / credit note / schedule ids → 404 like missing`, async () => {
      const them = other(co)
      const pairs: [string, string][] = [
        [`/finance/invoices/${own(invoiceRecords, them).id}`, '/finance/invoices/INV-0'],
        [`/finance/credit-notes/${own(financeCreditNotes, them).id}`, '/finance/credit-notes/CN-0'],
        [`/finance/recurring-invoices/${own(financeRecurring, them).id}`, '/finance/recurring-invoices/REC-0'],
      ]
      for (const [foreign, missing] of pairs) {
        const a = await call(admin(co), 'GET', foreign)
        const b = await call(admin(co), 'GET', missing)
        expect(a.status).toBe(404)
        expect(a.body).toEqual(b.body)
      }
      const r = await call(admin(co), 'POST', '/finance/invoices', { customer_id: own(invoiceRecords, them).customerId, lines: [{ description: 'x', quantity: 1, unit_price: 1 }] })
      expect(r.status).toBe(422)
      expect(r.body.code).toBe('customer_not_found')
    })

    it(`${co}: company_id in the body is ignored`, async () => {
      const before = invoiceRecords.filter((i) => i.companyId === other(co)).length
      const r = await call(admin(co), 'POST', '/finance/invoices', { ...draftBody(co), company_id: other(co), companyId: other(co) })
      expect(r.status).toBe(200)
      expect(invoiceRecords.find((i) => i.id === r.body.id)!.companyId).toBe(co)
      expect(invoiceRecords.filter((i) => i.companyId === other(co)).length).toBe(before)
    })
  }
})
