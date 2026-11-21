import { afterEach, describe, expect, it } from 'vitest'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal, financeTaxCodes } from '@/shared/mocks/data/finance'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { postJournal, reverseJournal, round2, systemAccount } from './ledger'
import { applyToInvoice, isOverdue } from './financeInvoiceBalance'
import type { Invoice } from '@/modules/finance/types'
import type { Tenant } from '@/shared/mocks/tenant'

/** Finance core contract: the seeded charts, balanced posting, reversal, numbering and invoice balances. */

const snap = takeSnapshot(true)
afterEach(() => restoreSnapshot(snap))

describe('seeded chart and tax codes', () => {
  it('each company has one active account per system role and its own VAT rate', () => {
    for (const co of [APEX_ID, CREST_ID]) {
      const roles = financeAccounts.filter((a) => a.companyId === co && a.systemRole).map((a) => a.systemRole)
      expect(new Set(roles).size).toBe(roles.length)
      expect(systemAccount(co, 'accounts_receivable')).toBe('ACC-1200')
    }
    expect(financeTaxCodes.find((t) => t.companyId === APEX_ID && t.category === 'standard')!.rate).toBe(5)
    expect(financeTaxCodes.find((t) => t.companyId === CREST_ID && t.category === 'standard')!.rate).toBe(15)
    expect(financeAccounts.find((a) => a.companyId === CREST_ID && a.code === '2410')!.name).toBe('GOSI payable')
  })
})

describe('postJournal', () => {
  const line = (accountId: string, debit: number, credit: number) => ({ accountId, debit, credit, description: '' })

  it('posts a balanced entry with a yearly number per company', () => {
    const a = postJournal(APEX_ID, { date: '2026-11-10', memo: 'x', sourceType: 'manual', sourceId: null, createdBy: 'u8', lines: [line('ACC-1120', 105, 0), line('ACC-4200', 0, 100), line('ACC-2200', 0, 5)] })
    const b = postJournal(APEX_ID, { date: '2026-11-11', memo: 'y', sourceType: 'manual', sourceId: null, createdBy: 'u8', lines: [line('ACC-1110', 1, 0), line('ACC-4900', 0, 1)] })
    const c = postJournal(CREST_ID, { date: '2026-11-11', memo: 'z', sourceType: 'manual', sourceId: null, createdBy: 'u101', lines: [line('ACC-1110', 1, 0), line('ACC-4900', 0, 1)] })
    expect(a.number).toBe('JV-2026-0001')
    expect(b.number).toBe('JV-2026-0002')
    expect(c.number).toBe('JV-2026-0001')
    expect(a.id).not.toBe(c.id)
    expect(financeJournal).toContain(a)
  })

  it('refuses unbalanced, mixed-side and foreign-company lines', () => {
    const base = { date: '2026-11-10', memo: '', sourceType: 'manual' as const, sourceId: null, createdBy: null }
    expect(() => postJournal(APEX_ID, { ...base, lines: [line('ACC-1120', 10, 0), line('ACC-4200', 0, 9)] })).toThrow(expect.objectContaining({ status: 422, code: 'unbalanced' }))
    expect(() => postJournal(APEX_ID, { ...base, lines: [line('ACC-1120', 10, 10), line('ACC-4200', 0, 0)] })).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => postJournal(APEX_ID, { ...base, lines: [line('ACC-1000', 10, 0), line('ACC-4200', 0, 10)] })).toThrow(expect.objectContaining({ code: 'invalid_account' }))
    expect(() => postJournal(APEX_ID, { ...base, lines: [line('ACC-NOPE', 10, 0), line('ACC-4200', 0, 10)] })).toThrow(expect.objectContaining({ code: 'invalid_account' }))
  })

  it('reverses an entry once', () => {
    const e = postJournal(APEX_ID, { date: '2026-11-10', memo: 'x', sourceType: 'manual', sourceId: null, createdBy: null, lines: [line('ACC-1120', 50, 0), line('ACC-4200', 0, 50)] })
    const r = reverseJournal(APEX_ID, e.id, '2026-11-12', 'undo', null)
    expect(r.lines[0]).toMatchObject({ accountId: 'ACC-1120', debit: 0, credit: 50 })
    expect(e.status).toBe('reversed')
    expect(() => reverseJournal(APEX_ID, e.id, '2026-11-12', 'again', null)).toThrow(expect.objectContaining({ status: 409 }))
    expect(() => reverseJournal(CREST_ID, e.id, '2026-11-12', 'other company', null)).toThrow(expect.objectContaining({ status: 404 }))
  })

  it('round2 handles float noise', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
  })
})

describe('invoice balance', () => {
  const inv = (): Tenant<Invoice> => ({ companyId: APEX_ID, status: 'issued', total: 1050, amountPaid: 0, amountCredited: 0, balanceDue: 1050, dueDate: '2026-11-01' }) as Tenant<Invoice>
  it('moves issued → partially paid → paid, and back when a payment is undone', () => {
    const i = inv()
    applyToInvoice(i, { paid: 500 }, 't')
    expect(i).toMatchObject({ status: 'partially_paid', balanceDue: 550 })
    applyToInvoice(i, { credited: 50, paid: 500 }, 't')
    expect(i).toMatchObject({ status: 'paid', balanceDue: 0 })
    applyToInvoice(i, { paid: -500 }, 't')
    expect(i).toMatchObject({ status: 'partially_paid', balanceDue: 500 })
    expect(isOverdue(i, '2026-11-21')).toBe(true)
    expect(isOverdue(i, '2026-11-01')).toBe(false)
  })
})
