import type { User } from '@/shared/types'
import type { JournalLine } from '@/modules/finance/types'
import type { PayrollPosting, PayrollPostingStatus } from '@/modules/finance/banking/types'
import { isLocked } from '@/modules/finance/ledger/calc'
import { ApiError } from '@/shared/lib/apiError'
import { nowIso } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { finPayrollPostings, finBankingMeta, type PayrollPostingRecord } from '@/shared/mocks/data/financeBanking'
import { hrFinalSettlements, hrPayAdjustments, hrPayLoans, hrPayrollRuns, type PayrollRunRecord, type SettlementRecord } from '@/shared/mocks/data/hrPayroll'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { onFinanceAccess, postJournal, reverseJournal, round2, systemAccount } from './ledger'
import { financeAccessOf, financeSettingsOf, registerJournalSource } from './financeLedger'
import { paymentAccountsOf } from './financeApprovals'
import { onPayrollEvent } from './hrPayroll'

/**
 * Accounts & finance › Payroll posting (docs/API.md › Finance › Payroll posting). HR payroll lands in the ledger
 * without anyone re-keying it:
 *
 *   run APPROVED (accrual, dated the period end)   Dr 6100 salaries (basic, overtime, bonus) · Dr 6110 allowances
 *       · Dr 6130 employer social insurance · Dr 2400 commission earnings (already accrued when the commission
 *       statement was approved) · Dr 2450 reimbursement earnings (already owed through the expense claim)
 *       / Cr 2400 salaries payable (net pay) · Cr 2410 social insurance payable (employee + employer share)
 *       · Cr 1410 loan / advance installments · Cr 6100 unpaid leave and absence · Cr 4900 other deductions
 *       (fines, uniform … recovered from the employee). Department dimension per employee line.
 *   run PAID (dated the pay day)                    Dr 2400 net pay / Cr the run's paid-from account (default bank of
 *       Finance settings) in two lines: the salary transfer (bank and cheque lines — equals the WPS / Mudad file total)
 *       and the cash withdrawn for cash-paid lines.
 *   run REOPENED (approved → draft)                 the accrual is reversed (and posted again on the next approval).
 *   loan / advance created                          Dr 1410 / Cr default bank (cancelled: reversed).
 *   final settlement PAID                           Dr 2500 EOSB provision used (the employee's accrued provision)
 *       · Dr 6120 the gratuity not covered by the provision (Cr 6120 when the provision was larger) · Dr 6100 unpaid
 *       salary and leave encashment · Dr 6110 positive adjustments / Cr 1410 open loan balance · Cr 4900 negative
 *       adjustments · Cr bank (total).
 *       EOSB POLICY: accrued monthly (services/financeEosb.ts: Dr 6120 / Cr 2500 per month from the gratuity
 *       calculator); the settlement consumes the provision (docs/DB-ALIGNMENT.md F-B5, done).
 *
 * Postings dated on or before the lock date are skipped (status `skipped_locked`), never shifted. The sync is idempotent
 * (state-based): it runs on every payroll event (services/hrPayroll.ts `onPayrollEvent`) and on every finance access,
 * so a run approved while the ledger refused (no chart, locked) posts as soon as it can.
 */

const LINK = (runId: string) => `/hr/salary?run=${encodeURIComponent(runId)}`
const ACC = {
  salaries: 'ACC-6100',
  allowances: 'ACC-6110',
  eosb: 'ACC-6120',
  eosbProvision: 'ACC-2500',
  employerSi: 'ACC-6130',
  salariesPayable: 'ACC-2400',
  siPayable: 'ACC-2410',
  reimbursements: 'ACC-2450',
  advances: 'ACC-1410',
  otherIncome: 'ACC-4900',
} as const

const todayOf = (co: string) => companyDayOf(co).today
const lockOf = (co: string) => financeSettingsOf(co).lockDate
const entryOf = (co: string, id: string | null) => (id ? financeJournal.find((e) => e.companyId === co && e.id === id) : undefined)
const accountIn = (co: string, id: string | null | undefined) => (id ? financeAccounts.find((a) => a.companyId === co && a.id === id) : undefined)

/** The bank a company pays from by default: Finance settings' default bank, else the `bank_default` account. */
export function defaultBankOf(co: string): string {
  const id = financeSettingsOf(co).defaultBankAccountId
  const a = accountIn(co, id)
  if (a && a.active && !a.isHeader) return a.id
  return systemAccount(co, 'bank_default')
}

function recordFor(co: string, kind: PayrollPostingRecord['kind'], sourceId: string): Tenant<PayrollPostingRecord> {
  let r = finPayrollPostings.find((x) => x.companyId === co && x.kind === kind && x.sourceId === sourceId)
  if (!r) {
    r = { companyId: co, kind, sourceId, status: 'not_posted', entryId: null, paymentEntryId: null, reversedEntryIds: [], reversalEntryIds: [], paidFromAccountId: null, note: null, updatedAt: nowIso() }
    finPayrollPostings.push(r)
  }
  return r
}

/* ---------------- run accrual ---------------- */

type Side = { accountId: string; departmentId: string | null; debit: boolean; description: string }

/** The account of an earning item (by its code; adjustments by their kind). */
function earningAccount(co: string, code: string): { accountId: string; description: string } {
  if (code === 'basic' || code === 'overtime') return { accountId: ACC.salaries, description: code === 'basic' ? 'Basic salaries' : 'Overtime' }
  if (code === 'housing' || code === 'transport' || code === 'other') return { accountId: ACC.allowances, description: 'Allowances' }
  if (code.startsWith('adj:')) {
    const a = hrPayAdjustments.find((x) => x.companyId === co && x.id === code.slice(4))
    const kind = (a?.kind ?? 'allowance') as string
    if (kind === 'commission') return { accountId: ACC.salariesPayable, description: 'Commissions (accrued on the approved statement)' }
    if (kind === 'reimbursement') return { accountId: ACC.reimbursements, description: 'Expense reimbursements (owed through the claim)' }
    if (kind === 'bonus') return { accountId: ACC.salaries, description: 'Bonuses' }
    return { accountId: ACC.allowances, description: 'Allowances' }
  }
  return { accountId: ACC.allowances, description: 'Other earnings' }
}
function deductionAccount(code: string): { accountId: string; description: string } {
  if (code === 'unpaid_leave' || code === 'absence') return { accountId: ACC.salaries, description: code === 'absence' ? 'Absence deductions' : 'Unpaid leave deductions' }
  if (code === 'si_employee') return { accountId: ACC.siPayable, description: 'Social insurance (employee share)' }
  if (code.startsWith('loan:')) return { accountId: ACC.advances, description: 'Loan / advance installments' }
  return { accountId: ACC.otherIncome, description: 'Other payroll deductions' }
}

/** The accrual lines of a run, aggregated per account, department and side. Balanced by construction. */
export function payrollAccrualLines(co: string, run: Pick<PayrollRunRecord, 'lines'>): JournalLine[] {
  const sums = new Map<string, { side: Side; amount: number }>()
  const add = (side: Side, amount: number) => {
    if (!amount) return
    const k = `${side.accountId}|${side.departmentId ?? ''}|${side.debit ? 'd' : 'c'}|${side.description}`
    const cur = sums.get(k)
    if (cur) cur.amount = round2(cur.amount + amount)
    else sums.set(k, { side, amount: round2(amount) })
  }
  for (const l of run.lines) {
    const dept = l.departmentId ?? null
    for (const it of l.items) {
      if (it.type === 'earning') {
        const a = earningAccount(co, it.code)
        add({ ...a, departmentId: dept, debit: true }, it.amount)
      } else if (it.type === 'deduction') {
        const a = deductionAccount(it.code)
        add({ ...a, departmentId: dept, debit: false }, it.amount)
      } else if (it.type === 'employer') {
        if (it.code === 'si_employer') {
          add({ accountId: ACC.employerSi, departmentId: dept, debit: true, description: 'Social insurance (employer share)' }, it.amount)
          add({ accountId: ACC.siPayable, departmentId: dept, debit: false, description: 'Social insurance (employer share)' }, it.amount)
        }
      } else {
        // Non-taxable pay-outs outside gross (the expenses section's `reimbursement` items): owed through the claim.
        add({ accountId: ACC.reimbursements, departmentId: dept, debit: true, description: 'Expense reimbursements (owed through the claim)' }, it.amount)
      }
    }
    if (l.net > 0) add({ accountId: ACC.salariesPayable, departmentId: dept, debit: false, description: 'Net pay' }, l.net)
    else if (l.net < 0) add({ accountId: ACC.salariesPayable, departmentId: dept, debit: true, description: 'Negative net pay (owed by the employee)' }, -l.net)
  }
  return [...sums.values()].map(({ side, amount }) => ({
    accountId: side.accountId,
    debit: side.debit ? amount : 0,
    credit: side.debit ? 0 : amount,
    description: side.description,
    departmentId: side.departmentId,
  }))
}

/** The payment lines of a paid run: Dr 2400 (positive nets) / Cr paid-from: the salary transfer and the cash withdrawn for cash lines. */
export function payrollPaymentLines(run: Pick<PayrollRunRecord, 'lines'>, paidFrom: string): { lines: JournalLine[]; bank: number; cash: number } {
  let bank = 0
  let cash = 0
  for (const l of run.lines) {
    if (l.net <= 0) continue
    if (l.payMethod === 'cash') cash = round2(cash + l.net)
    else bank = round2(bank + l.net)
  }
  // Cash salaries: the cash is withdrawn from the same account (its own line, so the WPS / Mudad line stays the file total).
  const lines: JournalLine[] = [{ accountId: ACC.salariesPayable, debit: round2(bank + cash), credit: 0, description: 'Salaries paid' }]
  if (bank) lines.push({ accountId: paidFrom, debit: 0, credit: bank, description: 'Salary transfer (WPS / Mudad)' })
  if (cash) lines.push({ accountId: paidFrom, debit: 0, credit: cash, description: 'Cash withdrawn for salaries paid in cash' })
  return { lines, bank, cash }
}

function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const paidDate = (r: PayrollRunRecord) => (r.paidAt ? r.paidAt.slice(0, 10) : r.payDate)

function reverse(co: string, rec: Tenant<PayrollPostingRecord>, entryId: string, why: string, by: string | null): void {
  const e = entryOf(co, entryId)
  if (!e || e.status === 'reversed') return
  const lock = lockOf(co)
  const date = isLocked(lock, e.date) ? todayOf(co) : e.date
  assertEntryNotReconciled(co, e.id)
  const rev = reverseJournal(co, e.id, date < e.date ? e.date : date, `${why} — reversal of ${e.number}`, by)
  rec.reversedEntryIds.push(e.id)
  rec.reversalEntryIds.push(rev.id)
}

function syncRun(co: string, r: Tenant<PayrollRunRecord>, by: string | null): void {
  const rec = recordFor(co, 'run', r.id)
  const lock = lockOf(co)
  const accrual = entryOf(co, rec.entryId)
  const live = accrual && accrual.status === 'posted' ? accrual : undefined
  const set = (status: PayrollPostingStatus, note: string | null = null) => {
    rec.status = status
    rec.note = note
    rec.updatedAt = nowIso()
  }
  if (r.status === 'draft' || r.status === 'calculated') {
    if (live) {
      reverse(co, rec, live.id, `Payroll ${monthName(r.month)} reopened`, by)
      rec.entryId = null
      set('reversed', 'Reopened in HR: the accrual was reversed.')
    }
    return
  }
  // approved or paid
  if (!live) {
    if (isLocked(lock, r.periodEnd)) return set('skipped_locked', `The period ending ${r.periodEnd} is locked (lock date ${lock}): not posted.`)
    const e = postJournal(co, { date: r.periodEnd, memo: `Payroll ${monthName(r.month)} — accrual`, sourceType: 'payroll', sourceId: r.id, lines: payrollAccrualLines(co, r), createdBy: by ?? r.approvedBy })
    rec.entryId = e.id
    set('accrued')
  }
  if (r.status === 'paid' && !entryOf(co, rec.paymentEntryId)) {
    const date = paidDate(r)
    if (isLocked(lock, date)) return set('skipped_locked', `The pay date ${date} is locked: the payment was not posted.`)
    const from = accountIn(co, rec.paidFromAccountId)?.active ? rec.paidFromAccountId! : defaultBankOf(co)
    rec.paidFromAccountId = from
    const p = payrollPaymentLines(r, from)
    if (p.bank + p.cash > 0) {
      const e = postJournal(co, { date, memo: `Payroll ${monthName(r.month)} — salaries paid`, sourceType: 'payroll', sourceId: r.id, lines: p.lines, createdBy: by ?? r.paidBy })
      rec.paymentEntryId = e.id
    }
    set('paid')
  } else if (r.status === 'paid') set('paid')
  else if (rec.status !== 'accrued') set('accrued')
}

/* ---------------- loans, settlements ---------------- */

function syncLoan(co: string, l: Tenant<(typeof hrPayLoans)[number]>, by: string | null): void {
  const rec = recordFor(co, 'loan', l.id)
  const live = entryOf(co, rec.entryId)
  if (l.status === 'cancelled') {
    if (live && live.status === 'posted') {
      reverse(co, rec, live.id, `${l.kind === 'advance' ? 'Salary advance' : 'Loan'} ${l.id} cancelled`, by)
      rec.status = 'reversed'
      rec.updatedAt = nowIso()
    }
    return
  }
  if (live) return
  if (rec.status === 'reversed') return
  const date = l.createdAt.slice(0, 10)
  if (isLocked(lockOf(co), date)) {
    rec.status = 'skipped_locked'
    rec.note = `Disbursed on ${date}, inside the locked period: not posted.`
    return
  }
  const name = employeeById(co, l.employeeId)?.fullName ?? l.employeeId
  const bank = defaultBankOf(co)
  const e = postJournal(co, {
    date,
    memo: `${l.kind === 'advance' ? 'Salary advance' : 'Employee loan'} to ${name}`,
    sourceType: 'payroll',
    sourceId: l.id,
    lines: [
      { accountId: ACC.advances, debit: l.principal, credit: 0, description: `${l.kind === 'advance' ? 'Advance' : 'Loan'} — ${name}` },
      { accountId: bank, debit: 0, credit: l.principal, description: `Disbursed to ${name}` },
    ],
    createdBy: by ?? l.createdBy,
  })
  rec.entryId = e.id
  rec.paidFromAccountId = bank
  rec.status = 'paid'
  rec.updatedAt = nowIso()
}

/**
 * The settlement payment lines: the gratuity is paid out of the employee's EOSB provision (Dr 2500 `provision`) and only
 * the difference goes to 6120 (a credit when the provision was larger). `provision` 0 = nothing accrued (all to 6120).
 */
export function settlementLines(f: Pick<SettlementRecord, 'gratuity' | 'unpaidSalary' | 'leaveEncashment' | 'loanBalance' | 'adjustments' | 'total'>, bank: string, name: string, provision = 0): JournalLine[] {
  const lines: JournalLine[] = []
  const dr = (accountId: string, amount: number, description: string) => {
    if (amount > 0) lines.push({ accountId, debit: round2(amount), credit: 0, description })
    else if (amount < 0) lines.push({ accountId, debit: 0, credit: round2(-amount), description })
  }
  const used = round2(Math.max(0, provision))
  if (used > 0) dr(ACC.eosbProvision, used, `End-of-service provision used — ${name}`)
  const diff = round2(f.gratuity.amount - used)
  dr(ACC.eosb, diff, diff >= 0 ? `End-of-service gratuity${used > 0 ? ' above the provision' : ''} — ${name}` : `End-of-service provision released (above the gratuity) — ${name}`)
  dr(ACC.salaries, f.unpaidSalary, `Unpaid salary to the exit date — ${name}`)
  dr(ACC.salaries, f.leaveEncashment, `Leave encashment — ${name}`)
  for (const a of f.adjustments) {
    if (a.amount > 0) dr(ACC.allowances, a.amount, a.label)
    else dr(ACC.otherIncome, a.amount, a.label)
  }
  if (f.loanBalance > 0) lines.push({ accountId: ACC.advances, debit: 0, credit: round2(f.loanBalance), description: `Open loan balance recovered — ${name}` })
  dr(bank, -f.total, `Final settlement paid — ${name}`)
  return lines
}

function syncSettlement(co: string, f: Tenant<SettlementRecord>, by: string | null): void {
  if (f.status !== 'paid') return
  const rec = recordFor(co, 'settlement', f.id)
  if (entryOf(co, rec.entryId) || rec.status === 'skipped_locked') return
  const date = (f.paidAt ?? nowIso()).slice(0, 10)
  if (isLocked(lockOf(co), date)) {
    rec.status = 'skipped_locked'
    rec.note = `Paid on ${date}, inside the locked period: not posted.`
    return
  }
  const name = employeeById(co, f.employeeId)?.fullName ?? f.employeeId
  const bank = defaultBankOf(co)
  const provision = eosbHooks.provision(co, f.employeeId)
  const e = postJournal(co, { date, memo: `Final settlement — ${name}`, sourceType: 'payroll', sourceId: f.id, lines: settlementLines(f, bank, name, provision), createdBy: by ?? f.paidBy })
  if (provision > 0) eosbHooks.used(co, f, round2(provision), date)
  rec.entryId = e.id
  rec.paidFromAccountId = bank
  rec.status = 'paid'
  rec.updatedAt = nowIso()
}

/** The EOSB provision service (financeEosb.ts) installs these (no import cycle): the employee's provision, and its use. */
let eosbHooks: { provision: (co: string, employeeId: string) => number; used: (co: string, f: SettlementRecord, amount: number, date: string) => void } = { provision: () => 0, used: () => {} }
export function setEosbSettlementHooks(h: typeof eosbHooks): void {
  eosbHooks = h
}

/* ---------------- sync ---------------- */

let reconciledGuard: (co: string, entryId: string) => void = () => {}
/** Banking installs the "reconciled lines can't be reversed" check (avoids an import cycle). */
export function setPayrollReverseGuard(fn: (co: string, entryId: string) => void): void {
  reconciledGuard = fn
}
const assertEntryNotReconciled = (co: string, entryId: string) => reconciledGuard(co, entryId)

const hasChart = (co: string) => financeAccounts.some((a) => a.companyId === co && a.id === ACC.salariesPayable && a.active)

/**
 * Brings the ledger in line with payroll for a company (idempotent). Errors (e.g. a locked date or a chart without
 * the payroll accounts) are kept on the posting record, never thrown.
 */
export function syncPayrollPostings(co: string, by: string | null = null): void {
  if (!hasChart(co)) return
  const guard = (kind: PayrollPostingRecord['kind'], id: string, fn: () => void) => {
    try {
      fn()
    } catch (e) {
      const rec = recordFor(co, kind, id)
      rec.status = 'error'
      rec.note = e instanceof Error ? e.message : 'Posting failed.'
      rec.updatedAt = nowIso()
    }
  }
  for (const r of hrPayrollRuns) if (r.companyId === co) guard('run', r.id, () => syncRun(co, r, by))
  for (const l of hrPayLoans) if (l.companyId === co) guard('loan', l.id, () => syncLoan(co, l, by))
  for (const f of hrFinalSettlements) if (f.companyId === co) guard('settlement', f.id, () => syncSettlement(co, f, by))
}

onPayrollEvent('finance-payroll-gl', (e) => syncPayrollPostings(e.companyId, e.userId))
onFinanceAccess('payroll-gl', (co) => {
  // Every access re-syncs (cheap, idempotent); the first one posts the seeded paid runs.
  try {
    syncPayrollPostings(co)
  } catch (e) {
    console.error('[payroll-gl] finance hook failed', e)
  }
  if (!finBankingMeta.payrollSynced.includes(co)) finBankingMeta.payrollSynced.push(co)
})

registerJournalSource('payroll', (co, id) => {
  if (id.startsWith('PR-')) {
    const r = hrPayrollRuns.find((x) => x.companyId === co && x.id === id)
    return { number: r ? `Payroll ${monthName(r.month)}` : null, link: LINK(id) }
  }
  if (id.startsWith('PLN-')) return { number: id, link: '/hr/salary?tab=loans' }
  if (id.startsWith('PFS-')) return { number: id, link: '/hr/salary?tab=settlements' }
  if (id.startsWith('EOSB-')) return { number: `EOSB provision ${id.slice(5)}`, link: '/finance/banking?tab=eosb' }
  if (id.startsWith('CST-')) return { number: id, link: `/finance/commissions?statement=${encodeURIComponent(id)}` }
  return null
})

/* ---------------- API ---------------- */

function viewOf(co: string, r: Tenant<PayrollRunRecord>): PayrollPosting {
  const rec = finPayrollPostings.find((x) => x.companyId === co && x.kind === 'run' && x.sourceId === r.id)
  const accrual = entryOf(co, rec?.entryId ?? null)
  const pay = entryOf(co, rec?.paymentEntryId ?? null)
  const sumBy = (pred: (code: string, type: string) => boolean) => round2(r.lines.reduce((s, l) => s + l.items.filter((i) => pred(i.code, i.type)).reduce((t, i) => t + i.amount, 0), 0))
  const from = accountIn(co, rec?.paidFromAccountId ?? null)
  const p = payrollPaymentLines(r, from?.id ?? 'ACC-1120')
  return {
    runId: r.id,
    month: r.month,
    runStatus: r.status,
    currency: r.currency,
    status: rec?.status ?? 'not_posted',
    accrualEntryId: accrual?.id ?? null,
    accrualEntryNumber: accrual?.number ?? null,
    paymentEntryId: pay?.id ?? null,
    paymentEntryNumber: pay?.number ?? null,
    reversalEntryIds: [...(rec?.reversalEntryIds ?? [])],
    paidFromAccountId: from?.id ?? null,
    paidFromAccountName: from ? `${from.code} ${from.name}` : null,
    totals: {
      gross: round2(r.lines.reduce((s, l) => s + l.gross, 0)),
      net: round2(r.lines.reduce((s, l) => s + l.net, 0)),
      employeeSocialInsurance: round2(r.lines.reduce((s, l) => s + l.employeeSocialInsurance, 0)),
      employerSocialInsurance: round2(r.lines.reduce((s, l) => s + l.employerSocialInsurance, 0)),
      loanRepayments: sumBy((c) => c.startsWith('loan:')),
      otherDeductions: sumBy((c, t) => t === 'deduction' && c.startsWith('adj:')),
      bankPaid: p.bank,
      cashPaid: p.cash,
    },
    note: rec?.note ?? null,
    runLink: LINK(r.id),
  }
}

const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}

/** GET /finance/payroll-postings — every run of the company with its ledger postings (accounting view). */
export function listPayrollPostings(user: User): PayrollPosting[] {
  financeAccessOf(user)
  const co = tenantOf(user)
  return hrPayrollRuns
    .filter((r) => r.companyId === co)
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((r) => viewOf(co, r))
}

/** GET /finance/payroll-postings/:runId */
export function getPayrollPosting(user: User, runId: string): PayrollPosting {
  financeAccessOf(user)
  const co = tenantOf(user)
  const r = hrPayrollRuns.find((x) => x.companyId === co && x.id === runId) ?? notFound()
  return viewOf(co, r)
}

/** PUT /finance/payroll-postings/:runId/paid-from `{ account_id }` (accounting full): before the run is paid. */
export function setPayrollPaidFrom(user: User, runId: string, input: { accountId?: unknown } | null): PayrollPosting {
  if (financeAccessOf(user) !== 'full') throw new CodedApiError('Only Company Admins, Management and Accountants can change the books.', 403, 'forbidden')
  const co = tenantOf(user)
  const r = hrPayrollRuns.find((x) => x.companyId === co && x.id === runId) ?? notFound()
  if (r.status === 'paid') throw new CodedApiError('This run is paid: its payment entry is posted.', 409, 'run_paid')
  const id = input?.accountId
  const ok = typeof id === 'string' && paymentAccountsOf(co).some((a) => a.id === id)
  if (!ok) throw new CodedApiError('Choose an active cash or bank account of your chart.', 422, 'invalid_account', { field: 'account_id' })
  const rec = recordFor(co, 'run', r.id)
  rec.paidFromAccountId = id as string
  rec.updatedAt = nowIso()
  recordAudit(user, { action: 'update', entity: 'payroll_run', entityId: r.id, summary: `Set the paid-from account of payroll ${monthName(r.month)}`, changes: [] })
  return viewOf(co, r)
}
