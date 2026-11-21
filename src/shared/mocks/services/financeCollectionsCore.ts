import type { User } from '@/shared/types'
import type { Account, Invoice, JournalLine, JournalSourceType } from '@/modules/finance/types'
import type { CollectionsSettings, DepositAccount, DunningStep } from '@/modules/finance/collections/types'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { activities, contacts, customers, users } from '@/shared/mocks/db'
import { nowIso } from '@/shared/mocks/clock'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeInvoices } from '@/shared/mocks/data/finance'
import { pushNotification } from '@/shared/mocks/data/tasks'
import {
  finCollectionsSettings,
  finCustomerCredit,
  finInvoicePauses,
  finPdcs,
  type CollectionsSettingsRecord,
  type CustomerCreditRecord,
} from '@/shared/mocks/data/financeCollections'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { postJournal, round2, systemAccount } from './ledger'
import { rateFor as ledgerRateFor } from './financeRates'

/**
 * Shared helpers of Accounts & finance › Collections (services/financeCollections.ts, financeReceivables.ts):
 * access, company context, exchange rates, invoices / customers lookups, posting with an FX balancing line,
 * settings, customer credit records, notifications.
 *
 * ACCESS (PERMISSION_MATRIX `accounting`): full (Company Admin, Management, Accountant) reads and writes;
 * view (Sales Manager) reads (payments, PDCs, links, aging, statements, credit); hidden → 403.
 */

export const FIN_FORBIDDEN = 'Accounts & finance is for accountants and management.'
export const FIN_WRITE_ONLY = 'Only Company Admins, Management and Accountants can change finance records.'
export const FINANCE_ALERT = 'finance' as const

export type FinAccess = 'full' | 'view'

export function finAccessOf(user: User): FinAccess {
  const s = scopeOf(user.role, 'accounting')
  if (s === 'full') return 'full'
  if (s === 'hidden') throw new CodedApiError(FIN_FORBIDDEN, 403, 'forbidden')
  return 'view'
}
export function assertFinFull(user: User): void {
  if (finAccessOf(user) !== 'full') throw new CodedApiError(FIN_WRITE_ONLY, 403, 'forbidden')
}

export const bad = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 422, code, details)
}
export const conflict = (message: string, code: string, details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 409, code, details)
}
export const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}

/* ---------------- company context ---------------- */

export function baseCurrencyOf(co: string): string {
  return companyById(co)?.regional.currency ?? DEFAULT_REGION.currency
}
export function todayOf(co: string): string {
  return companyDayOf(co).today
}
/** Document prefix of receipt numbers (APX, CRS; else from the subdomain). */
export function prefixOf(co: string): string {
  if (co === 'co_apex') return 'APX'
  if (co === 'co_crest') return 'CRS'
  return (companyById(co)?.subdomain ?? 'CO').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'CO'
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
export function money(v: unknown, field: string, opts: { min?: number; allowZero?: boolean } = {}): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return bad(`${field} must be a number.`)
  const r = round2(n)
  if (r < (opts.min ?? 0) || (!opts.allowZero && r === 0)) return bad(`${field} must be more than ${opts.min ?? 0}.`)
  return r
}
export const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/* ---------------- exchange rates (SEAM(rates)) ---------------- */

/**
 * Rates come from the ledger section's exchange-rate table (services/financeRates.ts `rateFor`, Finance settings).
 * When it has no rate effective on the date, a small fallback table (to AED / SAR) is used so a payment can
 * still be recorded; the same currency is always 1. A rate the user types on a payment wins over both.
 */
type RateProvider = (co: string, currency: string, date: string) => number | null
let provider: RateProvider | null = ledgerRateFor
export function setRateProvider(fn: RateProvider | null): void {
  provider = fn
}
const TO_AED: Record<string, number> = { AED: 1, USD: 3.6725, EUR: 4.0, GBP: 4.65, SAR: 0.979, INR: 0.044, KWD: 11.95, QAR: 1.0088, OMR: 9.54, BHD: 9.74 }
export function rateFor(co: string, currency: string, date: string): number {
  const base = baseCurrencyOf(co)
  if (currency === base) return 1
  const fromLedger = provider?.(co, currency, date)
  if (fromLedger && fromLedger > 0) return fromLedger
  const a = TO_AED[currency]
  const b = TO_AED[base]
  if (!a || !b) return bad(`No exchange rate for ${currency}. Add one in Finance settings or type the rate.`, 'missing_rate', { currency })
  return Math.round((a / b) * 1_000_000) / 1_000_000
}
export function rateInput(co: string, v: unknown, currency: string, date: string): number {
  if (currency === baseCurrencyOf(co)) return 1
  if (v === undefined || v === null || v === '') return rateFor(co, currency, date)
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return bad('Exchange rate must be a positive number.', 'invalid_rate')
  return Math.round(n * 1_000_000) / 1_000_000
}

/* ---------------- lookups ---------------- */

export function customerOf(co: string, id: unknown) {
  return typeof id === 'string' ? customers.find((c) => c.companyId === co && c.id === id) : undefined
}
export function customerName(co: string, id: string): string {
  return customerOf(co, id)?.name ?? 'Unknown customer'
}
export function userName(co: string, id: string | null | undefined): string | null {
  return id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? null) : null
}
export function ownerNameOf(co: string, customerId: string): string {
  const c = customerOf(co, customerId)
  return (c && userName(co, c.ownerId)) ?? '—'
}
/** The customer's billing contact: a decision maker with an email first. */
export function billingContact(co: string, customerId: string): { name: string; email: string } | null {
  const c = customerOf(co, customerId)
  if (!c) return null
  const mine = contacts.filter((x) => x.companyId === co && (x.customerId === customerId || x.leadId === c.leadId) && x.email)
  const pick = mine.find((x) => x.isDecisionMaker) ?? mine[0]
  return pick ? { name: pick.name, email: pick.email } : null
}

export const companyInvoices = (co: string): Tenant<Invoice>[] => financeInvoices.filter((i) => i.companyId === co)
export function invoiceOf(co: string, id: unknown): Tenant<Invoice> | undefined {
  return typeof id === 'string' ? financeInvoices.find((i) => i.companyId === co && i.id === id) : undefined
}
export const isOpenInvoice = (i: Invoice) => (i.status === 'issued' || i.status === 'partially_paid') && i.balanceDue > 0

/** Amount of an invoice held by uncleared cheques (received / deposited PDCs). */
export function pdcHeldOn(co: string, invoiceId: string): number {
  let s = 0
  for (const p of finPdcs) {
    if (p.companyId !== co || (p.status !== 'received' && p.status !== 'deposited')) continue
    for (const a of p.allocations) if (a.invoiceId === invoiceId) s += a.amount
  }
  return round2(s)
}
/** What a payment can still be allocated to an invoice: open balance minus cheques held. */
export function availableOn(co: string, inv: Invoice & { id: string }): number {
  if (!isOpenInvoice(inv)) return 0
  return Math.max(0, round2(inv.balanceDue - pdcHeldOn(co, inv.id)))
}

/** Open invoices of a customer in a currency, oldest due first (the auto-allocation order). */
export function openInvoicesOf(co: string, customerId: string, currency?: string): Tenant<Invoice>[] {
  return companyInvoices(co)
    .filter((i) => i.customerId === customerId && isOpenInvoice(i) && (!currency || i.currency === currency))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || (a.issueDate ?? '').localeCompare(b.issueDate ?? '') || a.number.localeCompare(b.number))
}

/* ---------------- accounts ---------------- */

export function accountOf(co: string, id: unknown): Tenant<Account> | undefined {
  return typeof id === 'string' ? financeAccounts.find((a) => a.companyId === co && a.id === id) : undefined
}
/** Cash / bank accounts money can be deposited to (children of "Cash and bank" or a cash-type system role). */
export function depositAccounts(co: string): DepositAccount[] {
  const roles = new Set(['bank_default', 'cash', 'undeposited_funds', 'payment_gateway_clearing'])
  const cashBank = financeAccounts.find((a) => a.companyId === co && a.code === '1100')?.id
  return financeAccounts
    .filter((a) => a.companyId === co && a.active && !a.isHeader && ((a.systemRole && roles.has(a.systemRole)) || (cashBank && a.parentId === cashBank)))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, role: a.systemRole }))
}
export function depositAccount(co: string, v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === '') return fallback
  if (!depositAccounts(co).some((a) => a.id === v)) return bad('Pick a cash or bank account to deposit to.', 'invalid_account')
  return v as string
}
/** Bank charges (6800): not a system role, so found by code. */
export function bankChargesAccount(co: string): string {
  const a = financeAccounts.find((x) => x.companyId === co && x.code === '6800' && x.active && !x.isHeader)
  if (!a) return conflict('The chart of accounts has no active Bank charges (6800) account.', 'missing_system_account', { role: 'bank_charges' })
  return a.id
}
export const accountName = (co: string, id: string | null) => (id ? (accountOf(co, id)?.name ?? id) : '—')

/* ---------------- posting ---------------- */

export interface Ln {
  accountId: string
  debit: number
  credit: number
  description: string
  customerId?: string | null
}
export const dr = (accountId: string, amount: number, description: string, customerId?: string | null): Ln => ({ accountId, debit: round2(amount), credit: 0, description, customerId: customerId ?? null })
export const cr = (accountId: string, amount: number, description: string, customerId?: string | null): Ln => ({ accountId, debit: 0, credit: round2(amount), description, customerId: customerId ?? null })

/**
 * Posts lines through the ledger (postJournal: period lock 423, balance 422). Any difference left between
 * debits and credits — receivables cleared at the invoices' own rates vs money at the payment's rate, and
 * rounding — goes to fx_gain_loss (credit = gain, debit = loss).
 */
export function postWithFx(co: string, input: { date: string; memo: string; sourceType: JournalSourceType; sourceId: string; createdBy: string | null; lines: Ln[] }) {
  const lines: JournalLine[] = input.lines.map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
  const diff = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0))
  if (diff !== 0) {
    const fx = systemAccount(co, 'fx_gain_loss')
    lines.push(diff > 0 ? { accountId: fx, debit: 0, credit: diff, description: 'Exchange gain' } : { accountId: fx, debit: -diff, credit: 0, description: 'Exchange loss' })
  }
  return postJournal(co, { date: input.date, memo: input.memo, sourceType: input.sourceType, sourceId: input.sourceId, createdBy: input.createdBy, lines })
}

/* ---------------- settings ---------------- */

export const DEFAULT_STEPS: DunningStep[] = [
  { id: 'step-before', offsetDays: -3, active: true, notifyOwner: false },
  { id: 'step-due', offsetDays: 0, active: true, notifyOwner: false },
  { id: 'step-7', offsetDays: 7, active: true, notifyOwner: false },
  { id: 'step-30', offsetDays: 30, active: true, notifyOwner: true },
]

/** The company's collections settings (defaults until saved; not stored by a read). */
export function settingsOf(co: string): CollectionsSettingsRecord {
  return (
    finCollectionsSettings.find((s) => s.companyId === co) ?? {
      dunningEnabled: true,
      dunningSteps: DEFAULT_STEPS.map((s) => ({ ...s })),
      creditCheckMode: 'warn',
      gatewayFeePct: 0,
      defaultExpiryDays: 14,
      updatedAt: null,
      updatedBy: null,
    }
  )
}
export function settingsRecord(co: string): Tenant<CollectionsSettingsRecord> {
  let s = finCollectionsSettings.find((x) => x.companyId === co)
  if (!s) {
    s = { companyId: co, ...settingsOf(co) }
    finCollectionsSettings.push(s)
  }
  return s
}
export function settingsView(co: string, canEdit: boolean): CollectionsSettings {
  const s = settingsOf(co)
  return {
    dunningEnabled: s.dunningEnabled,
    dunningSteps: s.dunningSteps.map((x) => ({ ...x })).sort((a, b) => a.offsetDays - b.offsetDays),
    creditCheckMode: s.creditCheckMode,
    gatewayFeePct: s.gatewayFeePct,
    defaultExpiryDays: s.defaultExpiryDays,
    canEdit,
    updatedAt: s.updatedAt,
  }
}

/* ---------------- customer credit records ---------------- */

export function creditOf(co: string, customerId: string): CustomerCreditRecord {
  return (
    finCustomerCredit.find((c) => c.companyId === co && c.customerId === customerId) ?? {
      customerId,
      creditLimit: null,
      creditHold: false,
      dunningPaused: false,
      bouncedCheques: 0,
      lastBounceDate: null,
      updatedAt: '',
    }
  )
}
export function creditRecord(co: string, customerId: string): Tenant<CustomerCreditRecord> {
  let c = finCustomerCredit.find((x) => x.companyId === co && x.customerId === customerId)
  if (!c) {
    c = { companyId: co, ...creditOf(co, customerId), updatedAt: nowIso() }
    finCustomerCredit.push(c)
  }
  return c
}
export const invoicePaused = (co: string, invoiceId: string) => finInvoicePauses.some((p) => p.companyId === co && p.invoiceId === invoiceId)

/* ---------------- notifications & timeline ---------------- */

/** Accountants of the company (Accountant role); without one, every accounting-full user. */
export function accountantIds(co: string): string[] {
  const active = users.filter((u) => u.companyId === co && u.active !== false)
  const acc = active.filter((u) => u.role === 'Accountant')
  return (acc.length ? acc : active.filter((u) => scopeOf(u.role, 'accounting') === 'full')).map((u) => u.id)
}
export function notify(co: string, userIds: string[], title: string, body: string, link: string, at = nowIso()): void {
  for (const id of [...new Set(userIds)]) {
    const u = users.find((x) => x.id === id && x.companyId === co && x.active !== false)
    if (u) pushNotification({ companyId: co, userId: u.id, type: FINANCE_ALERT, title, body, link, at })
  }
}
let actSeq = 0
/** A line on the customer's timeline (activities hang off the customer's Won lead). */
export function logOnCustomer(co: string, customerId: string, type: 'email' | 'system', summary: string, userId: string | null, at = nowIso()): void {
  const c = customerOf(co, customerId)
  if (!c) return
  activities.push({ companyId: co, id: `A-FIN-${Date.now().toString(36)}-${++actSeq}`, leadId: c.leadId, type, summary, userId: userId ?? c.ownerId, at })
}

export const companyOfUser = (user: User) => tenantOf(user)

/**
 * A line on the invoice's own history (the invoices section's `history`, when the row has one): payments as
 * `updated`, payment reminders as `sent`.
 */
export function logOnInvoice(inv: Invoice, action: 'updated' | 'sent', summary: string, byName: string | null, at = nowIso()): void {
  const h = (inv as Invoice & { history?: { at: string; byName: string; action: string; summary: string }[] }).history
  if (Array.isArray(h)) h.push({ at, byName: byName ?? 'System', action, summary })
}
