import type { Role, User } from '@/shared/types'
import type { CommissionBasis, CommissionLine, CommissionPlan, CommissionPlanInput, CommissionStatement, CommissionTier, MyCommissions } from '@/modules/finance/commissions/types'
import { clawbackOf, eligibleNet, rateForAchievement, statementTotals } from '@/modules/finance/commissions/calc'
import { completion } from '@/modules/targets/lib'
import { isLocked } from '@/modules/finance/ledger/calc'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { customers, leads, users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { departmentsOf } from '@/shared/mocks/data/departments'
import { financeInvoices, financeJournal } from '@/shared/mocks/data/finance'
import { finPayments } from '@/shared/mocks/data/financeCollections'
import { finCommissionPlans, finCommissionStatements, finCommissionsMeta, type CommissionPlanRecord, type CommissionStatementRecord } from '@/shared/mocks/data/financeCommissions'
import { bankId } from '@/shared/mocks/data/financeBanking'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { eventsEnabledIn } from '@/shared/mocks/selectors/events'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { docNumber, onFinanceAccess, postJournal, runFinanceHooks } from './ledger'
import { financeSettingsOf } from './financeLedger'
import { accountantIds, addDays, baseCurrencyOf, notify, prefixOf, todayOf } from './financeCollectionsCore'
import { ensureCollectionsSeed } from './financeCollections'
import { upsertSystemAdjustment } from './hrPayroll'
import { rowFor } from './targets'

/**
 * Accounts & finance › Sales commissions (docs/API.md › Finance › Commissions).
 *
 * WHO
 *   plans        read: accounting full + Sales Manager; write: Company Admin, Management, Accountant (accounting full)
 *   statements   accounting full: all; Sales Manager / Department Head: their team (manager chain + departments they
 *                head) and their own; everyone else: their own only (GET /finance/commissions/mine — Sales Agents have
 *                accounting hidden but reach their own statements). Others' statements answer 404.
 *   generate     accounting full. Approve: step 1 Sales Manager (Company Admin / Management stand in), step 2 Accountant
 *                (Company Admin / Management stand in); two different users, never the rep (maker–checker).
 * Plan gate: `/finance/*` → `accounting`.
 */

const LINK = '/finance/commissions'
const MY_LINK = '/sales/my-commissions'
const STEP_MANAGER: Role[] = ['Sales Manager', 'Company Admin', 'Management']
const STEP_ACCOUNTANT: Role[] = ['Accountant', 'Company Admin', 'Management']
const PLAN_ROLES: Role[] = ['Company Admin', 'Management', 'Accountant']

const bad = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 422, code, details)
}
const conflict = (message: string, code: string): never => {
  throw new CodedApiError(message, 409, code)
}
const forbidden = (message: string): never => {
  throw new CodedApiError(message, 403, 'forbidden')
}
const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}
const nameOf = (co: string, id: string | null) => (id ? (users.find((u) => u.companyId === co && u.id === id)?.name ?? 'Former user') : 'System')
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
}
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7)
}
const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7)
}

function isFull(user: User): boolean {
  return scopeOf(user.role, 'accounting') === 'full'
}

/* ---------------- plans ---------------- */

function planView(co: string, p: Tenant<CommissionPlanRecord>): CommissionPlan {
  return {
    id: p.id,
    name: p.name,
    basis: p.basis,
    rate: p.rate,
    tiers: p.tiers.map((t) => ({ ...t })),
    capPerMonth: p.capPerMonth,
    clawback: p.clawback,
    roles: [...p.roles],
    userIds: [...p.userIds],
    userNames: p.userIds.map((id) => nameOf(co, id)),
    effectiveFrom: p.effectiveFrom,
    active: p.active,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

function planReader(user: User): string {
  if (!isFull(user) && user.role !== 'Sales Manager') forbidden('Commission plans are for finance and sales managers.')
  runFinanceHooks(tenantOf(user))
  return tenantOf(user)
}
function planWriter(user: User): string {
  if (!PLAN_ROLES.includes(user.role)) forbidden('Only Company Admins, Management and Accountants manage commission plans.')
  return tenantOf(user)
}

const ROLES: Role[] = ['Company Admin', 'Management', 'Sales Manager', 'Sales Agent', 'Marketing Manager', 'Accountant', 'HR Manager', 'Department Head', 'Employee']

function cleanPlan(co: string, i: CommissionPlanInput, base: Partial<CommissionPlanRecord> = {}): Omit<CommissionPlanRecord, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'> {
  const name = typeof i.name === 'string' ? i.name.trim().slice(0, 120) : (base.name ?? '')
  if (!name) bad('Name the plan.', 'validation_failed', { field: 'name' })
  const basis = (i.basis ?? base.basis ?? 'collected_revenue') as CommissionBasis
  if (basis !== 'collected_revenue' && basis !== 'won_deals') bad('The basis is collected revenue or won deal value.', 'validation_failed', { field: 'basis' })
  const pct = (v: unknown, field: string) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 100) bad('Rates are 0–100 %.', 'validation_failed', { field })
    return Math.round(n * 100) / 100
  }
  const rate = i.rate !== undefined ? pct(i.rate, 'rate') : (base.rate ?? 0)
  let tiers: CommissionTier[] = base.tiers ?? []
  if (i.tiers !== undefined) {
    if (!Array.isArray(i.tiers) || i.tiers.length > 10) bad('Up to 10 tiers.', 'validation_failed', { field: 'tiers' })
    tiers = i.tiers.map((t) => {
      const min = Number(t?.minAchievement)
      if (!Number.isFinite(min) || min < 0 || min > 1000) bad('A tier starts at an achievement of 0–1000 %.', 'validation_failed', { field: 'tiers' })
      return { minAchievement: Math.round(min), rate: pct(t?.rate, 'tiers') }
    })
    if (new Set(tiers.map((t) => t.minAchievement)).size !== tiers.length) bad('Two tiers start at the same achievement.', 'validation_failed', { field: 'tiers' })
    tiers.sort((a, b) => a.minAchievement - b.minAchievement)
  }
  let capPerMonth = base.capPerMonth ?? null
  if (i.capPerMonth !== undefined) {
    if (i.capPerMonth === null || (i.capPerMonth as unknown) === '') capPerMonth = null
    else {
      const n = Number(i.capPerMonth)
      if (!Number.isFinite(n) || n <= 0 || n > 1e9) bad('The cap must be a positive amount (or empty).', 'validation_failed', { field: 'cap_per_month' })
      capPerMonth = Math.round(n * 100) / 100
    }
  }
  let roles = base.roles ?? []
  if (i.roles !== undefined) {
    if (!Array.isArray(i.roles) || i.roles.some((r) => !ROLES.includes(r))) bad('Unknown role.', 'validation_failed', { field: 'roles' })
    roles = [...new Set(i.roles)]
  }
  let userIds = base.userIds ?? []
  if (i.userIds !== undefined) {
    if (!Array.isArray(i.userIds)) bad('Users are a list of user ids.', 'validation_failed', { field: 'user_ids' })
    for (const id of i.userIds) if (!users.some((u) => u.companyId === co && u.id === id)) bad('Unknown user.', 'invalid_user', { field: 'user_ids' })
    userIds = [...new Set(i.userIds)]
  }
  if (!roles.length && !userIds.length) bad('Choose who earns: roles and / or users.', 'validation_failed', { field: 'roles' })
  const effectiveFrom = i.effectiveFrom ?? base.effectiveFrom ?? todayOf(co).slice(0, 7)
  if (!MONTH_RE.test(effectiveFrom)) bad('Effective from is a month (yyyy-MM).', 'validation_failed', { field: 'effective_from' })
  return { name, basis, rate, tiers, capPerMonth, clawback: i.clawback !== undefined ? i.clawback === true : (base.clawback ?? true), roles, userIds, effectiveFrom, active: i.active !== undefined ? i.active !== false : (base.active ?? true) }
}

/** GET /finance/commission-plans */
export function listPlans(user: User): CommissionPlan[] {
  const co = planReader(user)
  return finCommissionPlans.filter((p) => p.companyId === co).map((p) => planView(co, p))
}
/** POST /finance/commission-plans */
export function createPlan(user: User, input: CommissionPlanInput | null): CommissionPlan {
  const co = planWriter(user)
  const at = nowIso()
  const p: Tenant<CommissionPlanRecord> = { companyId: co, id: bankId(co, 'commissionPlan', 'CPL'), ...cleanPlan(co, input ?? {}), createdAt: at, createdBy: user.id, updatedAt: at }
  finCommissionPlans.push(p)
  recordAudit(user, { action: 'create', entity: 'commission_plan', entityId: p.id, summary: `Added commission plan ${p.name}` })
  return planView(co, p)
}
/** PATCH /finance/commission-plans/:id */
export function updatePlan(user: User, id: string, input: CommissionPlanInput | null): CommissionPlan {
  if (!PLAN_ROLES.includes(user.role)) {
    planReader(user)
    if (!finCommissionPlans.find((p) => p.companyId === tenantOf(user) && p.id === id)) notFound()
  }
  const co = planWriter(user)
  const p = finCommissionPlans.find((x) => x.companyId === co && x.id === id) ?? notFound()
  Object.assign(p, cleanPlan(co, input ?? {}, p), { updatedAt: nowIso() })
  recordAudit(user, { action: 'update', entity: 'commission_plan', entityId: p.id, summary: `Changed commission plan ${p.name}` })
  return planView(co, p)
}

/** The active plan that applies to a user in a month (named users first, then roles; oldest plan wins). */
export function planFor(co: string, u: User, month: string): Tenant<CommissionPlanRecord> | undefined {
  const live = finCommissionPlans.filter((p) => p.companyId === co && p.active && p.effectiveFrom <= month).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return live.find((p) => p.userIds.includes(u.id)) ?? live.find((p) => p.roles.includes(u.role))
}

/* ---------------- calculation ---------------- */

/** Invoice net before VAT (lines' net; the subtotal less discounts when it has no lines). */
const invoiceNet = (inv: { lines: { net: number }[]; total: number; taxTotal: number }) =>
  Math.round((inv.lines.length ? inv.lines.reduce((s, l) => s + l.net, 0) : inv.total - inv.taxTotal) * 100) / 100

/** Date an invoice became fully paid: its latest active allocation. */
function paidDateOf(co: string, invoiceId: string): string | null {
  let last: string | null = null
  for (const p of finPayments) {
    if (p.companyId !== co || p.status === 'void') continue
    for (const a of p.allocations) if (a.invoiceId === invoiceId && !a.reversedOn && (!last || a.date > last)) last = a.date
  }
  return last
}

/** Sales-target completion (%) of the month (targets: services/targets.ts rowFor). */
export function achievementOf(co: string, u: User, month: string): number {
  const [y, m] = month.split('-').map(Number)
  const row = rowFor(u, new Date(y, m - 1, 1))
  return Math.round(completion(row.values, row.actuals, eventsEnabledIn(co)) * 10) / 10
}

/** The earning and clawback lines of a rep's month (invoices / deals already on another statement are left out). */
export function calculate(co: string, u: User, month: string, plan: CommissionPlanRecord, achievement: number, excludeStatementId: string | null = null) {
  const rate = rateForAchievement(plan.rate, plan.tiers, achievement)
  const others = finCommissionStatements.filter((s) => s.companyId === co && s.userId === u.id && s.id !== excludeStatementId && s.status !== 'rejected')
  const done = new Set(others.flatMap((s) => s.lines.filter((l) => l.kind !== 'clawback').map((l) => `${l.kind}:${l.refId}`)))
  const lines: CommissionLine[] = []
  const ownCustomers = new Map(customers.filter((c) => c.companyId === co && c.ownerId === u.id).map((c) => [c.id, c]))
  if (plan.basis === 'collected_revenue') {
    for (const inv of financeInvoices) {
      if (inv.companyId !== co || inv.status !== 'paid' || !ownCustomers.has(inv.customerId) || done.has(`invoice:${inv.id}`)) continue
      const paid = paidDateOf(co, inv.id)
      if (!paid || paid.slice(0, 7) !== month) continue
      const net = Math.round(eligibleNet({ status: inv.status, total: inv.total, amountCredited: inv.amountCredited, net: invoiceNet(inv) }) * (inv.exchangeRate || 1) * 100) / 100
      if (net <= 0) continue
      lines.push({ kind: 'invoice', refId: inv.id, refNumber: inv.number, customerName: ownCustomers.get(inv.customerId)!.name, date: paid, baseAmount: net, rate, commission: Math.round(net * rate) / 100, note: inv.amountCredited > 0 ? 'Net of credit notes' : '' })
    }
  } else {
    for (const l of leads) {
      if (l.companyId !== co || l.ownerId !== u.id || !l.wonAt || l.wonAt.slice(0, 7) !== month || done.has(`deal:${l.id}`) || !(l.value > 0)) continue
      lines.push({ kind: 'deal', refId: l.id, refNumber: l.id, customerName: l.company, date: l.wonAt.slice(0, 10), baseAmount: l.value, rate, commission: Math.round(l.value * rate) / 100, note: '' })
    }
  }
  if (plan.clawback) {
    const approved = others.filter((s) => s.status === 'approved')
    for (const s of approved) {
      for (const l of s.lines) {
        if (l.kind !== 'invoice') continue
        const inv = financeInvoices.find((i) => i.companyId === co && i.id === l.refId)
        const now = inv ? Math.round(eligibleNet({ status: inv.status, total: inv.total, amountCredited: inv.amountCredited, net: invoiceNet(inv) }) * (inv.exchangeRate || 1) * 100) / 100 : 0
        const clawed = finCommissionStatements
          .filter((x) => x.companyId === co && x.userId === u.id && x.status !== 'rejected' && x.id !== excludeStatementId)
          .flatMap((x) => x.lines)
          .filter((x) => x.kind === 'clawback' && x.refId === l.refId)
          .reduce((t, x) => t + x.commission, 0)
        // A capped statement paid less than rate × base: claw back in proportion.
        const paidShare = s.baseTotal > 0 ? Math.min(1, s.gross / ((s.baseTotal * s.rate) / 100 || 1)) : 1
        const amount = clawbackOf(Math.round(l.commission * paidShare * 100) / 100, l.rate * paidShare, now, clawed)
        if (amount > 0) lines.push({ kind: 'clawback', refId: l.refId, refNumber: l.refNumber, customerName: l.customerName, date: monthEnd(month), baseAmount: Math.round((l.baseAmount - now) * 100) / 100, rate: l.rate, commission: amount, note: inv?.status === 'paid' ? 'Credited after the commission was paid' : 'No longer paid (refunded / voided)' })
      }
    }
  }
  return { rate, lines, ...statementTotals(lines, rate, plan.capPerMonth) }
}

/* ---------------- statements ---------------- */

function visibleIds(user: User): Set<string> | 'all' {
  const co = tenantOf(user)
  runFinanceHooks(co)
  if (isFull(user)) return 'all'
  const people = users.filter((u) => u.companyId === co)
  if (user.role === 'Sales Manager' || user.role === 'Department Head') {
    if (user.role === 'Sales Manager' && scopeOf(user.role, 'sales') === 'full') {
      // Their team: the reps reporting to them (and departments they head), plus every sales agent (sales scope full).
      return new Set([...teamIdsFor(user, people, departmentsOf(co)), ...people.filter((u) => u.role === 'Sales Agent').map((u) => u.id)])
    }
    return new Set(teamIdsFor(user, people, departmentsOf(co)))
  }
  return new Set([user.id])
}

function stepOf(s: CommissionStatementRecord): 'sales_manager' | 'accountant' | null {
  return s.status === 'pending_manager' ? 'sales_manager' : s.status === 'pending_accountant' ? 'accountant' : null
}
function approveBlock(user: User, s: CommissionStatementRecord): string | null {
  const step = stepOf(s)
  if (!step) return s.status === 'approved' ? 'Already approved.' : 'Rejected.'
  if (user.id === s.userId) return 'You can’t approve your own commission.'
  if (s.approvals.some((a) => a.userId === user.id)) return 'Maker–checker: another user approves the second step.'
  const roles = step === 'sales_manager' ? STEP_MANAGER : STEP_ACCOUNTANT
  if (!roles.includes(user.role)) return step === 'sales_manager' ? 'Waiting for a Sales Manager.' : 'Waiting for an Accountant.'
  return null
}

function statementView(user: User, co: string, s: Tenant<CommissionStatementRecord>): CommissionStatement {
  const plan = finCommissionPlans.find((p) => p.companyId === co && p.id === s.planId)
  const block = approveBlock(user, s)
  const showJournal = scopeOf(user.role, 'accounting') !== 'hidden'
  return {
    id: s.id,
    number: s.number,
    userId: s.userId,
    userName: nameOf(co, s.userId),
    month: s.month,
    planId: s.planId,
    planName: plan?.name ?? '—',
    basis: s.basis,
    currency: s.currency,
    achievement: s.achievement,
    rate: s.rate,
    baseTotal: s.baseTotal,
    gross: s.gross,
    capped: s.capped,
    clawback: s.clawback,
    total: s.total,
    status: s.status,
    lines: s.lines.map((l) => ({ ...l })),
    approvals: s.approvals.map((a) => ({ ...a, userName: nameOf(co, a.userId) })),
    rejectedReason: s.rejectedReason,
    journalEntryId: showJournal ? s.journalEntryId : null,
    journalNumber: showJournal && s.journalEntryId ? (financeJournal.find((e) => e.companyId === co && e.id === s.journalEntryId)?.number ?? null) : null,
    payrollAdjustmentId: s.payrollAdjustmentId,
    payrollMonth: s.payrollMonth,
    payrollNote: s.payrollNote,
    canApprove: block === null,
    approveBlockedReason: stepOf(s) ? block : null,
    createdAt: s.createdAt,
  }
}

function ownStatement(user: User, id: string): Tenant<CommissionStatementRecord> {
  const co = tenantOf(user)
  const s = finCommissionStatements.find((x) => x.companyId === co && x.id === id)
  const vis = visibleIds(user)
  if (!s || (vis !== 'all' && !vis.has(s.userId))) return notFound()
  return s
}

/** GET /finance/commission-statements?month=&user_id=&status= */
export function listStatements(user: User, q: { month?: string | null; userId?: string | null; status?: string | null } = {}): CommissionStatement[] {
  const co = tenantOf(user)
  const vis = visibleIds(user)
  return finCommissionStatements
    .filter((s) => s.companyId === co && (vis === 'all' || vis.has(s.userId)))
    .filter((s) => (!q.month || s.month === q.month) && (!q.userId || s.userId === q.userId) && (!q.status || s.status === q.status))
    .sort((a, b) => b.month.localeCompare(a.month) || nameOf(co, a.userId).localeCompare(nameOf(co, b.userId)))
    .map((s) => statementView(user, co, s))
}

/** GET /finance/commission-statements/:id */
export function getStatement(user: User, id: string): CommissionStatement {
  return statementView(user, tenantOf(user), ownStatement(user, id))
}

/** GET /finance/commissions/mine — the caller's own statements and plan (any role, Sales Agents included). */
export function myCommissions(user: User): MyCommissions {
  const co = tenantOf(user)
  runFinanceHooks(co)
  const plan = planFor(co, user, todayOf(co).slice(0, 7))
  return {
    plan: plan ? planView(co, plan) : null,
    statements: finCommissionStatements.filter((s) => s.companyId === co && s.userId === user.id).sort((a, b) => b.month.localeCompare(a.month)).map((s) => statementView(user, co, s)),
  }
}

function notifyStep(co: string, s: Tenant<CommissionStatementRecord>): void {
  const step = stepOf(s)
  if (!step) return
  const mark = `awaiting:${step}`
  if (s.alertMarks.includes(mark)) return
  s.alertMarks.push(mark)
  const active = users.filter((u) => u.companyId === co && u.active !== false && u.id !== s.userId && !s.approvals.some((a) => a.userId === u.id))
  let ids: string[]
  if (step === 'sales_manager') {
    const sm = active.filter((u) => u.role === 'Sales Manager')
    ids = (sm.length ? sm : active.filter((u) => u.role === 'Company Admin' || u.role === 'Management')).map((u) => u.id)
  } else {
    ids = accountantIds(co).filter((id) => active.some((u) => u.id === id))
  }
  notify(co, ids, `Commission statement ${s.number} awaits your approval`, `${nameOf(co, s.userId)} · ${s.month} · ${s.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${s.currency}`, `${LINK}?statement=${encodeURIComponent(s.id)}`)
}

/** Creates or refreshes a rep's statement for a month (pending ones without approvals are recalculated). */
export function generateFor(co: string, by: string | null, u: User, month: string, opts: { includeEmpty?: boolean } = {}): Tenant<CommissionStatementRecord> | null {
  const plan = planFor(co, u, month)
  if (!plan) return null
  const existing = finCommissionStatements.find((s) => s.companyId === co && s.userId === u.id && s.month === month && s.status !== 'rejected')
  if (existing && (existing.status !== 'pending_manager' || existing.approvals.length)) return existing
  const achievement = plan.tiers.length ? achievementOf(co, u, month) : 0
  const c = calculate(co, u, month, plan, achievement, existing?.id ?? null)
  if (!existing && !c.lines.length && !opts.includeEmpty) return null
  const fields = { planId: plan.id, basis: plan.basis, achievement, rate: c.rate, baseTotal: c.baseTotal, gross: c.gross, capped: c.capped, clawback: c.clawback, total: c.total, lines: c.lines }
  if (existing) {
    Object.assign(existing, fields)
    return existing
  }
  const s: Tenant<CommissionStatementRecord> = {
    companyId: co,
    id: bankId(co, 'commissionStatement', 'CST'),
    number: docNumber(co, prefixOf(co), 'COM', month.slice(0, 4)),
    userId: u.id,
    month,
    currency: baseCurrencyOf(co),
    ...fields,
    status: 'pending_manager',
    approvals: [],
    rejectedReason: null,
    journalEntryId: null,
    payrollAdjustmentId: null,
    payrollMonth: null,
    payrollNote: null,
    alertMarks: [],
    createdAt: nowIso(),
    createdBy: by,
  }
  finCommissionStatements.push(s)
  notifyStep(co, s)
  return s
}

/** POST /finance/commission-statements/generate `{ month }` (accounting full): one statement per rep with a plan. */
export function generateStatements(user: User, input: { month?: unknown } | null): CommissionStatement[] {
  if (!isFull(user)) forbidden('Only Company Admins, Management and Accountants generate commission statements.')
  const co = tenantOf(user)
  runFinanceHooks(co)
  const month = typeof input?.month === 'string' && MONTH_RE.test(input.month) ? input.month : prevMonth(todayOf(co).slice(0, 7))
  if (month > todayOf(co).slice(0, 7)) bad('Statements are for the current or a past month.', 'validation_failed', { field: 'month' })
  const out: Tenant<CommissionStatementRecord>[] = []
  for (const u of users) {
    if (u.companyId !== co || u.active === false) continue
    const s = generateFor(co, user.id, u, month)
    if (s) out.push(s)
  }
  recordAudit(user, { action: 'create', entity: 'commission_statement', entityId: month, summary: `Generated the commission statements of ${month}` })
  return out.map((s) => statementView(user, co, s))
}

/** On the final approval: the ledger entry and the payroll adjustment (each once per statement). */
function postApproved(co: string, s: Tenant<CommissionStatementRecord>, by: string): void {
  if (!s.journalEntryId && s.total !== 0) {
    const lock = financeSettingsOf(co).lockDate
    const today = todayOf(co)
    let date = monthEnd(s.month) > today ? today : monthEnd(s.month)
    if (isLocked(lock, date)) date = addDays(lock!, 1) > today ? addDays(lock!, 1) : today
    const amt = Math.abs(s.total)
    const pos = s.total > 0
    const e = postJournal(co, {
      date,
      memo: `Sales commission ${s.number} — ${nameOf(co, s.userId)} (${s.month})`,
      sourceType: 'payroll',
      sourceId: s.id,
      lines: [
        { accountId: 'ACC-6150', debit: pos ? amt : 0, credit: pos ? 0 : amt, description: pos ? 'Sales commission' : 'Commission clawback' },
        { accountId: 'ACC-2400', debit: pos ? 0 : amt, credit: pos ? amt : 0, description: `Commission payable — ${nameOf(co, s.userId)}` },
      ],
      createdBy: by,
    })
    s.journalEntryId = e.id
  }
  if (!s.payrollAdjustmentId && s.total !== 0) {
    const emp = hrEmployees.find((e) => e.companyId === co && e.userId === s.userId)
    if (!emp) {
      s.payrollNote = 'Not on payroll (no employee record): pay it outside payroll.'
      return
    }
    const openRun = hrPayrollRuns.filter((r) => r.companyId === co && r.status !== 'paid').sort((a, b) => a.month.localeCompare(b.month))[0]
    const month = openRun && openRun.month > s.month ? openRun.month : nextMonth(s.month)
    const a = upsertSystemAdjustment(
      co,
      { employeeId: emp.id, kind: s.total > 0 ? 'commission' : 'deduction', label: s.total > 0 ? `Commission ${s.month}` : `Commission clawback ${s.month}`, amount: Math.abs(s.total), month, notes: `Statement ${s.number}`, sourceRef: `commission:${s.id}` },
      by,
    )
    s.payrollAdjustmentId = a.id
    s.payrollMonth = a.month
    s.payrollNote = null
  }
}

/** POST /finance/commission-statements/:id/approve — the current step (Sales Manager, then Accountant). */
export function approveStatement(user: User, id: string): CommissionStatement {
  const co = tenantOf(user)
  const s = ownStatement(user, id)
  const block = approveBlock(user, s)
  if (!stepOf(s)) conflict(block ?? 'Nothing to approve.', 'not_pending')
  if (block) throw new CodedApiError(block, 403, user.id === s.userId ? 'own_request' : 'not_your_step')
  const step = stepOf(s)!
  s.approvals.push({ step, userId: user.id, at: nowIso() })
  if (step === 'sales_manager') {
    s.status = 'pending_accountant'
    notifyStep(co, s)
  } else {
    s.status = 'approved'
    postApproved(co, s, user.id)
    if (!s.alertMarks.includes('approved')) {
      s.alertMarks.push('approved')
      notify(co, [s.userId], `Your commission for ${s.month} is approved`, `${s.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${s.currency}${s.payrollMonth ? ` · paid with the ${s.payrollMonth} payroll` : ''}`, MY_LINK)
    }
  }
  recordAudit(user, { action: 'update', entity: 'commission_statement', entityId: s.id, summary: `Approved commission statement ${s.number} (${step === 'sales_manager' ? 'sales manager' : 'accountant'})` })
  return statementView(user, co, s)
}

/** POST /finance/commission-statements/:id/reject `{ reason }` — whoever may approve the current step. */
export function rejectStatement(user: User, id: string, input: { reason?: unknown } | null): CommissionStatement {
  const co = tenantOf(user)
  const s = ownStatement(user, id)
  if (!stepOf(s)) conflict('Only a pending statement can be rejected.', 'not_pending')
  const block = approveBlock(user, s)
  if (block) throw new CodedApiError(block, 403, 'not_your_step')
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 500) : ''
  if (!reason) bad('Say why it is rejected.', 'validation_failed', { field: 'reason' })
  s.status = 'rejected'
  s.rejectedReason = reason
  recordAudit(user, { action: 'update', entity: 'commission_statement', entityId: s.id, summary: `Rejected commission statement ${s.number}` })
  return statementView(user, co, s)
}

/* ---------------- seed ---------------- */

const SEED: Record<string, Omit<CommissionPlanRecord, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>> = {
  co_apex: { name: 'Account executives 2026', basis: 'collected_revenue', rate: 3, tiers: [{ minAchievement: 80, rate: 4 }, { minAchievement: 100, rate: 5 }], capPerMonth: 15000, clawback: true, roles: ['Sales Agent'], userIds: [], effectiveFrom: '2026-01', active: true },
  co_crest: { name: 'Logistics sales 2026', basis: 'won_deals', rate: 2, tiers: [{ minAchievement: 90, rate: 3 }], capPerMonth: 20000, clawback: false, roles: ['Sales Agent'], userIds: [], effectiveFrom: '2026-01', active: true },
}
const APPROVERS: Record<string, [string, string]> = { co_apex: ['u3', 'u8'], co_crest: ['u103', 'u102'] }

/** A plan per company and last month's statements: the first approved (posted, pushed to payroll), the others pending. */
export function ensureCommissionsSeed(co: string): void {
  if (finCommissionsMeta.seeded.includes(co)) return
  finCommissionsMeta.seeded.push(co)
  const plan = SEED[co]
  if (!plan) return
  ensureCollectionsSeed(co)
  const at = '2026-01-05T08:00:00.000Z'
  finCommissionPlans.push({ companyId: co, id: bankId(co, 'commissionPlan', 'CPL'), ...plan, tiers: plan.tiers.map((t) => ({ ...t })), createdAt: at, createdBy: co === 'co_apex' ? 'u8' : 'u101', updatedAt: at })
  const month = prevMonth(todayOf(co).slice(0, 7))
  const reps = users.filter((u) => u.companyId === co && u.active !== false && u.role === 'Sales Agent')
  // Every rep has last month's statement for the demo, even with nothing collected.
  const made = reps.map((u) => generateFor(co, null, u, month, { includeEmpty: true })).filter((s): s is Tenant<CommissionStatementRecord> => !!s)
  const first = made.sort((a, b) => b.total - a.total)[0]
  if (!first) return
  const [mgr, acc] = APPROVERS[co]
  first.approvals.push({ step: 'sales_manager', userId: mgr, at: `${addDays(monthEnd(month), 2)}T09:00:00.000Z` })
  first.approvals.push({ step: 'accountant', userId: acc, at: `${addDays(monthEnd(month), 3)}T11:00:00.000Z` })
  first.status = 'approved'
  first.alertMarks.push('awaiting:accountant', 'approved')
  try {
    postApproved(co, first, acc)
  } catch {
    /* the ledger refused (locked / no chart): stays approved without the entry */
  }
}

onFinanceAccess('commissions-seed', (co) => {
  try {
    ensureCommissionsSeed(co)
  } catch (e) {
    console.error('[commissions] finance hook failed', e)
  }
})
