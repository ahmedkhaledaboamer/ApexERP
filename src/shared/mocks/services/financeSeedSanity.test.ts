import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { runFinanceHooks } from './ledger'
import { paymentAccountsOf } from './financeApprovals'
import '@/shared/mocks/handlers'

/**
 * The demo books stay plausible once every finance seed has run (ledger, invoices, collections, purchases,
 * expenses, banking, payroll postings, commissions): no cash or bank account is overdrawn, and the whole
 * ledger balances per company.
 */

describe('seeded books are plausible', () => {
  for (const co of [APEX_ID, CREST_ID]) {
    it(`${co}: no cash / bank account below zero; debits = credits`, () => {
      expect(users.some((u) => u.companyId === co)).toBe(true)
      runFinanceHooks(co)
      const lines = financeJournal.filter((e) => e.companyId === co).flatMap((e) => e.lines)
      const dr = lines.reduce((s, l) => s + l.debit, 0)
      const cr = lines.reduce((s, l) => s + l.credit, 0)
      expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
      for (const a of paymentAccountsOf(co)) {
        const bal = lines.filter((l) => l.accountId === a.id).reduce((s, l) => s + l.debit - l.credit, 0)
        expect(bal, `${a.code} ${a.name}`).toBeGreaterThanOrEqual(0)
      }
      // Bank sub-accounts the banking seed adds under 1100 count too.
      const subBanks = financeAccounts.filter((a) => a.companyId === co && a.parentId === 'ACC-1100' && !a.isHeader)
      expect(subBanks.length).toBeGreaterThan(0)
    })
  }
})
