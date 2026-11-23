import type { User } from '@/shared/types'
import type { JournalLine } from '@/modules/finance/types'
import type { ApBucket, ApAmounts, BillLine, BillLineInput, HistoryEntry, MatchResult, PoLine, PoLineInput, SupplierStatement } from '@/modules/finance/purchases/types'
import { AP_BUCKETS } from '@/modules/finance/purchases/types'
import { addDaysIso, daysBetween, isIsoDay, toBase } from '@/modules/finance/invoices/calc'
import { apBucketOf, isOpenBill, isVatRecoverable, matchLine, purchaseLine, purchaseTotals } from '@/modules/finance/purchases/calc'
import { scopeOf } from '@/shared/lib/permissions'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { projects, pushNotification } from '@/shared/mocks/data/tasks'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import { eventVendors } from '@/shared/mocks/data/eventLibrary'
import { financeAccounts, financeTaxCodes } from '@/shared/mocks/data/finance'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import {
  finBillPayments,
  finBills,
  finDebitNotes,
  finPaymentRuns,
  finPurchaseOrders,
  finPurchasesSettings,
  finSupplierAdvances,
  finSupplierProfiles,
  type ApprovalState,
  type BillPaymentRecord,
  type BillRecord,
  type DebitNoteRecord,
  type PaymentRunRecord,
  type PoRecord,
  type SupplierProfileRecord,
  type SupplierAdvanceRecord,
} from '@/shared/mocks/data/financePurchases'
import { approvalChain, canApproveStep, type ApprovalStep, type SpendDocType } from './financeApprovals'
import { docNumber, nextId, postJournal, reverseJournal, round2, systemAccount } from './ledger'
import { baseCurrencyOf, requireRate } from './financeRates'
import { financeSettingsOf } from './financeLedger'
import { applyToBill, isBillOverdue, openBill } from './financeBillBalance'
import { billedByLine } from './financeEventCosts'

/**
 * Accounts & finance › Purchases & payables — store-level rules shared by the endpoints (services/financePurchases.ts)
 * and the seed (data/financePurchasesSeed.ts). No permission checks here (callers check access).
 *
 * APPROVALS (services/financeApprovals.ts): a PO / bill's chain is `approvalChain(co, type, total in base currency)`,
 * frozen on submit. Each step is decided in order by an eligible user (`assertCanApprove`: maker–checker, one step per
 * user). An empty chain approves on submit. A rejection ends the chain (the requester edits and resubmits).
 *
 * POSTINGS (base currency = amount × rate; a rounding difference goes to the `rounding` account; never for POs)
 *   bill          Dr each line's account (net, + VAT when not recoverable) with department / project / event
 *                 Dr VAT input (recoverable VAT: supplier VAT number + standard-rated line)      Cr AP (total)
 *   bill void     the bill entry reversed (only without payments / debit notes)
 *   debit note    Dr AP (gross)   Cr the bill's account (net share)   Cr VAT input (the bill's recoverable VAT share)
 *   payment       Dr AP (allocations at each bill's rate)   Cr payment account (amount at the payment's rate)
 *                 ± exchange gain / loss (the difference)   Dr bank charges / Cr payment account (charges, base)
 *   payment void  the payment entry reversed; the bills reopen through `applyToBill`
 */

export const bad = (message: string, code = 'validation_failed', extra?: Record<string, unknown>): never => {
  throw new CodedApiError(message, 422, code, extra)
}
export const conflict = (message: string, code: string, extra?: Record<string, unknown>): never => {
  throw new CodedApiError(message, 409, code, extra)
}

export interface Actor {
  id: string | null
  name: string
}
export const SYSTEM: Actor = { id: null, name: 'System' }
export const actorOf = (u: Pick<User, 'id' | 'name'>): Actor => ({ id: u.id, name: u.name })

export const FINANCE_ALERT_TYPE = 'finance'
export const poPathOf = (id: string) => `/finance/purchase-orders/${encodeURIComponent(id)}`
export const billPathOf = (id: string) => `/finance/bills/${encodeURIComponent(id)}`

export const todayOf = (co: string): string => companyDayOf(co).today
export const prefixOf = (co: string): string => financeSettingsOf(co).documentPrefix
export const hist = (by: Actor, action: string, summary: string, at: string): HistoryEntry => ({ at, byName: by.name, action, summary })
export const userName = (co: string, id: string | null | undefined) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : 'System')

/* ---------------- lookups (company-scoped; a foreign id is "not found") ---------------- */

export const vendorOf = (co: string, id: unknown) => (typeof id === 'string' ? eventVendors.find((v) => v.companyId === co && v.id === id) : undefined)
export const vendorName = (co: string, id: string) => vendorOf(co, id)?.name ?? 'Unknown supplier'
export const profileOf = (co: string, vendorId: string) => finSupplierProfiles.find((p) => p.companyId === co && p.vendorId === vendorId)
export const poOf = (co: string, id: unknown) => (typeof id === 'string' ? finPurchaseOrders.find((p) => p.companyId === co && p.id === id) : undefined)
export const billOf = (co: string, id: unknown) => (typeof id === 'string' ? finBills.find((b) => b.companyId === co && b.id === id) : undefined)
export const accountOf = (co: string, id: unknown) => (typeof id === 'string' ? financeAccounts.find((a) => a.companyId === co && a.id === id) : undefined)
export const taxOf = (co: string, id: unknown) => (typeof id === 'string' ? financeTaxCodes.find((t) => t.companyId === co && t.id === id) : undefined)
export const departmentName = (co: string, id: string | null) => (id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? '') : '')

/** Default finance profile of a vendor: VAT number from the vendor record, company terms, base currency. */
export function defaultProfile(co: string, vendorId: string): SupplierProfileRecord {
  const v = vendorOf(co, vendorId)
  const terms = Number(v?.paymentTerms.match(/(\d{1,3})\s*days?/i)?.[1] ?? financeSettingsOf(co).paymentTermsDays)
  return {
    vendorId,
    vatNumber: v?.taxNumber ?? '',
    paymentTermsDays: Number.isFinite(terms) ? terms : 30,
    defaultExpenseAccountId: null,
    defaultTaxCodeId: null,
    currency: baseCurrencyOf(co),
    bankName: '',
    iban: '',
    swiftBic: '',
    notes: '',
    updatedAt: '',
    updatedBy: null,
  }
}
/** The stored profile, or the defaults (not stored). */
export const effectiveProfile = (co: string, vendorId: string): SupplierProfileRecord => profileOf(co, vendorId) ?? defaultProfile(co, vendorId)

export function ensureProfile(co: string, vendorId: string): Tenant<SupplierProfileRecord> {
  let p = profileOf(co, vendorId)
  if (!p) {
    p = { companyId: co, ...defaultProfile(co, vendorId) }
    finSupplierProfiles.push(p)
  }
  return p
}

const CATEGORY_ACCOUNT: Record<string, string> = {
  booth_builder: 'ACC-6450',
  av_tech: 'ACC-6450',
  venue_services: 'ACC-6450',
  catering: 'ACC-6450',
  staffing: 'ACC-6450',
  photo_video: 'ACC-6450',
  giveaways: 'ACC-6450',
  printing: 'ACC-6400',
  logistics: 'ACC-5200',
  other: 'ACC-6550',
}

/** Postable purchase accounts: active, not headers, expense or asset (fixed assets, prepaid…), not cash/bank/AR/VAT. */
export function isPurchaseAccount(co: string, id: string): boolean {
  const a = accountOf(co, id)
  if (!a || !a.active || a.isHeader) return false
  if (a.type === 'expense') return a.systemRole !== 'fx_gain_loss' && a.systemRole !== 'rounding'
  return a.type === 'asset' && !a.systemRole && !a.code.startsWith('11')
}

export function standardTaxOf(co: string) {
  const rate = companyById(co)?.regional.country === 'SA' ? 15 : 5
  return financeTaxCodes.find((t) => t.companyId === co && t.active && t.category === 'standard' && t.rate === rate) ?? financeTaxCodes.find((t) => t.companyId === co && t.active)!
}

/* ---------------- currency ---------------- */

export function rateOrDefault(co: string, currency: string, rate: unknown, date: string): number {
  if (currency === baseCurrencyOf(co)) return 1
  if (rate !== undefined && rate !== null && rate !== '') {
    const n = Number(rate)
    if (!Number.isFinite(n) || n <= 0 || n > 100_000) bad('The exchange rate must be greater than 0.', 'invalid_rate')
    return Math.round(n * 1_000_000) / 1_000_000
  }
  return requireRate(co, currency, date)
}

export function cleanCurrency(_co: string, v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) return bad('Currency must be a 3-letter ISO code.', 'invalid_currency')
  return v
}

/* ---------------- lines ---------------- */

let lineSeq = 0
const lineId = (ownerId: string) => `${ownerId}-L${++lineSeq}${Date.now().toString(36).slice(-3)}`

export interface LineContext {
  vendorId: string
  vatNumber: string
  /** Lines may name a PO line (bills from a PO). */
  po?: PoRecord | null
}

function dimension(co: string, n: number, raw: PoLineInput) {
  let departmentId: string | null = null
  if (raw.departmentId) {
    const d = departments.find((x) => x.companyId === co && x.id === raw.departmentId)
    if (!d) bad(`Line ${n}: department not found.`, 'department_not_found')
    departmentId = d!.id
  }
  let projectId: string | null = null
  if (raw.projectId) {
    const p = projects.find((x) => x.companyId === co && x.id === raw.projectId)
    if (!p) bad(`Line ${n}: project not found.`, 'project_not_found')
    projectId = p!.id
  }
  let eventId: string | null = null
  let budgetLineId: string | null = null
  if (raw.eventId) {
    const e = events.find((x) => x.companyId === co && x.id === raw.eventId)
    if (!e) bad(`Line ${n}: event not found.`, 'event_not_found')
    eventId = e!.id
  }
  if (raw.budgetLineId) {
    const b = eventBudgetLines.find((x) => x.companyId === co && x.id === raw.budgetLineId)
    if (!b || (eventId && b.eventId !== eventId)) bad(`Line ${n}: budget line not found on this event.`, 'budget_line_not_found')
    budgetLineId = b!.id
    eventId = b!.eventId
  }
  return { departmentId, projectId, eventId, budgetLineId }
}

/** Validated, computed PO / bill lines (422 on the first invalid one). */
export function buildLines(co: string, ownerId: string, inputs: unknown, ctx: LineContext): (Omit<PoLine, 'receivedQty' | 'billedQty'> & { poLineId: string | null; vatRecoverable: boolean })[] {
  if (!Array.isArray(inputs) || inputs.length === 0) bad('Add at least one line.', 'no_lines')
  if ((inputs as unknown[]).length > 100) bad('A document has at most 100 lines.')
  const profile = effectiveProfile(co, ctx.vendorId)
  const vendor = vendorOf(co, ctx.vendorId)
  return (inputs as BillLineInput[]).map((raw, i) => {
    const n = i + 1
    if (!raw || typeof raw !== 'object') bad(`Line ${n} is invalid.`)
    let poLine: PoRecord['lines'][number] | undefined
    if (raw.poLineId) {
      poLine = ctx.po?.lines.find((l) => l.id === raw.poLineId)
      if (!poLine) bad(`Line ${n}: PO line not found.`, 'po_line_not_found')
    }
    const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim().slice(0, 500) : (poLine?.description ?? '')
    if (!description) bad(`Line ${n}: add a description.`)
    const quantity = Number(raw.quantity)
    const unitPrice = Number(raw.unitPrice)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) bad(`Line ${n}: quantity must be greater than 0.`)
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000) bad(`Line ${n}: unit price must be 0 or more.`)
    const taxId = raw.taxCodeId || poLine?.taxCodeId || profile.defaultTaxCodeId || (ctx.vatNumber.trim() ? standardTaxOf(co).id : 'OOS')
    const tax = taxOf(co, taxId)
    if (!tax || !tax.active) bad(`Line ${n}: unknown or inactive tax code.`, 'invalid_tax_code')
    const dims = dimension(co, n, { ...raw, departmentId: raw.departmentId ?? poLine?.departmentId, projectId: raw.projectId ?? poLine?.projectId, eventId: raw.eventId ?? poLine?.eventId, budgetLineId: raw.budgetLineId ?? poLine?.budgetLineId })
    const accountId = raw.accountId || poLine?.accountId || profile.defaultExpenseAccountId || (dims.eventId ? 'ACC-6450' : CATEGORY_ACCOUNT[vendor?.category ?? 'other'] ?? 'ACC-6550')
    if (!isPurchaseAccount(co, accountId)) bad(`Line ${n}: choose an active expense or asset account.`, 'invalid_account')
    const m = purchaseLine(quantity, unitPrice, tax!.rate)
    return {
      id: typeof raw.id === 'string' && raw.id.startsWith(ownerId) ? raw.id : lineId(ownerId),
      description,
      quantity,
      unitPrice: round2(unitPrice),
      taxCodeId: tax!.id,
      accountId,
      ...dims,
      net: m.net,
      taxAmount: m.taxAmount,
      total: m.total,
      poLineId: poLine?.id ?? null,
      vatRecoverable: isVatRecoverable(ctx.vatNumber, tax!.category) && m.taxAmount > 0,
    }
  })
}

export function applyTotals(doc: { lines: { net: number; taxAmount: number }[]; subtotal: number; taxTotal: number; total: number }): void {
  const t = purchaseTotals(doc.lines)
  doc.subtotal = t.subtotal
  doc.taxTotal = t.taxTotal
  doc.total = t.total
}

/* ---------------- approvals ---------------- */

export const currentStep = (doc: ApprovalState): ApprovalStep | null => (doc.decisions.some((d) => d.decision === 'rejected') ? null : (doc.chain[doc.decisions.length] ?? null))

/** Active users of the company who can act on `step` (role-exact first; admins only as a fallback). */
export function approversOf(co: string, step: ApprovalStep, doc: ApprovalState): User[] {
  const candidates = users.filter((u) => u.companyId === co && u.active && canApproveStep(u as User, step, { companyId: co, requesterId: doc.requesterId, departmentId: doc.departmentId, approvedBy: doc.approvedBy })) as User[]
  if (step.approver === 'department_head') return candidates
  const exact = candidates.filter((u) => u.role === step.approver)
  return exact.length ? exact : candidates
}

export function canActOn(user: User, co: string, doc: ApprovalState & { status: string }): boolean {
  if (doc.status !== 'pending_approval') return false
  const step = currentStep(doc)
  return !!step && canApproveStep(user, step, { companyId: co, requesterId: doc.requesterId, departmentId: doc.departmentId, approvedBy: doc.approvedBy })
}

/** Once-only "approval needed" notification of the current step's approvers. */
export function notifyStep(co: string, doc: ApprovalState & { id: string }, what: string, link: string, at: string): void {
  const step = currentStep(doc)
  if (!step || doc.notifiedSteps.includes(step.index)) return
  doc.notifiedSteps.push(step.index)
  for (const u of approversOf(co, step, doc)) {
    pushNotification({ userId: u.id, companyId: co, type: FINANCE_ALERT_TYPE, title: 'Approval needed', body: what, link, at })
  }
}

export function notifyRequester(co: string, doc: ApprovalState, title: string, body: string, link: string, at: string): void {
  const u = users.find((x) => x.id === doc.requesterId && x.companyId === co && x.active)
  if (u) pushNotification({ userId: u.id, companyId: co, type: FINANCE_ALERT_TYPE, title, body, link, at })
}

/** Freezes the chain for `amountBase`; returns true when nothing needs approving. */
export function startChain(co: string, doc: ApprovalState, type: SpendDocType, amountBase: number): boolean {
  doc.chain = approvalChain(co, type, amountBase)
  doc.decisions = []
  doc.approvedBy = []
  doc.notifiedSteps = []
  return doc.chain.length === 0
}

/* ---------------- purchase orders ---------------- */

/** Quantity of a PO line on non-void bills (optionally excluding one bill). */
export function billedQtyOf(co: string, poId: string, poLineId: string, exceptBillId?: string): number {
  let q = 0
  for (const b of finBills) {
    if (b.companyId !== co || b.poId !== poId || b.status === 'void' || b.status === 'rejected' || b.id === exceptBillId) continue
    for (const l of b.lines) if (l.poLineId === poLineId) q += l.quantity
  }
  return round2(q)
}

export function poBaseTotal(po: Pick<PoRecord, 'total' | 'exchangeRate'>): number {
  return toBase(po.total, po.exchangeRate)
}

/** After a receipt or a bill: received / partially received / closed (fully received and fully billed). */
export function refreshPoStatus(co: string, po: PoRecord, at: string): void {
  if (!['approved', 'partially_received', 'received'].includes(po.status)) return
  const anyReceived = po.lines.some((l) => l.receivedQty > 0)
  const allReceived = po.lines.every((l) => l.receivedQty + 1e-9 >= l.quantity)
  const allBilled = po.lines.every((l) => billedQtyOf(co, po.id, l.id) + 1e-9 >= l.quantity)
  if (allReceived && allBilled) {
    po.status = 'closed'
    po.closedAt = at
    po.history.push(hist(SYSTEM, 'closed', 'Fully received and billed', at))
  } else if (allReceived) po.status = 'received'
  else if (anyReceived) po.status = 'partially_received'
  po.updatedAt = at
}

export function newPoRecord(co: string, f: { id?: string; vendorId: string; requester: Actor & { id: string }; departmentId: string | null; orderDate: string; expectedDate: string | null; currency: string; exchangeRate: number; notes: string; deliveryAddress: string; advancePct?: number | null; lines: unknown; at: string }): Tenant<PoRecord> {
  const id = f.id ?? nextId('purchaseOrder', 'PO')
  const vat = effectiveProfile(co, f.vendorId).vatNumber
  const lines = buildLines(co, id, f.lines, { vendorId: f.vendorId, vatNumber: vat }).map(({ poLineId: _p, vatRecoverable: _v, ...l }) => ({ ...l, receivedQty: 0 })) // eslint-disable-line @typescript-eslint/no-unused-vars
  const po: Tenant<PoRecord> = {
    companyId: co,
    id,
    number: docNumber(co, prefixOf(co), 'PO', f.orderDate.slice(0, 4)),
    status: 'draft',
    vendorId: f.vendorId,
    orderDate: f.orderDate,
    expectedDate: f.expectedDate,
    currency: f.currency,
    exchangeRate: f.exchangeRate,
    lines,
    subtotal: 0,
    taxTotal: 0,
    total: 0,
    notes: f.notes,
    deliveryAddress: f.deliveryAddress,
    rejectionReason: null,
    cancelReason: null,
    advancePct: f.advancePct ?? null,
    receipts: [],
    history: [hist(f.requester, 'created', 'Purchase request created', f.at)],
    createdAt: f.at,
    updatedAt: f.at,
    submittedAt: null,
    approvedAt: null,
    closedAt: null,
    requesterId: f.requester.id,
    departmentId: f.departmentId,
    chain: [],
    decisions: [],
    approvedBy: [],
    notifiedSteps: [],
  }
  applyTotals(po)
  finPurchaseOrders.push(po)
  return po
}

const poWhat = (co: string, po: PoRecord) => `${po.number} · ${vendorName(co, po.vendorId)} · ${po.currency} ${po.total.toFixed(2)}`

export function submitPoCore(co: string, po: PoRecord, by: Actor, at: string): PoRecord {
  if (po.status !== 'draft' && po.status !== 'rejected') conflict('Only a draft or rejected request can be submitted.', 'not_draft')
  if (po.total <= 0) bad('The order total must be greater than 0.', 'zero_total')
  po.rejectionReason = null
  po.submittedAt = at
  po.updatedAt = at
  if (startChain(co, po, 'purchase_order', poBaseTotal(po))) {
    po.status = 'approved'
    po.approvedAt = at
    po.history.push(hist(by, 'approved', 'Submitted; no approval needed for this amount', at))
    notifyAdvanceDue(co, po, at)
    return po
  }
  po.status = 'pending_approval'
  po.history.push(hist(by, 'submitted', `Submitted for approval (${po.chain.length} step${po.chain.length === 1 ? '' : 's'})`, at))
  notifyStep(co, po, `Purchase order ${poWhat(co, po)}`, poPathOf(po.id), at)
  return po
}

export function decideCore(_co: string, doc: ApprovalState & { status: string }, by: Actor & { id: string }, decision: 'approved' | 'rejected', reason: string, at: string): boolean {
  const step = currentStep(doc)!
  doc.decisions.push({ index: step.index, decision, by: by.id, at, reason })
  if (decision === 'approved') doc.approvedBy.push(by.id)
  return decision === 'approved' && doc.decisions.length >= doc.chain.length
}

export function approvePoCore(co: string, po: PoRecord, by: Actor & { id: string }, at: string): PoRecord {
  const done = decideCore(co, po, by, 'approved', '', at)
  po.updatedAt = at
  if (done) {
    po.status = 'approved'
    po.approvedAt = at
    po.history.push(hist(by, 'approved', 'Approved (final step)', at))
    notifyRequester(co, po, 'Purchase order approved', poWhat(co, po), poPathOf(po.id), at)
    notifyAdvanceDue(co, po, at)
  } else {
    po.history.push(hist(by, 'approved_step', `Approved step ${po.decisions.length} of ${po.chain.length}`, at))
    notifyStep(co, po, `Purchase order ${poWhat(co, po)}`, poPathOf(po.id), at)
  }
  return po
}

export function rejectPoCore(co: string, po: PoRecord, by: Actor & { id: string }, reason: string, at: string): PoRecord {
  decideCore(co, po, by, 'rejected', reason, at)
  po.status = 'rejected'
  po.rejectionReason = reason
  po.updatedAt = at
  po.history.push(hist(by, 'rejected', `Rejected: ${reason}`, at))
  notifyRequester(co, po, 'Purchase order rejected', `${poWhat(co, po)} — ${reason}`, poPathOf(po.id), at)
  return po
}

export function receivePoCore(co: string, po: PoRecord, input: { date: string; note: string; lines: { lineId: string; quantity: number }[] }, by: Actor & { id: string }, at: string): PoRecord {
  if (!['approved', 'partially_received'].includes(po.status)) conflict('Goods can be received on an approved order only.', 'not_receivable')
  const lines = input.lines.filter((l) => Number(l.quantity) > 0)
  if (!lines.length) bad('Enter a received quantity on at least one line.', 'nothing_received')
  for (const r of lines) {
    const l = po.lines.find((x) => x.id === r.lineId)
    if (!l) bad('Line not found on this order.', 'po_line_not_found')
    const q = Number(r.quantity)
    if (!Number.isFinite(q) || q <= 0) bad('Received quantities must be greater than 0.')
    if (round2(l!.receivedQty + q) > l!.quantity + 1e-9) bad(`“${l!.description}”: at most ${round2(l!.quantity - l!.receivedQty)} more can be received.`, 'over_received')
  }
  for (const r of lines) {
    const l = po.lines.find((x) => x.id === r.lineId)!
    l.receivedQty = round2(l.receivedQty + Number(r.quantity))
  }
  po.receipts.push({ id: `${po.id}-R${po.receipts.length + 1}`, date: input.date, by: by.id, note: input.note, lines: lines.map((l) => ({ lineId: l.lineId, quantity: round2(Number(l.quantity)) })) })
  po.history.push(hist(by, 'received', `Goods / service receipt on ${input.date} (${lines.length} line${lines.length === 1 ? '' : 's'})`, at))
  refreshPoStatus(co, po, at)
  return po
}

/* ---------------- bills ---------------- */

export function matchOf(co: string, bill: Pick<BillRecord, 'id' | 'poId' | 'lines'>): MatchResult {
  const tolerancePct = finPurchasesSettings.get(co).matchTolerancePct
  const po = bill.poId ? poOf(co, bill.poId) : undefined
  if (!po) return { kind: 'none', ok: true, tolerancePct, issues: [] }
  const threeWay = po.receipts.length > 0
  const issues = bill.lines.flatMap((l) => {
    const pl = l.poLineId ? po.lines.find((x) => x.id === l.poLineId) : undefined
    if (!pl) return [{ lineId: l.id, description: l.description, kind: 'quantity' as const, message: 'Not on the purchase order.' }]
    return matchLine({ lineId: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }, { quantity: pl.quantity, unitPrice: pl.unitPrice, receivedQty: pl.receivedQty, billedElsewhere: billedQtyOf(co, po.id, pl.id, bill.id) }, threeWay, tolerancePct)
  })
  return { kind: threeWay ? 'three_way' : 'two_way', ok: issues.length === 0, tolerancePct, issues }
}

/** Lines of a bill prefilled from a PO: what is received (3-way) or ordered (2-way) and not billed yet. */
export function linesFromPo(co: string, po: PoRecord): BillLineInput[] {
  const threeWay = po.receipts.length > 0
  return po.lines
    .map((l) => ({ l, qty: round2((threeWay ? l.receivedQty : l.quantity) - billedQtyOf(co, po.id, l.id)) }))
    .filter((x) => x.qty > 0)
    .map(({ l, qty }) => ({ poLineId: l.id, description: l.description, quantity: qty, unitPrice: l.unitPrice, taxCodeId: l.taxCodeId, accountId: l.accountId, departmentId: l.departmentId, projectId: l.projectId, eventId: l.eventId, budgetLineId: l.budgetLineId }))
}

export function supplierInvoiceTaken(co: string, vendorId: string, ref: string, exceptId?: string): boolean {
  const k = ref.trim().toLowerCase()
  return finBills.some((b) => b.companyId === co && b.vendorId === vendorId && b.id !== exceptId && b.status !== 'void' && b.supplierInvoiceNumber.trim().toLowerCase() === k)
}

export function newBillRecord(co: string, f: { id?: string; vendorId: string; po: PoRecord | null; supplierInvoiceNumber: string; billDate: string; dueDate: string | null; currency: string; exchangeRate: number; notes: string; lines: unknown; creator: Actor & { id: string }; departmentId: string | null; at: string }): Tenant<BillRecord> {
  const id = f.id ?? nextId('bill', 'BILL')
  const profile = effectiveProfile(co, f.vendorId)
  if (!f.supplierInvoiceNumber) bad('Enter the supplier’s invoice number.', 'supplier_invoice_required')
  if (supplierInvoiceTaken(co, f.vendorId, f.supplierInvoiceNumber)) conflict(`This supplier’s invoice ${f.supplierInvoiceNumber} is already entered.`, 'duplicate_supplier_invoice')
  const termsDays = profile.paymentTermsDays
  const dueDate = f.dueDate ?? addDaysIso(f.billDate, termsDays)
  if (dueDate < f.billDate) bad('The due date can’t be before the bill date.', 'invalid_due_date')
  const bill: Tenant<BillRecord> = {
    companyId: co,
    id,
    number: docNumber(co, prefixOf(co), 'BILL', f.billDate.slice(0, 4)),
    supplierInvoiceNumber: f.supplierInvoiceNumber,
    status: 'draft',
    vendorId: f.vendorId,
    poId: f.po?.id ?? null,
    billDate: f.billDate,
    dueDate,
    termsDays,
    currency: f.currency,
    exchangeRate: f.exchangeRate,
    vendorVatNumber: profile.vatNumber,
    lines: buildLines(co, id, f.lines, { vendorId: f.vendorId, vatNumber: profile.vatNumber, po: f.po }),
    subtotal: 0,
    taxTotal: 0,
    total: 0,
    amountPaid: 0,
    amountCredited: 0,
    balanceDue: 0,
    notes: f.notes,
    journalEntryId: null,
    voidJournalEntryId: null,
    rejectionReason: null,
    voidReason: null,
    attachments: [],
    history: [hist(f.creator, 'created', f.po ? `Draft from purchase order ${f.po.number}` : 'Draft created', f.at)],
    dueSoonNotifiedAt: null,
    createdAt: f.at,
    updatedAt: f.at,
    postedAt: null,
    voidedAt: null,
    requesterId: f.creator.id,
    departmentId: f.departmentId,
    chain: [],
    decisions: [],
    approvedBy: [],
    notifiedSteps: [],
  }
  applyTotals(bill)
  bill.balanceDue = bill.total
  finBills.push(bill)
  return bill
}

function balanceWithRounding(co: string, lines: JournalLine[]): JournalLine[] {
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  const diff = round2(dr - cr)
  if (diff === 0) return lines
  const acc = systemAccount(co, 'rounding')
  return [...lines, diff > 0 ? { accountId: acc, debit: 0, credit: diff, description: 'Currency rounding' } : { accountId: acc, debit: -diff, credit: 0, description: 'Currency rounding' }]
}

export const recoverableTaxOf = (bill: Pick<BillRecord, 'lines'>) => round2(bill.lines.filter((l) => l.vatRecoverable).reduce((s, l) => s + l.taxAmount, 0))
/** A line's cost to the business (net, plus VAT the company can't recover). */
export const lineCost = (l: BillLine) => round2(l.net + (l.vatRecoverable ? 0 : l.taxAmount))

/** The bill's journal lines (base currency). */
export function billPostingLines(co: string, bill: BillRecord): JournalLine[] {
  const r = bill.exchangeRate
  const lines: JournalLine[] = bill.lines.map((l) => ({
    accountId: l.accountId,
    debit: toBase(lineCost(l), r),
    credit: 0,
    description: l.description.slice(0, 120),
    departmentId: l.departmentId,
    projectId: l.projectId,
    eventId: l.eventId,
    taxCode: l.taxCodeId,
  }))
  const vat = recoverableTaxOf(bill)
  if (vat > 0) lines.push({ accountId: systemAccount(co, 'vat_input'), debit: toBase(vat, r), credit: 0, description: 'VAT input', taxCode: bill.lines.find((l) => l.vatRecoverable)?.taxCodeId ?? null })
  lines.push({ accountId: systemAccount(co, 'accounts_payable'), debit: 0, credit: toBase(bill.total, r), description: `Accounts payable · ${vendorName(co, bill.vendorId)}` })
  return balanceWithRounding(co, lines)
}

export function postBillCore(co: string, bill: BillRecord, by: Actor, at: string): BillRecord {
  if (bill.total <= 0) bad('The bill total must be greater than 0.', 'zero_total')
  const entry = postJournal(co, { date: bill.billDate, memo: `Bill ${bill.number} · ${vendorName(co, bill.vendorId)} (${bill.supplierInvoiceNumber})`, sourceType: 'bill', sourceId: bill.id, lines: billPostingLines(co, bill), createdBy: by.id })
  bill.journalEntryId = entry.id
  bill.postedAt = at
  openBill(bill, at)
  bill.history.push(hist(by, 'posted', `Posted (journal ${entry.number})`, at))
  if (bill.poId) {
    const po = poOf(co, bill.poId)
    if (po) refreshPoStatus(co, po, at)
    applyPoAdvances(co, bill, by, at)
  }
  return bill
}

const billWhat = (co: string, b: BillRecord) => `Bill ${b.number} · ${vendorName(co, b.vendorId)} · ${b.currency} ${b.total.toFixed(2)}`

/** Submit: an empty chain posts at once. */
export function submitBillCore(co: string, bill: BillRecord, by: Actor, at: string): BillRecord {
  if (bill.status !== 'draft' && bill.status !== 'rejected') conflict('Only a draft or rejected bill can be submitted.', 'not_draft')
  if (bill.total <= 0) bad('The bill total must be greater than 0.', 'zero_total')
  bill.rejectionReason = null
  bill.updatedAt = at
  if (startChain(co, bill, 'bill', toBase(bill.total, bill.exchangeRate))) {
    bill.history.push(hist(by, 'submitted', 'Submitted; no approval needed for this amount', at))
    return postBillCore(co, bill, by, at)
  }
  bill.status = 'pending_approval'
  bill.history.push(hist(by, 'submitted', `Submitted for approval (${bill.chain.length} step${bill.chain.length === 1 ? '' : 's'})`, at))
  notifyStep(co, bill, billWhat(co, bill), billPathOf(bill.id), at)
  return bill
}

/** Approve a step; the final approval posts the bill (a refused post — e.g. 423 period locked — undoes the decision). */
export function approveBillCore(co: string, bill: BillRecord, by: Actor & { id: string }, at: string): BillRecord {
  const done = decideCore(co, bill, by, 'approved', '', at)
  bill.updatedAt = at
  if (done) {
    try {
      bill.history.push(hist(by, 'approved', 'Approved (final step)', at))
      postBillCore(co, bill, by, at)
    } catch (e) {
      bill.decisions.pop()
      bill.approvedBy.pop()
      bill.history.pop()
      throw e
    }
    notifyRequester(co, bill, 'Bill approved and posted', billWhat(co, bill), billPathOf(bill.id), at)
  } else {
    bill.history.push(hist(by, 'approved_step', `Approved step ${bill.decisions.length} of ${bill.chain.length}`, at))
    notifyStep(co, bill, billWhat(co, bill), billPathOf(bill.id), at)
  }
  return bill
}

export function rejectBillCore(co: string, bill: BillRecord, by: Actor & { id: string }, reason: string, at: string): BillRecord {
  decideCore(co, bill, by, 'rejected', reason, at)
  bill.status = 'rejected'
  bill.rejectionReason = reason
  bill.updatedAt = at
  bill.history.push(hist(by, 'rejected', `Rejected: ${reason}`, at))
  notifyRequester(co, bill, 'Bill rejected', `${billWhat(co, bill)} — ${reason}`, billPathOf(bill.id), at)
  return bill
}

/** "Post" without the approval chain: only for a bill matched to an approved PO without exceptions, or an empty chain. */
export function canDirectPost(co: string, bill: BillRecord): boolean {
  if (bill.status !== 'draft' && bill.status !== 'rejected') return false
  if (approvalChain(co, 'bill', toBase(bill.total, bill.exchangeRate)).length === 0) return true
  if (!bill.poId) return false
  const po = poOf(co, bill.poId)
  return !!po && ['approved', 'partially_received', 'received', 'closed'].includes(po.status) && matchOf(co, bill).ok
}

export function voidBillCore(co: string, bill: BillRecord, by: Actor, reason: string, at: string): BillRecord {
  if (bill.status === 'void') conflict('This bill is already void.', 'already_void')
  if (!isOpenBill(bill.status) && bill.status !== 'paid') conflict('Only a posted bill can be voided; delete a draft instead.', 'not_posted')
  const hasPayments = finBillPayments.some((p) => p.companyId === co && p.status === 'posted' && p.allocations.some((a) => a.billId === bill.id)) || advanceAppliedTo(co, bill.id) > 0
  if (hasPayments || finDebitNotes.some((d) => d.companyId === co && d.billId === bill.id && d.status !== 'void')) conflict('A bill with payments, applied advances or debit notes can’t be voided. Void the payments (and debit notes) first, or raise a debit note.', 'has_settlements')
  if (bill.journalEntryId) {
    const rev = reverseJournal(co, bill.journalEntryId, todayOf(co), `Void of bill ${bill.number}: ${reason}`, by.id)
    bill.voidJournalEntryId = rev.id
  }
  bill.status = 'void'
  bill.balanceDue = 0
  bill.voidReason = reason
  bill.voidedAt = at
  bill.updatedAt = at
  bill.history.push(hist(by, 'voided', `Voided: ${reason}`, at))
  if (bill.poId) {
    const po = poOf(co, bill.poId)
    if (po && po.status === 'closed' && po.closedAt) {
      po.status = 'received'
      po.closedAt = null
      refreshPoStatus(co, po, at)
    }
  }
  return bill
}

/* ---------------- debit notes ---------------- */

export function debitNoteCore(co: string, bill: BillRecord, input: { date: string; reason: string; amount: number; accountId: string | null }, by: Actor, at: string): Tenant<DebitNoteRecord> {
  if (!isOpenBill(bill.status)) conflict('Debit notes are for open bills with a balance.', 'not_open')
  const total = round2(input.amount)
  if (!Number.isFinite(total) || total <= 0) bad('The amount must be greater than 0.', 'invalid_amount')
  if (total > bill.balanceDue + 1e-9) bad(`At most ${bill.balanceDue.toFixed(2)} ${bill.currency} (the bill’s balance) can be credited.`, 'exceeds_balance')
  const accountId = input.accountId ?? bill.lines[0].accountId
  if (!isPurchaseAccount(co, accountId)) bad('Choose an active expense or asset account.', 'invalid_account')
  const share = bill.total > 0 ? total / bill.total : 0
  const taxAmount = round2(recoverableTaxOf(bill) * share)
  const net = round2(total - taxAmount)
  const id = nextId('debitNote', 'DN')
  const r = bill.exchangeRate
  const lines: JournalLine[] = [
    { accountId: systemAccount(co, 'accounts_payable'), debit: toBase(total, r), credit: 0, description: `Accounts payable · ${vendorName(co, bill.vendorId)}` },
    { accountId, debit: 0, credit: toBase(net, r), description: input.reason.slice(0, 120) },
  ]
  if (taxAmount > 0) lines.push({ accountId: systemAccount(co, 'vat_input'), debit: 0, credit: toBase(taxAmount, r), description: 'VAT input reversed' })
  const entry = postJournal(co, { date: input.date, memo: `Debit note for bill ${bill.number}: ${input.reason}`, sourceType: 'bill', sourceId: id, lines: balanceWithRounding(co, lines), createdBy: by.id })
  const dn: Tenant<DebitNoteRecord> = {
    companyId: co,
    id,
    number: docNumber(co, prefixOf(co), 'DN', input.date.slice(0, 4)),
    billId: bill.id,
    vendorId: bill.vendorId,
    date: input.date,
    reason: input.reason,
    currency: bill.currency,
    exchangeRate: r,
    net,
    taxAmount,
    total,
    accountId,
    journalEntryId: entry.id,
    status: 'posted',
    voidReason: null,
    voidedAt: null,
    voidJournalEntryId: null,
    createdBy: by.id,
    createdAt: at,
  }
  entry.memo = `Debit note ${dn.number} for bill ${bill.number}: ${input.reason}`
  finDebitNotes.push(dn)
  applyToBill(bill, { credited: total }, at)
  bill.history.push(hist(by, 'debit_note', `Debit note ${dn.number}: ${total.toFixed(2)} ${bill.currency}`, at))
  return dn
}

/**
 * Void of a debit note (the purchases gap): the debit-note entry is reversed (dated today, or the note's date when that
 * is later) and the credited amount goes back on the bill through `applyToBill` (a paid bill reopens). Not on a void bill.
 */
export function voidDebitNoteCore(co: string, dn: DebitNoteRecord, by: Actor, reason: string, at: string): DebitNoteRecord {
  if (dn.status === 'void') conflict('This debit note is already void.', 'already_void')
  const bill = billOf(co, dn.billId)
  if (!bill || bill.status === 'void') return conflict('The bill of this debit note is void.', 'bill_void')
  if (dn.journalEntryId) {
    const today = todayOf(co)
    const rev = reverseJournal(co, dn.journalEntryId, today < dn.date ? dn.date : today, `Void of debit note ${dn.number}: ${reason}`, by.id)
    dn.voidJournalEntryId = rev.id
  }
  dn.status = 'void'
  dn.voidReason = reason
  dn.voidedAt = at
  applyToBill(bill, { credited: -dn.total }, at)
  bill.history.push(hist(by, 'debit_note_void', `Debit note ${dn.number} voided: ${reason}`, at))
  return dn
}

/* ---------------- payments ---------------- */

export function isPaymentAccount(co: string, id: string, allowed: { id: string }[]): boolean {
  return allowed.some((a) => a.id === id) && !!accountOf(co, id)
}

export function bankChargesAccount(co: string): string {
  return financeAccounts.find((a) => a.companyId === co && a.code === '6800' && a.active && !a.isHeader)?.id ?? systemAccount(co, 'rounding')
}

export function paymentCore(
  co: string,
  input: { vendorId: string; date: string; paymentAccountId: string; method: BillPaymentRecord['method']; reference: string; exchangeRate: number | null; bankCharges: number; allocations: { bill: BillRecord; amount: number }[]; notes: string; runId: string | null },
  by: Actor,
  at: string,
): Tenant<BillPaymentRecord> {
  if (!input.allocations.length) bad('Choose at least one bill to pay.', 'no_allocations')
  const currency = input.allocations[0].bill.currency
  for (const a of input.allocations) {
    if (a.bill.vendorId !== input.vendorId) bad('Every bill of a payment must be from the same supplier.', 'mixed_suppliers')
    if (a.bill.currency !== currency) bad('Every bill of a payment must be in the same currency.', 'mixed_currencies')
    if (!isOpenBill(a.bill.status)) conflict(`Bill ${a.bill.number} isn’t open.`, 'bill_not_open')
    if (!Number.isFinite(a.amount) || a.amount <= 0) bad('Payment amounts must be greater than 0.', 'invalid_amount')
    if (a.amount > a.bill.balanceDue + 1e-9) bad(`At most ${a.bill.balanceDue.toFixed(2)} ${currency} is due on bill ${a.bill.number}.`, 'exceeds_balance')
    if (a.bill.billDate > input.date) bad(`Bill ${a.bill.number} is dated after the payment.`, 'payment_before_bill')
  }
  if (new Set(input.allocations.map((a) => a.bill.id)).size !== input.allocations.length) bad('A bill appears twice.', 'duplicate_bill')
  const rate = currency === baseCurrencyOf(co) ? 1 : rateOrDefault(co, currency, input.exchangeRate, input.date)
  const amount = round2(input.allocations.reduce((s, a) => s + a.amount, 0))
  const apBase = round2(input.allocations.reduce((s, a) => s + toBase(a.amount, a.bill.exchangeRate), 0))
  const bankBase = toBase(amount, rate)
  const fx = round2(apBase - bankBase)
  const charges = round2(input.bankCharges || 0)
  if (charges < 0 || !Number.isFinite(charges)) bad('Bank charges must be 0 or more.', 'invalid_charges')
  const id = nextId('billPayment', 'BPAY')
  const vName = vendorName(co, input.vendorId)
  const lines: JournalLine[] = [
    { accountId: systemAccount(co, 'accounts_payable'), debit: apBase, credit: 0, description: `Accounts payable · ${vName}` },
    { accountId: input.paymentAccountId, debit: 0, credit: bankBase, description: `Payment to ${vName}` },
  ]
  if (fx > 0) lines.push({ accountId: systemAccount(co, 'fx_gain_loss'), debit: 0, credit: fx, description: 'Exchange gain' })
  if (fx < 0) lines.push({ accountId: systemAccount(co, 'fx_gain_loss'), debit: -fx, credit: 0, description: 'Exchange loss' })
  if (charges > 0) {
    lines.push({ accountId: bankChargesAccount(co), debit: charges, credit: 0, description: 'Bank charges' })
    lines.push({ accountId: input.paymentAccountId, debit: 0, credit: charges, description: 'Bank charges' })
  }
  const entry = postJournal(co, { date: input.date, memo: `Payment to ${vName}`, sourceType: 'bill', sourceId: id, lines, createdBy: by.id })
  const p: Tenant<BillPaymentRecord> = {
    companyId: co,
    id,
    number: docNumber(co, prefixOf(co), 'PV', input.date.slice(0, 4)),
    status: 'posted',
    vendorId: input.vendorId,
    date: input.date,
    method: input.method,
    reference: input.reference,
    paymentAccountId: input.paymentAccountId,
    currency,
    exchangeRate: rate,
    amount,
    bankCharges: charges,
    fxDifference: fx,
    runId: input.runId,
    allocations: input.allocations.map((a) => ({ billId: a.bill.id, amount: round2(a.amount) })),
    notes: input.notes,
    journalEntryId: entry.id,
    voidJournalEntryId: null,
    voidReason: null,
    voidedAt: null,
    createdBy: by.id,
    createdAt: at,
  }
  entry.memo = `Payment voucher ${p.number} · ${vName}`
  finBillPayments.push(p)
  for (const a of input.allocations) {
    applyToBill(a.bill, { paid: a.amount }, at)
    a.bill.history.push(hist(by, 'paid', `Payment ${p.number}: ${a.amount.toFixed(2)} ${currency}`, at))
  }
  return p
}

export function voidPaymentCore(co: string, p: BillPaymentRecord, by: Actor, reason: string, at: string): BillPaymentRecord {
  if (p.status === 'void') conflict('This payment is already void.', 'already_void')
  if (p.journalEntryId) {
    const rev = reverseJournal(co, p.journalEntryId, todayOf(co) < p.date ? p.date : todayOf(co), `Void of payment ${p.number}: ${reason}`, by.id)
    p.voidJournalEntryId = rev.id
  }
  p.status = 'void'
  p.voidReason = reason
  p.voidedAt = at
  for (const a of p.allocations) {
    const b = billOf(co, a.billId)
    if (!b) continue
    applyToBill(b, { paid: -a.amount }, at)
    b.history.push(hist(by, 'payment_void', `Payment ${p.number} voided: ${reason}`, at))
  }
  return p
}

export function newRunRecord(co: string, date: string, paymentAccountId: string, by: Actor, at: string): Tenant<PaymentRunRecord> {
  const run: Tenant<PaymentRunRecord> = {
    companyId: co,
    id: nextId('paymentRun', 'PRUN'),
    number: docNumber(co, prefixOf(co), 'PRUN', date.slice(0, 4)),
    date,
    paymentAccountId,
    paymentIds: [],
    bankStatus: 'created',
    exports: [],
    sentAt: null,
    sentBy: null,
    confirmedAt: null,
    confirmedBy: null,
    bankReference: '',
    createdBy: by.id,
    createdAt: at,
  }
  finPaymentRuns.push(run)
  return run
}

/* ---------------- payables: balances as of a date, aging, statement, overview ---------------- */

const postedBill = (b: BillRecord) => isOpenBill(b.status) || b.status === 'paid'

/** Open balance of a bill at the end of `asOf` (bill currency). Void payments / bills are left out. */
export function billBalanceAsOf(co: string, b: BillRecord, asOf: string): number {
  if (!postedBill(b) || b.billDate > asOf) return 0
  if (asOf >= todayOf(co)) return Math.max(0, b.balanceDue)
  const paid = finBillPayments.filter((p) => p.companyId === co && p.status === 'posted' && p.date <= asOf).reduce((s, p) => s + p.allocations.filter((a) => a.billId === b.id).reduce((x, a) => x + a.amount, 0), 0)
  // A void debit note counted until the day it was voided.
  const credited = finDebitNotes.filter((d) => d.companyId === co && d.billId === b.id && d.date <= asOf && (d.status !== 'void' || (d.voidedAt ?? '').slice(0, 10) > asOf)).reduce((s, d) => s + d.total, 0)
  const advanced = advanceAppliedTo(co, b.id, asOf)
  return Math.max(0, round2(b.total - paid - credited - advanced))
}

const zero = (): ApAmounts => ({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 })

export function apAgingOf(co: string, asOf: string) {
  const byVendor = new Map<string, { id: string; number: string; supplierInvoiceNumber: string; dueDate: string; currency: string; balance: number; balanceBase: number; daysOverdue: number; bucket: ApBucket }[]>()
  for (const b of finBills) {
    if (b.companyId !== co) continue
    const balance = billBalanceAsOf(co, b, asOf)
    if (balance <= 0) continue
    const days = daysBetween(b.dueDate, asOf)
    const row = { id: b.id, number: b.number, supplierInvoiceNumber: b.supplierInvoiceNumber, dueDate: b.dueDate, currency: b.currency, balance, balanceBase: toBase(balance, b.exchangeRate), daysOverdue: Math.max(0, days), bucket: apBucketOf(days) }
    byVendor.set(b.vendorId, [...(byVendor.get(b.vendorId) ?? []), row])
  }
  const totals = zero()
  const rows = [...byVendor.entries()].map(([vendorId, bills]) => {
    const a = zero()
    for (const x of bills) {
      a[x.bucket] = round2(a[x.bucket] + x.balanceBase)
      a.total = round2(a.total + x.balanceBase)
    }
    for (const k of [...AP_BUCKETS, 'total'] as const) totals[k] = round2(totals[k] + a[k])
    const advances = unappliedAdvancesBase(co, vendorId, asOf)
    return { vendorId, vendorName: vendorName(co, vendorId), ...a, advances, net: round2(a.total - advances), bills: bills.sort((x, y) => x.dueDate.localeCompare(y.dueDate)) }
  })
  // Suppliers with an unapplied advance and no open bill still show (a debit balance: they owe us goods or money).
  for (const vendorId of new Set(finSupplierAdvances.filter((x) => x.companyId === co).map((x) => x.vendorId))) {
    if (byVendor.has(vendorId)) continue
    const advances = unappliedAdvancesBase(co, vendorId, asOf)
    if (advances > 0) rows.push({ vendorId, vendorName: vendorName(co, vendorId), ...zero(), advances, net: round2(-advances), bills: [] })
  }
  const advancesTotal = round2(rows.reduce((s, r) => s + r.advances, 0))
  rows.sort((x, y) => y.total - x.total || x.vendorName.localeCompare(y.vendorName))
  return { asOf, baseCurrency: baseCurrencyOf(co), rows, totals: { ...totals, advances: advancesTotal, net: round2(totals.total - advancesTotal) } }
}

export function dueBillsOf(co: string, days: number) {
  const today = todayOf(co)
  const until = addDaysIso(today, days)
  return finBills
    .filter((b) => b.companyId === co && isOpenBill(b.status) && b.balanceDue > 0 && b.dueDate <= until)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((b) => ({ id: b.id, number: b.number, supplierInvoiceNumber: b.supplierInvoiceNumber, vendorId: b.vendorId, vendorName: vendorName(co, b.vendorId), dueDate: b.dueDate, currency: b.currency, balanceDue: b.balanceDue, baseBalanceDue: toBase(b.balanceDue, b.exchangeRate), overdue: b.dueDate < today }))
}

/** Supplier statement in base currency (credit = we owe more, debit = paid / credited). Void documents are left out. */
export function statementOf(co: string, vendorId: string, from: string, to: string): Omit<SupplierStatement, 'company' | 'vendorName' | 'vendorVatNumber'> {
  type Ev = { date: string; type: 'bill' | 'payment' | 'debit_note' | 'advance' | 'advance_applied' | 'advance_refund'; reference: string; description: string; debit: number; credit: number }
  const evs: Ev[] = []
  const bills = finBills.filter((b) => b.companyId === co && b.vendorId === vendorId && postedBill(b))
  for (const b of bills) evs.push({ date: b.billDate, type: 'bill', reference: b.number, description: `Supplier invoice ${b.supplierInvoiceNumber}`, debit: 0, credit: toBase(b.total, b.exchangeRate) })
  for (const p of finBillPayments) {
    if (p.companyId !== co || p.vendorId !== vendorId || p.status !== 'posted') continue
    const base = round2(p.allocations.reduce((s, a) => s + toBase(a.amount, billOf(co, a.billId)?.exchangeRate ?? p.exchangeRate), 0))
    evs.push({ date: p.date, type: 'payment', reference: p.number, description: `Payment${p.reference ? ` · ${p.reference}` : ''}`, debit: base, credit: 0 })
  }
  for (const d of finDebitNotes) {
    if (d.companyId !== co || d.vendorId !== vendorId || d.status === 'void') continue
    evs.push({ date: d.date, type: 'debit_note', reference: d.number, description: `Debit note: ${d.reason}`, debit: toBase(d.total, d.exchangeRate), credit: 0 })
  }
  // Advances: the prepayment lowers what we owe (debit); a refund by the supplier raises it again (credit). Applying an
  // advance to a bill moves it from advances to the bill (net 0): listed for the trail with no amount.
  for (const a of finSupplierAdvances) {
    if (a.companyId !== co || a.vendorId !== vendorId) continue
    evs.push({ date: a.date, type: 'advance', reference: a.number, description: `Advance paid${a.reference ? ` · ${a.reference}` : ''}`, debit: toBase(a.amount, a.exchangeRate), credit: 0 })
    for (const x of a.applications) evs.push({ date: x.date, type: 'advance_applied', reference: a.number, description: `Advance applied to bill ${billOf(co, x.billId)?.number ?? x.billId} (${x.amount.toFixed(2)} ${a.currency})`, debit: 0, credit: 0 })
    for (const r of a.refunds) evs.push({ date: r.date, type: 'advance_refund', reference: a.number, description: `Advance refunded by the supplier${r.reference ? ` · ${r.reference}` : ''}`, debit: 0, credit: toBase(r.amount, a.exchangeRate) })
  }
  evs.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'bill' ? -1 : 1))
  let opening = 0
  for (const e of evs) if (e.date < from) opening = round2(opening + e.credit - e.debit)
  let bal = opening
  const lines = evs
    .filter((e) => e.date >= from && e.date <= to)
    .map((e) => {
      bal = round2(bal + e.credit - e.debit)
      return { ...e, balance: bal }
    })
  return { vendorId, from, to, baseCurrency: baseCurrencyOf(co), openingBalance: opening, lines, closingBalance: bal }
}

/** Overview tile data (the ledger overview may read it): open / overdue / due this week, approvals waiting. */
export function payablesOverview(co: string) {
  const today = todayOf(co)
  const week = addDaysIso(today, 7)
  const open = finBills.filter((b) => b.companyId === co && isOpenBill(b.status) && b.balanceDue > 0)
  const sum = (rows: BillRecord[]) => round2(rows.reduce((s, b) => s + toBase(b.balanceDue, b.exchangeRate), 0))
  const overdue = open.filter((b) => isBillOverdue(b, today))
  const dueWeek = open.filter((b) => b.dueDate >= today && b.dueDate <= week)
  return {
    baseCurrency: baseCurrencyOf(co),
    openBase: sum(open),
    openCount: open.length,
    overdueBase: sum(overdue),
    overdueCount: overdue.length,
    dueThisWeekBase: sum(dueWeek),
    dueThisWeekCount: dueWeek.length,
    pendingBillApprovals: finBills.filter((b) => b.companyId === co && b.status === 'pending_approval').length,
    pendingPoApprovals: finPurchaseOrders.filter((p) => p.companyId === co && p.status === 'pending_approval').length,
    openPoCount: finPurchaseOrders.filter((p) => p.companyId === co && ['approved', 'partially_received', 'received'].includes(p.status)).length,
  }
}

/** Open balance per supplier (base) and overdue part. */
export function supplierBalances(co: string): Map<string, { open: number; overdue: number; count: number; last: string | null }> {
  const today = todayOf(co)
  const out = new Map<string, { open: number; overdue: number; count: number; last: string | null }>()
  for (const b of finBills) {
    if (b.companyId !== co || b.status === 'void' || b.status === 'draft' || b.status === 'rejected' || b.status === 'pending_approval') continue
    const row = out.get(b.vendorId) ?? { open: 0, overdue: 0, count: 0, last: null }
    if (b.balanceDue > 0) {
      const base = toBase(b.balanceDue, b.exchangeRate)
      row.open = round2(row.open + base)
      row.count++
      if (isBillOverdue(b, today)) row.overdue = round2(row.overdue + base)
    }
    if (!row.last || b.billDate > row.last) row.last = b.billDate
    out.set(b.vendorId, row)
  }
  return out
}

/* ---------------- event costs (SEAM with Events › budget) ---------------- */

/**
 * SEAM(event-costs): what posted bills charged to an event, per budget line (base currency, cost = net + non-recoverable
 * VAT). Events keep their own `actual` on budget lines (typed by the event team); this is the finance view next to it.
 * The Events budget screen can read it later (GET /finance/event-costs?event_id=) without changing its own data.
 */
export function eventBilledCostsOf(co: string, eventId: string) {
  const { perLine, unlinked } = billedByLine(co, eventId)
  const lines = eventBudgetLines
    .filter((l) => l.companyId === co && l.eventId === eventId)
    .map((l) => ({ budgetLineId: l.id, label: `${l.category}${l.note ? ` · ${l.note}` : ''}`, planned: l.planned, actual: l.actual, billed: perLine.get(l.id)?.billed ?? 0, bills: (perLine.get(l.id)?.bills ?? []).map((b) => ({ id: b.id, number: b.number, amount: b.amount })) }))
  const totalBilled = round2(lines.reduce((s, l) => s + l.billed, 0) + unlinked)
  return { eventId, baseCurrency: baseCurrencyOf(co), lines, unlinkedBilled: unlinked, totalBilled }
}

/* ---------------- due-soon reminders (lifecycle tick) ---------------- */

export function accountingUsers(co: string) {
  return users.filter((u) => u.companyId === co && u.active && scopeOf(u.role, 'accounting') === 'full')
}

/** "Bill due in 3 days": once per bill, to the accountants (accounting full). */
export function runBillDueReminders(co: string, at: string): number {
  const today = todayOf(co)
  const limit = addDaysIso(today, 3)
  let n = 0
  for (const b of finBills) {
    if (b.companyId !== co || !isOpenBill(b.status) || b.balanceDue <= 0 || b.dueSoonNotifiedAt || b.dueDate < today || b.dueDate > limit) continue
    b.dueSoonNotifiedAt = at
    for (const u of accountingUsers(co)) {
      pushNotification({ userId: u.id, companyId: co, type: FINANCE_ALERT_TYPE, title: 'Bill due soon', body: `${b.number} · ${vendorName(co, b.vendorId)} · ${b.currency} ${b.balanceDue.toFixed(2)} due ${b.dueDate}`, link: billPathOf(b.id), at })
    }
    n++
  }
  return n
}

/* ---------------- supplier advances (prepayments) ---------------- */

/**
 * SUPPLIER ADVANCES (docs/API.md › Finance › Supplier advances). Paid before the bill, in the supplier's currency:
 *   advance   Dr 1420 Supplier advances (amount × the advance's rate)        Cr the payment account
 *   apply     Dr AP (amount × the bill's rate)   Cr 1420 (amount × the advance's rate)   ± exchange gain / loss
 *             — the bill's balance moves through `applyToBill({ paid })`, like a payment
 *   refund    Dr the receiving account (amount × the refund's rate)   Cr 1420 (amount × the advance's rate)   ± FX
 * Remaining (unapplied) = amount − applied − refunded. A PO may carry an advance % (e.g. 30 % on approval): the
 * accountants are told when it is approved, the advance paid against it is linked to the PO, and a bill posted from
 * that PO uses the PO's remaining advances automatically.
 */

export const advanceApplied = (a: Pick<SupplierAdvanceRecord, 'applications'>, asOf?: string) => round2(a.applications.filter((x) => !asOf || x.date <= asOf).reduce((s, x) => s + x.amount, 0))
export const advanceRefunded = (a: Pick<SupplierAdvanceRecord, 'refunds'>, asOf?: string) => round2(a.refunds.filter((x) => !asOf || x.date <= asOf).reduce((s, x) => s + x.amount, 0))
/** Unapplied part of an advance (at the end of `asOf`, or now). */
export function advanceRemaining(a: SupplierAdvanceRecord, asOf?: string): number {
  if (asOf && a.date > asOf) return 0
  return Math.max(0, round2(a.amount - advanceApplied(a, asOf) - advanceRefunded(a, asOf)))
}
export const advanceOf = (co: string, id: unknown) => (typeof id === 'string' ? finSupplierAdvances.find((a) => a.companyId === co && a.id === id) : undefined)

/** Advances applied to a bill (bill currency), up to `asOf` when given. */
export function advanceAppliedTo(co: string, billId: string, asOf?: string): number {
  let n = 0
  for (const a of finSupplierAdvances) if (a.companyId === co) for (const x of a.applications) if (x.billId === billId && (!asOf || x.date <= asOf)) n += x.amount
  return round2(n)
}

/** Unapplied advances of a supplier in base currency (at each advance's rate), as of a date. */
export function unappliedAdvancesBase(co: string, vendorId: string, asOf?: string): number {
  return round2(finSupplierAdvances.filter((a) => a.companyId === co && a.vendorId === vendorId).reduce((s, a) => s + toBase(advanceRemaining(a, asOf), a.exchangeRate), 0))
}

function fxLine(co: string, fx: number): JournalLine[] {
  if (fx > 0) return [{ accountId: systemAccount(co, 'fx_gain_loss'), debit: 0, credit: fx, description: 'Exchange gain' }]
  if (fx < 0) return [{ accountId: systemAccount(co, 'fx_gain_loss'), debit: -fx, credit: 0, description: 'Exchange loss' }]
  return []
}

export function advanceCore(
  co: string,
  input: { vendorId: string; poId: string | null; date: string; paymentAccountId: string; method: BillPaymentRecord['method']; reference: string; currency: string; exchangeRate: number; amount: number; notes: string },
  by: Actor,
  at: string,
): Tenant<SupplierAdvanceRecord> {
  const amount = round2(input.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) bad('The advance must be greater than 0.', 'invalid_amount')
  const id = nextId('supplierAdvance', 'ADV')
  const vName = vendorName(co, input.vendorId)
  const base = toBase(amount, input.exchangeRate)
  const entry = postJournal(co, {
    date: input.date,
    memo: `Advance to ${vName}`,
    sourceType: 'bill',
    sourceId: id,
    lines: [
      { accountId: systemAccount(co, 'supplier_advances'), debit: base, credit: 0, description: `Supplier advance · ${vName}` },
      { accountId: input.paymentAccountId, debit: 0, credit: base, description: `Advance paid to ${vName}` },
    ],
    createdBy: by.id,
  })
  const a: Tenant<SupplierAdvanceRecord> = {
    companyId: co,
    id,
    number: docNumber(co, prefixOf(co), 'ADV', input.date.slice(0, 4)),
    vendorId: input.vendorId,
    poId: input.poId,
    date: input.date,
    method: input.method,
    reference: input.reference,
    paymentAccountId: input.paymentAccountId,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    amount,
    applications: [],
    refunds: [],
    notes: input.notes,
    journalEntryId: entry.id,
    createdBy: by.id,
    createdAt: at,
  }
  entry.memo = `Supplier advance ${a.number} · ${vName}`
  finSupplierAdvances.push(a)
  if (input.poId) {
    const po = poOf(co, input.poId)
    po?.history.push(hist(by, 'advance', `Advance ${a.number} paid: ${amount.toFixed(2)} ${a.currency}`, at))
  }
  return a
}

/** Applies (part of) an advance to an open bill of the same supplier and currency. */
export function applyAdvanceCore(co: string, a: SupplierAdvanceRecord, bill: BillRecord, amountIn: number, date: string, by: Actor, at: string): SupplierAdvanceRecord {
  const amount = round2(amountIn)
  if (bill.vendorId !== a.vendorId) bad('The bill is from another supplier.', 'vendor_mismatch')
  if (bill.currency !== a.currency) bad(`The advance is in ${a.currency}; the bill is in ${bill.currency}.`, 'currency_mismatch')
  if (!isOpenBill(bill.status)) conflict(`Bill ${bill.number} isn’t open.`, 'bill_not_open')
  if (!Number.isFinite(amount) || amount <= 0) bad('The amount must be greater than 0.', 'invalid_amount')
  const remaining = advanceRemaining(a)
  if (amount > remaining + 1e-9) bad(`At most ${remaining.toFixed(2)} ${a.currency} of this advance is unapplied.`, 'exceeds_advance')
  if (amount > bill.balanceDue + 1e-9) bad(`At most ${bill.balanceDue.toFixed(2)} ${bill.currency} is due on bill ${bill.number}.`, 'exceeds_balance')
  if (date < a.date || date < bill.billDate) bad('The application date is before the advance or the bill.', 'invalid_date')
  const apBase = toBase(amount, bill.exchangeRate)
  const advBase = toBase(amount, a.exchangeRate)
  const fx = round2(apBase - advBase)
  const vName = vendorName(co, a.vendorId)
  const entry = postJournal(co, {
    date,
    memo: `Advance ${a.number} applied to bill ${bill.number} · ${vName}`,
    sourceType: 'bill',
    sourceId: a.id,
    lines: [
      { accountId: systemAccount(co, 'accounts_payable'), debit: apBase, credit: 0, description: `Accounts payable · ${vName}` },
      { accountId: systemAccount(co, 'supplier_advances'), debit: 0, credit: advBase, description: `Supplier advance ${a.number} applied` },
      ...fxLine(co, fx),
    ],
    createdBy: by.id,
  })
  a.applications.push({ id: `${a.id}-A${a.applications.length + 1}`, billId: bill.id, date, amount, fxDifference: fx, journalEntryId: entry.id, by: by.id, at })
  applyToBill(bill, { paid: amount }, at)
  bill.history.push(hist(by, 'advance_applied', `Advance ${a.number} applied: ${amount.toFixed(2)} ${bill.currency}`, at))
  return a
}

/** The supplier pays (part of) an unapplied advance back. */
export function refundAdvanceCore(co: string, a: SupplierAdvanceRecord, input: { amount: number; date: string; accountId: string; exchangeRate: number; reference: string }, by: Actor, at: string): SupplierAdvanceRecord {
  const amount = round2(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) bad('The amount must be greater than 0.', 'invalid_amount')
  const remaining = advanceRemaining(a)
  if (amount > remaining + 1e-9) bad(`At most ${remaining.toFixed(2)} ${a.currency} of this advance is unapplied.`, 'exceeds_advance')
  if (input.date < a.date) bad('The refund is dated before the advance.', 'invalid_date')
  const inBase = toBase(amount, input.exchangeRate)
  const advBase = toBase(amount, a.exchangeRate)
  const fx = round2(inBase - advBase)
  const vName = vendorName(co, a.vendorId)
  const entry = postJournal(co, {
    date: input.date,
    memo: `Refund of advance ${a.number} · ${vName}`,
    sourceType: 'bill',
    sourceId: a.id,
    lines: [
      { accountId: input.accountId, debit: inBase, credit: 0, description: `Advance refunded by ${vName}` },
      { accountId: systemAccount(co, 'supplier_advances'), debit: 0, credit: advBase, description: `Supplier advance ${a.number} refunded` },
      ...fxLine(co, fx),
    ],
    createdBy: by.id,
  })
  a.refunds.push({ id: `${a.id}-R${a.refunds.length + 1}`, date: input.date, amount, accountId: input.accountId, exchangeRate: input.exchangeRate, fxDifference: fx, reference: input.reference, journalEntryId: entry.id, by: by.id, at })
  return a
}

/** A bill posted from a PO uses the PO's remaining advances (same currency), up to its balance. Never blocks the post. */
export function applyPoAdvances(co: string, bill: BillRecord, by: Actor, at: string): void {
  if (!bill.poId) return
  for (const a of finSupplierAdvances) {
    if (a.companyId !== co || a.poId !== bill.poId || a.currency !== bill.currency || a.vendorId !== bill.vendorId) continue
    const amount = Math.min(advanceRemaining(a), bill.balanceDue)
    if (amount <= 0 || !isOpenBill(bill.status)) continue
    try {
      applyAdvanceCore(co, a, bill, amount, a.date > bill.billDate ? a.date : bill.billDate, by, at)
    } catch {
      /* e.g. a locked period: the accountant applies it by hand */
    }
  }
}

/** PO with an advance %: once approved, the accountants are asked to pay it (once). */
export function notifyAdvanceDue(co: string, po: PoRecord, at: string): void {
  if (!po.advancePct || po.advancePct <= 0) return
  const due = round2((po.total * po.advancePct) / 100)
  for (const u of accountingUsers(co)) {
    pushNotification({ userId: u.id, companyId: co, type: FINANCE_ALERT_TYPE, title: 'Supplier advance due', body: `${po.number} · ${vendorName(co, po.vendorId)} · ${po.advancePct}% advance = ${po.currency} ${due.toFixed(2)}`, link: poPathOf(po.id), at })
  }
}

export const isDate = isIsoDay
