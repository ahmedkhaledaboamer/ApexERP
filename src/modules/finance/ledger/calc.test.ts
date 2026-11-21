import { describe, expect, it } from 'vitest'
import type { Account, JournalEntry } from '@/modules/finance/types'
import { accountLedger, fiscalYearStart, isIsoDate, isLocked, isValidVatNumber, monthRange, naturalBalance, rateLookup, rollUp, sumByAccount, treeOrder, trialBalance } from './calc'

/** Ledger arithmetic: balances, roll-up, trial balance, running balances, rates, lock date, VAT numbers. */

const acc = (id: string, code: string, type: Account['type'], parentId: string | null = null, isHeader = false): Account => ({
  id, code, name: `Account ${code}`, type, subtype: '', parentId, systemRole: null, isHeader, active: true, currency: null, description: '', createdAt: '', updatedAt: '',
})
const ACCOUNTS = [
  acc('H1', '1000', 'asset', null, true),
  acc('BANK', '1120', 'asset', 'H1'),
  acc('AR', '1200', 'asset', 'H1'),
  acc('VAT', '2200', 'liability'),
  acc('EQ', '3300', 'equity'),
  acc('REV', '4100', 'income'),
  acc('RENT', '6200', 'expense'),
]
let n = 0
const entry = (date: string, lines: [string, number, number][]): JournalEntry => ({
  id: `JE-${++n}`, number: `JV-${String(n).padStart(4, '0')}`, date, memo: `m${n}`, sourceType: 'manual', sourceId: null,
  lines: lines.map(([accountId, debit, credit]) => ({ accountId, debit, credit, description: '' })),
  status: 'posted', reversalOf: null, reversedBy: null, createdBy: null, createdAt: `${date}T10:00:00.000Z`,
})
const ENTRIES = [
  entry('2026-01-01', [['BANK', 10000, 0], ['EQ', 0, 10000]]),
  entry('2026-02-10', [['AR', 1050, 0], ['REV', 0, 1000], ['VAT', 0, 50]]),
  entry('2026-02-20', [['BANK', 1050, 0], ['AR', 0, 1050]]),
  entry('2026-03-01', [['RENT', 3000, 0], ['BANK', 0, 3000]]),
  entry('2026-03-05', [['RENT', 0.1, 0], ['BANK', 0, 0.1]]),
  entry('2026-03-05', [['RENT', 0.2, 0], ['BANK', 0, 0.2]]),
]

describe('balances', () => {
  it('sums by account, with a date range, and rolls headers up', () => {
    const all = sumByAccount(ENTRIES)
    expect(all.get('BANK')).toEqual({ debit: 11050, credit: 3000.3 })
    const feb = sumByAccount(ENTRIES, { from: '2026-02-01', to: '2026-02-28' })
    expect(feb.get('REV')).toEqual({ debit: 0, credit: 1000 })
    expect(feb.has('RENT')).toBe(false)
    const rolled = rollUp(ACCOUNTS, all)
    expect(rolled.get('H1')).toEqual({ debit: 12100, credit: 4050.3 })
    expect(naturalBalance('asset', 12100, 4050.3)).toBe(8049.7)
    expect(naturalBalance('income', 0, 1000)).toBe(1000)
  })

  it('orders the tree by code with children after their parent', () => {
    expect(treeOrder([...ACCOUNTS].reverse()).map((a) => a.id)).toEqual(['H1', 'BANK', 'AR', 'VAT', 'EQ', 'REV', 'RENT'])
  })
})

describe('trial balance', () => {
  it('debits equal credits; each account on its side; headers left out; as of a date', () => {
    const tb = trialBalance(ACCOUNTS, ENTRIES, '2026-12-31', 'AED')
    expect(tb.balanced).toBe(true)
    expect(tb.totals).toEqual({ debit: 11050, credit: 11050 })
    expect(tb.rows.find((r) => r.accountId === 'BANK')).toMatchObject({ debit: 8049.7, credit: 0 })
    expect(tb.rows.find((r) => r.accountId === 'REV')).toMatchObject({ debit: 0, credit: 1000 })
    expect(tb.rows.some((r) => r.accountId === 'H1')).toBe(false)
    expect(tb.rows.some((r) => r.accountId === 'AR')).toBe(false) // settled: zero
    expect(trialBalance(ACCOUNTS, ENTRIES, '2026-12-31', 'AED', { includeZero: true }).rows.some((r) => r.accountId === 'AR')).toBe(true)
    const jan = trialBalance(ACCOUNTS, ENTRIES, '2026-01-31', 'AED')
    expect(jan.totals).toEqual({ debit: 10000, credit: 10000 })
    expect(jan.rows).toHaveLength(2)
  })
})

describe('account ledger (running balance)', () => {
  it('opening balance before `from`, running natural balance, closing', () => {
    const l = accountLedger(ACCOUNTS[1], ENTRIES, { from: '2026-02-15' }, 'AED')
    expect(l.openingBalance).toBe(10000)
    expect(l.rows.map((r) => r.balance)).toEqual([11050, 8050, 8049.9, 8049.7])
    expect(l.closingBalance).toBe(8049.7)
    expect(l.totals).toEqual({ debit: 1050, credit: 3000.3 })
  })
  it('credit-normal accounts run the other way; no lines → closing = opening', () => {
    const rev = accountLedger(ACCOUNTS[5], ENTRIES, {}, 'AED')
    expect(rev.rows.map((r) => r.balance)).toEqual([1000])
    const empty = accountLedger(ACCOUNTS[5], ENTRIES, { from: '2026-03-01' }, 'AED')
    expect(empty).toMatchObject({ openingBalance: 1000, closingBalance: 1000, rows: [] })
    const until = accountLedger(ACCOUNTS[1], ENTRIES, { to: '2026-01-31' }, 'AED')
    expect(until.closingBalance).toBe(10000)
  })
})

describe('exchange rates', () => {
  const rates = [
    { currency: 'USD', rate: 3.67, effectiveDate: '2026-01-01' },
    { currency: 'USD', rate: 3.68, effectiveDate: '2026-06-01' },
    { currency: 'EUR', rate: 4, effectiveDate: '2026-03-01' },
  ]
  it('takes the latest rate effective on or before the date; 1 for the base; null when none', () => {
    expect(rateLookup(rates, 'USD', 'AED', '2026-05-31')).toBe(3.67)
    expect(rateLookup(rates, 'usd', 'AED', '2026-06-01')).toBe(3.68)
    expect(rateLookup(rates, 'USD', 'AED', '2027-01-01')).toBe(3.68)
    expect(rateLookup(rates, 'EUR', 'AED', '2026-02-28')).toBeNull()
    expect(rateLookup(rates, 'GBP', 'AED', '2026-06-01')).toBeNull()
    expect(rateLookup(rates, 'AED', 'AED', '2020-01-01')).toBe(1)
  })
})

describe('lock date, VAT numbers, periods', () => {
  it('locks on and before the lock date', () => {
    expect(isLocked('2026-10-31', '2026-10-31')).toBe(true)
    expect(isLocked('2026-10-31', '2026-10-01')).toBe(true)
    expect(isLocked('2026-10-31', '2026-11-01')).toBe(false)
    expect(isLocked(null, '2000-01-01')).toBe(false)
  })
  it('validates UAE TRN and KSA VAT numbers', () => {
    expect(isValidVatNumber('100234567800003', 'AE')).toBe(true)
    expect(isValidVatNumber('100 2345 6780 0003', 'AE')).toBe(true)
    expect(isValidVatNumber('10023456780000', 'AE')).toBe(false) // 14 digits
    expect(isValidVatNumber('200234567800003', 'AE')).toBe(false)
    expect(isValidVatNumber('310123456700003', 'SA')).toBe(true)
    expect(isValidVatNumber('310123456700004', 'SA')).toBe(false) // must end with 3
    expect(isValidVatNumber('210123456700003', 'SA')).toBe(false) // must start with 3
    expect(isValidVatNumber('3101234567003', 'SA')).toBe(false) // 13 digits
    expect(isValidVatNumber('', 'SA')).toBe(false)
  })
  it('fiscal year start, month ranges and ISO dates', () => {
    expect(fiscalYearStart('2026-11-21', 1)).toBe('2026-01-01')
    expect(fiscalYearStart('2026-03-21', 4)).toBe('2025-04-01')
    expect(fiscalYearStart('2026-04-01', 4)).toBe('2026-04-01')
    expect(monthRange('2026-03-15', -1)).toEqual({ from: '2026-02-01', to: '2026-02-28', month: '2026-02' })
    expect(monthRange('2026-01-15', -1).month).toBe('2025-12')
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-02-28')).toBe(true)
  })
})
