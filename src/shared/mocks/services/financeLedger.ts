import type { User } from '@/shared/types'
import type { Account, AccountType, JournalEntry, JournalLine, JournalSourceType, SystemAccountRole } from '@/modules/finance/types'
import { ACCOUNT_TYPES } from '@/modules/finance/types'
import type {
  AccountInput,
  AccountLedger,
  AccountRow,
  ExchangeRate,
  ExchangeRateInput,
  FinanceOverview,
  FinanceSettings,
  FinanceSettingsInput,
  JournalDetail,
  JournalDimensions,
  JournalFilters,
  JournalLineView,
  JournalRow,
  ManualJournalInput,
  OpeningBalanceInput,
  TrialBalance,
} from '@/modules/finance/ledger/types'
import { ACCOUNT_SUBTYPES, SOURCE_TYPE_LABEL, SYSTEM_ROLE_LABEL, SYSTEM_ROLE_TYPE } from '@/modules/finance/ledger/types'
import {
  accountLedger,
  depthOf,
  descendantsOf,
  isIsoDate,
  isLocked,
  isValidVatNumber,
  monthRange,
  naturalBalance,
  r2,
  rollUp,
  sumByAccount,
  treeOrder,
  trialBalance,
} from '@/modules/finance/ledger/calc'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { taxLabel, taxNumberError, normalizeTaxNumber } from '@/shared/lib/taxNumber'
import type { CountryCode } from '@/modules/tenancy/types'
import { nowIso } from '@/shared/mocks/clock'
import { customers, users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { departments } from '@/shared/mocks/data/departments'
import { projects } from '@/shared/mocks/data/tasks'
import { events } from '@/shared/mocks/data/events'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeInvoices, financeJournal, financeSeq, financeTaxCodes } from '@/shared/mocks/data/finance'
import { chartTemplateFor, taxCodesTemplateFor } from '@/shared/mocks/data/financeSeed'
import { financeSettings, type FinanceSettingsRecord } from '@/shared/mocks/data/financeLedger'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { postJournal, reverseJournal, runFinanceHooks, setPeriodGuard, systemAccount } from './ledger'
import { isOverdue } from './financeInvoiceBalance'
import { baseCurrencyOf } from './financeRates'
import { seedLedgerJournal } from '@/shared/mocks/data/financeLedgerSeed'

/**
 * Accounts & finance › ledger core and setup (docs/API.md › Finance › Ledger & settings).
 *
 * WHO (PERMISSION_MATRIX `accounting`): full (Company Admin, Management, Accountant) reads and writes; view (Sales
 * Manager) reads settings, the chart, the journal, the reports and the overview; hidden → 403. The lock date moves
 * only for Company Admin and Accountant (Management: 403 `lock_date_forbidden`), audited. Plan gate: `/finance/*` →
 * module `accounting` (services/billing.ts). The company comes from the session; a foreign id answers 404 like a
 * missing one (ids in bodies: the same 422 as a missing one).
 *
 * LOCK DATE: `postJournal` refuses any date on or before the company's lock date with 423 `period_locked` (wired
 * through `setPeriodGuard` when this module loads) — for every finance section, not only manual entries.
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

export const FINANCE_FORBIDDEN = 'Accounts & finance is for Company Admins, Management and Accountants.'
export const FINANCE_MANAGE_ONLY = 'Only Company Admins, Management and Accountants can change the books.'
const LOCK_ROLES = new Set(['Company Admin', 'Accountant'])

export type FinanceAccess = 'full' | 'view'
export function financeAccessOf(user: User): FinanceAccess {
  const s = scopeOf(user.role, 'accounting')
  if (s === 'hidden') throw new CodedApiError(FINANCE_FORBIDDEN, 403, 'forbidden')
  runFinanceHooks(tenantOf(user))
  return s === 'full' ? 'full' : 'view'
}
function assertFull(user: User): string {
  if (financeAccessOf(user) !== 'full') throw new CodedApiError(FINANCE_MANAGE_ONLY, 403, 'forbidden')
  return tenantOf(user)
}
function viewer(user: User): string {
  financeAccessOf(user)
  return tenantOf(user)
}

/* ---------------- period guard (lock date) ---------------- */

/** Throws 423 `period_locked` when `date` is on or before the company's lock date. */
export function assertPeriodOpen(companyId: string, date: string): void {
  const lock = financeSettings.get(companyId).lockDate
  if (isLocked(lock, date)) {
    throw new CodedApiError(`The books are locked up to ${lock}. Use a later date, or ask a Company Admin or Accountant to move the lock date.`, 423, 'period_locked', { lock_date: lock })
  }
}
// The seed (opening balances, manual entries) is posted before the guard is installed.
seedLedgerJournal()
setPeriodGuard(assertPeriodOpen)

/* ---------------- source documents (other sections register theirs) ---------------- */

type SourceResolver = (companyId: string, sourceId: string) => { number: string | null; link: string | null } | null
const resolvers = new Map<JournalSourceType, SourceResolver>()

/**
 * Lets a finance section say how its documents show in the journal (number + screen link). Defaults: invoices are
 * read from the invoice store; payroll runs link to Salary Management; other sources link to their section's list.
 */
export function registerJournalSource(type: JournalSourceType, fn: SourceResolver): void {
  resolvers.set(type, fn)
}

const DEFAULT_LINK: Partial<Record<JournalSourceType, (id: string) => string>> = {
  invoice: (id) => `/finance/invoices/${encodeURIComponent(id)}`,
  credit_note: (id) => `/finance/invoices?credit_note=${encodeURIComponent(id)}`,
  payment: (id) => `/finance/payments/${encodeURIComponent(id)}`,
  payment_refund: (id) => `/finance/payments/${encodeURIComponent(id)}`,
  pdc: (id) => `/finance/payments?pdc=${encodeURIComponent(id)}`,
  payroll: (id) => `/hr/salary?run=${encodeURIComponent(id)}`,
}

function sourceOf(co: string, e: Pick<JournalEntry, 'sourceType' | 'sourceId'>): { number: string | null; link: string | null } {
  if (!e.sourceId) return { number: null, link: null }
  const custom = resolvers.get(e.sourceType)?.(co, e.sourceId)
  if (custom) return custom
  if (e.sourceType === 'invoice') {
    const inv = financeInvoices.find((i) => i.companyId === co && i.id === e.sourceId)
    return { number: inv?.number ?? null, link: inv ? DEFAULT_LINK.invoice!(inv.id) : null }
  }
  const link = DEFAULT_LINK[e.sourceType]
  return { number: null, link: link ? link(e.sourceId) : null }
}

/* ---------------- helpers ---------------- */

const strip = <T extends { companyId: string }>(r: T): Omit<T, 'companyId'> => {
  const { companyId: _c, ...rest } = r // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest
}
const userName = (co: string, id: string | null) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : 'System')
const accountsOf = (co: string) => financeAccounts.filter((a) => a.companyId === co)
const entriesOf = (co: string) => financeJournal.filter((e) => e.companyId === co)
const accountIn = (co: string, id: unknown) => (typeof id === 'string' ? financeAccounts.find((a) => a.companyId === co && a.id === id) : undefined)
const todayOf = (co: string) => companyDayOf(co).today
const countryOf = (co: string) => companyById(co)?.regional.country ?? 'AE'
const str = (v: unknown, max: number, field: string): string => {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') return bad(`${field} must be text.`)
  const t = v.trim()
  if (t.length > max) bad(`${field} is too long (max ${max} characters).`)
  return t
}
const num = (v: unknown, field: string): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return bad(`${field} must be a number.`)
  return n
}
const hasPostings = (co: string, accountId: string) => financeJournal.some((e) => e.companyId === co && e.lines.some((l) => l.accountId === accountId))

/* ================= settings ================= */

function settingsView(user: User, co: string): FinanceSettings {
  const s = financeSettings.get(co)
  const full = scopeOf(user.role, 'accounting') === 'full'
  const country = countryOf(co)
  return {
    baseCurrency: baseCurrencyOf(co),
    country,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
    vatRegistered: s.vatRegistered,
    vatNumber: s.vatNumber,
    vatLabel: taxLabel(country as CountryCode),
    legalNameEn: s.legalNameEn,
    legalNameAr: s.legalNameAr,
    documentPrefix: s.documentPrefix,
    paymentTermsDays: s.paymentTermsDays,
    invoiceNotes: s.invoiceNotes,
    invoiceTerms: s.invoiceTerms,
    defaultRevenueAccountId: s.defaultRevenueAccountId,
    defaultBankAccountId: s.defaultBankAccountId,
    exchangeRates: [...s.exchangeRates]
      .sort((a, b) => a.currency.localeCompare(b.currency) || b.effectiveDate.localeCompare(a.effectiveDate))
      .map((r): ExchangeRate => ({ id: r.id, currency: r.currency, rate: r.rate, effectiveDate: r.effectiveDate, createdAt: r.createdAt, createdByName: r.createdBy ? userName(co, r.createdBy) : null })),
    lockDate: s.lockDate,
    lockDateSetAt: s.lockDateSetAt,
    lockDateSetByName: s.lockDateSetBy ? userName(co, s.lockDateSetBy) : null,
    canMoveLockDate: full && LOCK_ROLES.has(user.role),
    canEdit: full,
    updatedAt: s.updatedAt,
  }
}

/** Server-side read of a company's finance settings (invoices: payment terms, notes, terms, prefix, defaults). */
export function financeSettingsOf(companyId: string): Readonly<FinanceSettingsRecord> {
  return financeSettings.get(companyId)
}

/** GET /finance/settings */
export function getFinanceSettings(user: User): FinanceSettings {
  return settingsView(user, viewer(user))
}

/** PATCH /finance/settings (full). */
export function updateFinanceSettings(user: User, input: FinanceSettingsInput | null): FinanceSettings {
  const co = assertFull(user)
  if (!input || typeof input !== 'object') bad('Send the settings to change.')
  const i = input as Record<string, unknown>
  const s = financeSettings.get(co)
  const next: FinanceSettingsRecord = { ...s }
  const country = countryOf(co)
  if (i.fiscalYearStartMonth !== undefined) {
    const m = num(i.fiscalYearStartMonth, 'Fiscal year start month')
    if (!Number.isInteger(m) || m < 1 || m > 12) bad('Fiscal year start month is 1 (January) to 12 (December).', 'validation_failed', { field: 'fiscal_year_start_month' })
    next.fiscalYearStartMonth = m
  }
  if (i.vatRegistered !== undefined) next.vatRegistered = i.vatRegistered === true
  if (i.vatNumber !== undefined) next.vatNumber = normalizeTaxNumber(str(i.vatNumber, 30, 'VAT number'))
  if (i.legalNameEn !== undefined) next.legalNameEn = str(i.legalNameEn, 200, 'Legal name')
  if (i.legalNameAr !== undefined) {
    next.legalNameAr = str(i.legalNameAr, 200, 'Arabic legal name')
    if (next.legalNameAr && !/[؀-ۿ]/.test(next.legalNameAr)) bad('The Arabic legal name must be written in Arabic.', 'validation_failed', { field: 'legal_name_ar' })
  }
  if (i.paymentTermsDays !== undefined) {
    const d = num(i.paymentTermsDays, 'Payment terms')
    if (!Number.isInteger(d) || d < 0 || d > 365) bad('Payment terms are 0–365 days.', 'validation_failed', { field: 'payment_terms_days' })
    next.paymentTermsDays = d
  }
  if (i.invoiceNotes !== undefined) next.invoiceNotes = str(i.invoiceNotes, 2000, 'Invoice notes')
  if (i.invoiceTerms !== undefined) next.invoiceTerms = str(i.invoiceTerms, 4000, 'Invoice terms')
  if (i.defaultRevenueAccountId !== undefined) {
    const id = i.defaultRevenueAccountId
    if (id === null || id === '') next.defaultRevenueAccountId = null
    else {
      const a = accountIn(co, id)
      if (!a || !a.active || a.isHeader || a.type !== 'income') bad('Choose an active income account of your chart.', 'invalid_account', { field: 'default_revenue_account_id' })
      next.defaultRevenueAccountId = a!.id
    }
  }
  if (i.defaultBankAccountId !== undefined) {
    const id = i.defaultBankAccountId
    if (id === null || id === '') next.defaultBankAccountId = null
    else {
      const a = accountIn(co, id)
      if (!a || !a.active || a.isHeader || a.type !== 'asset') bad('Choose an active asset (bank) account of your chart.', 'invalid_account', { field: 'default_bank_account_id' })
      next.defaultBankAccountId = a!.id
    }
  }
  if (next.vatRegistered) {
    if (!next.vatNumber) bad(`Enter the ${taxLabel(country as CountryCode)} of a VAT-registered company.`, 'validation_failed', { field: 'vat_number' })
    if (!isValidVatNumber(next.vatNumber, country)) bad(taxNumberError(country as CountryCode), 'invalid_vat_number', { field: 'vat_number' })
    if (country === 'SA' && !next.legalNameAr) bad('KSA tax invoices need the legal name in Arabic.', 'validation_failed', { field: 'legal_name_ar' })
  } else if (next.vatNumber && !isValidVatNumber(next.vatNumber, country)) {
    bad(taxNumberError(country as CountryCode), 'invalid_vat_number', { field: 'vat_number' })
  }
  if (!next.legalNameEn) bad('Enter the company’s legal name.', 'validation_failed', { field: 'legal_name_en' })
  next.updatedAt = nowIso()
  next.updatedBy = user.id
  const changes = (['fiscalYearStartMonth', 'vatRegistered', 'vatNumber', 'legalNameEn', 'legalNameAr', 'paymentTermsDays', 'defaultRevenueAccountId', 'defaultBankAccountId'] as const)
    .filter((k) => s[k] !== next[k])
    .map((k) => ({ field: k, from: String(s[k] ?? ''), to: String(next[k] ?? '') }))
  Object.assign(s, next)
  if (changes.length) recordAudit(user, { action: 'update', entity: 'finance_settings', entityId: 'finance_settings', summary: 'Changed the finance settings', changes })
  return settingsView(user, co)
}

/** PUT /finance/settings/lock-date (Company Admin, Accountant): `{ lock_date: yyyy-MM-dd | null, reason }`. Audited. */
export function setLockDate(user: User, input: { lockDate?: unknown; reason?: unknown } | null): FinanceSettings {
  const co = assertFull(user)
  if (!LOCK_ROLES.has(user.role)) throw new CodedApiError('Only a Company Admin or an Accountant can move the lock date.', 403, 'lock_date_forbidden')
  const raw = input?.lockDate
  if (raw === undefined) bad('Send `lock_date` (yyyy-MM-dd, or null to remove the lock).', 'validation_failed', { field: 'lock_date' })
  const lockDate = raw === null || raw === '' ? null : (raw as string)
  if (lockDate !== null && !isIsoDate(lockDate)) bad('Enter the lock date as yyyy-MM-dd, or clear it.', 'validation_failed', { field: 'lock_date' })
  if (lockDate && lockDate > todayOf(co)) bad('The lock date can’t be in the future.', 'validation_failed', { field: 'lock_date' })
  const reason = str(input?.reason, 300, 'Reason')
  const s = financeSettings.get(co)
  const before = s.lockDate
  if (before !== lockDate) {
    s.lockDate = lockDate
    s.lockDateSetAt = nowIso()
    s.lockDateSetBy = user.id
    recordAudit(user, {
      action: 'security',
      entity: 'finance_lock_date',
      entityId: 'lock_date',
      summary: `${lockDate ? `Locked the books up to ${lockDate}` : 'Removed the lock date'}${reason ? ` — ${reason}` : ''}`,
      changes: [{ field: 'lock_date', from: before ?? '', to: lockDate ?? '' }],
    })
  }
  return settingsView(user, co)
}

/** POST /finance/exchange-rates (full). Unique per currency and effective date. */
export function addExchangeRate(user: User, input: Partial<ExchangeRateInput> | null): FinanceSettings {
  const co = assertFull(user)
  const base = baseCurrencyOf(co)
  const currency = typeof input?.currency === 'string' ? input.currency.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(currency)) bad('Enter a three-letter currency code (e.g. USD).', 'validation_failed', { field: 'currency' })
  if (currency === base) bad(`${base} is the base currency (rate 1).`, 'validation_failed', { field: 'currency' })
  const rate = num(input?.rate, 'Rate')
  if (rate <= 0 || rate > 100000) bad('The rate must be above 0.', 'validation_failed', { field: 'rate' })
  if (!isIsoDate(input?.effectiveDate)) bad('Enter the effective date as yyyy-MM-dd.', 'validation_failed', { field: 'effective_date' })
  const s = financeSettings.get(co)
  if (s.exchangeRates.some((r) => r.currency === currency && r.effectiveDate === input!.effectiveDate)) {
    conflict(`There is already a ${currency} rate effective ${input!.effectiveDate}. Delete it first.`, 'duplicate_rate')
  }
  financeSeq.ids.fxRate = (financeSeq.ids.fxRate ?? 1000) + 1
  const id = `FXR-${financeSeq.ids.fxRate}`
  s.exchangeRates.push({ id, currency, rate: Math.round(rate * 1e6) / 1e6, effectiveDate: input!.effectiveDate as string, createdAt: nowIso(), createdBy: user.id })
  recordAudit(user, { action: 'create', entity: 'exchange_rate', entityId: id, summary: `Added the ${currency} rate ${rate} effective ${input!.effectiveDate}` })
  return settingsView(user, co)
}

/** DELETE /finance/exchange-rates/:id (full). Documents keep the rate they were posted with. */
export function deleteExchangeRate(user: User, id: string): FinanceSettings {
  const co = assertFull(user)
  const s = financeSettings.get(co)
  const i = s.exchangeRates.findIndex((r) => r.id === id)
  if (i < 0) notFound()
  const [r] = s.exchangeRates.splice(i, 1)
  recordAudit(user, { action: 'delete', entity: 'exchange_rate', entityId: id, summary: `Deleted the ${r.currency} rate effective ${r.effectiveDate}` })
  return settingsView(user, co)
}

/** GET /finance/exchange-rates/lookup?currency=&date= → `{ currency, date, base_currency, rate }` (rate null when none). */
export function lookupRate(user: User, q: { currency: string | null; date: string | null }): { currency: string; date: string; baseCurrency: string; rate: number | null } {
  const co = viewer(user)
  const currency = (q.currency ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) bad('Enter a three-letter currency code.', 'validation_failed', { field: 'currency' })
  const date = q.date && isIsoDate(q.date) ? q.date : todayOf(co)
  const s = financeSettings.get(co)
  const base = baseCurrencyOf(co)
  let rate: number | null = currency === base ? 1 : null
  if (rate === null) {
    const best = s.exchangeRates.filter((r) => r.currency === currency && r.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]
    rate = best?.rate ?? null
  }
  return { currency, date, baseCurrency: base, rate }
}

/* ================= chart of accounts ================= */

function rowsOf(co: string, opts: { asOf?: string | null; includeInactive?: boolean } = {}): AccountRow[] {
  const all = accountsOf(co)
  const entries = entriesOf(co)
  const sums = sumByAccount(entries, { to: opts.asOf ?? null })
  const rolled = rollUp(all, sums)
  const posted = new Set(entries.flatMap((e) => e.lines.map((l) => l.accountId)))
  return treeOrder(all)
    .filter((a) => opts.includeInactive !== false || a.active)
    .map((a) => {
      const s = rolled.get(a.id) ?? { debit: 0, credit: 0 }
      return { ...strip(a), debit: s.debit, credit: s.credit, balance: naturalBalance(a.type, s.debit, s.credit), hasPostings: posted.has(a.id), depth: depthOf(a.id, all) }
    })
}

/** GET /finance/accounts?as_of=&include_inactive= — the tree (headers first, children after) with base-currency balances. */
export function listAccounts(user: User, q: { asOf?: string | null; includeInactive?: string | null } = {}): AccountRow[] {
  const co = viewer(user)
  const asOf = q.asOf && isIsoDate(q.asOf) ? q.asOf : null
  return rowsOf(co, { asOf, includeInactive: q.includeInactive !== 'false' })
}

const CODE_RE = /^\d{3,10}$/

function validateParent(co: string, parentId: unknown, type: AccountType, selfId: string | null): string | null {
  if (parentId === null || parentId === undefined || parentId === '') return null
  const p = accountIn(co, parentId)
  if (!p) return bad('Choose a header account of your chart as the parent.', 'invalid_parent', { field: 'parent_id' })
  if (!p.isHeader) bad('The parent must be a header account.', 'invalid_parent', { field: 'parent_id' })
  if (p.type !== type) bad(`The parent is a ${p.type} header; the account must be the same type.`, 'invalid_parent', { field: 'parent_id' })
  if (selfId && (p.id === selfId || descendantsOf(selfId, accountsOf(co)).includes(p.id))) bad('An account can’t sit under itself or its own sub-account.', 'invalid_parent', { field: 'parent_id' })
  return p.id
}

function accountView(co: string, id: string): AccountRow {
  return rowsOf(co).find((r) => r.id === id)!
}

/** POST /finance/accounts (full). */
export function createAccount(user: User, input: AccountInput | null): AccountRow {
  const co = assertFull(user)
  const i = (input ?? {}) as Record<string, unknown>
  const code = str(i.code, 10, 'Code')
  if (!CODE_RE.test(code)) bad('The account code is 3–10 digits.', 'validation_failed', { field: 'code' })
  if (accountsOf(co).some((a) => a.code === code)) conflict(`Code ${code} is already used in your chart.`, 'duplicate_code', { field: 'code' })
  const name = str(i.name, 120, 'Name')
  if (!name) bad('Enter the account name.', 'validation_failed', { field: 'name' })
  const type = i.type as AccountType
  if (!ACCOUNT_TYPES.includes(type)) bad('Choose the account type.', 'validation_failed', { field: 'type' })
  const isHeader = i.isHeader === true
  const subtype = typeof i.subtype === 'string' && i.subtype ? i.subtype : isHeader ? 'header' : ACCOUNT_SUBTYPES[type][0].id
  if (subtype !== 'header' && !ACCOUNT_SUBTYPES[type].some((s) => s.id === subtype)) bad('Choose a subtype of this account type.', 'validation_failed', { field: 'subtype' })
  const parentId = validateParent(co, i.parentId, type, null)
  if (i.systemRole) bad('Create the account first, then assign the system role to it.', 'validation_failed', { field: 'system_role' })
  financeSeq.ids.account = (financeSeq.ids.account ?? 1000) + 1
  const at = nowIso()
  const acc: Tenant<Account> = {
    companyId: co,
    id: `ACC-N${financeSeq.ids.account}`,
    code,
    name,
    type,
    subtype,
    parentId,
    systemRole: null,
    isHeader,
    active: true,
    currency: null,
    description: str(i.description, 500, 'Description'),
    createdAt: at,
    updatedAt: at,
  }
  financeAccounts.push(acc)
  recordAudit(user, { action: 'create', entity: 'account', entityId: acc.id, summary: `Added account ${code} ${name}` })
  return accountView(co, acc.id)
}

/** PATCH /finance/accounts/:id (full): name, code, subtype, parent, header flag, description, active, system role. */
export function updateAccount(user: User, id: string, input: AccountInput | null): AccountRow {
  const co = assertFull(user)
  const acc = accountIn(co, id) ?? notFound()
  const i = (input ?? {}) as Record<string, unknown>
  const before = { ...acc }
  const posted = hasPostings(co, acc.id)
  const all = accountsOf(co)
  const children = all.filter((a) => a.parentId === acc.id)
  const next = { ...acc }
  if (i.code !== undefined) {
    const code = str(i.code, 10, 'Code')
    if (!CODE_RE.test(code)) bad('The account code is 3–10 digits.', 'validation_failed', { field: 'code' })
    if (all.some((a) => a.id !== acc.id && a.code === code)) conflict(`Code ${code} is already used in your chart.`, 'duplicate_code', { field: 'code' })
    next.code = code
  }
  if (i.name !== undefined) {
    next.name = str(i.name, 120, 'Name')
    if (!next.name) bad('Enter the account name.', 'validation_failed', { field: 'name' })
  }
  if (i.type !== undefined && i.type !== acc.type) {
    if (!ACCOUNT_TYPES.includes(i.type as AccountType)) bad('Choose the account type.', 'validation_failed', { field: 'type' })
    if (posted) conflict('This account has postings: its type can’t change. Create a new account instead.', 'has_postings')
    if (children.length) conflict('Move or remove its sub-accounts before changing the type.', 'has_children')
    if (acc.systemRole) conflict('A system account’s type can’t change.', 'system_role')
    next.type = i.type as AccountType
    if (next.subtype !== 'header') next.subtype = ACCOUNT_SUBTYPES[next.type][0].id
  }
  if (i.isHeader !== undefined && (i.isHeader === true) !== acc.isHeader) {
    if (i.isHeader === true) {
      if (posted) conflict('An account with postings can’t become a header.', 'has_postings')
      if (acc.systemRole) conflict('A system account can’t be a header.', 'system_role')
      next.isHeader = true
      next.subtype = 'header'
    } else {
      if (children.length) conflict('Move its sub-accounts first: only headers have children.', 'has_children')
      next.isHeader = false
      if (next.subtype === 'header') next.subtype = ACCOUNT_SUBTYPES[next.type][0].id
    }
  }
  if (i.subtype !== undefined && typeof i.subtype === 'string' && i.subtype) {
    if (!next.isHeader && !ACCOUNT_SUBTYPES[next.type].some((s) => s.id === i.subtype)) bad('Choose a subtype of this account type.', 'validation_failed', { field: 'subtype' })
    if (!next.isHeader) next.subtype = i.subtype
  }
  if (i.parentId !== undefined || next.type !== acc.type) next.parentId = validateParent(co, i.parentId !== undefined ? i.parentId : acc.parentId, next.type, acc.id)
  if (i.description !== undefined) next.description = str(i.description, 500, 'Description')

  // System role: moved to this account from its current holder (exactly one active account per role).
  let roleMovedFrom: Tenant<Account> | undefined
  if (i.systemRole !== undefined && i.systemRole !== acc.systemRole) {
    if (i.systemRole === null || i.systemRole === '') {
      conflict(`“${SYSTEM_ROLE_LABEL[acc.systemRole!]}” must stay assigned: give the role to another account instead.`, 'system_role')
    }
    const role = i.systemRole as SystemAccountRole
    if (!(role in SYSTEM_ROLE_TYPE)) bad('Unknown system role.', 'validation_failed', { field: 'system_role' })
    if (acc.systemRole) conflict(`This account already holds “${SYSTEM_ROLE_LABEL[acc.systemRole]}”. Move that role to another account first.`, 'system_role')
    if (next.isHeader || !next.active) bad('A system role goes on an active, postable account.', 'validation_failed', { field: 'system_role' })
    if (next.type !== SYSTEM_ROLE_TYPE[role]) bad(`“${SYSTEM_ROLE_LABEL[role]}” must be an ${SYSTEM_ROLE_TYPE[role]} account.`, 'validation_failed', { field: 'system_role' })
    roleMovedFrom = all.find((a) => a.systemRole === role)
    next.systemRole = role
  }

  if (i.active !== undefined && (i.active === true) !== acc.active) {
    if (i.active === false) {
      if (acc.systemRole && next.systemRole === acc.systemRole) {
        conflict(`This is the “${SYSTEM_ROLE_LABEL[acc.systemRole]}” account. Assign that role to another account before deactivating it.`, 'system_role', { role: acc.systemRole })
      }
      if (children.some((c) => c.active)) conflict('Deactivate its sub-accounts first.', 'has_active_children')
      const s = rollUp(all, sumByAccount(entriesOf(co))).get(acc.id)
      if (s && r2(s.debit - s.credit) !== 0) conflict('The account still has a balance. Move it to another account with a journal entry first.', 'has_balance')
      const st = financeSettings.get(co)
      if (st.defaultRevenueAccountId === acc.id || st.defaultBankAccountId === acc.id) conflict('This is a default account in Finance settings. Choose another default first.', 'default_account')
      next.active = false
    } else {
      next.active = true
    }
  }
  next.updatedAt = nowIso()
  Object.assign(acc, next)
  if (roleMovedFrom && roleMovedFrom.id !== acc.id) {
    roleMovedFrom.systemRole = null
    roleMovedFrom.updatedAt = next.updatedAt
  }
  const changes = (['code', 'name', 'type', 'subtype', 'parentId', 'isHeader', 'active', 'systemRole', 'description'] as const)
    .filter((k) => before[k] !== acc[k])
    .map((k) => ({ field: k, from: String(before[k] ?? ''), to: String(acc[k] ?? '') }))
  if (changes.length) {
    recordAudit(user, { action: i.active === false && before.active ? 'deactivate' : i.active === true && !before.active ? 'reactivate' : 'update', entity: 'account', entityId: acc.id, summary: `Changed account ${acc.code} ${acc.name}`, changes })
  }
  return accountView(co, acc.id)
}

/** DELETE /finance/accounts/:id (full): only an account that was never posted to (deactivate it otherwise). */
export function deleteAccount(user: User, id: string): { id: string } {
  const co = assertFull(user)
  const acc = accountIn(co, id) ?? notFound()
  if (hasPostings(co, acc.id)) conflict('This account has postings: deactivate it instead.', 'has_postings')
  if (acc.systemRole) conflict(`This is the “${SYSTEM_ROLE_LABEL[acc.systemRole]}” account. Assign that role to another account first.`, 'system_role', { role: acc.systemRole })
  if (accountsOf(co).some((a) => a.parentId === acc.id)) conflict('Move or delete its sub-accounts first.', 'has_children')
  const st = financeSettings.get(co)
  if (st.defaultRevenueAccountId === acc.id || st.defaultBankAccountId === acc.id) conflict('This is a default account in Finance settings. Choose another default first.', 'default_account')
  financeAccounts.splice(financeAccounts.indexOf(acc), 1)
  recordAudit(user, { action: 'delete', entity: 'account', entityId: acc.id, summary: `Deleted account ${acc.code} ${acc.name}` })
  return { id: acc.id }
}

/** POST /finance/accounts/import-template (full): the country chart (and VAT codes) for a company with an empty chart. */
export function importChartTemplate(user: User): AccountRow[] {
  const co = assertFull(user)
  if (accountsOf(co).length) conflict('Your chart of accounts isn’t empty. The template only fills an empty chart.', 'chart_not_empty')
  const country = countryOf(co)
  financeAccounts.push(...chartTemplateFor(co, country).map((a) => ({ ...a, createdAt: nowIso(), updatedAt: nowIso() })))
  if (!financeTaxCodes.some((t) => t.companyId === co)) financeTaxCodes.push(...taxCodesTemplateFor(co, country))
  recordAudit(user, { action: 'create', entity: 'account', entityId: 'chart_template', summary: `Imported the ${country === 'SA' ? 'KSA' : 'UAE'} chart of accounts template` })
  return rowsOf(co)
}

/** GET /finance/accounts/:id/ledger?from=&to= — the account's lines with a running balance. */
export function getAccountLedger(user: User, id: string, q: { from?: string | null; to?: string | null } = {}): AccountLedger {
  const co = viewer(user)
  const acc = accountIn(co, id) ?? notFound()
  const from = q.from && isIsoDate(q.from) ? q.from : null
  const to = q.to && isIsoDate(q.to) ? q.to : null
  const ids = acc.isHeader ? new Set([acc.id, ...descendantsOf(acc.id, accountsOf(co))]) : new Set([acc.id])
  // A header's ledger lists its descendants' lines (as one account).
  const entries = acc.isHeader
    ? entriesOf(co).map((e) => ({ ...e, lines: e.lines.filter((l) => ids.has(l.accountId)).map((l) => ({ ...l, accountId: acc.id })) }))
    : entriesOf(co)
  return accountLedger(acc, entries, { from, to }, baseCurrencyOf(co))
}

/* ================= journal ================= */

function rowOf(co: string, e: Tenant<JournalEntry>): JournalRow {
  const src = sourceOf(co, e)
  const names = [...new Set(e.lines.map((l) => financeAccounts.find((a) => a.companyId === co && a.id === l.accountId)?.name ?? l.accountId))]
  return {
    id: e.id,
    number: e.number,
    date: e.date,
    memo: e.memo,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    sourceNumber: src.number,
    sourceLink: src.link,
    status: e.status,
    reversalOf: e.reversalOf,
    reversedBy: e.reversedBy,
    total: r2(e.lines.reduce((s, l) => s + l.debit, 0)),
    lineCount: e.lines.length,
    accountNames: names,
    createdBy: e.createdBy,
    createdByName: userName(co, e.createdBy),
    createdAt: e.createdAt,
  }
}

const byNewest = (a: JournalEntry, b: JournalEntry) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number)

/** GET /finance/journal?from=&to=&source_type=&account_id=&q= — newest first. */
export function listJournal(user: User, f: JournalFilters = {}): JournalRow[] {
  const co = viewer(user)
  const q = (f.q ?? '').trim().toLowerCase()
  const accName = new Map(accountsOf(co).map((a) => [a.id, `${a.code} ${a.name}`.toLowerCase()]))
  return entriesOf(co)
    .filter((e) => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to))
    .filter((e) => !f.sourceType || e.sourceType === f.sourceType)
    .filter((e) => !f.accountId || e.lines.some((l) => l.accountId === f.accountId))
    .filter((e) => {
      if (!q) return true
      const hay = [e.number, e.memo, ...e.lines.map((l) => l.description), ...e.lines.map((l) => accName.get(l.accountId) ?? ''), sourceOf(co, e).number ?? ''].join(' ').toLowerCase()
      return hay.includes(q)
    })
    .sort(byNewest)
    .map((e) => rowOf(co, e))
}

const REVERSIBLE: JournalSourceType[] = ['manual', 'opening_balance']

/** Other sections may veto a reversal (banking: a line in a finished bank reconciliation → 409 `reconciled`). */
const reverseGuards: ((companyId: string, entryId: string) => void)[] = []
export function registerReverseGuard(fn: (companyId: string, entryId: string) => void): void {
  if (!reverseGuards.includes(fn)) reverseGuards.push(fn)
}

function detailOf(user: User, co: string, e: Tenant<JournalEntry>): JournalDetail {
  const acc = (id: string) => financeAccounts.find((a) => a.companyId === co && a.id === id)
  const nameIn = <T extends { companyId: string; id: string; name: string }>(rows: readonly T[], id: string | null | undefined) => (id ? (rows.find((r) => r.companyId === co && r.id === id)?.name ?? null) : null)
  const lines: JournalLineView[] = e.lines.map((l) => ({
    ...l,
    accountCode: acc(l.accountId)?.code ?? '',
    accountName: acc(l.accountId)?.name ?? l.accountId,
    departmentName: nameIn(departments, l.departmentId),
    projectName: nameIn(projects, l.projectId),
    eventName: nameIn(events, l.eventId),
    customerName: nameIn(customers, l.customerId),
  }))
  const numberOf = (id: string | null) => (id ? (financeJournal.find((x) => x.companyId === co && x.id === id)?.number ?? null) : null)
  let blocked: string | null = null
  if (scopeOf(user.role, 'accounting') !== 'full') blocked = 'View only.'
  else if (e.status === 'reversed') blocked = 'Already reversed.'
  else if (e.reversalOf) blocked = 'This entry is a reversal.'
  else if (!REVERSIBLE.includes(e.sourceType)) blocked = `Posted from a ${SOURCE_TYPE_LABEL[e.sourceType].toLowerCase()}: correct it from that document.`
  return { ...rowOf(co, e), lines, reversalOfNumber: numberOf(e.reversalOf), reversedByNumber: numberOf(e.reversedBy), canReverse: blocked === null, reverseBlockedReason: blocked }
}

/** GET /finance/journal/:id */
export function getJournalEntry(user: User, id: string): JournalDetail {
  const co = viewer(user)
  const e = financeJournal.find((x) => x.companyId === co && x.id === id) ?? notFound()
  return detailOf(user, co, e)
}

function dimension<T extends { companyId: string; id: string }>(co: string, rows: readonly T[], v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !rows.some((r) => r.companyId === co && r.id === v)) return bad('Unknown dimension value.', 'invalid_dimension', { field })
  return v
}

function amount(v: unknown, field: string): number {
  if (v === undefined || v === null || v === '') return 0
  const n = num(v, field)
  if (n < 0) bad('Amounts can’t be negative: put them on the other side.', 'invalid_line')
  if (n > 1e12) bad('The amount is too large.', 'invalid_line')
  return r2(n)
}

/** POST /finance/journal (full): a balanced manual entry with optional dimensions per line. */
export function createManualJournal(user: User, input: ManualJournalInput | null): JournalDetail {
  const co = assertFull(user)
  const i = (input ?? {}) as Partial<ManualJournalInput>
  if (!isIsoDate(i.date)) bad('Enter the entry date as yyyy-MM-dd.', 'validation_failed', { field: 'date' })
  const memo = str(i.memo, 300, 'Memo')
  if (!memo) bad('Enter a memo that explains the entry.', 'validation_failed', { field: 'memo' })
  if (!Array.isArray(i.lines) || i.lines.length < 2) bad('An entry needs at least two lines.', 'unbalanced')
  if (i.lines!.length > 200) bad('Too many lines (max 200).')
  const lines: JournalLine[] = i.lines!.map((l, n) => {
    const raw = (l ?? {}) as unknown as Record<string, unknown>
    if (typeof raw.accountId !== 'string' || !raw.accountId) bad(`Line ${n + 1}: choose an account.`, 'invalid_account')
    return {
      accountId: raw.accountId as string,
      debit: amount(raw.debit, 'debit'),
      credit: amount(raw.credit, 'credit'),
      description: str(raw.description, 300, 'Line description'),
      departmentId: dimension(co, departments, raw.departmentId, 'department_id'),
      projectId: dimension(co, projects, raw.projectId, 'project_id'),
      eventId: dimension(co, events, raw.eventId, 'event_id'),
      customerId: dimension(co, customers, raw.customerId, 'customer_id'),
    }
  })
  const e = postJournal(co, { date: i.date as string, memo, sourceType: 'manual', sourceId: null, lines, createdBy: user.id })
  recordAudit(user, { action: 'create', entity: 'journal_entry', entityId: e.id, summary: `Posted manual journal ${e.number} (${e.date})` })
  return detailOf(user, co, e)
}

/** POST /finance/journal/:id/reverse (full) `{ date, memo }`: manual and opening-balance entries only. */
export function reverseManualJournal(user: User, id: string, input: { date?: unknown; memo?: unknown } | null): JournalDetail {
  const co = assertFull(user)
  const e = financeJournal.find((x) => x.companyId === co && x.id === id) ?? notFound()
  if (e.status === 'reversed') conflict('This entry is already reversed.', 'already_reversed')
  if (e.reversalOf) conflict('This entry is itself a reversal.', 'is_reversal')
  if (!REVERSIBLE.includes(e.sourceType)) conflict(`This entry was posted from a ${SOURCE_TYPE_LABEL[e.sourceType].toLowerCase()}. Correct it from that document.`, 'source_document')
  const date = input?.date === undefined || input.date === null || input.date === '' ? todayOf(co) : input.date
  if (!isIsoDate(date)) bad('Enter the reversal date as yyyy-MM-dd.', 'validation_failed', { field: 'date' })
  if ((date as string) < e.date) bad('The reversal can’t be dated before the entry.', 'validation_failed', { field: 'date' })
  const memo = str(input?.memo, 300, 'Memo') || `Reversal of ${e.number}`
  for (const guard of reverseGuards) guard(co, e.id)
  const rev = reverseJournal(co, e.id, date as string, memo, user.id)
  recordAudit(user, { action: 'update', entity: 'journal_entry', entityId: e.id, summary: `Reversed journal ${e.number} with ${rev.number}` })
  return detailOf(user, co, rev)
}

/**
 * POST /finance/opening-balances (full) `{ date, memo, lines[{account_id, debit, credit}] }`: one entry, the difference
 * posted to the opening-balance-equity account.
 */
export function postOpeningBalances(user: User, input: OpeningBalanceInput | null): JournalDetail {
  const co = assertFull(user)
  const i = (input ?? {}) as Partial<OpeningBalanceInput>
  if (!isIsoDate(i.date)) bad('Enter the opening balance date as yyyy-MM-dd.', 'validation_failed', { field: 'date' })
  if (!Array.isArray(i.lines) || i.lines.length === 0) bad('Enter at least one account balance.', 'validation_failed', { field: 'lines' })
  const obe = systemAccount(co, 'opening_balance_equity')
  const lines: JournalLine[] = i.lines!.map((l, n) => {
    const raw = (l ?? {}) as unknown as Record<string, unknown>
    if (typeof raw.accountId !== 'string' || !raw.accountId) bad(`Line ${n + 1}: choose an account.`, 'invalid_account')
    if (raw.accountId === obe) bad('Opening balance equity takes the difference automatically; don’t enter it.', 'invalid_account')
    return { accountId: raw.accountId as string, debit: amount(raw.debit, 'debit'), credit: amount(raw.credit, 'credit'), description: 'Opening balance' }
  })
  const diff = r2(lines.reduce((s, l) => s + l.debit - l.credit, 0))
  if (lines.every((l) => l.debit === 0 && l.credit === 0)) bad('Enter at least one non-zero balance.', 'validation_failed', { field: 'lines' })
  if (diff !== 0) lines.push({ accountId: obe, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0, description: 'Opening balance equity' })
  const memo = str(i.memo, 300, 'Memo') || `Opening balances at ${i.date}`
  const e = postJournal(co, { date: i.date as string, memo, sourceType: 'opening_balance', sourceId: null, lines, createdBy: user.id })
  recordAudit(user, { action: 'create', entity: 'journal_entry', entityId: e.id, summary: `Posted opening balances ${e.number} (${e.date})` })
  return detailOf(user, co, e)
}

/** GET /finance/journal/dimensions — pickers for manual lines (departments, projects, events, customers of the company). */
export function journalDimensions(user: User): JournalDimensions {
  const co = assertFull(user)
  const pick = <T extends { companyId: string; id: string; name: string }>(rows: readonly T[], keep: (r: T) => boolean = () => true) =>
    rows.filter((r) => r.companyId === co && keep(r)).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name))
  return {
    departments: pick(departments, (d) => d.active),
    projects: pick(projects),
    events: pick(events),
    customers: pick(customers),
  }
}

/* ================= reports ================= */

/** GET /finance/reports/trial-balance?as_of= (default: company today). */
export function getTrialBalance(user: User, q: { asOf?: string | null; includeZero?: string | null } = {}): TrialBalance {
  const co = viewer(user)
  const asOf = q.asOf && isIsoDate(q.asOf) ? q.asOf : todayOf(co)
  return trialBalance(accountsOf(co), entriesOf(co), asOf, baseCurrencyOf(co), { includeZero: q.includeZero === 'true' })
}

/** Balances by account (natural side, base currency) as of a date — for the overview and later statements. */
export function balancesByAccount(companyId: string, asOf: string | null = null, from: string | null = null): Map<string, number> {
  const accounts = accountsOf(companyId)
  const rolled = rollUp(accounts, sumByAccount(entriesOf(companyId), { from, to: asOf }))
  return new Map(accounts.map((a) => [a.id, naturalBalance(a.type, rolled.get(a.id)?.debit ?? 0, rolled.get(a.id)?.credit ?? 0)]))
}

const CASH_ROLES: SystemAccountRole[] = ['cash', 'bank_default', 'undeposited_funds', 'payment_gateway_clearing']

/** Cash and bank accounts: postable accounts under the header holding the cash / default bank account, plus those roles. */
function cashAccounts(co: string): Tenant<Account>[] {
  const all = accountsOf(co).filter((a) => a.active || a.systemRole)
  const parents = new Set(all.filter((a) => a.systemRole === 'cash' || a.systemRole === 'bank_default').map((a) => a.parentId).filter((p): p is string => !!p))
  return all.filter((a) => !a.isHeader && a.type === 'asset' && ((a.parentId && parents.has(a.parentId)) || (a.systemRole && CASH_ROLES.includes(a.systemRole))))
}

/** GET /finance/overview */
export function getFinanceOverview(user: User): FinanceOverview {
  const co = viewer(user)
  const today = todayOf(co)
  const balances = balancesByAccount(co, today)
  const cash = treeOrder(cashAccounts(co)).map((a) => ({ accountId: a.id, code: a.code, name: a.name, balance: balances.get(a.id) ?? 0 }))
  const open = financeInvoices.filter((i) => i.companyId === co && (i.status === 'issued' || i.status === 'partially_paid') && i.balanceDue > 0)
  const base = (i: { balanceDue: number; exchangeRate: number }) => r2(i.balanceDue * (i.exchangeRate || 1))
  const overdue = open.filter((i) => isOverdue(i, today))
  const income = accountsOf(co).filter((a) => a.type === 'income')
  const revenueIn = (from: string, to: string) => {
    const s = sumByAccount(entriesOf(co), { from, to })
    return r2(income.reduce((t, a) => t + ((s.get(a.id)?.credit ?? 0) - (s.get(a.id)?.debit ?? 0)), 0))
  }
  const cur = monthRange(today, 0)
  const prev = monthRange(today, -1)
  const roleBalance = (role: SystemAccountRole) => {
    const a = accountsOf(co).find((x) => x.systemRole === role)
    return a ? (balances.get(a.id) ?? 0) : 0
  }
  const output = roleBalance('vat_output')
  const input = roleBalance('vat_input')
  return {
    currency: baseCurrencyOf(co),
    today,
    cash,
    cashTotal: r2(cash.reduce((s, c) => s + c.balance, 0)),
    receivables: { total: r2(open.reduce((s, i) => s + base(i), 0)), overdue: r2(overdue.reduce((s, i) => s + base(i), 0)), openCount: open.length, overdueCount: overdue.length },
    revenue: { thisMonth: revenueIn(cur.from, today), lastMonth: revenueIn(prev.from, prev.to), month: cur.month, previousMonth: prev.month },
    vat: { output, input, payable: r2(output - input) },
    latest: entriesOf(co).sort(byNewest).slice(0, 8).map((e) => rowOf(co, e)),
    lockDate: financeSettings.get(co).lockDate,
  }
}
