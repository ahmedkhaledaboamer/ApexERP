import { companyById } from '@/shared/mocks/data/tenancy'
import { empIdForUser } from '@/shared/mocks/data/hrEmployees'
import { hrFinalSettlements, hrPayAdjustments, hrPayLoans, hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { addMonths } from '@/modules/hr/payroll/calc'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { ADMIN, api, userToken, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'
import { withHr } from './hrTalentEndpoints'

/**
 * Coverage-table entries of HR › Salary Management (handlers/hrPayroll.ts), spread into ENDPOINTS
 * (endpoints.ts). Crest's plan has no HR: every sample turns it on for the caller's company first (withHr).
 * Samples run as the company admin (HR full); the approval runs as the other HR-full user (maker–checker:
 * Apex Management u2, Crest Management u102). Writes prepare their own data through the API.
 */

const CHECKER: Record<Co, string> = { co_apex: 'u2', co_crest: 'u102' }
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const month = (co: Co, n = 0) => addMonths(todayIsoIn(companyById(co)!.regional.timezone).slice(0, 7), n)
const today = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)
const adminEmp = (co: Co) => empIdForUser(ADMIN[co])
/** A team member of the company (not the admin), active with a contract. */
const STAFF: Record<Co, string> = { co_apex: 'EMP-u11', co_crest: 'EMP-u107' }
const LEAVER: Record<Co, string> = { co_apex: 'EMP-u15', co_crest: 'EMP-u105' }

function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Payroll isolation table: no ${what} in ${co}`)
  return row
}
const draftRun = (co: Co) => first(hrPayrollRuns, co, 'unpaid run', (r) => r.status !== 'paid')
const paidRun = (co: Co) => first(hrPayrollRuns, co, 'paid run', (r) => r.status === 'paid')
const payslipId = (co: Co) => paidRun(co).lines.find((l) => l.paidDays > 0)!.id
const loan = (co: Co) => first(hrPayLoans, co, 'loan')
const adjustment = (co: Co) => first(hrPayAdjustments, co, 'unpaid adjustment', (a) => a.paidRunIds.length === 0)

const hr = (f: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  withHr(co)
  return f(co)
}

async function ok(co: Co, method: string, path: string, body?: unknown, as = ADMIN[co]): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(userToken(as), method, path, { body })
  if (r.status !== 200) throw new Error(`Payroll isolation table: ${method} ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body
}

/** The current draft run, calculated by the admin (status calculated, warnings open). */
async function calculated(co: Co): Promise<string> {
  const r = draftRun(co)
  if (r.status === 'draft') await ok(co, 'POST', `/hr/payroll/runs/${r.id}/calculate`)
  return r.id
}
/** Calculated by the admin, acknowledged and approved by the checker. */
async function approved(co: Co): Promise<string> {
  const id = await calculated(co)
  if (draftRun(co).status === 'calculated') {
    await ok(co, 'POST', `/hr/payroll/runs/${id}/acknowledge`, { all: true }, CHECKER[co])
    await ok(co, 'POST', `/hr/payroll/runs/${id}/approve`, undefined, CHECKER[co])
  }
  return id
}
/** A draft settlement of a leaving employee. */
async function settlement(co: Co): Promise<string> {
  const existing = hrFinalSettlements.find((f) => f.companyId === co && f.status === 'draft')
  if (existing) return existing.id
  await ok(co, 'PATCH', `/hr/employees/${LEAVER[co]}`, { status: 'notice', exit_date: today(co) })
  return (await ok(co, 'POST', '/hr/payroll/settlements', { employee_id: LEAVER[co], reason: 'resignation' })).id
}

const M = 'hr'

export const HR_PAYROLL_ENDPOINTS: Endpoint[] = [
  /* settings */
  { method: 'GET', path: '/hr/payroll/settings', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'PATCH', path: '/hr/payroll/settings', kind: 'company-write', module: M, sample: hr(() => ({ body: { pay_day: 26, social_insurance: { national_employee_rate: 11 } } })) },

  /* payroll profiles (path id = employee id; person ids served masked, reveal = audited POST) */
  { method: 'GET', path: '/hr/payroll/profiles', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'PATCH', path: '/hr/payroll/profiles/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: STAFF[co] }, body: { pay_method: 'bank' } })) },
  {
    method: 'POST', path: '/hr/payroll/profiles/:id/reveal', kind: 'company-item', module: M,
    note: 'Answers the full WPS person id / national id (HR full, audited): an explicit exception of the HR secrets sweep (REVEAL_PATHS in harness.ts).',
    sample: hr((co) => ({ params: { id: STAFF[co] } })),
  },

  /* adjustments */
  { method: 'GET', path: '/hr/payroll/adjustments', kind: 'company-list', module: M, sample: hr(() => ({})), count: { of: len, expected: (co) => hrPayAdjustments.filter((a) => a.companyId === co).length } },
  { method: 'POST', path: '/hr/payroll/adjustments', kind: 'company-write', module: M, sample: hr((co) => ({ body: { employee_id: STAFF[co], kind: 'bonus', label: 'Iso bonus', amount: 100, month: month(co, 1) } })) },
  { method: 'PATCH', path: '/hr/payroll/adjustments/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: adjustment(co).id }, body: { notes: 'Checked' } })) },
  {
    method: 'DELETE', path: '/hr/payroll/adjustments/:id', kind: 'company-item', module: M,
    sample: hr(async (co) => ({ params: { id: (await ok(co, 'POST', '/hr/payroll/adjustments', { employee_id: STAFF[co], kind: 'deduction', label: 'Iso delete', amount: 5, month: month(co, 1) })).id }, expect: [200, 404] })),
  },

  /* loans and advances */
  { method: 'GET', path: '/hr/payroll/loans', kind: 'company-list', module: M, sample: hr(() => ({})), count: { of: len, expected: (co) => hrPayLoans.filter((l) => l.companyId === co).length } },
  { method: 'POST', path: '/hr/payroll/loans', kind: 'company-write', module: M, sample: hr((co) => ({ body: { employee_id: STAFF[co], kind: 'advance', principal: 1000, installment_amount: 500, start_month: month(co, 1) } })) },
  { method: 'PATCH', path: '/hr/payroll/loans/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: loan(co).id }, body: { reason: 'Reviewed' }, expect: [200, 409] })) },

  /* runs */
  { method: 'GET', path: '/hr/payroll/runs', kind: 'company-list', module: M, sample: hr(() => ({})), count: { of: len, expected: (co) => hrPayrollRuns.filter((r) => r.companyId === co).length } },
  { method: 'POST', path: '/hr/payroll/runs', kind: 'company-write', module: M, sample: hr((co) => ({ body: { month: month(co, 1) }, expect: [200, 409] })) },
  { method: 'GET', path: '/hr/payroll/runs/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: paidRun(co).id } })) },
  {
    method: 'DELETE', path: '/hr/payroll/runs/:id', kind: 'company-item', module: M,
    sample: hr(async (co) => {
      const next = hrPayrollRuns.find((r) => r.companyId === co && r.month === month(co, 1))
      return { params: { id: next?.id ?? (await ok(co, 'POST', '/hr/payroll/runs', { month: month(co, 1) })).id }, expect: [200, 404] }
    }),
  },
  { method: 'POST', path: '/hr/payroll/runs/:id/calculate', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: draftRun(co).id }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/payroll/runs/:id/acknowledge', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await calculated(co) }, body: { all: true }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/payroll/runs/:id/approve', kind: 'company-item', module: M, sample: hr(async (co) => {
    const id = await calculated(co)
    if (draftRun(co).status === 'calculated') await ok(co, 'POST', `/hr/payroll/runs/${id}/acknowledge`, { all: true })
    return { params: { id }, as: CHECKER[co], expect: [200, 409] }
  }) },
  { method: 'POST', path: '/hr/payroll/runs/:id/reopen', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await calculated(co) }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/payroll/runs/:id/pay', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await approved(co) }, expect: [200, 409] })) },
  {
    method: 'POST', path: '/hr/payroll/runs/:id/bank-file', kind: 'company-item', module: M,
    note: 'Answers the bank file (full IBANs / person ids) of an approved or paid run: HR full, audited, POST only; an explicit exception of the HR secrets sweep (REVEAL_PATHS in harness.ts).',
    sample: hr((co) => ({ params: { id: paidRun(co).id }, body: { format: companyById(co)!.regional.country === 'SA' ? 'mudad' : 'wps' } })),
  },

  /* payslips (HR full: every paid line; team / own: their own) */
  { method: 'GET', path: '/hr/payroll/payslips', kind: 'company-list', module: M, sample: hr(() => ({})), count: { of: len, expected: (co) => hrPayrollRuns.filter((r) => r.companyId === co && r.status === 'paid').flatMap((r) => r.lines.filter((l) => l.paidDays > 0)).length } },
  { method: 'GET', path: '/hr/payroll/payslips/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: payslipId(co) } })) },

  /* summary */
  { method: 'GET', path: '/hr/payroll/summary', kind: 'company-export', module: M, sample: hr(() => ({})) },

  /* final settlements */
  { method: 'GET', path: '/hr/payroll/settlements', kind: 'company-list', module: M, sample: hr(() => ({})), count: { of: len, expected: (co) => hrFinalSettlements.filter((f) => f.companyId === co).length } },
  { method: 'POST', path: '/hr/payroll/settlements/preview', kind: 'company-write', module: M, sample: hr((co) => ({ body: { employee_id: adminEmp(co), reason: 'termination', exit_date: today(co) } })) },
  {
    method: 'POST', path: '/hr/payroll/settlements', kind: 'company-write', module: M,
    sample: hr(async (co) => {
      await ok(co, 'PATCH', `/hr/employees/${LEAVER[co]}`, { status: 'notice', exit_date: today(co) })
      return { body: { employee_id: LEAVER[co], reason: 'resignation' }, expect: [200, 409] }
    }),
  },
  { method: 'GET', path: '/hr/payroll/settlements/:id', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await settlement(co) } })) },
  { method: 'PATCH', path: '/hr/payroll/settlements/:id', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await settlement(co) }, body: { notes: 'Reviewed' }, expect: [200, 409] })) },
  { method: 'DELETE', path: '/hr/payroll/settlements/:id', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await settlement(co) }, expect: [200, 404] })) },
  { method: 'POST', path: '/hr/payroll/settlements/:id/pay', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await settlement(co) }, expect: [200, 409] })) },
]

