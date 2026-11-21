import type { User } from '@/shared/types'
import type { Account, JournalEntry, TaxCategory } from '@/modules/finance/types'
import type {
  CorporateTaxEstimate,
  EstimateLine,
  FileVatReturnInput,
  PayVatReturnInput,
  ProvisionInput,
  ProvisionResult,
  TaxAdjustmentLine,
  TaxAdjustmentsInput,
  TaxSettings,
  VatBoxItems,
  VatFrequency,
  VatItem,
  VatLayout,
  VatReturnDetail,
  VatReturnRow,
  ZakatEstimate,
} from '@/modules/finance/tax/types'
import {
  addDaysIso,
  boxOf,
  corporateTaxAdjustments,
  corporateTaxBands,
  EMIRATES,
  fiscalYearOf,
  fiscalYearRange,
  isQuarterEnd,
  KSA_CORRECTION_LIMIT,
  periodsBetween,
  r2,
  settlementLines,
  sumManual,
  UAE_CT_RATE,
  UAE_CT_THRESHOLD,
  UAE_EMIRATE_BOXES,
  vatBoxes,
  vatDueDate,
  ZAKAT_RATE,
  zakatOf,
} from '@/modules/finance/tax/calc'
import { isIsoDate, naturalBalance, sumByAccount } from '@/modules/finance/ledger/calc'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { customers, users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal, financeTaxCodes } from '@/shared/mocks/data/finance'
import { financeCreditNotes, invoiceRecords } from '@/shared/mocks/data/financeInvoices'
import { finBills, finDebitNotes } from '@/shared/mocks/data/financePurchases'
import { finExpenseClaims, finExpenses, finPettyMovements } from '@/shared/mocks/data/financeExpenses'
import { finTaxMeta, finTaxSettings, finVatReturns, type VatReturnRecord, type VatSnapshot } from '@/shared/mocks/data/financeTax'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { nextId, onFinanceAccess, postJournal, systemAccount } from './ledger'
import { financeAccessOf, financeSettingsOf, FINANCE_MANAGE_ONLY } from './financeLedger'
import { baseCurrencyOf } from './financeRates'

/**
 * Accounts & finance › Tax (docs/API.md › Finance › VAT returns, Corporate tax & zakat).
 *
 * WHO (PERMISSION_MATRIX `accounting`): full (Company Admin, Management, Accountant) reads and writes (file / pay a
 * return, settings, adjustments, provisions); view (Sales Manager) reads; hidden → 403. Plan gate `/finance/*` →
 * `accounting`. The company comes from the session; a foreign return id answers 404 like a missing one, a foreign
 * payment account the same 422 as a missing one.
 *
 * VAT APPROACH. A return is computed from the JOURNAL, so every section counts: each posted entry in the period
 * (by entry date; reversals / voids are separate entries in the period they are posted) is classified —
 *  - entries of invoices, credit notes, bills, debit notes and company expenses: per document line (tax code →
 *    category, net amount); the entry's own VAT-account lines decide the VAT (a rounding difference goes onto the
 *    document's first standard-rated line), so the return always agrees with the ledger;
 *  - any other entry touching VAT output (2200) or VAT input (1300) — manual entries, claims, petty cash: one item per
 *    VAT line, standard-rated, net = VAT ÷ the line's tax-code rate.
 * VAT settlement / tax provision / year-end entries are never classified. Non-recoverable VAT (bill lines or expenses
 * without a valid tax invoice) is listed as excluded. Documents give the drill-down detail (which invoice / bill feeds
 * which box). Filing freezes the snapshot and the counted entry ids; an entry later dated inside a filed period is
 * reported as a correction in the next unfiled return.
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

/** Reads: full and view (runs the finance hooks). */
function viewer(user: User): string {
  financeAccessOf(user)
  return tenantOf(user)
}
function writer(user: User): string {
  if (financeAccessOf(user) !== 'full') throw new CodedApiError(FINANCE_MANAGE_ONLY, 403, 'forbidden')
  return tenantOf(user)
}

/* ---------------- helpers ---------------- */

const todayOf = (co: string) => companyDayOf(co).today
const countryOf = (co: string) => companyById(co)?.regional.country ?? 'AE'
export const layoutOf = (co: string): VatLayout => (countryOf(co) === 'SA' ? 'ksa_zatca' : 'uae_vat201')
const userName = (co: string, id: string | null) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : null)
const accountsOf = (co: string) => financeAccounts.filter((a) => a.companyId === co)
const entriesOf = (co: string) => financeJournal.filter((e) => e.companyId === co)
const toBase = (amount: number, rate: number) => r2(amount * (rate || 1))
const NOT_CLASSIFIED = new Set(['vat_return', 'tax_provision', 'year_end_close'])

/** The company's emirate (Settings › Company profile region / city), else Dubai. */
export function companyEmirate(co: string): string {
  const a = companyById(co)?.profile.address
  return EMIRATES.find((e) => e === a?.region) ?? EMIRATES.find((e) => e === a?.city) ?? 'Dubai'
}

/** Cash and bank accounts (postable assets under the cash / bank header, plus the cash roles). */
export function cashAccountsOf(co: string): Tenant<Account>[] {
  const all = accountsOf(co).filter((a) => a.active)
  const parents = new Set(all.filter((a) => a.systemRole === 'cash' || a.systemRole === 'bank_default').map((a) => a.parentId).filter((p): p is string => !!p))
  const roles = new Set(['cash', 'bank_default', 'undeposited_funds', 'payment_gateway_clearing'])
  return all.filter((a) => !a.isHeader && a.type === 'asset' && ((a.parentId && parents.has(a.parentId)) || (a.systemRole && roles.has(a.systemRole)))).sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * The "VAT payable to tax authority" liability (code 2210). Not in the seeded chart: created on the first filing,
 * additively (`ACC-2210` under Liabilities, like a template account), and reused afterwards.
 */
export function ensureVatPayableAccount(co: string): string {
  const found = financeAccounts.find((a) => a.companyId === co && a.code === '2210')
  if (found) {
    if (found.type !== 'liability' || found.isHeader || !found.active) conflict('Account 2210 must be an active, postable liability to hold VAT payable to the tax authority.', 'vat_payable_account')
    return found.id
  }
  const at = nowIso()
  const parent = financeAccounts.find((a) => a.companyId === co && a.id === 'ACC-2000' && a.isHeader)
  financeAccounts.push({ companyId: co, id: 'ACC-2210', code: '2210', name: 'VAT payable to tax authority', type: 'liability', subtype: 'current_liability', parentId: parent ? parent.id : null, systemRole: null, isHeader: false, active: true, currency: null, description: 'Net VAT of filed returns until paid (created by the VAT return filing).', createdAt: at, updatedAt: at })
  return 'ACC-2210'
}

/* ================= VAT: classification ================= */

interface Ctx {
  co: string
  layout: VatLayout
  base: string
  emirate: string
  categories: Map<string, { category: TaxCategory; rate: number }>
  standardRate: number
  output: string | null
  input: string | null
}

function ctxOf(co: string): Ctx {
  const codes = financeTaxCodes.filter((t) => t.companyId === co)
  const accounts = accountsOf(co)
  return {
    co,
    layout: layoutOf(co),
    base: baseCurrencyOf(co),
    emirate: companyEmirate(co),
    categories: new Map(codes.map((t) => [t.id, { category: t.category, rate: t.rate }])),
    standardRate: codes.find((t) => t.category === 'standard' && t.active)?.rate ?? (countryOf(co) === 'SA' ? 15 : 5),
    output: accounts.find((a) => a.systemRole === 'vat_output')?.id ?? null,
    input: accounts.find((a) => a.systemRole === 'vat_input')?.id ?? null,
  }
}

const catOf = (ctx: Ctx, code: string | null | undefined): TaxCategory => (code ? (ctx.categories.get(code)?.category ?? 'standard') : 'standard')
const customerOf = (co: string, id: string) => customers.find((c) => c.companyId === co && c.id === id)

/** Output VAT (credit − debit on VAT output) and recoverable input VAT (debit − credit on VAT input) of an entry. */
function entryVat(ctx: Ctx, e: JournalEntry): { output: number; input: number } {
  let output = 0
  let input = 0
  for (const l of e.lines) {
    if (l.accountId === ctx.output) output += l.credit - l.debit
    if (l.accountId === ctx.input) input += l.debit - l.credit
  }
  return { output: r2(output), input: r2(input) }
}

type Draft = Omit<VatItem, 'box' | 'correction' | 'entryId' | 'entryNumber' | 'date'>

/** Puts the ledger's VAT on the items (the difference to the documents' VAT goes on the first standard-rated one). */
function reconcile(items: Draft[], side: 'sales' | 'purchases', ledgerVat: number, fallback: () => Draft): Draft[] {
  const counted = items.filter((i) => i.side === side && (side === 'sales' || i.recoverable))
  const diff = r2(ledgerVat - counted.reduce((s, i) => s + i.vat, 0))
  if (diff === 0) return items
  const target = counted.find((i) => i.category === 'standard')
  if (target) target.vat = r2(target.vat + diff)
  else items.push({ ...fallback(), vat: diff })
  return items
}

function journalItems(ctx: Ctx, e: JournalEntry, docNumber: string | null, link: string | null): Draft[] {
  const out: Draft[] = []
  for (const l of e.lines) {
    const isOut = l.accountId === ctx.output
    const isIn = l.accountId === ctx.input
    if (!isOut && !isIn) continue
    const vat = r2(isOut ? l.credit - l.debit : l.debit - l.credit)
    const rate = (l.taxCode && ctx.categories.get(l.taxCode)?.rate) || ctx.standardRate
    out.push({
      side: isOut ? 'sales' : 'purchases',
      kind: e.sourceType === 'expense' ? 'expense' : 'journal',
      docId: e.sourceId,
      docNumber: docNumber ?? e.number,
      link: link ?? `/finance/journal?entry=${encodeURIComponent(e.id)}`,
      counterparty: l.description || e.memo,
      category: 'standard',
      taxCode: l.taxCode ?? null,
      net: rate > 0 ? r2((vat * 100) / rate) : 0,
      vat,
      recoverable: true,
      emirate: ctx.emirate,
      emirateAssumed: true,
      export: false,
    })
  }
  return out
}

/** Classifies one journal entry into VAT items (empty for entries without VAT relevance). */
export function classifyEntry(ctx: Ctx, e: JournalEntry): Draft[] {
  if (NOT_CLASSIFIED.has(e.sourceType)) return []
  const co = ctx.co
  const sign = e.reversalOf ? -1 : 1
  const vat = entryVat(ctx, e)
  const id = e.sourceId ?? ''

  if (e.sourceType === 'invoice' && id) {
    const inv = invoiceRecords.find((i) => i.companyId === co && i.id === id)
    if (inv && !inv.lines.length) return journalItems(ctx, e, inv.number, `/finance/invoices/${encodeURIComponent(inv.id)}`)
    if (inv) {
      const c = customerOf(co, inv.customerId)
      const emirate = c?.emirate || ''
      const items: Draft[] = inv.lines.map((l) => ({
        side: 'sales',
        kind: 'invoice',
        docId: inv.id,
        docNumber: inv.number,
        link: `/finance/invoices/${encodeURIComponent(inv.id)}`,
        counterparty: c?.name ?? 'Customer',
        category: catOf(ctx, l.taxCodeId),
        taxCode: l.taxCodeId,
        net: sign * toBase(l.net, inv.exchangeRate),
        vat: sign * toBase(l.taxAmount, inv.exchangeRate),
        recoverable: true,
        emirate: emirate || ctx.emirate,
        emirateAssumed: !emirate,
        export: inv.currency !== ctx.base,
      }))
      return reconcile(items, 'sales', vat.output, () => ({ ...items[0], category: 'standard', net: 0 }))
    }
  }
  if (e.sourceType === 'credit_note' && id) {
    const cn = financeCreditNotes.find((x) => x.companyId === co && x.id === id)
    if (cn && !cn.lines.length) return journalItems(ctx, e, cn.number, `/finance/invoices?credit_note=${encodeURIComponent(cn.id)}`)
    if (cn) {
      const inv = invoiceRecords.find((i) => i.companyId === co && i.id === cn.invoiceId)
      const c = customerOf(co, cn.customerId)
      const emirate = c?.emirate || ''
      const items: Draft[] = cn.lines.map((l) => ({
        side: 'sales',
        kind: 'credit_note',
        docId: cn.id,
        docNumber: cn.number,
        link: `/finance/invoices?credit_note=${encodeURIComponent(cn.id)}`,
        counterparty: c?.name ?? 'Customer',
        category: catOf(ctx, l.taxCodeId),
        taxCode: l.taxCodeId,
        net: -sign * toBase(l.net, cn.exchangeRate),
        vat: -sign * toBase(l.taxAmount, cn.exchangeRate),
        recoverable: true,
        emirate: emirate || ctx.emirate,
        emirateAssumed: !emirate,
        export: (inv?.currency ?? cn.currency) !== ctx.base,
      }))
      return reconcile(items, 'sales', vat.output, () => ({ ...items[0], category: 'standard', net: 0 }))
    }
  }
  if (e.sourceType === 'bill' && id) {
    const bill = finBills.find((b) => b.companyId === co && b.id === id)
    if (bill && !bill.lines.length) return journalItems(ctx, e, bill.number, `/finance/bills/${encodeURIComponent(bill.id)}`)
    if (bill) {
      const vendor = bill.supplierInvoiceNumber ? `${bill.supplierInvoiceNumber}` : ''
      const items: Draft[] = bill.lines.map((l) => {
        const category = catOf(ctx, l.taxCodeId)
        const recoverable = category !== 'standard' || l.vatRecoverable
        return {
          side: 'purchases',
          kind: 'bill',
          docId: bill.id,
          docNumber: bill.number,
          link: `/finance/bills/${encodeURIComponent(bill.id)}`,
          counterparty: vendor ? `Supplier invoice ${vendor}` : 'Supplier',
          category,
          taxCode: l.taxCodeId,
          net: sign * toBase(l.net, bill.exchangeRate),
          vat: sign * toBase(l.taxAmount, bill.exchangeRate),
          recoverable,
          emirate: ctx.emirate,
          emirateAssumed: false,
          export: false,
        }
      })
      return reconcile(items, 'purchases', vat.input, () => ({ ...items[0], category: 'standard', recoverable: true, net: 0 }))
    }
    const dn = finDebitNotes.find((d) => d.companyId === co && d.id === id)
    if (dn) {
      const bill2 = finBills.find((b) => b.companyId === co && b.id === dn.billId)
      const category: TaxCategory = dn.taxAmount > 0 ? 'standard' : catOf(ctx, bill2?.lines[0]?.taxCodeId)
      const items: Draft[] = [
        {
          side: 'purchases',
          kind: 'debit_note',
          docId: dn.id,
          docNumber: dn.number,
          link: `/finance/bills/${encodeURIComponent(dn.billId)}`,
          counterparty: bill2 ? `Debit note on ${bill2.number}` : 'Supplier',
          category,
          taxCode: bill2?.lines[0]?.taxCodeId ?? null,
          net: -sign * toBase(dn.net, dn.exchangeRate),
          vat: -sign * toBase(dn.taxAmount, dn.exchangeRate),
          recoverable: category !== 'standard' || dn.taxAmount > 0 || !!bill2?.lines.some((l) => l.vatRecoverable),
          emirate: ctx.emirate,
          emirateAssumed: false,
          export: false,
        },
      ]
      return reconcile(items, 'purchases', vat.input, () => ({ ...items[0], net: 0 }))
    }
  }
  if (e.sourceType === 'expense' && id) {
    const x = finExpenses.find((r) => r.companyId === co && r.id === id)
    if (x) {
      const category = catOf(ctx, x.taxCodeId)
      const items: Draft[] = [
        {
          side: 'purchases',
          kind: 'expense',
          docId: x.id,
          docNumber: x.number,
          link: `/finance/expenses?expense=${encodeURIComponent(x.id)}`,
          counterparty: x.payeeName,
          category,
          taxCode: x.taxCodeId,
          net: sign * toBase(x.netAmount, x.exchangeRate),
          vat: sign * toBase(x.vatAmount, x.exchangeRate),
          recoverable: category !== 'standard' || x.vatRecoverable,
          emirate: ctx.emirate,
          emirateAssumed: false,
          export: false,
        },
      ]
      if (category !== 'standard' && !items[0].vat && !vat.input) return items
      return reconcile(items, 'purchases', vat.input, () => ({ ...items[0], category: 'standard', recoverable: true, net: 0 }))
    }
    const claim = finExpenseClaims.find((r) => r.companyId === co && r.id === id)
    if (claim) return journalItems(ctx, e, claim.number, `/finance/expenses?claim=${encodeURIComponent(claim.id)}`)
    const mv = finPettyMovements.find((r) => r.companyId === co && r.id === id)
    if (mv) return journalItems(ctx, e, mv.number, `/finance/expenses?tab=petty&fund=${encodeURIComponent(mv.fundId)}`)
  }
  return journalItems(ctx, e, null, null)
}

/* ================= VAT: periods and returns ================= */

const settingsOf = (co: string) => finTaxSettings.get(co)
const returnsOf = (co: string) => finVatReturns.filter((r) => r.companyId === co)
const filedOf = (co: string) => returnsOf(co).filter((r) => r.status !== 'draft')

/** Creates the period rows up to the current period (idempotent); drafts of another frequency are dropped. */
export function ensureReturns(co: string): Tenant<VatReturnRecord>[] {
  const s = settingsOf(co)
  const today = todayOf(co)
  const periods = periodsBetween(s.trackingFrom, today, s.vatFrequency)
  const filed = filedOf(co)
  const overlapsFiled = (from: string, to: string) => filed.some((f) => f.from <= to && from <= f.to)
  // Drafts that no longer match the frequency (settings changed) go away; filed rows always stay.
  for (let i = finVatReturns.length - 1; i >= 0; i--) {
    const r = finVatReturns[i]
    if (r.companyId === co && r.status === 'draft' && (r.frequency !== s.vatFrequency || overlapsFiled(r.from, r.to))) finVatReturns.splice(i, 1)
  }
  for (const p of periods) {
    if (overlapsFiled(p.from, p.to)) continue
    if (returnsOf(co).some((r) => r.from === p.from && r.to === p.to)) continue
    finVatReturns.push({
      companyId: co,
      id: nextId('vatReturn', 'VATR'),
      periodKey: p.key,
      label: p.label,
      frequency: s.vatFrequency,
      from: p.from,
      to: p.to,
      status: 'draft',
      snapshot: null,
      countedEntryIds: [],
      filingReference: null,
      filedDate: null,
      filedAt: null,
      filedBy: null,
      settlementEntryId: null,
      creditUsedBy: null,
      creditFrom: null,
      paidDate: null,
      paidAt: null,
      paidBy: null,
      paymentAccountId: null,
      paymentReference: null,
      paymentEntryId: null,
      createdAt: nowIso(),
    })
  }
  return returnsOf(co).sort((a, b) => b.from.localeCompare(a.from))
}

function returnOf(co: string, id: string): Tenant<VatReturnRecord> {
  ensureReturns(co)
  return finVatReturns.find((r) => r.companyId === co && r.id === id) ?? notFound()
}

/** The earliest unfiled return starting after `date` (where a late entry of a filed period is reported). */
function correctionTarget(co: string, date: string): Tenant<VatReturnRecord> | undefined {
  return returnsOf(co)
    .filter((r) => r.status === 'draft' && r.from > date)
    .sort((a, b) => a.from.localeCompare(b.from))[0]
}

/** Items of a draft return: its period's entries + late entries of filed periods reported here. */
export function draftItems(co: string, ret: Pick<VatReturnRecord, 'id' | 'from' | 'to'>): VatItem[] {
  const ctx = ctxOf(co)
  const filed = filedOf(co)
  const counted = new Set(filed.flatMap((f) => f.countedEntryIds))
  const trackingFrom = settingsOf(co).trackingFrom
  const out: VatItem[] = []
  for (const e of entriesOf(co)) {
    if (e.date < trackingFrom || counted.has(e.id)) continue
    let correction = false
    if (e.date >= ret.from && e.date <= ret.to) correction = false
    else if (e.date < ret.from && filed.some((f) => e.date >= f.from && e.date <= f.to) && correctionTarget(co, e.date)?.id === ret.id) correction = true
    else continue
    for (const d of classifyEntry(ctx, e)) {
      const item: VatItem = { ...d, entryId: e.id, entryNumber: e.number, date: e.date, correction, box: '' }
      item.box = boxOf(ctx.layout, item)
      out.push(item)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber.localeCompare(b.entryNumber))
}

/** Credit of the previous filed return (negative payable, not used by another return yet). */
function creditSource(co: string, ret: VatReturnRecord): Tenant<VatReturnRecord> | null {
  const prev = filedOf(co)
    .filter((r) => r.to < ret.from)
    .sort((a, b) => b.to.localeCompare(a.to))[0]
  if (!prev || !prev.snapshot || prev.snapshot.totals.payable >= 0) return null
  if (prev.creditUsedBy && prev.creditUsedBy !== ret.id) return null
  return prev
}

/** Computes a draft return (live) — what filing freezes. */
export function computeReturn(co: string, ret: VatReturnRecord): VatSnapshot {
  const layout = layoutOf(co)
  const items = draftItems(co, ret)
  const credit = creditSource(co, ret)
  const { boxes, totals } = vatBoxes(layout, items, credit ? -credit.snapshot!.totals.payable : 0)
  const warnings: string[] = []
  const assumptions: string[] = []
  const s = financeSettingsOf(co)
  if (!s.vatRegistered || !s.vatNumber) warnings.push('The company is not VAT registered in Finance settings: a return can still be prepared, but check the registration first.')
  if (layout === 'ksa_zatca' && Math.abs(totals.corrections) > KSA_CORRECTION_LIMIT) warnings.push(`Corrections from previous periods exceed SAR ${KSA_CORRECTION_LIMIT.toLocaleString('en-US')}: file a voluntary disclosure for the earlier period instead of box 14.`)
  const excluded = items.filter((i) => i.box === 'excluded' && i.side === 'purchases' && i.category === 'standard' && !i.recoverable)
  if (excluded.length) warnings.push(`${excluded.length} purchase line${excluded.length === 1 ? '' : 's'} with VAT that is not recoverable (no valid tax invoice) ${excluded.length === 1 ? 'is' : 'are'} excluded.`)
  if (layout === 'uae_vat201') {
    const assumed = items.filter((i) => i.side === 'sales' && i.category === 'standard' && i.emirateAssumed)
    if (assumed.length) assumptions.push(`${assumed.length} standard-rated sale${assumed.length === 1 ? '' : 's'} without a customer emirate ${assumed.length === 1 ? 'is' : 'are'} reported in the company’s emirate (${companyEmirate(co)}). Set the emirate on the customer to change it.`)
    assumptions.push('Reverse charge, imports and tourist refunds are not tracked yet (boxes 2, 3, 6, 7 and 10 stay 0).')
  } else {
    if (items.some((i) => i.side === 'sales' && i.category === 'zero_rated' && i.export)) assumptions.push('Zero-rated sales invoiced in a foreign currency are reported as exports (box 4); the rest as zero-rated domestic sales (box 3).')
    assumptions.push('Sales to citizens (box 2), imports and reverse charge (boxes 8–9) are not tracked yet and stay 0.')
  }
  assumptions.push('Computed from the journal: each entry’s VAT lines decide the VAT; document lines decide the category and net value.')
  return { layout, boxes, totals, items, warnings, assumptions }
}

function rowOf(co: string, r: VatReturnRecord, payable?: number): VatReturnRow {
  const today = todayOf(co)
  const dueDate = vatDueDate(layoutOf(co), r.to)
  return {
    id: r.id,
    periodKey: r.periodKey,
    label: r.label,
    frequency: r.frequency,
    from: r.from,
    to: r.to,
    dueDate,
    status: r.status,
    inProgress: today <= r.to,
    overdue: r.status !== 'paid' && today > dueDate && (r.status === 'draft' || (r.snapshot?.totals.payable ?? 0) > 0),
    payable: payable ?? r.snapshot?.totals.payable ?? computeReturn(co, r).totals.payable,
    filingReference: r.filingReference,
    filedDate: r.filedDate,
    paidDate: r.paidDate,
  }
}

const entryRef = (co: string, id: string | null) => {
  if (!id) return null
  const e = financeJournal.find((x) => x.companyId === co && x.id === id)
  return e ? { id: e.id, number: e.number } : null
}

function detailOf(user: User, co: string, r: VatReturnRecord): VatReturnDetail {
  const snap = r.snapshot ?? computeReturn(co, r)
  const s = financeSettingsOf(co)
  const full = scopeOf(user.role, 'accounting') === 'full'
  const today = todayOf(co)
  const addr = companyById(co)?.profile.address
  const fileBlockedReason = r.status !== 'draft' ? 'This return is already filed.' : today <= r.to ? `The period ends on ${r.to}: file it once the period has ended.` : null
  return {
    ...rowOf(co, r, snap.totals.payable),
    layout: snap.layout,
    currency: baseCurrencyOf(co),
    adjustmentLabel: snap.layout === 'uae_vat201' ? 'Adjustment (VAT)' : 'Adjustment (amount)',
    boxes: snap.boxes,
    totals: snap.totals,
    itemCount: snap.items.filter((i) => i.box !== 'excluded').length,
    excludedCount: snap.items.filter((i) => i.box === 'excluded').length,
    correctionCount: snap.items.filter((i) => i.correction).length,
    warnings: snap.warnings,
    assumptions: snap.assumptions,
    seller: { legalName: s.legalNameEn, legalNameAr: s.legalNameAr, vatNumber: s.vatNumber, address: addr ? [addr.line1, addr.line2, addr.city, addr.region].filter(Boolean).join(', ') : '' },
    settlementEntry: entryRef(co, r.settlementEntryId),
    paymentEntry: entryRef(co, r.paymentEntryId),
    filedAt: r.filedAt,
    filedByName: userName(co, r.filedBy),
    paidByName: userName(co, r.paidBy),
    paymentReference: r.paymentReference,
    frozen: !!r.snapshot,
    can: { file: full && !fileBlockedReason, pay: full && r.status === 'filed' && snap.totals.payable > 0 },
    fileBlockedReason,
  }
}

/** GET /finance/vat-returns — every period from the first tracked one (newest first). */
export function listVatReturns(user: User): VatReturnRow[] {
  const co = viewer(user)
  return ensureReturns(co).map((r) => rowOf(co, r))
}

/** GET /finance/vat-returns/:id */
export function getVatReturn(user: User, id: string): VatReturnDetail {
  const co = viewer(user)
  return detailOf(user, co, returnOf(co, id))
}

/** The boxes that can be drilled into per layout (UAE "1" = 1a–1g together; `excluded` = not reported). */
function drillKeys(layout: VatLayout): string[] {
  return layout === 'uae_vat201' ? ['1', ...UAE_EMIRATE_BOXES.map(([k]) => k), '4', '5', '9', 'excluded', 'corrections'] : ['1', '3', '4', '5', '7', '10', '11', '14', 'excluded', 'corrections']
}

/** GET /finance/vat-returns/:id/boxes/:box — the lines feeding a box. */
export function getVatBoxItems(user: User, id: string, box: string): VatBoxItems {
  const co = viewer(user)
  const r = returnOf(co, id)
  const snap = r.snapshot ?? computeReturn(co, r)
  if (!drillKeys(snap.layout).includes(box)) notFound()
  const label = box === 'excluded' ? 'Not reported (non-recoverable VAT, out of scope, other purchases)' : box === 'corrections' ? 'Corrections of earlier periods' : box === '1' && snap.layout === 'uae_vat201' ? 'Standard rated supplies (boxes 1a–1g)' : (snap.boxes.find((b) => b.key === box)?.label ?? box)
  const items =
    box === 'corrections' ? snap.items.filter((i) => i.correction) : box === '1' && snap.layout === 'uae_vat201' ? snap.items.filter((i) => i.box.startsWith('1')) : snap.items.filter((i) => i.box === box)
  return { returnId: r.id, box, label, items }
}

const REF_RE = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{2,39}$/

/** POST /finance/vat-returns/:id/file — freezes the snapshot and posts the settlement entry. */
export function fileVatReturn(user: User, id: string, input: Partial<FileVatReturnInput> | null): VatReturnDetail {
  const co = writer(user)
  const r = returnOf(co, id)
  if (r.status !== 'draft') conflict('This return is already filed.', 'already_filed')
  const today = todayOf(co)
  if (today <= r.to) conflict(`The period ends on ${r.to}: file it once the period has ended.`, 'period_open', { to: r.to })
  const ref = typeof input?.filingReference === 'string' ? input.filingReference.trim() : ''
  if (!REF_RE.test(ref)) bad('Enter the filing reference from the tax authority portal (3–40 letters, digits, spaces, . / _ -).', 'validation_failed', { field: 'filing_reference' })
  const filedDate = input?.filedDate === undefined || input.filedDate === null || input.filedDate === '' ? today : input.filedDate
  if (!isIsoDate(filedDate)) bad('Enter the filing date as yyyy-MM-dd.', 'validation_failed', { field: 'filed_date' })
  if (filedDate <= r.to || filedDate > today) bad(`The filing date must be after the period (${r.to}) and not in the future.`, 'validation_failed', { field: 'filed_date' })
  const snap = computeReturn(co, r)
  const credit = creditSource(co, r)
  const lines = settlementLines(snap.totals, { output: systemAccount(co, 'vat_output'), input: systemAccount(co, 'vat_input'), payable: ensureVatPayableAccount(co) })
  // Post first: a refused entry (423 period_locked) leaves the return a draft.
  const entry = lines.length >= 2 ? postJournal(co, { date: filedDate, memo: `VAT return ${r.label} filed (${ref})`, sourceType: 'vat_return', sourceId: r.id, lines, createdBy: user.id }) : null
  const at = nowIso()
  r.status = 'filed'
  r.snapshot = snap
  r.countedEntryIds = [...new Set(snap.items.map((i) => i.entryId))]
  r.filingReference = ref
  r.filedDate = filedDate
  r.filedAt = at
  r.filedBy = user.id
  r.settlementEntryId = entry?.id ?? null
  if (credit) {
    credit.creditUsedBy = r.id
    r.creditFrom = credit.id
  }
  recordAudit(user, { action: 'update', entity: 'vat_return', entityId: r.id, summary: `Filed the VAT return ${r.label} (${ref}): ${snap.totals.payable >= 0 ? 'payable' : 'credit'} ${Math.abs(snap.totals.payable).toFixed(2)} ${baseCurrencyOf(co)}` })
  return detailOf(user, co, r)
}

/** POST /finance/vat-returns/:id/pay — Dr VAT payable to tax authority / Cr bank. */
export function payVatReturn(user: User, id: string, input: Partial<PayVatReturnInput> | null): VatReturnDetail {
  const co = writer(user)
  const r = returnOf(co, id)
  if (r.status === 'draft') conflict('File the return before recording its payment.', 'not_filed')
  if (r.status === 'paid') conflict('This return is already paid.', 'already_paid')
  const payable = r.snapshot?.totals.payable ?? 0
  if (payable <= 0) conflict('Nothing to pay: this return is a credit carried forward.', 'nothing_to_pay')
  const today = todayOf(co)
  const date = input?.date === undefined || input.date === null || input.date === '' ? today : input.date
  if (!isIsoDate(date)) bad('Enter the payment date as yyyy-MM-dd.', 'validation_failed', { field: 'date' })
  if (date > today || (r.filedDate && date < r.filedDate)) bad('The payment date must be between the filing date and today.', 'validation_failed', { field: 'date' })
  const accountId = typeof input?.accountId === 'string' && input.accountId ? input.accountId : financeSettingsOf(co).defaultBankAccountId
  const acc = cashAccountsOf(co).find((a) => a.id === accountId)
  if (!acc) bad('Choose a bank or cash account of the company.', 'invalid_account', { field: 'account_id' })
  const reference = typeof input?.reference === 'string' ? input.reference.trim().slice(0, 60) : ''
  const entry = postJournal(co, {
    date,
    memo: `VAT payment ${r.label}${reference ? ` (${reference})` : ''}`,
    sourceType: 'vat_return',
    sourceId: r.id,
    lines: [
      { accountId: ensureVatPayableAccount(co), debit: payable, credit: 0, description: 'VAT paid to the tax authority' },
      { accountId: acc!.id, debit: 0, credit: payable, description: `VAT ${r.label}` },
    ],
    createdBy: user.id,
  })
  r.status = 'paid'
  r.paidDate = date
  r.paidAt = nowIso()
  r.paidBy = user.id
  r.paymentAccountId = acc!.id
  r.paymentReference = reference || null
  r.paymentEntryId = entry.id
  recordAudit(user, { action: 'update', entity: 'vat_return', entityId: r.id, summary: `Recorded the payment of the VAT return ${r.label}: ${payable.toFixed(2)} ${baseCurrencyOf(co)} from ${acc!.code} ${acc!.name}` })
  return detailOf(user, co, r)
}

/* ================= settings ================= */

function fiscalYearsOf(co: string): number[] {
  const start = financeSettingsOf(co).fiscalYearStartMonth
  const first = fiscalYearOf(settingsOf(co).trackingFrom, start)
  const cur = fiscalYearOf(todayOf(co), start)
  const out: number[] = []
  for (let y = cur; y >= Math.min(first, cur - 1); y--) out.push(y)
  return out
}

function settingsView(user: User, co: string): TaxSettings {
  const s = settingsOf(co)
  const fs = financeSettingsOf(co)
  return {
    country: countryOf(co),
    layout: layoutOf(co),
    currency: baseCurrencyOf(co),
    vatFrequency: s.vatFrequency,
    trackingFrom: s.trackingFrom,
    companyEmirate: layoutOf(co) === 'uae_vat201' ? companyEmirate(co) : '',
    vatNumber: fs.vatNumber,
    vatRegistered: fs.vatRegistered,
    canEdit: scopeOf(user.role, 'accounting') === 'full',
    paymentAccounts: cashAccountsOf(co).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    fiscalYearStartMonth: fs.fiscalYearStartMonth,
    fiscalYears: fiscalYearsOf(co),
  }
}

/** GET /finance/tax/settings */
export function getTaxSettings(user: User): TaxSettings {
  const co = viewer(user)
  return settingsView(user, co)
}

/** PATCH /finance/tax/settings — the VAT filing frequency. */
export function updateTaxSettings(user: User, input: { vatFrequency?: unknown } | null): TaxSettings {
  const co = writer(user)
  const s = settingsOf(co)
  const f = input?.vatFrequency
  if (f !== undefined) {
    if (f !== 'monthly' && f !== 'quarterly') bad('The filing frequency is monthly or quarterly.', 'validation_failed', { field: 'vat_frequency' })
    const freq = f as VatFrequency
    if (freq !== s.vatFrequency) {
      const last = filedOf(co).sort((a, b) => b.to.localeCompare(a.to))[0]
      if (freq === 'quarterly' && last && !isQuarterEnd(last.to)) conflict('The last filed return doesn’t end on a calendar quarter: file the remaining months of the quarter monthly first.', 'frequency_misaligned')
      const before = s.vatFrequency
      s.vatFrequency = freq
      s.updatedAt = nowIso()
      s.updatedBy = user.id
      recordAudit(user, { action: 'update', entity: 'tax_settings', entityId: 'vat_frequency', summary: `VAT filing frequency: ${freq}`, changes: [{ field: 'vat_frequency', from: before, to: freq }] })
      ensureReturns(co)
    }
  }
  return settingsView(user, co)
}

/* ================= corporate tax / zakat ================= */

/** Entries counted in profit: not tax provisions (the tax itself), not year-end closing entries. */
const profitEntries = (co: string) => entriesOf(co).filter((e) => e.sourceType !== 'tax_provision' && e.sourceType !== 'year_end_close')

function yearOf(co: string, raw: unknown): { year: number; from: string; to: string; asOf: string } {
  const start = financeSettingsOf(co).fiscalYearStartMonth
  const today = todayOf(co)
  const year = raw === undefined || raw === null || raw === '' ? fiscalYearOf(today, start) : Number(raw)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) bad('Enter the fiscal year (e.g. 2026).', 'validation_failed', { field: 'year' })
  const { from, to } = fiscalYearRange(year, start)
  if (from > today) bad('That fiscal year hasn’t started yet.', 'validation_failed', { field: 'year' })
  return { year, from, to, asOf: to < today ? to : today }
}

/**
 * Profit and loss by account for a range (income: credit − debit; expense: debit − credit), from the ledger.
 * SEAM: the statements section exports `profitAndLoss(companyId, from, to)` (services/financeStatements.ts). The estimate
 * keeps its own ledger sum on purpose: it needs profit BEFORE tax (tax-provision entries left out, so posting the
 * provision never changes the estimate), while the statement's P&L includes the provision. Both exclude year-end
 * closing entries and read the same journal, so pre-tax figures agree.
 */
function profitRows(co: string, from: string, to: string) {
  const sums = sumByAccount(profitEntries(co), { from, to })
  return accountsOf(co)
    .filter((a) => !a.isHeader && (a.type === 'income' || a.type === 'expense'))
    .map((a) => {
      const s = sums.get(a.id) ?? { debit: 0, credit: 0 }
      return { code: a.code, name: a.name, type: a.type as 'income' | 'expense', amount: r2(a.type === 'income' ? s.credit - s.debit : s.debit - s.credit) }
    })
}

function manualOf(co: string, kind: 'corporate_tax' | 'zakat', year: number): TaxAdjustmentLine[] {
  return settingsOf(co).adjustments.find((a) => a.kind === kind && a.year === year)?.lines ?? []
}

const PROVISION_PAYABLE = '2700'
function payableAccount(co: string): string {
  const a = financeAccounts.find((x) => x.companyId === co && x.code === PROVISION_PAYABLE && x.type === 'liability' && !x.isHeader && x.active)
  return a ? a.id : conflict('The chart has no active liability 2700 (corporate tax / zakat payable).', 'missing_tax_account')
}
/** Tax expense account 6960 (Corporate tax expense / Zakat expense): created on the first provision, additively. */
export function ensureTaxExpenseAccount(co: string): string {
  const found = financeAccounts.find((a) => a.companyId === co && a.code === '6960')
  if (found) {
    if (found.type !== 'expense' || found.isHeader || !found.active) conflict('Account 6960 must be an active, postable expense account for the tax provision.', 'tax_expense_account')
    return found.id
  }
  const at = nowIso()
  const parent = financeAccounts.find((a) => a.companyId === co && a.id === 'ACC-6000' && a.isHeader)
  const name = countryOf(co) === 'SA' ? 'Zakat expense' : 'Corporate tax expense'
  financeAccounts.push({ companyId: co, id: 'ACC-6960', code: '6960', name, type: 'expense', subtype: 'other_expense', parentId: parent ? parent.id : null, systemRole: null, isHeader: false, active: true, currency: null, description: 'Provisional tax charge (created by the tax provision).', createdAt: at, updatedAt: at })
  return 'ACC-6960'
}

const provisionKey = (kind: 'corporate_tax' | 'zakat', year: number) => `${kind}:${year}`
function providedOf(co: string, kind: 'corporate_tax' | 'zakat', year: number): number {
  const key = provisionKey(kind, year)
  const payable = financeAccounts.find((x) => x.companyId === co && x.code === PROVISION_PAYABLE)?.id
  let total = 0
  for (const e of entriesOf(co)) {
    if (e.sourceType !== 'tax_provision' || e.sourceId !== key) continue
    for (const l of e.lines) if (l.accountId === payable) total += l.credit - l.debit
  }
  return r2(total)
}

const monthsBetween = (from: string, asOf: string) => (Number(asOf.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(asOf.slice(5, 7)) - Number(from.slice(5, 7)) + 1

function ctEstimate(user: User, co: string, raw: unknown): CorporateTaxEstimate {
  if (countryOf(co) === 'SA') conflict('Corporate tax applies to UAE companies; KSA companies see the zakat estimate.', 'not_applicable')
  const { year, from, to, asOf } = yearOf(co, raw)
  const rows = profitRows(co, from, asOf)
  const revenue = r2(rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0))
  const expenses = r2(rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0))
  const accountingProfit = r2(revenue - expenses)
  const adjustments = corporateTaxAdjustments(rows)
  const manual = manualOf(co, 'corporate_tax', year)
  const taxableIncome = r2(Math.max(0, accountingProfit + adjustments.reduce((s, a) => s + a.amount, 0) + sumManual(manual)))
  const bands = corporateTaxBands(taxableIncome)
  const tax = r2(bands.reduce((s, b) => s + b.tax, 0))
  const months = Math.max(1, Math.min(12, monthsBetween(from, asOf)))
  const projectedProfit = r2((accountingProfit / months) * 12)
  const projectedTaxable = Math.max(0, r2(projectedProfit + ((adjustments.reduce((s, a) => s + a.amount, 0) + sumManual(manual)) / months) * 12))
  const projectedTax = r2(corporateTaxBands(projectedTaxable).reduce((s, b) => s + b.tax, 0))
  const provided = providedOf(co, 'corporate_tax', year)
  return {
    kind: 'corporate_tax',
    fiscalYear: year,
    from,
    to,
    asOf,
    currency: baseCurrencyOf(co),
    revenue,
    expenses,
    accountingProfit,
    adjustments,
    manualAdjustments: manual,
    taxableIncome,
    threshold: UAE_CT_THRESHOLD,
    rate: UAE_CT_RATE,
    bands,
    tax,
    projectedProfit,
    projectedTax,
    provided,
    toProvide: r2(tax - provided),
    source: 'ledger',
    notes: [
      'Estimate only, from the ledger to date — not a tax return. Consult your tax advisor.',
      `0 % on taxable income up to AED ${UAE_CT_THRESHOLD.toLocaleString('en-US')}, ${UAE_CT_RATE} % above (UAE Federal Decree-Law No. 47 of 2022).`,
      'Small business relief, free-zone qualifying income, tax losses brought forward and transfer-pricing adjustments are not applied.',
      'The projection extends the year to date straight-line to 12 months.',
    ],
    canPost: scopeOf(user.role, 'accounting') === 'full',
  }
}

function zakatEstimate(user: User, co: string, raw: unknown): ZakatEstimate {
  if (countryOf(co) !== 'SA') conflict('Zakat applies to KSA companies; UAE companies see the corporate tax estimate.', 'not_applicable')
  const { year, from, to, asOf } = yearOf(co, raw)
  const accounts = accountsOf(co).filter((a) => !a.isHeader)
  const sums = sumByAccount(profitEntries(co), { to: asOf })
  const bal = (a: Account) => {
    const s = sums.get(a.id) ?? { debit: 0, credit: 0 }
    return naturalBalance(a.type, s.debit, s.credit)
  }
  const total = (pred: (a: Account) => boolean) => r2(accounts.filter(pred).reduce((s, a) => s + bal(a), 0))
  const equity = total((a) => a.type === 'equity')
  const unclosedProfit = r2(total((a) => a.type === 'income') - total((a) => a.type === 'expense'))
  const longTermLiabilities = total((a) => a.type === 'liability' && a.subtype === 'non_current_liability')
  const fixedAssetsNet = total((a) => a.type === 'asset' && a.subtype === 'fixed_asset')
  const manual = manualOf(co, 'zakat', year)
  const rows = profitRows(co, from, asOf)
  const netProfit = r2(rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0) - rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0))
  const adjustedNetProfit = r2(netProfit + sumManual(manual))
  const z = zakatOf({ equity, unclosedProfit, longTermLiabilities, fixedAssetsNet, adjustedNetProfit, manual: sumManual(manual) })
  const provided = providedOf(co, 'zakat', year)
  const lines: EstimateLine[] = [
    { key: 'equity', label: 'Equity (share capital, retained earnings, opening balance equity)', amount: equity, note: null },
    { key: 'unclosed', label: 'Profit not yet closed to retained earnings', amount: unclosedProfit, note: null },
    { key: 'ltl', label: 'Long-term liabilities (e.g. end-of-service provision)', amount: longTermLiabilities, note: null },
    { key: 'fixed', label: 'Less: fixed assets, net of depreciation', amount: r2(-fixedAssetsNet), note: null },
    ...(manual.length ? [{ key: 'manual', label: 'Manual adjustments', amount: sumManual(manual), note: null }] : []),
  ]
  return {
    kind: 'zakat',
    fiscalYear: year,
    from,
    to,
    asOf,
    currency: baseCurrencyOf(co),
    equity,
    unclosedProfit,
    longTermLiabilities,
    fixedAssetsNet,
    manualAdjustments: manual,
    baseByBalanceSheet: z.baseByBalanceSheet,
    adjustedNetProfit,
    base: z.base,
    method: z.method,
    rate: ZAKAT_RATE,
    zakat: z.zakat,
    provided,
    toProvide: r2(z.zakat - provided),
    lines,
    notes: [
      'Estimate, consult your advisor: a simplified zakat base, not the ZATCA zakat return.',
      'Base = equity + long-term liabilities − net fixed assets (± adjustments), or the adjusted net profit when higher; zakat = 2.5 % of the base.',
      'Deductible investments, Hijri / Gregorian year rate differences (2.5777 %) and the treatment of provisions are not applied.',
    ],
    canPost: scopeOf(user.role, 'accounting') === 'full',
  }
}

/** GET /finance/tax/corporate-tax?year= (UAE; KSA → 409 not_applicable). */
export function getCorporateTax(user: User, year?: string | null): CorporateTaxEstimate {
  const co = viewer(user)
  return ctEstimate(user, co, year)
}
/** GET /finance/tax/zakat?year= (KSA; UAE → 409 not_applicable). */
export function getZakat(user: User, year?: string | null): ZakatEstimate {
  const co = viewer(user)
  return zakatEstimate(user, co, year)
}

const kindOf = (raw: unknown): 'corporate_tax' | 'zakat' => (raw === 'corporate_tax' || raw === 'zakat' ? raw : bad('The kind is corporate_tax or zakat.', 'validation_failed', { field: 'kind' }))

/** PUT /finance/tax/adjustments — manual adjustments of a year's estimate (replaces the list). */
export function putTaxAdjustments(user: User, input: Partial<TaxAdjustmentsInput> | null): CorporateTaxEstimate | ZakatEstimate {
  const co = writer(user)
  const kind = kindOf(input?.kind)
  const est = kind === 'zakat' ? zakatEstimate(user, co, input?.year) : ctEstimate(user, co, input?.year)
  const raw = input?.lines
  if (!Array.isArray(raw) || raw.length > 30) bad('Send `lines` (up to 30 adjustments).', 'validation_failed', { field: 'lines' })
  const lines: TaxAdjustmentLine[] = (raw as unknown[]).map((l, i) => {
    const x = (l ?? {}) as { label?: unknown; amount?: unknown }
    const label = typeof x.label === 'string' ? x.label.trim() : ''
    const amount = typeof x.amount === 'string' && x.amount.trim() !== '' ? Number(x.amount) : x.amount
    if (!label || label.length > 120) bad(`Adjustment ${i + 1}: enter a label (up to 120 characters).`, 'validation_failed', { field: 'lines' })
    if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 1e12) bad(`Adjustment ${i + 1}: enter an amount.`, 'validation_failed', { field: 'lines' })
    return { label, amount: r2(amount as number) }
  })
  const s = settingsOf(co)
  s.adjustments = [...s.adjustments.filter((a) => !(a.kind === kind && a.year === est.fiscalYear)), ...(lines.length ? [{ kind, year: est.fiscalYear, lines }] : [])]
  s.updatedAt = nowIso()
  s.updatedBy = user.id
  recordAudit(user, { action: 'update', entity: 'tax_adjustments', entityId: provisionKey(kind, est.fiscalYear), summary: `${kind === 'zakat' ? 'Zakat' : 'Corporate tax'} ${est.fiscalYear}: ${lines.length} manual adjustment${lines.length === 1 ? '' : 's'}` })
  return kind === 'zakat' ? zakatEstimate(user, co, est.fiscalYear) : ctEstimate(user, co, est.fiscalYear)
}

/** POST /finance/tax/provisions — posts the difference between the estimate and what is already provided. */
export function postTaxProvision(user: User, input: Partial<ProvisionInput> | null): ProvisionResult {
  const co = writer(user)
  const kind = kindOf(input?.kind)
  const est = kind === 'zakat' ? zakatEstimate(user, co, input?.year) : ctEstimate(user, co, input?.year)
  const today = todayOf(co)
  const date = input?.date === undefined || input.date === null || input.date === '' ? (est.to < today ? est.to : today) : input.date
  if (!isIsoDate(date)) bad('Enter the date as yyyy-MM-dd.', 'validation_failed', { field: 'date' })
  if (date < est.from || date > est.to || date > today) bad('The provision date must be inside the fiscal year and not in the future.', 'validation_failed', { field: 'date' })
  const amount = est.toProvide
  if (amount === 0) conflict('The provision already matches the estimate.', 'nothing_to_post')
  const expense = ensureTaxExpenseAccount(co)
  const payable = payableAccount(co)
  const what = kind === 'zakat' ? 'Zakat' : 'Corporate tax'
  const lines =
    amount > 0
      ? [
          { accountId: expense, debit: amount, credit: 0, description: `${what} provision ${est.fiscalYear}` },
          { accountId: payable, debit: 0, credit: amount, description: `${what} payable ${est.fiscalYear}` },
        ]
      : [
          { accountId: payable, debit: -amount, credit: 0, description: `${what} provision released ${est.fiscalYear}` },
          { accountId: expense, debit: 0, credit: -amount, description: `${what} provision released ${est.fiscalYear}` },
        ]
  const entry = postJournal(co, { date, memo: `${what} provision ${est.fiscalYear} (estimate)`, sourceType: 'tax_provision', sourceId: provisionKey(kind, est.fiscalYear), lines, createdBy: user.id })
  recordAudit(user, { action: 'create', entity: 'tax_provision', entityId: entry.id, summary: `${what} provision ${est.fiscalYear}: ${amount.toFixed(2)} ${est.currency} (journal ${entry.number})` })
  const next = kind === 'zakat' ? zakatEstimate(user, co, est.fiscalYear) : ctEstimate(user, co, est.fiscalYear)
  return { entry: { id: entry.id, number: entry.number, amount }, estimate: next }
}

/* ---------------- for the cash-flow forecast ---------------- */

/** VAT expected to be paid: filed unpaid returns and the estimate of unfiled periods (net > 0), with due dates. */
export function vatOutflows(co: string): { returnId: string; label: string; dueDate: string; amount: number; estimate: boolean }[] {
  const layout = layoutOf(co)
  return ensureReturns(co)
    .map((r) => {
      const payable = r.status === 'draft' ? computeReturn(co, r).totals.payable : r.status === 'filed' ? (r.snapshot?.totals.payable ?? 0) : 0
      return { returnId: r.id, label: r.label, dueDate: vatDueDate(layout, r.to), amount: payable, estimate: r.status === 'draft' }
    })
    .filter((x) => x.amount > 0)
}

/* ---------------- seed: past returns filed and paid ---------------- */

const SEED_FILER: Record<string, string> = { co_apex: 'u8', co_crest: 'u101' }

/**
 * The demo company files on time: every return whose deadline has passed is filed a few days before it (FTA / ZATCA
 * reference) and paid the next day, through the same services as the screen (frozen snapshot, settlement and payment
 * entries). The period just ended stays a draft until its deadline. Runs once per company, after every other finance
 * seed has posted (a late hook).
 */
export function ensureVatFilingSeed(co: string): void {
  if (finTaxMeta.seeded.includes(co)) return
  const filer = users.find((u) => u.id === SEED_FILER[co] && u.companyId === co)
  if (!filer) return
  finTaxMeta.seeded.push(co)
  const today = todayOf(co)
  const layout = layoutOf(co)
  const prefix = layout === 'uae_vat201' ? 'FTA-230' : 'ZATCA-31'
  const drafts = ensureReturns(co)
    .filter((r) => r.status === 'draft' && vatDueDate(layout, r.to) < today)
    .sort((a, b) => a.from.localeCompare(b.from))
  drafts.forEach((r, i) => {
    const due = vatDueDate(layout, r.to)
    let filedDate = addDaysIso(due, -4 - (i % 3))
    if (filedDate <= r.to) filedDate = addDaysIso(r.to, 1)
    if (filedDate > today) filedDate = today
    try {
      const filed = fileVatReturn(filer, r.id, { filingReference: `${prefix}${r.to.slice(0, 7).replace('-', '')}${String(4170 + i * 13)}`, filedDate })
      if (filed.totals.payable > 0) {
        const paidDate = addDaysIso(filedDate, 1) > today ? today : addDaysIso(filedDate, 1)
        payVatReturn(filer, r.id, { date: paidDate, reference: `${layout === 'uae_vat201' ? 'GIBAN' : 'SADAD'} ${String(880211 + i * 97)}` })
      }
    } catch (e) {
      console.error('[tax] seed filing failed', e)
    }
  })
}

onFinanceAccess('vat-filing-seed', ensureVatFilingSeed, { last: true })
