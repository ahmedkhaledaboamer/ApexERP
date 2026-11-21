import type { User } from '@/shared/types'
import type { JournalEntry, JournalLine } from '@/modules/finance/types'
import type {
  BankAccount,
  BankAccountInput,
  BankAccountKind,
  BankAccountReveal,
  BankMatch,
  BankReconciliation,
  BankRule,
  BankRuleInput,
  BankStatement,
  BankStatementDetail,
  BankTransfer,
  BookLine,
  CreateFromLineInput,
  CsvMapping,
  FinishReconciliationInput,
  MatchInput,
  ParsedLine,
  ReconcileWorkspace,
  ReconciliationReport,
  StatementImportInput,
  StatementLine,
  StatementPreview,
  TransferInput,
} from '@/modules/finance/banking/types'
import { BANK_ACCOUNT_KINDS, DATE_FORMATS } from '@/modules/finance/banking/types'
import { buildLines, clearedBalance, detectDelimiter, lineIdOf, lineKey, maskTail, matchBalances, parseCsv, parseLineId, r2, suggestMapping, suggestMatches, transferLines } from '@/modules/finance/banking/calc'
import { isLocked } from '@/modules/finance/ledger/calc'
import { ApiError } from '@/shared/lib/apiError'
import { nowIso } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { finPayments } from '@/shared/mocks/data/financeCollections'
import {
  finBankAccounts,
  finBankLineFx,
  finBankMatches,
  finBankReconciliations,
  finBankRules,
  finBankStatements,
  finBankTransfers,
  finBankingMeta,
  bankId,
  type BankAccountRecord,
  type MatchRecord,
  type ReconciliationRecord,
  type StatementLineRecord,
  type StatementRecord,
  type TransferRecord,
} from '@/shared/mocks/data/financeBanking'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { docNumber, onFinanceAccess, postJournal, reverseJournal, systemAccount } from './ledger'
import { financeAccessOf, financeSettingsOf, registerJournalSource, registerReverseGuard } from './financeLedger'
import { paymentAccountsOf } from './financeApprovals'
import { accountantIds, addDays, baseCurrencyOf, isIsoDate, notify, prefixOf, rateFor, todayOf, userName } from './financeCollectionsCore'
import { ensureCollectionsSeed } from './financeCollections'
import { setPayrollReverseGuard, syncPayrollPostings } from './financePayrollGl'

/**
 * Accounts & finance › Banking (docs/API.md › Finance › Bank accounts, Reconciliation).
 *
 * WHO: accounting full (Company Admin, Management, Accountant) reads and writes; view (Sales Manager) reads accounts,
 * transfers, statements and reconciliations (writes 403); hidden → 403. Plan gate `/finance/*` → `accounting`. The
 * company comes from the session; foreign ids answer 404 (in bodies: the same 422 / 404 as a missing id).
 *
 * Bank accounts sit on top of the ledger; balances come from journal lines on the linked ledger account. Reconciliation
 * matches imported statement lines to those journal lines; finishing a session for a statement date needs
 * statement balance − cleared book balance = 0; matched lines of a finished session are RECONCILED and their entries
 * can't be reversed (409 `reconciled`) until the session is undone.
 */

/* ---------------- errors / access ---------------- */

const bad = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 422, code, details)
}
const conflict = (message: string, code: string, details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 409, code, details)
}
const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}
function viewer(user: User): string {
  financeAccessOf(user)
  return tenantOf(user)
}
function full(user: User): string {
  if (financeAccessOf(user) !== 'full') throw new CodedApiError('Only Company Admins, Management and Accountants can change the books.', 403, 'forbidden')
  return tenantOf(user)
}
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const accountIn = (co: string, id: unknown) => (typeof id === 'string' ? financeAccounts.find((a) => a.companyId === co && a.id === id) : undefined)
const entryIn = (co: string, id: string | null | undefined) => (id ? financeJournal.find((e) => e.companyId === co && e.id === id) : undefined)
const bankOf = (co: string, id: unknown) => (typeof id === 'string' ? finBankAccounts.find((b) => b.companyId === co && b.id === id) : undefined)
const ownBank = (co: string, id: unknown) => bankOf(co, id) ?? notFound()

/* ---------------- ledger lines of a bank account ---------------- */

interface RawLine {
  id: string
  entry: Tenant<JournalEntry>
  index: number
  date: string
  base: number
  amount: number
  description: string
}

function fxMap(co: string): Map<string, number> {
  return new Map(finBankLineFx.filter((r) => r.companyId === co).map((r) => [lineIdOf(r.entryId, r.lineIndex), r.amount]))
}
function recordFx(co: string, entryId: string, lineIndex: number, amount: number): void {
  finBankLineFx.push({ companyId: co, entryId, lineIndex, amount: r2(amount) })
}

function matchesOf(co: string, bankId: string): Tenant<MatchRecord>[] {
  return finBankMatches.filter((m) => m.companyId === co && m.bankAccountId === bankId)
}
function finishedRecon(co: string, id: string | null): Tenant<ReconciliationRecord> | undefined {
  return id ? finBankReconciliations.find((r) => r.companyId === co && r.id === id && r.status === 'finished') : undefined
}

/** Every journal line on the bank's ledger account (account currency), reversed-and-unmatched pairs left out. */
function rawLines(co: string, bank: Tenant<BankAccountRecord>): RawLine[] {
  const fx = fxMap(co)
  const foreign = bank.currency !== baseCurrencyOf(co)
  const out: RawLine[] = []
  for (const e of financeJournal) {
    if (e.companyId !== co) continue
    e.lines.forEach((l, i) => {
      if (l.accountId !== bank.ledgerAccountId) return
      const id = lineIdOf(e.id, i)
      const base = r2(l.debit - l.credit)
      let amount = base
      if (foreign) amount = fx.get(id) ?? r2(base / (rateFor(co, bank.currency, e.date) || 1))
      out.push({ id, entry: e, index: i, date: e.date, base, amount, description: l.description })
    })
  }
  const matched = new Set(matchesOf(co, bank.id).flatMap((m) => m.journalLineIds))
  const has = (entryId: string | null) => !!entryId && out.some((x) => x.entry.id === entryId && matched.has(x.id))
  const drop = new Set<string>()
  for (const e of financeJournal) {
    if (e.companyId !== co || e.status !== 'reversed' || !e.reversedBy) continue
    if (!has(e.id) && !has(e.reversedBy)) {
      drop.add(e.id)
      drop.add(e.reversedBy)
    }
  }
  return out.filter((x) => !drop.has(x.entry.id)).sort((a, b) => a.date.localeCompare(b.date) || a.entry.createdAt.localeCompare(b.entry.createdAt) || a.id.localeCompare(b.id))
}

/** Document numbers a statement may quote for an entry: the journal number, a payment's receipt number / reference, a transfer's number. */
function docNumbersOf(co: string, e: JournalEntry): string[] {
  const out = [e.number]
  if (e.sourceId) {
    if (e.sourceType === 'payment' || e.sourceType === 'payment_refund') {
      const p = finPayments.find((x) => x.companyId === co && x.id === e.sourceId)
      if (p) out.push(p.number, p.reference)
    }
    if (e.sourceType === 'bank' && e.sourceId.startsWith('TRF-')) {
      const t = finBankTransfers.find((x) => x.companyId === co && x.id === e.sourceId)
      if (t) out.push(t.number, t.reference)
    }
  }
  // Any other source (supplier bill payments, expenses, payroll…): document numbers quoted in the memo / line texts.
  const text = [e.memo, ...e.lines.map((l) => l.description)].join(' ')
  for (const m of text.matchAll(/[A-Z]{2,5}(?:-[A-Z]{2,5})?-\d{4}-\d{3,6}/g)) if (!out.includes(m[0])) out.push(m[0])
  return out.filter(Boolean)
}
function sourceNumberOf(co: string, e: JournalEntry): string | null {
  const d = docNumbersOf(co, e)
  return d.length > 1 ? d[1] : null
}

/** Statement date of a match: its latest statement line. */
function matchDate(co: string, m: MatchRecord): string | null {
  const lines = statementLinesOf(co, m.bankAccountId)
  const dates = m.statementLineIds.map((id) => lines.find((l) => l.id === id)?.date).filter((d): d is string => !!d)
  return dates.length ? dates.sort().slice(-1)[0] : null
}

function statementLinesOf(co: string, bankId: string): (StatementLineRecord & { statementId: string })[] {
  return finBankStatements
    .filter((s) => s.companyId === co && s.bankAccountId === bankId)
    .flatMap((s) => s.lines.map((l) => ({ ...l, statementId: s.id })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

function bookLineView(co: string, x: RawLine, byLine: Map<string, Tenant<MatchRecord>>): BookLine {
  const m = byLine.get(x.id)
  return {
    id: x.id,
    entryId: x.entry.id,
    entryNumber: x.entry.number,
    date: x.date,
    memo: x.entry.memo,
    description: x.description,
    sourceType: x.entry.sourceType,
    sourceNumber: sourceNumberOf(co, x.entry),
    amount: x.amount,
    matchId: m?.id ?? null,
    reconciled: !!finishedRecon(co, m?.reconciliationId ?? null),
  }
}

function ruleFor(co: string, bankId: string, l: { description: string; amount: number }) {
  const d = l.description.toLowerCase()
  return finBankRules.find(
    (r) => r.companyId === co && r.active && (!r.bankAccountId || r.bankAccountId === bankId) && d.includes(r.contains.toLowerCase()) && (r.direction === 'any' || (r.direction === 'in' ? l.amount > 0 : l.amount < 0)),
  )
}

function stmtLineView(co: string, bankId: string, l: StatementLineRecord & { statementId: string }, byStmt: Map<string, Tenant<MatchRecord>>): StatementLine {
  const m = byStmt.get(l.id)
  const rule = m ? undefined : ruleFor(co, bankId, l)
  return {
    id: l.id,
    statementId: l.statementId,
    date: l.date,
    description: l.description,
    reference: l.reference,
    amount: l.amount,
    balance: l.balance,
    matchId: m?.id ?? null,
    reconciled: !!finishedRecon(co, m?.reconciliationId ?? null),
    ruleId: rule?.id ?? null,
    ruleAccountId: rule?.accountId ?? null,
  }
}

const indexBy = (ms: Tenant<MatchRecord>[], key: 'journalLineIds' | 'statementLineIds') => {
  const map = new Map<string, Tenant<MatchRecord>>()
  for (const m of ms) for (const id of m[key]) map.set(id, m)
  return map
}

/** Statement balance on `date`: the last running balance on or before it plus later amounts; without a balance column, the opening position plus every amount. */
function statementBalanceAt(co: string, bank: Tenant<BankAccountRecord>, date: string): number | null {
  const lines = statementLinesOf(co, bank.id).filter((l) => l.date <= date)
  if (!lines.length) return null
  let lastBal = -1
  lines.forEach((l, i) => {
    if (l.balance !== null) lastBal = i
  })
  if (lastBal >= 0) return r2(lines[lastBal].balance! + lines.slice(lastBal + 1).reduce((s, l) => s + l.amount, 0))
  const opening = bank.reconcileFrom ? rawLines(co, bank).filter((x) => x.date < bank.reconcileFrom!).reduce((s, x) => s + x.amount, 0) : 0
  return r2(opening + lines.reduce((s, l) => s + l.amount, 0))
}

function clearedOn(co: string, bank: Tenant<BankAccountRecord>, date: string, onlyReconciled = false, upTo: ReconciliationRecord | null = null): number {
  const ms = matchesOf(co, bank.id)
  const byLine = indexBy(ms, 'journalLineIds')
  const raw = rawLines(co, bank)
  return clearedBalance(
    raw.map((x) => {
      const m = byLine.get(x.id)
      let ok = !!m
      if (m && onlyReconciled) {
        const rec = finishedRecon(co, m.reconciliationId)
        ok = !!rec && (!upTo || rec.statementDate <= upTo.statementDate)
      }
      return { date: x.date, amount: x.amount, matched: ok, matchStatementDate: m ? matchDate(co, m) : null }
    }),
    bank.reconcileFrom,
    date,
  )
}

const lastRecon = (co: string, bankId: string) =>
  finBankReconciliations.filter((r) => r.companyId === co && r.bankAccountId === bankId && r.status === 'finished').sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0]

/* ---------------- bank accounts ---------------- */

function accountView(co: string, b: Tenant<BankAccountRecord>): BankAccount {
  const acc = accountIn(co, b.ledgerAccountId)
  const today = todayOf(co)
  const raw = rawLines(co, b).filter((x) => x.date <= today)
  const lines = statementLinesOf(co, b.id)
  const last = lines[lines.length - 1]
  const rec = lastRecon(co, b.id)
  const matchedIds = new Set(matchesOf(co, b.id).flatMap((m) => m.statementLineIds))
  return {
    id: b.id,
    name: b.name,
    bankName: b.bankName,
    kind: b.kind,
    accountNumberMasked: maskTail(b.accountNumber),
    ibanMasked: maskTail(b.iban),
    currency: b.currency,
    ledgerAccountId: b.ledgerAccountId,
    ledgerAccountCode: acc?.code ?? '',
    ledgerAccountName: acc?.name ?? '',
    active: b.active,
    isDefault: financeSettingsOf(co).defaultBankAccountId === b.ledgerAccountId,
    bookBalance: r2(raw.reduce((s, x) => s + x.amount, 0)),
    bookBalanceBase: r2(raw.reduce((s, x) => s + x.base, 0)),
    statementBalance: last ? statementBalanceAt(co, b, last.date) : null,
    statementBalanceDate: last?.date ?? null,
    lastReconciledDate: rec?.statementDate ?? null,
    lastReconciledBalance: rec?.statementBalance ?? null,
    unmatchedLines: lines.filter((l) => !matchedIds.has(l.id)).length,
    reconcileFrom: b.reconcileFrom,
    openingBalance: b.openingBalance,
    openingDate: b.openingDate,
    notes: b.notes,
    createdAt: b.createdAt,
  }
}

/** GET /finance/bank-accounts?include_inactive= */
export function listBankAccounts(user: User, q: { includeInactive?: string | null } = {}): BankAccount[] {
  const co = viewer(user)
  return finBankAccounts.filter((b) => b.companyId === co && (q.includeInactive === 'true' || b.active)).map((b) => accountView(co, b))
}

/** GET /finance/bank-accounts/:id */
export function getBankAccount(user: User, id: string): BankAccount {
  const co = viewer(user)
  return accountView(co, ownBank(co, id))
}

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/
const ACCNO_RE = /^[A-Z0-9-]{4,34}$/

function cleanIdentifiers(i: BankAccountInput): { accountNumber?: string; iban?: string } {
  const out: { accountNumber?: string; iban?: string } = {}
  if (i.iban !== undefined) {
    const v = str(i.iban, 40).replace(/\s/g, '').toUpperCase()
    if (v && !IBAN_RE.test(v)) bad('The IBAN looks wrong (two letters, two check digits, then the account).', 'validation_failed', { field: 'iban' })
    out.iban = v
  }
  if (i.accountNumber !== undefined) {
    const v = str(i.accountNumber, 40).replace(/\s/g, '').toUpperCase()
    if (v && !ACCNO_RE.test(v)) bad('The account number is 4–34 letters, digits or dashes.', 'validation_failed', { field: 'account_number' })
    out.accountNumber = v
  }
  return out
}

/** A new postable account under 1100 Cash and bank (first free code from 1121). */
function newLedgerAccount(co: string, name: string, currency: string | null): string {
  const used = new Set(financeAccounts.filter((a) => a.companyId === co).map((a) => a.code))
  let code = 1121
  while (used.has(String(code)) && code < 1199) code++
  if (used.has(String(code))) bad('No free account code left under 1100 Cash and bank.', 'no_code')
  const at = nowIso()
  const id = bankId(co, 'ledgerAccount', 'ACC-NB')
  financeAccounts.push({ companyId: co, id, code: String(code), name: name.slice(0, 120), type: 'asset', subtype: 'current_asset', parentId: 'ACC-1100', systemRole: null, isHeader: false, active: true, currency, description: 'Bank account (Banking)', createdAt: at, updatedAt: at })
  return id
}

function postOpening(co: string, b: Tenant<BankAccountRecord>, by: string | null): void {
  if (!b.openingBalance || !b.openingDate) return
  const base = baseCurrencyOf(co)
  const rate = b.currency === base ? 1 : rateFor(co, b.currency, b.openingDate)
  const amt = r2(Math.abs(b.openingBalance) * rate)
  const obe = systemAccount(co, 'opening_balance_equity')
  const into = b.openingBalance > 0
  const e = postJournal(co, {
    date: b.openingDate,
    memo: `Opening balance — ${b.name}`,
    sourceType: 'opening_balance',
    sourceId: b.id,
    lines: [
      { accountId: b.ledgerAccountId, debit: into ? amt : 0, credit: into ? 0 : amt, description: 'Opening balance' },
      { accountId: obe, debit: into ? 0 : amt, credit: into ? amt : 0, description: 'Opening balance equity' },
    ],
    createdBy: by,
  })
  if (b.currency !== base) recordFx(co, e.id, 0, b.openingBalance)
  b.openingEntryId = e.id
}

/** Creates a bank-account record (and its ledger account when none is chosen); posts the opening balance. */
export function createBankAccountFor(co: string, by: string | null, input: BankAccountInput): Tenant<BankAccountRecord> {
  const i = input ?? {}
  const name = str(i.name, 120)
  if (!name) bad('Name the account (e.g. “Emirates NBD current account”).', 'validation_failed', { field: 'name' })
  const kind = (i.kind ?? 'current') as BankAccountKind
  if (!BANK_ACCOUNT_KINDS.includes(kind)) bad('Unknown account kind.', 'validation_failed', { field: 'kind' })
  const base = baseCurrencyOf(co)
  const currency = (str(i.currency, 3) || base).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) bad('Enter a three-letter currency code.', 'validation_failed', { field: 'currency' })
  const ids = cleanIdentifiers(i)
  let ledgerAccountId: string
  if (i.ledgerAccountId) {
    const acc = paymentAccountsOf(co).find((a) => a.id === i.ledgerAccountId)
    if (!acc) return bad('Choose an active, postable account under 1100 Cash and bank.', 'invalid_account', { field: 'ledger_account_id' })
    if (finBankAccounts.some((b) => b.companyId === co && b.ledgerAccountId === acc.id)) conflict('Another bank account already uses this ledger account.', 'ledger_account_in_use')
    if ((acc.currency ?? base) !== currency) bad(`The ledger account is in ${acc.currency ?? base}.`, 'currency_mismatch', { field: 'currency' })
    ledgerAccountId = acc.id
  } else {
    ledgerAccountId = newLedgerAccount(co, name, currency === base ? null : currency)
  }
  let openingBalance = 0
  let openingDate: string | null = null
  if (i.openingBalance !== undefined && i.openingBalance !== null) {
    const n = num(i.openingBalance)
    if (n === null || Math.abs(n) > 1e12) bad('The opening balance must be a number.', 'validation_failed', { field: 'opening_balance' })
    openingBalance = r2(n!)
    if (openingBalance) {
      openingDate = i.openingDate ?? todayOf(co)
      if (!isIsoDate(openingDate)) bad('Enter the opening date as yyyy-MM-dd.', 'validation_failed', { field: 'opening_date' })
    }
  }
  let reconcileFrom: string | null = openingDate ? addDays(openingDate, 1) : i.ledgerAccountId ? todayOf(co) : null
  if (i.reconcileFrom !== undefined) {
    if (i.reconcileFrom !== null && i.reconcileFrom !== '' && !isIsoDate(i.reconcileFrom)) bad('Enter “reconcile from” as yyyy-MM-dd.', 'validation_failed', { field: 'reconcile_from' })
    reconcileFrom = i.reconcileFrom || null
  }
  const b: Tenant<BankAccountRecord> = {
    companyId: co,
    id: bankId(co, 'bankAccount', 'BNK'),
    name,
    bankName: str(i.bankName, 120),
    kind,
    accountNumber: ids.accountNumber ?? '',
    iban: ids.iban ?? '',
    currency,
    ledgerAccountId,
    active: true,
    openingBalance,
    openingDate,
    openingEntryId: null,
    reconcileFrom,
    notes: str(i.notes, 1000),
    createdAt: nowIso(),
    createdBy: by,
  }
  postOpening(co, b, by)
  finBankAccounts.push(b)
  return b
}

/** POST /finance/bank-accounts (full). */
export function createBankAccount(user: User, input: BankAccountInput | null): BankAccount {
  const co = full(user)
  const b = createBankAccountFor(co, user.id, input ?? {})
  recordAudit(user, { action: 'create', entity: 'bank_account', entityId: b.id, summary: `Added bank account ${b.name}` })
  return accountView(co, b)
}

/** PATCH /finance/bank-accounts/:id (full): name, bank, kind, number / IBAN, active, notes, reconcile-from (before the first reconciliation). */
export function updateBankAccount(user: User, id: string, input: BankAccountInput | null): BankAccount {
  const co = full(user)
  const b = ownBank(co, id)
  const i = input ?? {}
  if (i.name !== undefined) {
    const n = str(i.name, 120)
    if (!n) bad('Name the account.', 'validation_failed', { field: 'name' })
    b.name = n
  }
  if (i.bankName !== undefined) b.bankName = str(i.bankName, 120)
  if (i.kind !== undefined) {
    if (!BANK_ACCOUNT_KINDS.includes(i.kind)) bad('Unknown account kind.', 'validation_failed', { field: 'kind' })
    b.kind = i.kind
  }
  Object.assign(b, cleanIdentifiers(i))
  if (i.notes !== undefined) b.notes = str(i.notes, 1000)
  if (i.active !== undefined) b.active = i.active === true
  if (i.reconcileFrom !== undefined) {
    if (lastRecon(co, b.id)) conflict('This account has finished reconciliations: undo them before moving “reconcile from”.', 'has_reconciliations')
    if (i.reconcileFrom !== null && i.reconcileFrom !== '' && !isIsoDate(i.reconcileFrom)) bad('Enter “reconcile from” as yyyy-MM-dd.', 'validation_failed', { field: 'reconcile_from' })
    b.reconcileFrom = i.reconcileFrom || null
  }
  if (i.currency !== undefined && i.currency !== b.currency) bad('The currency of a bank account can’t change.', 'validation_failed', { field: 'currency' })
  recordAudit(user, { action: 'update', entity: 'bank_account', entityId: b.id, summary: `Changed bank account ${b.name}` })
  return accountView(co, b)
}

/** POST /finance/bank-accounts/:id/reveal (full) — the full account number and IBAN; audited. */
export function revealBankAccount(user: User, id: string): BankAccountReveal {
  const co = full(user)
  const b = ownBank(co, id)
  recordAudit(user, { action: 'security', entity: 'bank_account', entityId: b.id, summary: `Viewed the full account number / IBAN of ${b.name}`, changes: [] })
  return { id: b.id, accountNumber: b.accountNumber, iban: b.iban }
}

/* ---------------- transfers ---------------- */

function transferView(co: string, t: Tenant<TransferRecord>): BankTransfer {
  const from = bankOf(co, t.fromBankAccountId)
  const to = bankOf(co, t.toBankAccountId)
  return {
    id: t.id,
    number: t.number,
    date: t.date,
    fromBankAccountId: t.fromBankAccountId,
    fromName: from?.name ?? '—',
    toBankAccountId: t.toBankAccountId,
    toName: to?.name ?? '—',
    amountFrom: t.amountFrom,
    fromCurrency: from?.currency ?? '',
    amountTo: t.amountTo,
    toCurrency: to?.currency ?? '',
    fee: t.fee,
    fxDifference: t.fxDifference,
    reference: t.reference,
    memo: t.memo,
    status: t.status,
    journalEntryId: t.journalEntryId,
    journalNumber: entryIn(co, t.journalEntryId)?.number ?? '',
    voidJournalEntryId: t.voidJournalEntryId,
    createdByName: userName(co, t.createdBy),
    createdAt: t.createdAt,
  }
}

/** GET /finance/bank-transfers?bank_account_id= */
export function listTransfers(user: User, q: { bankAccountId?: string | null } = {}): BankTransfer[] {
  const co = viewer(user)
  return finBankTransfers
    .filter((t) => t.companyId === co && (!q.bankAccountId || t.fromBankAccountId === q.bankAccountId || t.toBankAccountId === q.bankAccountId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .map((t) => transferView(co, t))
}

/** Posts a transfer (Dr to / Cr from; fee to bank charges; cross-currency difference to fx gain / loss). */
export function createTransferFor(co: string, by: string | null, input: TransferInput): Tenant<TransferRecord> {
  const i = input ?? {}
  const from = bankOf(co, i.fromBankAccountId)
  const to = bankOf(co, i.toBankAccountId)
  if (!from || !from.active) return bad('Choose the account the money leaves.', 'invalid_bank_account', { field: 'from_bank_account_id' })
  if (!to || !to.active) return bad('Choose the account the money goes to.', 'invalid_bank_account', { field: 'to_bank_account_id' })
  if (from.id === to.id) bad('Choose two different accounts.', 'validation_failed', { field: 'to_bank_account_id' })
  const date = i.date ?? todayOf(co)
  if (!isIsoDate(date)) bad('Enter the transfer date as yyyy-MM-dd.', 'validation_failed', { field: 'date' })
  const amountFrom = num(i.amountFrom)
  if (amountFrom === null || amountFrom <= 0 || amountFrom > 1e12) return bad('Enter the amount that leaves the account.', 'validation_failed', { field: 'amount_from' })
  let amountTo = num(i.amountTo)
  if (from.currency === to.currency) {
    if (amountTo !== null && r2(amountTo) !== r2(amountFrom)) bad('Both accounts are in the same currency: the amounts must be equal.', 'validation_failed', { field: 'amount_to' })
    amountTo = amountFrom
  } else if (amountTo === null || amountTo <= 0) return bad(`Enter the amount received in ${to.currency}.`, 'validation_failed', { field: 'amount_to' })
  const fee = num(i.fee) ?? 0
  if (fee < 0 || fee > amountFrom) bad('The fee must be between 0 and the amount.', 'validation_failed', { field: 'fee' })
  const base = baseCurrencyOf(co)
  const rateFrom = from.currency === base ? 1 : rateFor(co, from.currency, date)
  const rateTo = to.currency === base ? 1 : rateFor(co, to.currency, date)
  const calc = transferLines({
    fromAccountId: from.ledgerAccountId,
    toAccountId: to.ledgerAccountId,
    feeAccountId: financeAccounts.find((a) => a.companyId === co && a.code === '6800' && a.active)?.id ?? 'ACC-6800',
    fxAccountId: systemAccount(co, 'fx_gain_loss'),
    amountFrom: r2(amountFrom),
    amountTo: r2(amountTo!),
    fee: r2(fee),
    rateFrom,
    rateTo,
  })
  const id = bankId(co, 'bankTransfer', 'TRF')
  const reference = str(i.reference, 100)
  const memo = str(i.memo, 300) || `Transfer ${from.name} → ${to.name}`
  const e = postJournal(co, {
    date,
    memo,
    sourceType: 'bank',
    sourceId: id,
    lines: calc.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description })),
    createdBy: by,
  })
  calc.lines.forEach((l, idx) => {
    const bank = l.accountId === from.ledgerAccountId ? from : l.accountId === to.ledgerAccountId ? to : null
    if (bank && l.foreign !== null && bank.currency !== base) recordFx(co, e.id, idx, l.foreign)
  })
  const t: Tenant<TransferRecord> = {
    companyId: co,
    id,
    number: docNumber(co, prefixOf(co), 'TRF', date.slice(0, 4)),
    date,
    fromBankAccountId: from.id,
    toBankAccountId: to.id,
    amountFrom: r2(amountFrom),
    amountTo: r2(amountTo!),
    fee: r2(fee),
    fxDifference: calc.fxDifference,
    reference,
    memo,
    status: 'posted',
    journalEntryId: e.id,
    voidJournalEntryId: null,
    createdAt: nowIso(),
    createdBy: by,
  }
  finBankTransfers.push(t)
  return t
}

/** POST /finance/bank-transfers (full). */
export function createTransfer(user: User, input: TransferInput | null): BankTransfer {
  const co = full(user)
  const t = createTransferFor(co, user.id, input ?? {})
  recordAudit(user, { action: 'create', entity: 'bank_transfer', entityId: t.id, summary: `Recorded transfer ${t.number}` })
  return transferView(co, t)
}

/** POST /finance/bank-transfers/:id/void (full): reverses the entry (409 when a line is reconciled). */
export function voidTransfer(user: User, id: string): BankTransfer {
  const co = full(user)
  const t = finBankTransfers.find((x) => x.companyId === co && x.id === id) ?? notFound()
  if (t.status === 'void') conflict('This transfer is already void.', 'already_void')
  assertNotReconciled(co, t.journalEntryId)
  const e = entryIn(co, t.journalEntryId)!
  const date = isLocked(financeSettingsOf(co).lockDate, t.date) ? todayOf(co) : t.date
  const rev = reverseJournal(co, e.id, date, `Void of transfer ${t.number}`, user.id)
  for (const f of finBankLineFx.filter((x) => x.companyId === co && x.entryId === e.id)) recordFx(co, rev.id, f.lineIndex, -f.amount)
  t.status = 'void'
  t.voidJournalEntryId = rev.id
  recordAudit(user, { action: 'update', entity: 'bank_transfer', entityId: t.id, summary: `Voided transfer ${t.number}` })
  return transferView(co, t)
}

/* ---------------- statements ---------------- */

const MAX_CSV = 1_000_000
const MAX_ROWS = 5000

function existingKeys(co: string, bankId: string): Set<string> {
  return new Set(statementLinesOf(co, bankId).map((l) => l.key))
}

function cleanMapping(m: Partial<CsvMapping> | undefined, suggested: CsvMapping, width: number): CsvMapping {
  const out: CsvMapping = { ...suggested, ...(m ?? {}) } as CsvMapping
  const col = (v: unknown, field: string, required = false): number | null => {
    if (v === null || v === undefined || v === '') {
      if (required) bad(`Map the ${field} column.`, 'invalid_mapping', { field })
      return null
    }
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0 || n >= width) return bad(`The ${field} column is not in the file.`, 'invalid_mapping', { field })
    return n
  }
  out.date = col(out.date, 'date', true)!
  out.description = col(out.description, 'description', true)!
  out.reference = col(out.reference, 'reference')
  out.amount = col(out.amount, 'amount')
  out.debit = col(out.debit, 'debit')
  out.credit = col(out.credit, 'credit')
  out.balance = col(out.balance, 'balance')
  if (out.amount === null && (out.debit === null || out.credit === null)) bad('Map a signed amount column, or both debit and credit.', 'invalid_mapping', { field: 'amount' })
  if (out.amount !== null) {
    out.debit = null
    out.credit = null
  }
  if (!DATE_FORMATS.includes(out.dateFormat)) bad('Choose the date format of the file.', 'invalid_mapping', { field: 'date_format' })
  out.hasHeader = out.hasHeader !== false
  out.invertSign = out.invertSign === true
  return out
}

function parseInput(co: string, bankId: string, i: StatementImportInput): { rows: string[][]; mapping: CsvMapping; lines: ParsedLine[] } {
  const csv = typeof i.csv === 'string' ? i.csv : ''
  if (!csv.trim()) bad('Choose a CSV statement file.', 'validation_failed', { field: 'csv' })
  if (csv.length > MAX_CSV) bad('The file is too large (1 MB at most).', 'validation_failed', { field: 'csv' })
  const delimiter = i.mapping?.delimiter ?? detectDelimiter(csv)
  const rows = parseCsv(csv, delimiter)
  if (rows.length > MAX_ROWS + 1) bad(`Too many rows (${MAX_ROWS} at most).`, 'validation_failed', { field: 'csv' })
  const width = Math.max(...rows.map((r) => r.length))
  const mapping = { ...cleanMapping(i.mapping, suggestMapping(rows), width), delimiter }
  return { rows, mapping, lines: buildLines(rows, mapping, existingKeys(co, bankId)) }
}

function previewOf(rows: string[][], mapping: CsvMapping, lines: ParsedLine[]): StatementPreview {
  const ok = lines.filter((l) => !l.error)
  const dates = ok.map((l) => l.date).sort()
  const withBal = ok.filter((l) => l.balance !== null)
  return {
    columns: mapping.hasHeader ? rows[0] : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`),
    sample: rows.slice(mapping.hasHeader ? 1 : 0, (mapping.hasHeader ? 1 : 0) + 5),
    suggestedMapping: mapping,
    lines,
    errors: lines.filter((l) => l.error).length,
    duplicates: lines.filter((l) => l.duplicate).length,
    totalIn: r2(ok.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)),
    totalOut: r2(ok.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0)),
    startDate: dates[0] ?? null,
    endDate: dates[dates.length - 1] ?? null,
    closingBalance: withBal.length ? withBal[withBal.length - 1].balance : null,
  }
}

/** POST /finance/bank-accounts/:id/statements/preview (full): parse with the mapping (suggested when absent); nothing stored. */
export function previewStatement(user: User, id: string, input: StatementImportInput | null): StatementPreview {
  const co = full(user)
  const b = ownBank(co, id)
  const p = parseInput(co, b.id, input ?? {})
  return previewOf(p.rows, p.mapping, p.lines)
}

function statementView(co: string, s: Tenant<StatementRecord>): BankStatement {
  const matched = new Set(matchesOf(co, s.bankAccountId).flatMap((m) => m.statementLineIds))
  return {
    id: s.id,
    bankAccountId: s.bankAccountId,
    fileName: s.fileName,
    startDate: s.startDate,
    endDate: s.endDate,
    lineCount: s.lines.length,
    matchedCount: s.lines.filter((l) => matched.has(l.id)).length,
    skippedDuplicates: s.skippedDuplicates,
    closingBalance: s.closingBalance,
    importedByName: userName(co, s.importedBy),
    importedAt: s.importedAt,
  }
}
function statementDetail(co: string, s: Tenant<StatementRecord>, canWrite: boolean): BankStatementDetail {
  const byStmt = indexBy(matchesOf(co, s.bankAccountId), 'statementLineIds')
  const v = statementView(co, s)
  return { ...v, lines: s.lines.map((l) => stmtLineView(co, s.bankAccountId, { ...l, statementId: s.id }, byStmt)), canDelete: canWrite && v.matchedCount === 0 }
}

/** Stores statement lines (already parsed) for a bank account. */
export function storeStatement(co: string, by: string | null, bankAccountId: string, fileName: string, lines: { date: string; description: string; reference: string; amount: number; balance: number | null }[], skipped = 0): Tenant<StatementRecord> {
  if (!lines.length) bad('No new lines to import (all are duplicates or invalid).', 'empty_statement')
  const dates = lines.map((l) => l.date).sort()
  const withBal = lines.filter((l) => l.balance !== null)
  const s: Tenant<StatementRecord> = {
    companyId: co,
    id: bankId(co, 'bankStatement', 'STM'),
    bankAccountId,
    fileName: fileName.slice(0, 200) || 'statement.csv',
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    closingBalance: withBal.length ? withBal[withBal.length - 1].balance : null,
    skippedDuplicates: skipped,
    lines: lines.map((l) => ({ id: bankId(co, 'bankStatementLine', 'SL'), date: l.date, description: l.description, reference: l.reference, amount: r2(l.amount), balance: l.balance, key: lineKey(l) })),
    importedAt: nowIso(),
    importedBy: by,
  }
  finBankStatements.push(s)
  return s
}

/** POST /finance/bank-accounts/:id/statements (full): import a CSV; duplicate lines are skipped unless `include_duplicates`. */
export function importStatement(user: User, id: string, input: StatementImportInput | null): BankStatementDetail {
  const co = full(user)
  const b = ownBank(co, id)
  const i = input ?? {}
  const p = parseInput(co, b.id, i)
  const errors = p.lines.filter((l) => l.error)
  if (errors.length) bad(`${errors.length} line${errors.length === 1 ? '' : 's'} can’t be read: ${errors[0].error}`, 'invalid_lines', { rows: errors.slice(0, 20).map((l) => l.row) })
  const keep = p.lines.filter((l) => i.includeDuplicates === true || !l.duplicate)
  const s = storeStatement(co, user.id, b.id, str(i.fileName, 200), keep, p.lines.length - keep.length)
  recordAudit(user, { action: 'create', entity: 'bank_statement', entityId: s.id, summary: `Imported ${s.lines.length} statement lines into ${b.name}` })
  return statementDetail(co, s, true)
}

/** GET /finance/bank-accounts/:id/statements */
export function listStatements(user: User, id: string): BankStatement[] {
  const co = viewer(user)
  const b = ownBank(co, id)
  return finBankStatements.filter((s) => s.companyId === co && s.bankAccountId === b.id).sort((a, x) => x.importedAt.localeCompare(a.importedAt) || x.id.localeCompare(a.id)).map((s) => statementView(co, s))
}

/** GET /finance/bank-statements/:id */
export function getStatement(user: User, id: string): BankStatementDetail {
  const access = financeAccessOf(user)
  const co = tenantOf(user)
  const s = finBankStatements.find((x) => x.companyId === co && x.id === id) ?? notFound()
  return statementDetail(co, s, access === 'full')
}

/** DELETE /finance/bank-statements/:id (full): only when none of its lines is matched. */
export function deleteStatement(user: User, id: string): { id: string } {
  const co = full(user)
  const s = finBankStatements.find((x) => x.companyId === co && x.id === id) ?? notFound()
  const ids = new Set(s.lines.map((l) => l.id))
  if (finBankMatches.some((m) => m.companyId === co && m.statementLineIds.some((x) => ids.has(x)))) conflict('Some lines of this statement are matched: unmatch them first.', 'has_matches')
  finBankStatements.splice(finBankStatements.indexOf(s), 1)
  recordAudit(user, { action: 'delete', entity: 'bank_statement', entityId: s.id, summary: `Deleted statement ${s.fileName}` })
  return { id: s.id }
}

/* ---------------- matching ---------------- */

function matchView(co: string, m: Tenant<MatchRecord>): BankMatch {
  return {
    id: m.id,
    statementLineIds: [...m.statementLineIds],
    journalLineIds: [...m.journalLineIds],
    kind: m.kind,
    amount: m.amount,
    reconciliationId: finishedRecon(co, m.reconciliationId) ? m.reconciliationId : null,
    createdByName: userName(co, m.createdBy),
    createdAt: m.createdAt,
  }
}

/** Matches statement lines to journal lines of the account (1-to-1, 1-to-many, many-to-1). Amounts must balance. */
export function matchFor(co: string, by: string | null, bank: Tenant<BankAccountRecord>, input: MatchInput, kind: MatchRecord['kind'] = 'manual'): Tenant<MatchRecord> {
  const sIds = Array.isArray(input.statementLineIds) ? [...new Set(input.statementLineIds.filter((x): x is string => typeof x === 'string'))] : []
  const jIds = Array.isArray(input.journalLineIds) ? [...new Set(input.journalLineIds.filter((x): x is string => typeof x === 'string'))] : []
  if (!sIds.length || !jIds.length) bad('Pick at least one statement line and one book line.', 'validation_failed')
  if (sIds.length > 1 && jIds.length > 1) bad('Match one statement line to many book lines, or many statement lines to one book line.', 'validation_failed')
  const stmt = statementLinesOf(co, bank.id)
  const raw = rawLines(co, bank)
  const ms = matchesOf(co, bank.id)
  const usedS = indexBy(ms, 'statementLineIds')
  const usedJ = indexBy(ms, 'journalLineIds')
  const sLines = sIds.map((id) => stmt.find((l) => l.id === id) ?? bad('Unknown statement line.', 'invalid_statement_line', { id }))
  const jLines = jIds.map((id) => (parseLineId(id) ? raw.find((l) => l.id === id) : undefined) ?? bad('Unknown book line of this account.', 'invalid_journal_line', { id }))
  if (sIds.some((id) => usedS.has(id)) || jIds.some((id) => usedJ.has(id))) conflict('A line is already matched: unmatch it first.', 'already_matched')
  if (bank.reconcileFrom && jLines.some((l) => l.date < bank.reconcileFrom!)) bad('That book line is before “reconcile from” (already part of the opening balance).', 'before_reconcile_from')
  const sa = sLines.map((l) => l.amount)
  const ja = jLines.map((l) => l.amount)
  if (!matchBalances(sa, ja)) bad(`The amounts don’t agree: statement ${r2(sa.reduce((s, a) => s + a, 0))} vs book ${r2(ja.reduce((s, a) => s + a, 0))}.`, 'amounts_differ')
  const m: Tenant<MatchRecord> = { companyId: co, id: bankId(co, 'bankMatch', 'BM'), bankAccountId: bank.id, statementLineIds: sIds, journalLineIds: jIds, kind, amount: r2(sa.reduce((s, a) => s + a, 0)), reconciliationId: null, createdAt: nowIso(), createdBy: by }
  finBankMatches.push(m)
  return m
}

function suggestionsFor(co: string, bank: Tenant<BankAccountRecord>) {
  const ms = matchesOf(co, bank.id)
  const usedS = indexBy(ms, 'statementLineIds')
  const usedJ = indexBy(ms, 'journalLineIds')
  const stmt = statementLinesOf(co, bank.id).filter((l) => !usedS.has(l.id))
  const book = rawLines(co, bank).filter((l) => !usedJ.has(l.id) && (!bank.reconcileFrom || l.date >= bank.reconcileFrom))
  return suggestMatches(
    stmt.map((l) => ({ id: l.id, date: l.date, amount: l.amount, description: l.description, reference: l.reference })),
    book.map((l) => ({ id: l.id, date: l.date, amount: l.amount, docNumbers: docNumbersOf(co, l.entry) })),
  )
}

/** POST /finance/bank-accounts/:id/matches (full) `{ statement_line_ids, journal_line_ids }`. */
export function createMatch(user: User, id: string, input: MatchInput | null): ReconcileWorkspace {
  const co = full(user)
  const b = ownBank(co, id)
  matchFor(co, user.id, b, input ?? {})
  return workspaceOf(user, co, b)
}

/** POST /finance/bank-accounts/:id/auto-match (full): accepts every suggestion (score ≥ 60). */
export function autoMatch(user: User, id: string): ReconcileWorkspace & { autoMatched: number } {
  const co = full(user)
  const b = ownBank(co, id)
  let n = 0
  for (const s of suggestionsFor(co, b)) {
    matchFor(co, user.id, b, { statementLineIds: [s.statementLineId], journalLineIds: s.journalLineIds }, 'auto')
    n++
  }
  return { ...workspaceOf(user, co, b), autoMatched: n }
}

/** DELETE /finance/bank-matches/:id (full): 409 when part of a finished reconciliation. */
export function deleteMatch(user: User, id: string): { id: string } {
  const co = full(user)
  const m = finBankMatches.find((x) => x.companyId === co && x.id === id) ?? notFound()
  if (finishedRecon(co, m.reconciliationId)) conflict('This match is part of a finished reconciliation: undo the reconciliation first.', 'reconciled')
  finBankMatches.splice(finBankMatches.indexOf(m), 1)
  return { id: m.id }
}

/** POST /finance/bank-statement-lines/:id/create-entry (full): posts the line (bank vs the chosen / rule account) and matches it. */
export function createEntryFromLine(user: User, lineId: string, input: CreateFromLineInput | null): ReconcileWorkspace {
  const co = full(user)
  const s = finBankStatements.find((x) => x.companyId === co && x.lines.some((l) => l.id === lineId)) ?? notFound()
  const line = s.lines.find((l) => l.id === lineId)!
  const bank = ownBank(co, s.bankAccountId)
  if (finBankMatches.some((m) => m.companyId === co && m.statementLineIds.includes(line.id))) conflict('This statement line is already matched.', 'already_matched')
  const i = input ?? {}
  const rule = ruleFor(co, bank.id, line)
  const accountId = i.accountId || rule?.accountId
  const acc = accountIn(co, accountId)
  if (!acc || !acc.active || acc.isHeader || acc.id === bank.ledgerAccountId) bad('Choose the account to post to (e.g. 6800 Bank charges).', 'invalid_account', { field: 'account_id' })
  const base = baseCurrencyOf(co)
  const rate = bank.currency === base ? 1 : rateFor(co, bank.currency, line.date)
  const amt = r2(Math.abs(line.amount) * rate)
  const into = line.amount > 0
  const description = str(i.description, 300) || line.description || 'Bank statement line'
  const lines: JournalLine[] = [
    { accountId: bank.ledgerAccountId, debit: into ? amt : 0, credit: into ? 0 : amt, description },
    { accountId: acc!.id, debit: into ? 0 : amt, credit: into ? amt : 0, description },
  ]
  const e = postJournal(co, { date: line.date, memo: str(i.memo, 300) || `${bank.name}: ${description}`, sourceType: 'bank', sourceId: line.id, lines, createdBy: user.id })
  if (bank.currency !== base) recordFx(co, e.id, 0, line.amount)
  matchFor(co, user.id, bank, { statementLineIds: [line.id], journalLineIds: [lineIdOf(e.id, 0)] }, 'created')
  if (i.saveRule) {
    const contains = str(i.ruleContains, 100) || line.description.slice(0, 40)
    if (contains) createRuleFor(co, user.id, { name: `${contains} → ${acc!.code} ${acc!.name}`, contains, direction: into ? 'in' : 'out', accountId: acc!.id, bankAccountId: null })
  }
  recordAudit(user, { action: 'create', entity: 'journal_entry', entityId: e.id, summary: `Posted ${e.number} from a statement line of ${bank.name}` })
  return workspaceOf(user, co, bank)
}

/* ---------------- workspace, reconciliations ---------------- */

function reconView(co: string, r: Tenant<ReconciliationRecord>): BankReconciliation {
  return {
    id: r.id,
    bankAccountId: r.bankAccountId,
    bankAccountName: bankOf(co, r.bankAccountId)?.name ?? '—',
    statementDate: r.statementDate,
    statementBalance: r.statementBalance,
    clearedBalance: r.clearedBalance,
    difference: r.difference,
    status: r.status,
    matchCount: r.matchIds.length,
    journalLineCount: r.journalLineIds.length,
    finishedByName: userName(co, r.finishedBy),
    finishedAt: r.finishedAt,
    undoneAt: r.undoneAt,
  }
}

function workspaceOf(_user: User, co: string, b: Tenant<BankAccountRecord>, to: string | null = null): ReconcileWorkspace {
  const ms = matchesOf(co, b.id)
  const byLine = indexBy(ms, 'journalLineIds')
  const byStmt = indexBy(ms, 'statementLineIds')
  const stmt = statementLinesOf(co, b.id)
  const raw = rawLines(co, b)
  const statementDate = to ?? stmt[stmt.length - 1]?.date ?? null
  const statementBalance = statementDate ? statementBalanceAt(co, b, statementDate) : null
  const cleared = statementDate ? clearedOn(co, b, statementDate) : 0
  const rec = lastRecon(co, b.id)
  const open = ms.filter((m) => !finishedRecon(co, m.reconciliationId))
  return {
    bankAccount: accountView(co, b),
    statementLines: stmt.filter((l) => !byStmt.has(l.id) && (!to || l.date <= to)).map((l) => stmtLineView(co, b.id, l, byStmt)),
    bookLines: raw.filter((x) => !byLine.has(x.id) && (!b.reconcileFrom || x.date >= b.reconcileFrom)).map((x) => bookLineView(co, x, byLine)),
    matches: open.map((m) => ({
      ...matchView(co, m),
      statementLines: stmt.filter((l) => m.statementLineIds.includes(l.id)).map((l) => stmtLineView(co, b.id, l, byStmt)),
      bookLines: raw.filter((x) => m.journalLineIds.includes(x.id)).map((x) => bookLineView(co, x, byLine)),
    })),
    suggestions: suggestionsFor(co, b),
    statementDate,
    statementBalance,
    clearedBalance: cleared,
    difference: statementBalance === null ? 0 : r2(statementBalance - cleared),
    lastReconciliation: rec ? reconView(co, rec) : null,
  }
}

/** GET /finance/bank-accounts/:id/reconcile?to= */
export function getReconcileWorkspace(user: User, id: string, q: { to?: string | null } = {}): ReconcileWorkspace {
  const co = viewer(user)
  const b = ownBank(co, id)
  return workspaceOf(user, co, b, q.to && isIsoDate(q.to) ? q.to : null)
}

/** Finishes a reconciliation session (difference must be 0). */
export function finishReconciliationFor(co: string, by: string | null, b: Tenant<BankAccountRecord>, input: FinishReconciliationInput): Tenant<ReconciliationRecord> {
  const stmt = statementLinesOf(co, b.id)
  const date = input.statementDate ?? stmt[stmt.length - 1]?.date
  if (!date || !isIsoDate(date)) return bad('Enter the statement date (yyyy-MM-dd).', 'validation_failed', { field: 'statement_date' })
  const prev = lastRecon(co, b.id)
  if (prev && date <= prev.statementDate) conflict(`This account is reconciled up to ${prev.statementDate}: choose a later statement date.`, 'already_reconciled')
  const given = num(input.statementBalance)
  const balance = given ?? statementBalanceAt(co, b, date)
  if (balance === null) return bad('Enter the statement balance on that date.', 'validation_failed', { field: 'statement_balance' })
  const cleared = clearedOn(co, b, date)
  const difference = r2(balance - cleared)
  if (difference !== 0) bad(`The statement balance and the cleared book balance differ by ${difference}. Match or create the missing lines first.`, 'difference_not_zero', { difference, cleared_balance: cleared, statement_balance: balance })
  const ms = matchesOf(co, b.id).filter((m) => !finishedRecon(co, m.reconciliationId) && (matchDate(co, m) ?? '9999') <= date)
  const r: Tenant<ReconciliationRecord> = {
    companyId: co,
    id: bankId(co, 'bankReconciliation', 'REC'),
    bankAccountId: b.id,
    statementDate: date,
    statementBalance: r2(balance),
    clearedBalance: cleared,
    difference,
    status: 'finished',
    matchIds: ms.map((m) => m.id),
    journalLineIds: ms.flatMap((m) => m.journalLineIds),
    finishedAt: nowIso(),
    finishedBy: by,
    undoneAt: null,
    undoneBy: null,
  }
  for (const m of ms) m.reconciliationId = r.id
  finBankReconciliations.push(r)
  return r
}

/** POST /finance/bank-accounts/:id/reconciliations (full) `{ statement_date, statement_balance }`. */
export function finishReconciliation(user: User, id: string, input: FinishReconciliationInput | null): ReconciliationReport {
  const co = full(user)
  const b = ownBank(co, id)
  const r = finishReconciliationFor(co, user.id, b, input ?? {})
  recordAudit(user, { action: 'create', entity: 'bank_reconciliation', entityId: r.id, summary: `Reconciled ${b.name} to ${r.statementDate}` })
  return reportOf(user, co, r)
}

/** GET /finance/bank-reconciliations?bank_account_id= */
export function listReconciliations(user: User, q: { bankAccountId?: string | null } = {}): BankReconciliation[] {
  const co = viewer(user)
  return finBankReconciliations
    .filter((r) => r.companyId === co && (!q.bankAccountId || r.bankAccountId === q.bankAccountId))
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || b.finishedAt.localeCompare(a.finishedAt))
    .map((r) => reconView(co, r))
}

function reportOf(user: User, co: string, r: Tenant<ReconciliationRecord>): ReconciliationReport {
  const b = ownBank(co, r.bankAccountId)
  const ms = matchesOf(co, b.id)
  const byLine = indexBy(ms, 'journalLineIds')
  const byStmt = indexBy(ms, 'statementLineIds')
  const recs = new Map(finBankReconciliations.filter((x) => x.companyId === co).map((x) => [x.id, x]))
  const clearedAsOf = (lineId: string) => {
    const m = byLine.get(lineId)
    const rec = m?.reconciliationId ? recs.get(m.reconciliationId) : undefined
    if (r.status === 'finished') return !!rec && rec.status === 'finished' && rec.statementDate <= r.statementDate
    return r.journalLineIds.includes(lineId)
  }
  const raw = rawLines(co, b).filter((x) => x.date <= r.statementDate)
  const bookBalance = r2(raw.reduce((s, x) => s + x.amount, 0))
  const outstanding = raw.filter((x) => !(b.reconcileFrom && x.date < b.reconcileFrom) && !clearedAsOf(x.id)).map((x) => bookLineView(co, x, byLine))
  const latest = lastRecon(co, b.id)
  return {
    ...reconView(co, r),
    currency: b.currency,
    bookBalance,
    outstandingDeposits: outstanding.filter((l) => l.amount > 0),
    outstandingPayments: outstanding.filter((l) => l.amount < 0),
    unmatchedStatementLines: statementLinesOf(co, b.id)
      .filter((l) => l.date <= r.statementDate && !byStmt.has(l.id))
      .map((l) => stmtLineView(co, b.id, l, byStmt)),
    adjustedBookBalance: r2(bookBalance - outstanding.reduce((s, l) => s + l.amount, 0)),
    canUndo: financeAccessOf(user) === 'full' && r.status === 'finished' && latest?.id === r.id,
  }
}

/** GET /finance/bank-reconciliations/:id — the reconciliation report (outstanding deposits / payments). */
export function getReconciliation(user: User, id: string): ReconciliationReport {
  const co = viewer(user)
  const r = finBankReconciliations.find((x) => x.companyId === co && x.id === id) ?? notFound()
  return reportOf(user, co, r)
}

/** POST /finance/bank-reconciliations/:id/undo (full): the latest finished one of its account only. */
export function undoReconciliation(user: User, id: string): ReconciliationReport {
  const co = full(user)
  const r = finBankReconciliations.find((x) => x.companyId === co && x.id === id) ?? notFound()
  if (r.status !== 'finished') conflict('This reconciliation is already undone.', 'already_undone')
  if (lastRecon(co, r.bankAccountId)?.id !== r.id) conflict('Undo the later reconciliations of this account first.', 'not_latest')
  for (const m of finBankMatches) if (m.companyId === co && m.reconciliationId === r.id) m.reconciliationId = null
  r.status = 'undone'
  r.undoneAt = nowIso()
  r.undoneBy = user.id
  recordAudit(user, { action: 'update', entity: 'bank_reconciliation', entityId: r.id, summary: `Undid the reconciliation to ${r.statementDate}` })
  return reportOf(user, co, r)
}

/** 409 `reconciled` when a line of the entry (or of its reversal) is matched in a finished reconciliation. */
export function assertNotReconciled(co: string, entryId: string): void {
  const hit = finBankMatches.find((m) => m.companyId === co && finishedRecon(co, m.reconciliationId) && m.journalLineIds.some((id) => parseLineId(id)?.entryId === entryId))
  if (hit) conflict('A line of this entry is reconciled with a bank statement. Undo that reconciliation (Banking) before reversing it.', 'reconciled', { reconciliation_id: hit.reconciliationId })
}
registerReverseGuard(assertNotReconciled)
setPayrollReverseGuard(assertNotReconciled)

/* ---------------- rules ---------------- */

function ruleView(co: string, r: Tenant<(typeof finBankRules)[number]>): BankRule {
  const a = accountIn(co, r.accountId)
  return { id: r.id, name: r.name, contains: r.contains, direction: r.direction, accountId: r.accountId, accountCode: a?.code ?? '', accountName: a?.name ?? '', bankAccountId: r.bankAccountId, active: r.active, createdAt: r.createdAt }
}
function cleanRule(co: string, i: BankRuleInput, base: Partial<BankRuleInput> = {}) {
  const m = { ...base, ...i }
  const contains = str(m.contains, 100)
  if (!contains) bad('Enter the text the description contains.', 'validation_failed', { field: 'contains' })
  const acc = accountIn(co, m.accountId)
  if (!acc || !acc.active || acc.isHeader) bad('Choose an active, postable account.', 'invalid_account', { field: 'account_id' })
  const direction = m.direction ?? 'any'
  if (!['any', 'in', 'out'].includes(direction)) bad('Direction is any, in or out.', 'validation_failed', { field: 'direction' })
  let bankAccountId: string | null = null
  if (m.bankAccountId) bankAccountId = bankOf(co, m.bankAccountId)?.id ?? bad('Unknown bank account.', 'invalid_bank_account', { field: 'bank_account_id' })
  return { name: str(m.name, 120) || `${contains} → ${acc!.code} ${acc!.name}`, contains, direction: direction as 'any' | 'in' | 'out', accountId: acc!.id, bankAccountId, active: m.active !== false }
}
function createRuleFor(co: string, by: string | null, i: BankRuleInput) {
  const r = { companyId: co, id: bankId(co, 'bankRule', 'BR'), ...cleanRule(co, i), createdAt: nowIso(), createdBy: by }
  finBankRules.push(r)
  return r
}
/** GET /finance/bank-rules */
export function listRules(user: User): BankRule[] {
  const co = viewer(user)
  return finBankRules.filter((r) => r.companyId === co).map((r) => ruleView(co, r))
}
/** POST /finance/bank-rules (full) */
export function createRule(user: User, input: BankRuleInput | null): BankRule {
  const co = full(user)
  return ruleView(co, createRuleFor(co, user.id, input ?? {}))
}
/** PATCH /finance/bank-rules/:id (full) */
export function updateRule(user: User, id: string, input: BankRuleInput | null): BankRule {
  const co = full(user)
  const r = finBankRules.find((x) => x.companyId === co && x.id === id) ?? notFound()
  Object.assign(r, cleanRule(co, input ?? {}, { name: r.name, contains: r.contains, direction: r.direction, accountId: r.accountId, bankAccountId: r.bankAccountId, active: r.active }))
  return ruleView(co, r)
}
/** DELETE /finance/bank-rules/:id (full) */
export function deleteRule(user: User, id: string): { id: string } {
  const co = full(user)
  const r = finBankRules.find((x) => x.companyId === co && x.id === id) ?? notFound()
  finBankRules.splice(finBankRules.indexOf(r), 1)
  return { id: r.id }
}

/** Ledger accounts a bank account may use: active postable accounts under 1100 not linked yet (GET /finance/bank-accounts/ledger-options). */
export function ledgerOptions(user: User): { id: string; code: string; name: string; currency: string | null }[] {
  const co = viewer(user)
  const used = new Set(finBankAccounts.filter((b) => b.companyId === co).map((b) => b.ledgerAccountId))
  return paymentAccountsOf(co).filter((a) => !used.has(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name, currency: a.currency }))
}

/* ---------------- journal sources ---------------- */

registerJournalSource('bank', (co, id) => {
  if (id.startsWith('TRF-')) {
    const t = finBankTransfers.find((x) => x.companyId === co && x.id === id)
    return { number: t?.number ?? null, link: `/finance/banking?tab=transfers&transfer=${encodeURIComponent(id)}` }
  }
  const s = finBankStatements.find((x) => x.companyId === co && x.lines.some((l) => l.id === id))
  return s ? { number: s.fileName, link: `/finance/banking?account=${encodeURIComponent(s.bankAccountId)}&tab=reconcile` } : null
})

/* ---------------- alerts ---------------- */

/** Accountants hear once per account and statement when a statement line is still unmatched 30 days after its date. */
export function runBankingAlerts(co: string): void {
  const cutoff = addDays(todayOf(co), -30)
  for (const b of finBankAccounts) {
    if (b.companyId !== co || !b.active) continue
    const matched = new Set(matchesOf(co, b.id).flatMap((m) => m.statementLineIds))
    const old = statementLinesOf(co, b.id).filter((l) => !matched.has(l.id) && l.date < cutoff)
    if (!old.length) continue
    const key = `recon-old:${b.id}:${old[0].statementId}`
    if (finBankingMeta.alerts.includes(key)) continue
    finBankingMeta.alerts.push(key)
    notify(co, accountantIds(co), `Bank reconciliation of ${b.name} has differences older than 30 days`, `${old.length} statement line${old.length === 1 ? '' : 's'} still unmatched (oldest ${old[0].date}).`, `/finance/banking?account=${encodeURIComponent(b.id)}&tab=reconcile`)
  }
}

/* ---------------- seed ---------------- */

interface SeedAccount {
  key: string
  name: string
  bankName: string
  kind: BankAccountKind
  currency: string | null
  ledger: string | null
  accountNumber: string
  iban: string
  opening: number
  openingOffset: number
}
const SEEDS: Record<string, { accounts: SeedAccount[]; transfers: { from: string; to: string; amountFrom: number; amountTo?: number; fee?: number; offset: number; reference: string }[]; statement: { from: number; to: number; reconcileAt: number; extra: { offset: number; description: string; reference: string; amount: number }[] }; rules: { contains: string; direction: 'any' | 'in' | 'out'; account: string }[] }> = {
  co_apex: {
    accounts: [
      { key: 'main', name: 'Main bank account', bankName: 'Emirates NBD', kind: 'current', currency: null, ledger: 'ACC-1120', accountNumber: '101482736510', iban: 'AE070260001014827365101', opening: 0, openingOffset: 0 },
      { key: 'cash', name: 'Cash on hand', bankName: '', kind: 'cash', currency: null, ledger: 'ACC-1110', accountNumber: '', iban: '', opening: 0, openingOffset: 0 },
      { key: 'savings', name: 'ADCB savings account', bankName: 'Abu Dhabi Commercial Bank', kind: 'savings', currency: null, ledger: null, accountNumber: '120556093002', iban: 'AE460030012055609300201', opening: 120000, openingOffset: -60 },
      { key: 'usd', name: 'Mashreq USD account', bankName: 'Mashreq', kind: 'current', currency: 'USD', ledger: null, accountNumber: '019400772188', iban: 'AE330330000019400772188', opening: 25000, openingOffset: -60 },
    ],
    transfers: [
      { from: 'main', to: 'savings', amountFrom: 50000, offset: -20, reference: 'TT-ADCB-0412' },
      { from: 'main', to: 'usd', amountFrom: 36800, amountTo: 10000, fee: 25, offset: -12, reference: 'FX-MSHQ-2211' },
    ],
    statement: { from: -30, to: -4, reconcileAt: -18, extra: [{ offset: -10, description: 'MONTHLY ACCOUNT MAINTENANCE FEE', reference: 'FEE1124', amount: -52.5 }, { offset: -6, description: 'CREDIT INTEREST', reference: 'INT1124', amount: 18.4 }] },
    rules: [
      { contains: 'fee', direction: 'out', account: 'ACC-6800' },
      { contains: 'interest', direction: 'in', account: 'ACC-4900' },
    ],
  },
  co_crest: {
    accounts: [
      { key: 'main', name: 'Main bank account', bankName: 'Al Rajhi Bank', kind: 'current', currency: null, ledger: 'ACC-1120', accountNumber: '608010167519', iban: 'SA0380000000608010167519', opening: 0, openingOffset: 0 },
      { key: 'cash', name: 'Cash on hand', bankName: '', kind: 'cash', currency: null, ledger: 'ACC-1110', accountNumber: '', iban: '', opening: 0, openingOffset: 0 },
      { key: 'riyad', name: 'Riyad Bank operations', bankName: 'Riyad Bank', kind: 'current', currency: null, ledger: null, accountNumber: '230118840011', iban: 'SA4420000002301188400119', opening: 300000, openingOffset: -70 },
    ],
    transfers: [
      { from: 'main', to: 'riyad', amountFrom: 80000, offset: -22, reference: 'RJHI-TRF-7781' },
      { from: 'riyad', to: 'main', amountFrom: 15000, fee: 10, offset: -8, reference: 'RIBL-TRF-3310' },
    ],
    statement: { from: -50, to: -20, reconcileAt: -42, extra: [{ offset: -40, description: 'PROFIT SHARE CREDIT', reference: 'PRF0926', amount: 240 }, { offset: -25, description: 'SADAD SERVICE FEE', reference: 'SDD0921', amount: -11.5 }] },
    rules: [
      { contains: 'fee', direction: 'out', account: 'ACC-6800' },
      { contains: 'profit share', direction: 'in', account: 'ACC-4900' },
    ],
  },
}

/** Seeds a company's bank accounts, transfers, rules and a partly reconciled statement (once; after collections and payroll). */
export function ensureBankingSeed(co: string): void {
  if (finBankingMeta.seeded.includes(co)) return
  const seed = SEEDS[co]
  finBankingMeta.seeded.push(co)
  if (!seed || !financeAccounts.some((a) => a.companyId === co && a.id === 'ACC-1120')) return
  ensureCollectionsSeed(co)
  syncPayrollPostings(co)
  const today = todayOf(co)
  const day = (n: number) => addDays(today, n)
  const keyed = new Map<string, Tenant<BankAccountRecord>>()
  for (const a of seed.accounts) {
    const b = createBankAccountFor(co, null, {
      name: a.name,
      bankName: a.bankName,
      kind: a.kind,
      currency: a.currency ?? undefined,
      ledgerAccountId: a.ledger,
      accountNumber: a.accountNumber,
      iban: a.iban,
      openingBalance: a.opening || undefined,
      openingDate: a.opening ? day(a.openingOffset) : undefined,
    })
    keyed.set(a.key, b)
  }
  for (const t of seed.transfers) {
    createTransferFor(co, null, { date: day(t.offset), fromBankAccountId: keyed.get(t.from)!.id, toBankAccountId: keyed.get(t.to)!.id, amountFrom: t.amountFrom, amountTo: t.amountTo, fee: t.fee, reference: t.reference })
  }
  for (const r of seed.rules) createRuleFor(co, null, { contains: r.contains, direction: r.direction, accountId: r.account })

  // A statement of the main account built from its book lines: two left out (outstanding), two bank-only lines.
  const main = keyed.get('main')!
  const st = seed.statement
  main.reconcileFrom = day(st.from)
  const raw = rawLines(co, main)
  let running = r2(raw.filter((x) => x.date < main.reconcileFrom!).reduce((s, x) => s + x.amount, 0))
  const inWindow = raw.filter((x) => x.date >= day(st.from) && x.date <= day(st.to))
  const outstanding = new Set(inWindow.slice(-2).map((x) => x.id))
  type Row = { date: string; description: string; reference: string; amount: number; bookId: string | null }
  const rows: Row[] = inWindow
    .filter((x) => !outstanding.has(x.id))
    .map((x, i) => {
      const date = i % 3 === 0 && x.date < day(st.reconcileAt) ? addDays(x.date, 1) : x.date
      const docs = docNumbersOf(co, x.entry)
      return { date: date > day(st.to) ? x.date : date, description: (x.amount > 0 ? 'INWARD ' : 'OUTWARD ') + (x.entry.memo || x.description).toUpperCase().slice(0, 60), reference: docs[1] ?? docs[0], amount: x.amount, bookId: x.id }
    })
  for (const e of st.extra) rows.push({ date: day(e.offset), description: e.description, reference: e.reference, amount: e.amount, bookId: null })
  rows.sort((a, b) => a.date.localeCompare(b.date))
  const withBalance = rows.map((r) => {
    running = r2(running + r.amount)
    return { ...r, balance: running }
  })
  if (withBalance.length) {
    const s = storeStatement(co, co === 'co_apex' ? 'u8' : 'u101', main.id, `${main.bankName.replace(/\s+/g, '_')}_statement_${day(st.from)}_${day(st.to)}.csv`, withBalance)
    s.importedAt = `${day(st.to + 1)}T07:30:00.000Z`
    s.lines.forEach((l, i) => {
      const bookId = withBalance[i].bookId
      if (bookId) matchFor(co, s.importedBy, main, { statementLineIds: [l.id], journalLineIds: [bookId] }, 'auto')
    })
    try {
      finishReconciliationFor(co, s.importedBy, main, { statementDate: day(st.reconcileAt) })
    } catch {
      /* nothing to reconcile at that date */
    }
  }
}

onFinanceAccess('banking-seed', (co) => {
  // A finance hook never throws: a seed / alert problem must not break every finance endpoint.
  try {
    ensureBankingSeed(co)
    runBankingAlerts(co)
  } catch (e) {
    console.error('[banking] finance hook failed', e)
  }
})
