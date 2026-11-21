import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { finPaymentLinks, finPayments, finPdcs } from '@/shared/mocks/data/financeCollections'
import { financeInvoices, financeJournal } from '@/shared/mocks/data/finance'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { addDays, availableOn, todayOf } from '@/shared/mocks/services/financeCollectionsCore'
import { createLinkFor, ensureCollectionsSeed, receivePdcFor, recordPaymentFor } from '@/shared/mocks/services/financeCollections'
import { fixtureInvoice } from '@/shared/mocks/services/financeCollections.fixtures'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Collections — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting` column; docs/API.md › Finance):
 *   full    (Company Admin, Management, Accountant) reads and writes everything
 *   view    (Sales Manager) reads payments, cheques, links, aging, statements, credit; every write → 403
 *   hidden  everything → 403 (the quotation credit check stays open to sales roles, without amounts)
 * Every role × both companies; the plan gate (accounting off → 403 module_not_in_plan, public links → 404);
 * the public pay page by token only (another company's invoice is never shown or paid).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
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
        id: `u-fincol-${co}-${slug}`,
        companyId: co,
        name: `Finance ${role} ${co}`,
        email: `fincol-${slug}@${co}.test`,
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
const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!

/** An open invoice of the company with money left to collect (a fixture when none). */
function openInvoice(co: Co) {
  ensureCollectionsSeed(co)
  return (
    financeInvoices.find((i) => i.companyId === co && availableOn(co, i) > 5) ??
    fixtureInvoice(co, { issueDate: addDays(todayOf(co), -40), dueDate: addDays(todayOf(co), -10), currency: co === 'co_crest' ? 'SAR' : 'AED' })
  )
}

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
        const inv = openInvoice(co)
        const pay = recordPaymentFor(co, ADMIN[co], { customerId: inv.customerId, date: todayOf(co), method: 'cash', amount: 2, currency: inv.currency, exchangeRate: inv.exchangeRate, allocationMode: 'none' })
        const pdc = receivePdcFor(co, ADMIN[co], { customerId: inv.customerId, chequeNo: `R${role.length}`, bankName: 'Role Bank', receivedDate: todayOf(co), dueDate: todayOf(co), amount: 2, currency: inv.currency, exchangeRate: inv.exchangeRate })
        const reads: [string, string][] = [
          ['GET', '/finance/payments'],
          ['GET', `/finance/payments/${pay.id}`],
          ['GET', `/finance/payments/${pay.id}/receipt`],
          ['GET', '/finance/pdcs'],
          ['GET', `/finance/pdcs/${pdc.id}`],
          ['GET', '/finance/payment-links'],
          ['GET', '/finance/receivables/aging'],
          ['GET', `/finance/receivables/aging/${inv.customerId}`],
          ['GET', '/finance/customers'],
          ['GET', `/finance/customers/${inv.customerId}/credit`],
          ['GET', `/finance/customers/${inv.customerId}/statement`],
          ['GET', `/finance/customers/${inv.customerId}/open-items`],
          ['GET', '/finance/collections/settings'],
          ['GET', '/finance/dunning/log'],
          ['GET', '/finance/deposit-accounts'],
        ]
        for (const [m, p] of reads) {
          const r = await call(u, m, p)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        const writes: [string, string, unknown][] = [
          ['POST', '/finance/payments', { customer_id: inv.customerId, date: todayOf(co), method: 'cash', amount: 1, currency: inv.currency, exchange_rate: inv.exchangeRate, allocation_mode: 'none' }],
          ['POST', `/finance/payments/${pay.id}/refund`, { amount: 1 }],
          ['POST', `/finance/pdcs/${pdc.id}/deposit`, {}],
          ['POST', '/finance/payment-links', { invoice_id: inv.id }],
          ['PATCH', `/finance/customers/${inv.customerId}/credit`, { credit_limit: 1000 }],
          ['PATCH', '/finance/collections/settings', { gateway_fee_pct: 1 }],
          ['POST', '/finance/dunning/pause', { target_type: 'customer', target_id: inv.customerId, paused: true }],
          ['POST', `/finance/customers/${inv.customerId}/statement/email`, { email: 'ap@example.com' }],
          ['POST', `/finance/payments/${pay.id}/void`, { reason: 'Role test' }],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(scope === 'full' ? 200 : 403)
        }
        // The quotation credit check: any role with sales or accounting; amounts only with accounting.
        const cc = await call(u, 'GET', `/finance/credit-check?customer_id=${inv.customerId}&amount=10`)
        const canCheck = scopeOf(roleOf(u), 'sales') !== 'hidden' || scope !== 'hidden'
        expect(cc.status, `${role} credit check`).toBe(canCheck ? 200 : 403)
        if (canCheck) expect(cc.body.detail === null, `${role} credit detail`).toBe(scope === 'hidden')
      })
    }
  }

  it('a Sales Manager sees a customer’s balance and credit status but can’t record a payment', async () => {
    const u = userFor('co_apex', 'Sales Manager')
    const inv = openInvoice('co_apex')
    const credit = await call(u, 'GET', `/finance/customers/${inv.customerId}/credit`)
    expect(credit.status).toBe(200)
    expect(credit.body.open_ar).toBeGreaterThan(0)
    const n = finPayments.length
    const r = await call(u, 'POST', '/finance/payments', { customer_id: inv.customerId, date: todayOf('co_apex'), method: 'cash', amount: 1 })
    expect(r.status).toBe(403)
    expect(finPayments.length).toBe(n)
  })
})

describe('plan gate', () => {
  it('without the accounting module every collections endpoint answers 403 module_not_in_plan and its links stop working', async () => {
    const inv = openInvoice('co_crest')
    const link = createLinkFor('co_crest', ADMIN.co_crest, { invoiceId: inv.id })
    moduleOverrides.push({ companyId: 'co_crest', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    for (const p of ['/finance/payments', '/finance/receivables/aging', '/finance/pdcs', '/finance/credit-check']) {
      const r = await call(admin('co_crest'), 'GET', p)
      expect(r.status, p).toBe(403)
      expect(r.body.code, p).toBe('module_not_in_plan')
    }
    const pub = await callApi(null, 'GET', `/public/pay/${link.token}`)
    expect(pub.status).toBe(404)
    // Apex is untouched.
    expect((await call(admin('co_apex'), 'GET', '/finance/payments')).status).toBe(200)
  })
})

describe('public pay page: by token only, never another company', () => {
  const card = { cardholder_name: 'Test Payer', card_number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' }

  for (const co of COMPANIES) {
    const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
    it(`${co}: the page shows only that invoice’s number, amount, currency and the company’s name / logo; paying it touches only ${co}`, async () => {
      const inv = openInvoice(co)
      const theirs = openInvoice(them)
      const link = createLinkFor(co, ADMIN[co], { invoiceId: inv.id })
      const page = await callApi(null, 'GET', `/public/pay/${link.token}`)
      expect(page.status).toBe(200)
      expect(Object.keys(page.body).sort()).toEqual(['amount_due', 'company_name', 'currency', 'invoice_number', 'logo_url', 'message', 'monogram', 'state', 'test_mode'])
      expect(page.body.invoice_number).toBe(inv.number)
      expect(JSON.stringify(page.body)).not.toContain(theirs.number)
      expect(JSON.stringify(page.body)).not.toContain(inv.customerId)
      const theirBefore = {
        invoices: JSON.stringify(financeInvoices.filter((i) => i.companyId === them)),
        payments: JSON.stringify(finPayments.filter((p) => p.companyId === them)),
        journal: financeJournal.filter((e) => e.companyId === them).length,
      }
      const paid = await callApi(null, 'POST', `/public/pay/${link.token}`, card)
      expect(paid.status, JSON.stringify(paid.body)).toBe(200)
      expect(JSON.stringify(paid.body)).not.toMatch(/4242 ?4242 ?4242 ?4242/)
      const p = finPayments.find((x) => x.paymentLinkId === link.id)!
      expect(p.companyId).toBe(co)
      expect(p.allocations.map((a) => a.invoiceId)).toEqual([inv.id])
      expect({
        invoices: JSON.stringify(financeInvoices.filter((i) => i.companyId === them)),
        payments: JSON.stringify(finPayments.filter((x) => x.companyId === them)),
        journal: financeJournal.filter((e) => e.companyId === them).length,
      }).toEqual(theirBefore)
      // Nothing card-like stored anywhere in collections.
      expect(JSON.stringify([finPayments, finPaymentLinks, finPdcs])).not.toContain('4242424242424242')
    })

    it(`${co}: an unknown or another company’s link id is not a token; a signed-in user of ${them} can’t use the company endpoints on it`, async () => {
      const inv = openInvoice(co)
      const link = createLinkFor(co, ADMIN[co], { invoiceId: inv.id })
      expect((await callApi(null, 'GET', `/public/pay/${link.id}`)).status).toBe(404)
      expect((await callApi(null, 'GET', `/public/pay/${'x'.repeat(32)}`)).status).toBe(404)
      const foreign = await call(admin(them), 'POST', `/finance/payment-links/${link.id}/void`)
      expect(foreign.status).toBe(404)
      expect(finPaymentLinks.find((l) => l.id === link.id)!.status).toBe('active')
    })
  }
})
