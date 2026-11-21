import type { Account, AccountType, JournalEntry } from '@/modules/finance/types'
import { DEBIT_NORMAL } from '@/modules/finance/types'
import type { CountryCode } from '@/modules/tenancy/types'
import { isValidTaxNumber, normalizeTaxNumber } from '@/shared/lib/taxNumber'
import type { AccountLedger, LedgerRow, TrialBalance, TrialBalanceRow } from './types'

/**
 * Ledger arithmetic (pure; the mock services and the screens share it). Amounts on journal lines are already in the
 * company's base currency, so every balance here is a base-currency balance. A reversed entry and its reversing entry
 * both count (they cancel out), so balances never depend on the `status` field.
 *
 * Reusable for the phase-3 statements: P&L = `sumByAccount(entries, { from, to })` over income / expense accounts,
 * balance sheet = `sumByAccount(entries, { to })` over asset / liability / equity plus the period result.
 */

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export interface Sums {
  debit: number
  credit: number
}
type EntryLike = Pick<JournalEntry, 'id' | 'number' | 'date' | 'memo' | 'sourceType' | 'lines' | 'createdAt'>

/** Natural-side balance: debit − credit for debit-normal types (asset, expense), credit − debit otherwise. */
export function naturalBalance(type: AccountType, debit: number, credit: number): number {
  return r2(DEBIT_NORMAL[type] ? debit - credit : credit - debit)
}

/** Debit / credit totals per account over entries dated in [from, to] (both optional, inclusive). */
export function sumByAccount(entries: readonly EntryLike[], range: { from?: string | null; to?: string | null } = {}): Map<string, Sums> {
  const out = new Map<string, Sums>()
  for (const e of entries) {
    if (range.from && e.date < range.from) continue
    if (range.to && e.date > range.to) continue
    for (const l of e.lines) {
      const s = out.get(l.accountId) ?? { debit: 0, credit: 0 }
      s.debit += l.debit
      s.credit += l.credit
      out.set(l.accountId, s)
    }
  }
  for (const s of out.values()) {
    s.debit = r2(s.debit)
    s.credit = r2(s.credit)
  }
  return out
}

/** Child → parent walk: every account's ancestors (nearest first). Cycles are cut. */
function ancestorsOf(id: string, byId: Map<string, Pick<Account, 'id' | 'parentId'>>): string[] {
  const out: string[] = []
  let cur = byId.get(id)?.parentId ?? null
  while (cur && !out.includes(cur) && cur !== id) {
    out.push(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return out
}

/** Totals per account where headers (and any parent) include every descendant's postings. */
export function rollUp(accounts: readonly Pick<Account, 'id' | 'parentId'>[], sums: Map<string, Sums>): Map<string, Sums> {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const out = new Map<string, Sums>(accounts.map((a) => [a.id, { debit: 0, credit: 0 }]))
  for (const [id, s] of sums) {
    if (!byId.has(id)) continue
    for (const target of [id, ...ancestorsOf(id, byId)]) {
      const t = out.get(target)!
      t.debit = r2(t.debit + s.debit)
      t.credit = r2(t.credit + s.credit)
    }
  }
  return out
}

/** Depth in the tree (0 = top level). */
export function depthOf(id: string, accounts: readonly Pick<Account, 'id' | 'parentId'>[]): number {
  return ancestorsOf(id, new Map(accounts.map((a) => [a.id, a]))).length
}

/** Ids of an account's descendants (any depth). */
export function descendantsOf(id: string, accounts: readonly Pick<Account, 'id' | 'parentId'>[]): string[] {
  const out: string[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const a of accounts) {
      if (a.parentId === cur && !out.includes(a.id) && a.id !== id) {
        out.push(a.id)
        stack.push(a.id)
      }
    }
  }
  return out
}

/** Accounts in tree order: by code within each parent, children right after their parent. */
export function treeOrder<T extends Pick<Account, 'id' | 'parentId' | 'code'>>(accounts: readonly T[]): T[] {
  const ids = new Set(accounts.map((a) => a.id))
  const kids = new Map<string | null, T[]>()
  for (const a of accounts) {
    const p = a.parentId && ids.has(a.parentId) ? a.parentId : null
    kids.set(p, [...(kids.get(p) ?? []), a])
  }
  const out: T[] = []
  const seen = new Set<string>()
  const walk = (p: string | null) => {
    for (const a of (kids.get(p) ?? []).sort((x, y) => x.code.localeCompare(y.code))) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
      out.push(a)
      walk(a.id)
    }
  }
  walk(null)
  for (const a of accounts) if (!seen.has(a.id)) out.push(a) // orphans of a cycle
  return out
}

/**
 * Trial balance as of a date: one row per postable account with a non-zero net, the net on its side.
 * Total debits always equal total credits for balanced entries.
 */
export function trialBalance(
  accounts: readonly Pick<Account, 'id' | 'code' | 'name' | 'type' | 'isHeader'>[],
  entries: readonly EntryLike[],
  asOf: string,
  currency: string,
  opts: { includeZero?: boolean } = {},
): TrialBalance {
  const sums = sumByAccount(entries, { to: asOf })
  const rows: TrialBalanceRow[] = []
  for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code))) {
    if (a.isHeader) continue
    const s = sums.get(a.id) ?? { debit: 0, credit: 0 }
    const net = r2(s.debit - s.credit)
    if (net === 0 && !opts.includeZero) continue
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 })
  }
  const debit = r2(rows.reduce((s, r) => s + r.debit, 0))
  const credit = r2(rows.reduce((s, r) => s + r.credit, 0))
  return { asOf, currency, rows, totals: { debit, credit }, balanced: debit === credit }
}

/** An account's lines over [from, to] with the opening balance before `from` and a running natural-side balance. */
export function accountLedger(
  account: Pick<Account, 'id' | 'code' | 'name' | 'type'>,
  entries: readonly EntryLike[],
  range: { from?: string | null; to?: string | null },
  currency: string,
): AccountLedger {
  const from = range.from ?? null
  const to = range.to ?? null
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.number.localeCompare(b.number))
  let opening = 0
  const rows: LedgerRow[] = []
  let running = 0
  let td = 0
  let tc = 0
  for (const e of sorted) {
    if (to && e.date > to) continue
    for (const l of e.lines) {
      if (l.accountId !== account.id) continue
      const delta = naturalBalance(account.type, l.debit, l.credit)
      if (from && e.date < from) {
        opening = r2(opening + delta)
        continue
      }
      if (rows.length === 0) running = opening
      running = r2(running + delta)
      td += l.debit
      tc += l.credit
      rows.push({ entryId: e.id, number: e.number, date: e.date, memo: e.memo, description: l.description, sourceType: e.sourceType, debit: l.debit, credit: l.credit, balance: running })
    }
  }
  const closing = rows.length ? running : opening
  return { account: { id: account.id, code: account.code, name: account.name, type: account.type }, currency, from, to, openingBalance: opening, rows, totals: { debit: r2(td), credit: r2(tc) }, closingBalance: closing }
}

/* ---------------- exchange rates ---------------- */

/**
 * Rate to the base currency for `currency` on `date`: 1 for the base currency, else the latest rate effective on or
 * before `date` (null when none).
 */
export function rateLookup(rates: readonly { currency: string; rate: number; effectiveDate: string }[], currency: string, base: string, date: string): number | null {
  const c = currency.trim().toUpperCase()
  if (c === base.toUpperCase()) return 1
  let best: { rate: number; effectiveDate: string } | null = null
  for (const r of rates) {
    if (r.currency !== c || r.effectiveDate > date) continue
    if (!best || r.effectiveDate > best.effectiveDate) best = r
  }
  return best ? best.rate : null
}

/* ---------------- lock date, VAT number, periods ---------------- */

/** True when `date` is on or before the lock date. */
export const isLocked = (lockDate: string | null | undefined, date: string): boolean => !!lockDate && date <= lockDate

/** VAT registration number check by company country: UAE TRN (15 digits, starts 100), KSA (15 digits, 3…3). */
export function isValidVatNumber(value: string, country: string): boolean {
  return isValidTaxNumber(normalizeTaxNumber(value), country as CountryCode)
}

/** First day of the fiscal year containing `today` (start month 1–12). */
export function fiscalYearStart(today: string, startMonth: number): string {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const year = m >= startMonth ? y : y - 1
  return `${year}-${String(startMonth).padStart(2, '0')}-01`
}

/** [first, last] day of the month `offset` months from `today`'s month. */
export function monthRange(today: string, offset = 0): { from: string; to: string; month: string } {
  const t = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset
  const y = Math.floor(t / 12)
  const m = (t % 12) + 1
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}`, month: `${y}-${mm}` }
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

/** 12,345.50 */
export function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
