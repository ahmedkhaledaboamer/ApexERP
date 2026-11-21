import type { JournalEntry, JournalLine, JournalSourceType, SystemAccountRole } from '@/modules/finance/types'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { nowIso } from '@/shared/mocks/clock'
import { financeAccounts, financeJournal, financeSeq } from '@/shared/mocks/data/finance'

/**
 * General-ledger posting API (contract). Every finance section posts through `postJournal` — never by
 * pushing to `financeJournal` directly — so balance checks, numbering and period locks live in one place.
 * The ledger-core section extends this file (period locks, reports, manual journals); keep the exported
 * signatures stable.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Next id for a series, unique across companies (e.g. nextId('invoice', 'INV') → INV-1001). */
export function nextId(series: string, prefix: string): string {
  financeSeq.ids[series] = (financeSeq.ids[series] ?? 1000) + 1
  return `${prefix}-${financeSeq.ids[series]}`
}

/** Next yearly document number per company, e.g. docNumber(co, 'APX', 'INV', '2026') → APX-INV-2026-0001. */
export function docNumber(companyId: string, companyPrefix: string, series: string, year: string): string {
  const key = `${companyId}:${series}:${year}`
  financeSeq.numbers[key] = (financeSeq.numbers[key] ?? 0) + 1
  return `${companyPrefix}-${series}-${year}-${String(financeSeq.numbers[key]).padStart(4, '0')}`
}

/** The company's active account for a system role, or a 409 when the chart lacks it. */
export function systemAccount(companyId: string, role: SystemAccountRole): string {
  const a = financeAccounts.find((x) => x.companyId === companyId && x.systemRole === role && x.active)
  if (!a) throw new CodedApiError(`The chart of accounts has no active “${role}” account.`, 409, 'missing_system_account', { role })
  return a.id
}

export interface PostInput {
  date: string // yyyy-MM-dd company-local
  memo: string
  sourceType: JournalSourceType
  sourceId: string | null
  lines: JournalLine[]
  createdBy: string | null
}

/**
 * Hooks run before any finance read or write for a company (e.g. the collections section seeds its
 * payments lazily from the invoices). Each section's access check calls `runFinanceHooks`, so every
 * finance screen sees the same data whichever page is opened first. Hooks must be idempotent.
 */
const financeHooks = new Map<string, (companyId: string) => void>()
export function onFinanceAccess(name: string, fn: (companyId: string) => void): void {
  financeHooks.set(name, fn)
}
export function runFinanceHooks(companyId: string): void {
  for (const fn of financeHooks.values()) fn(companyId)
}

/** Hook for the ledger core: throws (e.g. 423 period_locked) when `date` can't be posted to. */
let assertOpen: (companyId: string, date: string) => void = () => {}
export function setPeriodGuard(fn: (companyId: string, date: string) => void): void {
  assertOpen = fn
}

/**
 * Posts a balanced entry and returns it. Lines with both sides 0 are dropped; amounts are rounded;
 * accounts must belong to the company, be active and not headers. Throws 422 `unbalanced` otherwise.
 */
export function postJournal(companyId: string, input: PostInput, numberPrefix = 'JV'): Tenant<JournalEntry> {
  assertOpen(companyId, input.date)
  const lines = input.lines
    .map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0)
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0)) throw new CodedApiError('Each line is either a debit or a credit, not negative.', 422, 'invalid_line')
    const acc = financeAccounts.find((a) => a.companyId === companyId && a.id === l.accountId)
    if (!acc || !acc.active || acc.isHeader) throw new CodedApiError('Unknown or inactive account.', 422, 'invalid_account', { accountId: l.accountId })
  }
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (lines.length < 2 || dr !== cr) throw new CodedApiError('Debits and credits must balance.', 422, 'unbalanced', { debit: dr, credit: cr })
  const entry: Tenant<JournalEntry> = {
    companyId,
    id: nextId('journal', 'JE'),
    number: docNumber(companyId, numberPrefix, 'JV', input.date.slice(0, 4)).replace(/^JV-JV-/, 'JV-'),
    date: input.date,
    memo: input.memo,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    lines,
    status: 'posted',
    reversalOf: null,
    reversedBy: null,
    createdBy: input.createdBy,
    createdAt: nowIso(),
  }
  financeJournal.push(entry)
  return entry
}

/** Posts the mirror entry of `entryId` on `date` and marks both; returns the reversing entry. */
export function reverseJournal(companyId: string, entryId: string, date: string, memo: string, createdBy: string | null): Tenant<JournalEntry> {
  const orig = financeJournal.find((e) => e.companyId === companyId && e.id === entryId)
  if (!orig) throw new CodedApiError('Journal entry not found.', 404, 'not_found')
  if (orig.status === 'reversed') throw new CodedApiError('This entry is already reversed.', 409, 'already_reversed')
  const rev = postJournal(companyId, {
    date,
    memo,
    sourceType: orig.sourceType,
    sourceId: orig.sourceId,
    lines: orig.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
    createdBy,
  })
  rev.reversalOf = orig.id
  orig.reversedBy = rev.id
  orig.status = 'reversed'
  return rev
}
