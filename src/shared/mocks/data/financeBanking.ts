import type { BankAccountKind, PayrollPostingStatus } from '@/modules/finance/banking/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'
import { financeSeq } from './finance'

/**
 * Accounts & finance › Banking stores (docs/API.md › Finance › Bank accounts, Reconciliation, Payroll posting).
 * Seeded lazily per company on the first finance access (services/financeBanking.ts `ensureBankingSeed`, after the
 * collections seed and the payroll postings). Ids are unique across companies (financeSeq: BNK-, TRF-, STM-, SL-,
 * BM-, REC-, BR-). Account numbers / IBANs are stored in full and served masked. Synthetic data only.
 */

export interface BankAccountRecord {
  id: string
  name: string
  bankName: string
  kind: BankAccountKind
  /** Stored full (encrypted in the backend); served masked. */
  accountNumber: string
  iban: string
  currency: string
  ledgerAccountId: string
  active: boolean
  openingBalance: number
  openingDate: string | null
  openingEntryId: string | null
  reconcileFrom: string | null
  notes: string
  createdAt: string
  createdBy: string | null
}

export interface TransferRecord {
  id: string
  number: string
  date: string
  fromBankAccountId: string
  toBankAccountId: string
  amountFrom: number
  amountTo: number
  fee: number
  fxDifference: number
  reference: string
  memo: string
  status: 'posted' | 'void'
  journalEntryId: string
  voidJournalEntryId: string | null
  createdAt: string
  createdBy: string | null
}

/** Account-currency amount of a journal line on a foreign-currency bank account, as banking posted it. */
export interface LineFxRecord {
  entryId: string
  lineIndex: number
  amount: number
}

export interface StatementLineRecord {
  id: string
  date: string
  description: string
  reference: string
  amount: number
  balance: number | null
  key: string
}

export interface StatementRecord {
  id: string
  bankAccountId: string
  fileName: string
  startDate: string
  endDate: string
  closingBalance: number | null
  skippedDuplicates: number
  lines: StatementLineRecord[]
  importedAt: string
  importedBy: string | null
}

export interface MatchRecord {
  id: string
  bankAccountId: string
  statementLineIds: string[]
  journalLineIds: string[]
  kind: 'manual' | 'auto' | 'created'
  amount: number
  reconciliationId: string | null
  createdAt: string
  createdBy: string | null
}

export interface ReconciliationRecord {
  id: string
  bankAccountId: string
  statementDate: string
  statementBalance: number
  clearedBalance: number
  difference: number
  status: 'finished' | 'undone'
  matchIds: string[]
  journalLineIds: string[]
  finishedAt: string
  finishedBy: string | null
  undoneAt: string | null
  undoneBy: string | null
}

export interface BankRuleRecord {
  id: string
  name: string
  contains: string
  direction: 'any' | 'in' | 'out'
  accountId: string
  bankAccountId: string | null
  active: boolean
  createdAt: string
  createdBy: string | null
}

/** Ledger postings of HR payroll: one row per run, loan or settlement (services/financePayrollGl.ts). */
export interface PayrollPostingRecord {
  kind: 'run' | 'loan' | 'settlement'
  sourceId: string
  status: PayrollPostingStatus
  /** The live posting (run accrual, loan disbursement, settlement payment). */
  entryId: string | null
  /** Run only: the payment entry (Dr salaries payable / Cr bank). */
  paymentEntryId: string | null
  /** Every reversed posting (reopen / cancel), oldest first. */
  reversedEntryIds: string[]
  reversalEntryIds: string[]
  paidFromAccountId: string | null
  note: string | null
  updatedAt: string
}

export const finBankAccounts = registerArray<Tenant<BankAccountRecord>>('fin.bankAccounts', [])
export const finBankTransfers = registerArray<Tenant<TransferRecord>>('fin.bankTransfers', [])
export const finBankLineFx = registerArray<Tenant<LineFxRecord>>('fin.bankLineFx', [])
export const finBankStatements = registerArray<Tenant<StatementRecord>>('fin.bankStatements', [])
export const finBankMatches = registerArray<Tenant<MatchRecord>>('fin.bankMatches', [])
export const finBankReconciliations = registerArray<Tenant<ReconciliationRecord>>('fin.bankReconciliations', [])
export const finBankRules = registerArray<Tenant<BankRuleRecord>>('fin.bankRules', [])
export const finPayrollPostings = registerArray<Tenant<PayrollPostingRecord>>('fin.payrollPostings', [])
/** Lazy seed marks per company and once-only alert keys. */
export const finBankingMeta = registerObject('fin.bankingMeta', { seeded: [] as string[], payrollSynced: [] as string[], alerts: [] as string[] })

const ID_BASE: Record<string, number> = { co_apex: 1000, co_crest: 5000 }
/**
 * Next id of a banking / commissions series for a company: the two demo companies count in their own ranges (Apex from
 * 1001, Crest from 5001), every other company in a shared range from 20001 — so an id never names two records, whatever
 * order the lazy seeds run in.
 */
export function bankId(co: string, series: string, prefix: string): string {
  const key = ID_BASE[co] === undefined ? `bk.${series}` : `bk.${series}@${co}`
  const start = ID_BASE[co] ?? 20000
  financeSeq.ids[key] = (financeSeq.ids[key] ?? start) + 1
  return `${prefix}-${financeSeq.ids[key]}`
}
