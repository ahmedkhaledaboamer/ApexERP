import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { financeJournal } from '@/shared/mocks/data/finance'
import { finBankAccounts, finBankMatches, finBankReconciliations } from '@/shared/mocks/data/financeBanking'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { buildLines, clearedBalance, lineKey, parseAmount, parseCsv, parseDate, reconciliationDifference, scoreMatch, suggestMapping, suggestMatches, transferLines } from '@/modules/finance/banking/calc'
import '@/shared/mocks/handlers'
import * as bank from './financeBanking'
import * as fin from './financeLedger'
import { todayOf, addDays } from './financeCollectionsCore'

const snap = takeSnapshot(true)
beforeEach(() => {
  restoreSnapshot(snap)
})
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User
const rashid = () => u('u8')
const balanced = (id: string) => {
  const e = financeJournal.find((x) => x.id === id)!
  const dr = e.lines.reduce((s, l) => s + l.debit, 0)
  const cr = e.lines.reduce((s, l) => s + l.credit, 0)
  return Math.round(dr * 100) === Math.round(cr * 100)
}

describe('CSV statement parsing', () => {
  it('parses quoted fields, CRLF, a BOM and semicolons', () => {
    expect(parseCsv('﻿Date,Description,Amount\r\n2026-11-01,"Fee, monthly",-10\r\n\r\n')).toEqual([
      ['Date', 'Description', 'Amount'],
      ['2026-11-01', 'Fee, monthly', '-10'],
    ])
    expect(parseCsv('a;b\n"x ""q""";2')).toEqual([['a', 'b'], ['x "q"', '2']])
  })
  it('reads every date format and rejects impossible dates', () => {
    expect(parseDate('2026-11-05', 'yyyy-MM-dd')).toBe('2026-11-05')
    expect(parseDate('05/11/2026', 'dd/MM/yyyy')).toBe('2026-11-05')
    expect(parseDate('11/05/2026', 'MM/dd/yyyy')).toBe('2026-11-05')
    expect(parseDate('05-11-26', 'dd-MM-yyyy')).toBe('2026-11-05')
    expect(parseDate('05.11.2026', 'dd.MM.yyyy')).toBe('2026-11-05')
    expect(parseDate('5 Nov 2026', 'd MMM yyyy')).toBe('2026-11-05')
    expect(parseDate('31/02/2026', 'dd/MM/yyyy')).toBeNull()
    expect(parseDate('2026-13-01', 'yyyy-MM-dd')).toBeNull()
  })
  it('reads amounts with separators, brackets, CR / DR and currencies', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5)
    expect(parseAmount('(45.00)')).toBe(-45)
    expect(parseAmount('12.00 DR')).toBe(-12)
    expect(parseAmount('AED 10')).toBe(10)
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('abc')).toBeNull()
  })
  it('suggests a debit / credit mapping and flags duplicates (in the file and already imported)', () => {
    const rows = parseCsv('Value date,Narrative,Ref,Debit,Credit,Balance\n05/11/2026,Fee,F1,10.00,,990.00\n06/11/2026,Deposit,D1,,500,1490\n06/11/2026,Deposit,D1,,500,1990\n07/11/2026,Old,O1,1,,1989')
    const m = suggestMapping(rows)
    expect(m).toMatchObject({ date: 0, description: 1, reference: 2, debit: 3, credit: 4, balance: 5, amount: null, dateFormat: 'dd/MM/yyyy', hasHeader: true })
    const existing = new Set([lineKey({ date: '2026-11-07', amount: -1, description: 'old', reference: 'o1' })])
    const lines = buildLines(rows, m, existing)
    expect(lines.map((l) => l.amount)).toEqual([-10, 500, 500, -1])
    expect(lines.map((l) => l.duplicate)).toEqual([false, false, true, true])
    expect(lines[0]).toMatchObject({ date: '2026-11-05', balance: 990, error: null })
  })
  it('reports unreadable rows', () => {
    const rows = parseCsv('Date,Description,Amount\n2026-11-40,Bad,1\n2026-11-02,Zero,0')
    const lines = buildLines(rows, suggestMapping(rows))
    expect(lines[0].error).toMatch(/date/)
    expect(lines[1].error).toMatch(/zero/i)
  })
})

describe('auto-match scoring and the reconciliation difference', () => {
  const s = { id: 's1', date: '2026-11-10', amount: -500, description: 'Payment JV-2026-0042', reference: '' }
  it('needs the same amount and a date within ±3 days; a document number adds points', () => {
    expect(scoreMatch(s, { id: 'b1', date: '2026-11-10', amount: -500, docNumbers: [] }).score).toBe(80)
    expect(scoreMatch(s, { id: 'b2', date: '2026-11-12', amount: -500, docNumbers: ['JV-2026-0042'] }).score).toBe(90)
    expect(scoreMatch(s, { id: 'b3', date: '2026-11-14', amount: -500, docNumbers: [] }).score).toBe(0)
    expect(scoreMatch(s, { id: 'b4', date: '2026-11-10', amount: -501, docNumbers: [] }).score).toBe(0)
  })
  it('suggests each line once, best score first', () => {
    const out = suggestMatches([s, { ...s, id: 's2', description: '' }], [
      { id: 'b1', date: '2026-11-11', amount: -500, docNumbers: [] },
      { id: 'b2', date: '2026-11-10', amount: -500, docNumbers: ['JV-2026-0042'] },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ statementLineId: 's1', journalLineIds: ['b2'], score: 100 })
    expect(out[1]).toMatchObject({ statementLineId: 's2', journalLineIds: ['b1'] })
  })
  it('cleared balance = opening position + matched lines up to the statement date', () => {
    const book = [
      { date: '2026-10-31', amount: 1000, matched: false, matchStatementDate: null },
      { date: '2026-11-02', amount: -200, matched: true, matchStatementDate: '2026-11-03' },
      { date: '2026-11-05', amount: 50, matched: true, matchStatementDate: '2026-11-20' },
      { date: '2026-11-06', amount: -70, matched: false, matchStatementDate: null },
    ]
    const c = clearedBalance(book, '2026-11-01', '2026-11-10')
    expect(c).toBe(800)
    expect(reconciliationDifference(800, c)).toBe(0)
    expect(reconciliationDifference(750, c)).toBe(-50)
  })
})

describe('transfers', () => {
  it('cross-currency: Dr to, Cr from + fee, fee to bank charges, the rest to fx; balanced', () => {
    const t = transferLines({ fromAccountId: 'A', toAccountId: 'U', feeAccountId: 'F', fxAccountId: 'X', amountFrom: 36800, amountTo: 10000, fee: 25, rateFrom: 1, rateTo: 3.6725 })
    expect(t.fxDifference).toBe(75)
    const dr = t.lines.reduce((s, l) => s + l.debit, 0)
    const cr = t.lines.reduce((s, l) => s + l.credit, 0)
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
    expect(t.lines.find((l) => l.accountId === 'U')).toMatchObject({ debit: 36725, foreign: 10000 })
    expect(t.lines.find((l) => l.accountId === 'A')).toMatchObject({ credit: 36825, foreign: -36825 })
    expect(t.lines.find((l) => l.accountId === 'X')).toMatchObject({ debit: 75 })
  })

  it('a USD transfer moves the USD book balance by the USD amount and posts the exchange difference', () => {
    const accounts = bank.listBankAccounts(rashid())
    const main = accounts.find((a) => a.ledgerAccountId === 'ACC-1120')!
    const usd = accounts.find((a) => a.currency === 'USD')!
    const t = bank.createTransfer(rashid(), { date: todayOf('co_apex'), fromBankAccountId: main.id, toBankAccountId: usd.id, amountFrom: 3700, amountTo: 1000 })
    expect(balanced(t.journalEntryId)).toBe(true)
    expect(t.fxDifference).toBeCloseTo(3700 - 3672.5, 2)
    const after = bank.getBankAccount(rashid(), usd.id)
    expect(after.bookBalance).toBeCloseTo(usd.bookBalance + 1000, 2)
    expect(() => bank.createTransfer(rashid(), { fromBankAccountId: main.id, toBankAccountId: main.id, amountFrom: 1 })).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => bank.createTransfer(rashid(), { fromBankAccountId: main.id, toBankAccountId: usd.id, amountFrom: 10 })).toThrow(expect.objectContaining({ status: 422 }))
  })
})

describe('seed', () => {
  it('each company has its bank accounts, a USD one for Apex, a partly reconciled statement and a balanced ledger', () => {
    const apex = bank.listBankAccounts(rashid())
    const crest = bank.listBankAccounts(u('u101'))
    expect(apex.length).toBeGreaterThanOrEqual(3)
    expect(crest.length).toBeGreaterThanOrEqual(3)
    expect(apex.some((a) => a.currency === 'USD')).toBe(true)
    expect(apex.find((a) => a.ledgerAccountId === 'ACC-1120')!.name).toBe('Main bank account')
    expect(apex.map((a) => a.name)).not.toEqual(crest.map((a) => a.name))
    for (const [co, user] of [['co_apex', rashid()], ['co_crest', u('u101')]] as const) {
      const recs = finBankReconciliations.filter((r) => r.companyId === co && r.status === 'finished')
      expect(recs.length, co).toBe(1)
      expect(recs[0].difference).toBe(0)
      const main = bank.listBankAccounts(user).find((a) => a.ledgerAccountId === 'ACC-1120')!
      const ws = bank.getReconcileWorkspace(user, main.id)
      expect(ws.statementLines.length, co).toBeGreaterThanOrEqual(2)
      expect(ws.statementLines.some((l) => l.ruleAccountId), co).toBe(true)
      expect(fin.getTrialBalance(user).balanced).toBe(true)
    }
    // Served masked only.
    expect(JSON.stringify(apex)).not.toContain('AE070260001014827365101')
    expect(apex.find((a) => a.ledgerAccountId === 'ACC-1120')!.ibanMasked).toBe('•••• 5101')
  })
})

describe('statement import → auto-match → entry from a line → finish at zero', () => {
  it('reconciles the savings account and protects the reconciled entries', () => {
    const me = rashid()
    const savings = bank.listBankAccounts(me).find((a) => a.name.startsWith('ADCB'))!
    const before = bank.getReconcileWorkspace(me, savings.id)
    const book = before.bookLines
    expect(book.length).toBeGreaterThan(0)
    // The statement: every book line, a bank charge and a running balance.
    let bal = bank.getBankAccount(me, savings.id).openingBalance
    const rows = [...book.map((l) => ({ date: l.date, d: l.description || l.memo, a: l.amount })), { date: addDays(todayOf('co_apex'), -1), d: 'Account fee', a: -25 }]
    const csv = ['Date,Description,Amount,Balance', ...rows.map((r) => `${r.date},"${r.d}",${r.a},${(bal = Math.round((bal + r.a) * 100) / 100)}`)].join('\n')
    const preview = bank.previewStatement(me, savings.id, { csv })
    expect(preview.errors).toBe(0)
    expect(preview.closingBalance).toBe(bal)
    const st = bank.importStatement(me, savings.id, { csv, fileName: 'adcb.csv' })
    expect(st.lineCount).toBe(rows.length)
    // Importing the same file again: everything is a duplicate.
    expect(() => bank.importStatement(me, savings.id, { csv })).toThrow(expect.objectContaining({ code: 'empty_statement' }))
    const auto = bank.autoMatch(me, savings.id)
    expect(auto.autoMatched).toBe(book.length)
    expect(auto.difference).toBe(-25)
    const fee = auto.statementLines.find((l) => l.amount === -25)!
    expect(fee.ruleAccountId).toBe('ACC-6800')
    const ws = bank.createEntryFromLine(me, fee.id, {})
    expect(ws.difference).toBe(0)
    const rep = bank.finishReconciliation(me, savings.id, {})
    expect(rep.difference).toBe(0)
    expect(rep.statementBalance).toBe(bal)
    expect(rep.outstandingDeposits).toEqual([])
    // A reconciled transfer can't be voided; undo the reconciliation first.
    const transfer = bank.listTransfers(me, { bankAccountId: savings.id })[0]
    expect(() => bank.voidTransfer(me, transfer.id)).toThrow(expect.objectContaining({ status: 409, code: 'reconciled' }))
    const match = finBankMatches.find((m) => m.companyId === 'co_apex' && m.reconciliationId === rep.id)!
    expect(() => bank.deleteMatch(me, match.id)).toThrow(expect.objectContaining({ status: 409 }))
    bank.undoReconciliation(me, rep.id)
    // Its other side (the main account) is in the seeded reconciliation too: still protected.
    expect(() => bank.voidTransfer(me, transfer.id)).toThrow(expect.objectContaining({ code: 'reconciled' }))
    const fresh = bank.createTransfer(me, { fromBankAccountId: savings.id, toBankAccountId: bank.listBankAccounts(me).find((a) => a.ledgerAccountId === 'ACC-1120')!.id, amountFrom: 10 })
    expect(bank.voidTransfer(me, fresh.id).status).toBe('void')
  })

  it('a manual journal entry on a reconciled line can’t be reversed (409) until unreconciled', () => {
    const me = rashid()
    const savings = bank.listBankAccounts(me).find((a) => a.name.startsWith('ADCB'))!
    const today = todayOf('co_apex')
    const e = fin.createManualJournal(me, { date: today, memo: 'Interest', lines: [{ accountId: savings.ledgerAccountId, debit: 7, credit: 0, description: 'Interest' }, { accountId: 'ACC-4900', debit: 0, credit: 7, description: 'Interest' }] })
    const ws0 = bank.getReconcileWorkspace(me, savings.id)
    let bal = bank.getBankAccount(me, savings.id).openingBalance
    const csv = ['Date,Description,Amount,Balance', ...ws0.bookLines.map((l) => `${l.date},Line,${l.amount},${(bal = Math.round((bal + l.amount) * 100) / 100)}`)].join('\n')
    bank.importStatement(me, savings.id, { csv })
    bank.autoMatch(me, savings.id)
    const rep = bank.finishReconciliation(me, savings.id, {})
    expect(() => fin.reverseManualJournal(me, e.id, {})).toThrow(expect.objectContaining({ status: 409, code: 'reconciled' }))
    bank.undoReconciliation(me, rep.id)
    expect(fin.reverseManualJournal(me, e.id, {}).reversalOf).toBe(e.id)
  })

  it('finishing with a difference is refused; manual matches must balance', () => {
    const me = rashid()
    const main = bank.listBankAccounts(me).find((a) => a.ledgerAccountId === 'ACC-1120')!
    const ws = bank.getReconcileWorkspace(me, main.id)
    expect(ws.difference).not.toBe(0)
    expect(() => bank.finishReconciliation(me, main.id, {})).toThrow(expect.objectContaining({ code: 'difference_not_zero' }))
    const sl = ws.statementLines[0]
    const bl = ws.bookLines.find((l) => l.amount !== sl.amount)!
    expect(() => bank.createMatch(me, main.id, { statementLineIds: [sl.id], journalLineIds: [bl.id] })).toThrow(expect.objectContaining({ code: 'amounts_differ' }))
    expect(finBankAccounts.every((b) => b.companyId === 'co_apex' || b.companyId === 'co_crest')).toBe(true)
  })
})
