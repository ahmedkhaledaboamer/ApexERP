import { afterEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { postJournal } from './ledger'
import * as fin from './financeLedger'
import { rateFor, requireRate } from './financeRates'
// Every store registered before the snapshot.
import '@/shared/mocks/handlers'

/** Ledger core services: seed, lock date (all postings), exchange rates, settings validation, chart rules, journal, reports. */

const snap = takeSnapshot(true)
afterEach(() => restoreSnapshot(snap))

const u = (id: string) => users.find((x) => x.id === id)! as User
const omar = () => u('u1') // Apex Company Admin
const layla = () => u('u2') // Apex Management
const karim = () => u('u3') // Apex Sales Manager
const rashid = () => u('u8') // Apex Accountant
const faisal = () => u('u101') // Crest Company Admin
const today = (co: string) => companyDayOf(co).today
const line = (accountId: string, debit: number, credit: number) => ({ accountId, debit, credit, description: '' })

describe('seed', () => {
  it('posts balanced opening balances and manual entries per company, different data', () => {
    for (const co of [APEX_ID, CREST_ID]) {
      const mine = financeJournal.filter((e) => e.companyId === co)
      expect(mine.some((e) => e.sourceType === 'opening_balance')).toBe(true)
      expect(mine.filter((e) => e.sourceType === 'manual').length).toBeGreaterThanOrEqual(3)
      const tb = fin.getTrialBalance(co === APEX_ID ? omar() : faisal())
      expect(tb.balanced).toBe(true)
    }
    expect(financeJournal.some((e) => e.companyId === APEX_ID && e.status === 'reversed')).toBe(true)
    const apexBank = fin.listAccounts(omar()).find((a) => a.id === 'ACC-1120')!.balance
    const crestBank = fin.listAccounts(faisal()).find((a) => a.id === 'ACC-1120')!.balance
    expect(apexBank).not.toBe(crestBank)
  })
})

describe('lock date', () => {
  it('refuses any posting on or before it (423 period_locked), from every section', () => {
    fin.setLockDate(rashid(), { lockDate: '2026-06-30', reason: 'H1 closed' })
    expect(() => postJournal(APEX_ID, { date: '2026-06-30', memo: 'x', sourceType: 'invoice', sourceId: null, createdBy: null, lines: [line('ACC-1200', 5, 0), line('ACC-4200', 0, 5)] })).toThrow(
      expect.objectContaining({ status: 423, code: 'period_locked' }),
    )
    expect(() => fin.createManualJournal(rashid(), { date: '2026-01-15', memo: 'Back-dated', lines: [line('ACC-6200', 10, 0), line('ACC-1120', 0, 10)] })).toThrow(expect.objectContaining({ status: 423 }))
    expect(fin.createManualJournal(rashid(), { date: '2026-07-01', memo: 'Open period', lines: [line('ACC-6200', 10, 0), line('ACC-1120', 0, 10)] }).number).toMatch(/^JV-2026-/)
    // Crest is not affected by Apex's lock.
    expect(postJournal(CREST_ID, { date: '2026-06-30', memo: 'y', sourceType: 'manual', sourceId: null, createdBy: null, lines: [line('ACC-6800', 1, 0), line('ACC-1120', 0, 1)] }).companyId).toBe(CREST_ID)
  })
  it('only Company Admin and Accountant move it; not in the future; audited; removable', () => {
    expect(() => fin.setLockDate(layla(), { lockDate: '2026-01-31' })).toThrow(expect.objectContaining({ status: 403, code: 'lock_date_forbidden' }))
    expect(() => fin.setLockDate(karim(), { lockDate: '2026-01-31' })).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => fin.setLockDate(omar(), { lockDate: '2999-01-01' })).toThrow(expect.objectContaining({ status: 422 }))
    expect(fin.setLockDate(omar(), { lockDate: '2026-01-31' }).lockDate).toBe('2026-01-31')
    expect(fin.getFinanceSettings(layla()).canMoveLockDate).toBe(false)
    expect(fin.getFinanceSettings(rashid()).canMoveLockDate).toBe(true)
    expect(fin.setLockDate(rashid(), { lockDate: null }).lockDate).toBeNull()
  })
  it('Crest’s seeded lock (2025) blocks 2025 dates', () => {
    expect(fin.getFinanceSettings(faisal()).lockDate).toBe('2025-12-31')
    expect(() => fin.createManualJournal(faisal(), { date: '2025-12-31', memo: 'Late', lines: [line('ACC-6800', 1, 0), line('ACC-1120', 0, 1)] })).toThrow(expect.objectContaining({ code: 'period_locked' }))
  })
})

describe('exchange rates', () => {
  it('rateFor: base = 1, latest effective rate, null when none; requireRate → 422', () => {
    expect(rateFor(APEX_ID, 'AED', '2026-01-01')).toBe(1)
    expect(rateFor(APEX_ID, 'EUR', '2026-06-30')).toBe(3.98)
    expect(rateFor(APEX_ID, 'EUR', '2026-07-01')).toBe(4.05)
    expect(rateFor(CREST_ID, 'USD', '2026-05-01')).toBe(3.75)
    expect(rateFor(APEX_ID, 'GBP', '2026-05-01')).toBeNull()
    expect(() => requireRate(APEX_ID, 'GBP', '2026-05-01')).toThrow(expect.objectContaining({ status: 422, code: 'missing_exchange_rate' }))
  })
  it('add (unique per currency and date, not the base) and delete; per company', () => {
    const s = fin.addExchangeRate(rashid(), { currency: 'gbp', rate: 4.65, effectiveDate: '2026-11-01' })
    expect(s.exchangeRates.find((r) => r.currency === 'GBP')?.rate).toBe(4.65)
    expect(rateFor(APEX_ID, 'GBP', '2026-11-02')).toBe(4.65)
    expect(rateFor(CREST_ID, 'GBP', '2026-11-02')).toBeNull()
    expect(() => fin.addExchangeRate(rashid(), { currency: 'GBP', rate: 4.7, effectiveDate: '2026-11-01' })).toThrow(expect.objectContaining({ code: 'duplicate_rate' }))
    expect(() => fin.addExchangeRate(rashid(), { currency: 'AED', rate: 1, effectiveDate: '2026-11-01' })).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => fin.addExchangeRate(rashid(), { currency: 'USD', rate: 0, effectiveDate: '2026-11-01' })).toThrow(expect.objectContaining({ status: 422 }))
    const id = s.exchangeRates.find((r) => r.currency === 'GBP')!.id
    expect(() => fin.deleteExchangeRate(faisal(), id)).toThrow(expect.objectContaining({ status: 404 }))
    fin.deleteExchangeRate(rashid(), id)
    expect(rateFor(APEX_ID, 'GBP', '2026-11-02')).toBeNull()
  })
})

describe('settings', () => {
  it('validates the VAT number by country and the Arabic legal name for KSA', () => {
    expect(() => fin.updateFinanceSettings(rashid(), { vatNumber: '12345' })).toThrow(expect.objectContaining({ code: 'invalid_vat_number' }))
    expect(fin.updateFinanceSettings(rashid(), { vatNumber: '100 9999 9999 9999' }).vatNumber).toBe('100999999999999')
    expect(() => fin.updateFinanceSettings(faisal(), { vatNumber: '310123456700004' })).toThrow(expect.objectContaining({ code: 'invalid_vat_number' }))
    expect(() => fin.updateFinanceSettings(faisal(), { legalNameAr: '' })).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => fin.updateFinanceSettings(faisal(), { legalNameAr: 'Crest' })).toThrow(expect.objectContaining({ status: 422 }))
    expect(fin.updateFinanceSettings(faisal(), { vatRegistered: false, legalNameAr: '' }).vatRegistered).toBe(false)
    expect(() => fin.updateFinanceSettings(rashid(), { fiscalYearStartMonth: 13 })).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => fin.updateFinanceSettings(rashid(), { defaultRevenueAccountId: 'ACC-1120' })).toThrow(expect.objectContaining({ code: 'invalid_account' }))
    expect(() => fin.updateFinanceSettings(karim(), { paymentTermsDays: 10 })).toThrow(expect.objectContaining({ status: 403 }))
    expect(fin.getFinanceSettings(karim()).canEdit).toBe(false)
  })
})

describe('chart of accounts', () => {
  it('adds with unique codes per company, header parents of the same type', () => {
    const a = fin.createAccount(rashid(), { code: '1125', name: 'Second bank account', type: 'asset', parentId: 'ACC-1100' })
    expect(a).toMatchObject({ code: '1125', parentId: 'ACC-1100', balance: 0, depth: 2 })
    expect(() => fin.createAccount(rashid(), { code: '1125', name: 'Dup', type: 'asset' })).toThrow(expect.objectContaining({ code: 'duplicate_code' }))
    // Same code in the other company is fine.
    expect(fin.createAccount(faisal(), { code: '1125', name: 'Riyad Bank', type: 'asset', parentId: 'ACC-1100' }).id).not.toBe(a.id)
    expect(() => fin.createAccount(rashid(), { code: '1126', name: 'X', type: 'asset', parentId: 'ACC-1120' })).toThrow(expect.objectContaining({ code: 'invalid_parent' }))
    expect(() => fin.createAccount(rashid(), { code: '1127', name: 'X', type: 'income', parentId: 'ACC-1100' })).toThrow(expect.objectContaining({ code: 'invalid_parent' }))
  })
  it('deletes only unposted accounts; deactivation needs a zero balance and the system role moved', () => {
    expect(() => fin.deleteAccount(rashid(), 'ACC-6200')).toThrow(expect.objectContaining({ code: 'has_postings' }))
    expect(() => fin.updateAccount(rashid(), 'ACC-6200', { active: false })).toThrow(expect.objectContaining({ code: 'has_balance' }))
    expect(() => fin.updateAccount(rashid(), 'ACC-1110', { active: false })).toThrow(expect.objectContaining({ code: 'system_role' }))
    expect(() => fin.updateAccount(rashid(), 'ACC-1110', { systemRole: null })).toThrow(expect.objectContaining({ code: 'system_role' }))
    // Move the cash role to a new account; then the old one (after emptying it) can be deactivated.
    const petty = fin.createAccount(rashid(), { code: '1115', name: 'Petty cash 2', type: 'asset', parentId: 'ACC-1100' })
    expect(() => fin.updateAccount(rashid(), 'ACC-6100', { systemRole: 'cash' })).toThrow(expect.objectContaining({ status: 422 }))
    fin.updateAccount(rashid(), petty.id, { systemRole: 'cash' })
    expect(financeAccounts.find((a) => a.companyId === APEX_ID && a.id === 'ACC-1110')!.systemRole).toBeNull()
    const bal = fin.listAccounts(rashid()).find((a) => a.id === 'ACC-1110')!.balance
    fin.createManualJournal(rashid(), { date: today(APEX_ID), memo: 'Move petty cash', lines: [line(petty.id, bal, 0), line('ACC-1110', 0, bal)] })
    expect(fin.updateAccount(rashid(), 'ACC-1110', { active: false }).active).toBe(false)
    // A fresh, unposted account deletes.
    const tmp = fin.createAccount(rashid(), { code: '6999', name: 'Temp', type: 'expense', parentId: 'ACC-6000' })
    expect(fin.deleteAccount(rashid(), tmp.id)).toEqual({ id: tmp.id })
    expect(() => fin.deleteAccount(rashid(), 'ACC-1100')).toThrow(expect.objectContaining({ status: 409 }))
  })
  it('imports the country template only into an empty chart', () => {
    expect(() => fin.importChartTemplate(rashid())).toThrow(expect.objectContaining({ code: 'chart_not_empty' }))
    for (let i = financeAccounts.length - 1; i >= 0; i--) if (financeAccounts[i].companyId === CREST_ID) financeAccounts.splice(i, 1)
    const rows = fin.importChartTemplate(faisal())
    expect(rows.find((a) => a.code === '2410')?.name).toBe('GOSI payable')
    expect(financeAccounts.filter((a) => a.companyId === APEX_ID).length).toBeGreaterThan(40)
  })
  it('headers roll up balances; the account ledger runs a balance', () => {
    const rows = fin.listAccounts(rashid())
    const header = rows.find((a) => a.id === 'ACC-1100')!
    const kids = rows.filter((a) => a.parentId === 'ACC-1100')
    expect(header.balance).toBeCloseTo(kids.reduce((s, k) => s + k.balance, 0), 2)
    const l = fin.getAccountLedger(rashid(), 'ACC-1120')
    expect(l.closingBalance).toBe(rows.find((a) => a.id === 'ACC-1120')!.balance)
    expect(() => fin.getAccountLedger(faisal(), 'ACC-N99999')).toThrow(expect.objectContaining({ status: 404 }))
  })
})

describe('journal', () => {
  it('manual entries: balanced, dimensions of the company only; reversal once, manual only', () => {
    const e = fin.createManualJournal(rashid(), {
      date: today(APEX_ID),
      memo: 'Reclass marketing spend',
      lines: [
        { accountId: 'ACC-6400', debit: 500, credit: 0, departmentId: 'd-marketing' },
        { accountId: 'ACC-6450', debit: 0, credit: 500 },
      ],
    })
    expect(e.lines[0]).toMatchObject({ departmentName: 'Marketing' })
    expect(() => fin.createManualJournal(rashid(), { date: today(APEX_ID), memo: 'x', lines: [{ accountId: 'ACC-6400', debit: 1, credit: 0, departmentId: 'c2-ops' }, { accountId: 'ACC-6450', debit: 0, credit: 1 }] })).toThrow(
      expect.objectContaining({ code: 'invalid_dimension' }),
    )
    expect(() => fin.createManualJournal(rashid(), { date: today(APEX_ID), memo: 'x', lines: [line('ACC-6400', 2, 0), line('ACC-6450', 0, 1)] })).toThrow(expect.objectContaining({ code: 'unbalanced' }))
    expect(() => fin.createManualJournal(karim(), { date: today(APEX_ID), memo: 'x', lines: [line('ACC-6400', 1, 0), line('ACC-6450', 0, 1)] })).toThrow(expect.objectContaining({ status: 403 }))
    const rev = fin.reverseManualJournal(rashid(), e.id, { date: today(APEX_ID) })
    expect(rev.reversalOf).toBe(e.id)
    expect(fin.getJournalEntry(rashid(), e.id)).toMatchObject({ status: 'reversed', canReverse: false })
    expect(() => fin.reverseManualJournal(rashid(), e.id, {})).toThrow(expect.objectContaining({ code: 'already_reversed' }))
    expect(() => fin.reverseManualJournal(rashid(), rev.id, {})).toThrow(expect.objectContaining({ code: 'is_reversal' }))
    const inv = postJournal(APEX_ID, { date: today(APEX_ID), memo: 'inv', sourceType: 'invoice', sourceId: 'INV-X', createdBy: null, lines: [line('ACC-1200', 5, 0), line('ACC-4200', 0, 5)] })
    expect(() => fin.reverseManualJournal(rashid(), inv.id, {})).toThrow(expect.objectContaining({ code: 'source_document' }))
    expect(() => fin.getJournalEntry(faisal(), e.id)).toThrow(expect.objectContaining({ status: 404 }))
  })
  it('filters by date, source, account and text', () => {
    const all = fin.listJournal(rashid())
    expect(all.length).toBeGreaterThan(3)
    expect(fin.listJournal(rashid(), { sourceType: 'opening_balance' }).every((r) => r.sourceType === 'opening_balance')).toBe(true)
    expect(fin.listJournal(rashid(), { accountId: 'ACC-6600' }).length).toBe(1)
    expect(fin.listJournal(rashid(), { q: 'software' }).length).toBe(1)
    expect(fin.listJournal(rashid(), { from: '2999-01-01' })).toEqual([])
  })
  it('opening balances post the difference to opening balance equity', () => {
    const e = fin.postOpeningBalances(rashid(), { date: today(APEX_ID), lines: [{ accountId: 'ACC-1530', debit: 50000, credit: 0 }, { accountId: 'ACC-2600', debit: 0, credit: 12000 }] })
    expect(e.sourceType).toBe('opening_balance')
    expect(e.lines.find((l) => l.accountId === 'ACC-3300')).toMatchObject({ credit: 38000 })
    expect(() => fin.postOpeningBalances(rashid(), { date: today(APEX_ID), lines: [{ accountId: 'ACC-3300', debit: 1, credit: 0 }] })).toThrow(expect.objectContaining({ status: 422 }))
  })
})

describe('trial balance and overview', () => {
  it('a new entry shows in the trial balance as of its date and not before', () => {
    const before = fin.getTrialBalance(rashid())
    fin.createManualJournal(rashid(), { date: today(APEX_ID), memo: 'Travel', lines: [line('ACC-6500', 1234.5, 0), line('ACC-1120', 0, 1234.5)] })
    const after = fin.getTrialBalance(rashid())
    expect(after.balanced).toBe(true)
    expect(after.rows.find((r) => r.accountId === 'ACC-6500')?.debit).toBe((before.rows.find((r) => r.accountId === 'ACC-6500')?.debit ?? 0) + 1234.5)
    expect(fin.getTrialBalance(rashid(), { asOf: '2000-01-01' }).rows).toEqual([])
  })
  it('overview: cash and bank, revenue months, VAT estimate, latest entries; view for Sales Manager', () => {
    const o = fin.getFinanceOverview(karim())
    expect(o.currency).toBe('AED')
    expect(o.cash.map((c) => c.accountId)).toContain('ACC-1120')
    expect(o.cashTotal).toBeCloseTo(o.cash.reduce((s, c) => s + c.balance, 0), 2)
    expect(o.vat.payable).toBe(Math.round((o.vat.output - o.vat.input) * 100) / 100)
    expect(o.latest.length).toBeGreaterThan(0)
    expect(() => fin.getFinanceOverview(u('u4'))).toThrow(expect.objectContaining({ status: 403 }))
  })
})
