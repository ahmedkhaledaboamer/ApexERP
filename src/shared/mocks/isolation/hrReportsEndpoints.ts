import { employedOn } from '@/modules/hr/reports/calc'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import type { Co } from './harness'
import type { Endpoint, Sample } from './endpoints'
import { withHr } from './hrTalentEndpoints'

/**
 * Coverage-table entries of HR › Reports (handlers/hrReports.ts), spread into ENDPOINTS (endpoints.ts).
 * Samples run as the company admin (HR full) and name the company's own department; Crest's plan has no
 * HR, so every sample turns it on for Crest with a platform module override first (withHr).
 */

const hr = (f: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  withHr(co)
  return f(co)
}

/** A department of the company that has employees (for the department filter). */
function deptOf(co: Co): string {
  const d = departments.find((x) => x.companyId === co && x.active && hrEmployees.some((e) => e.companyId === co && e.departmentId === x.id))
  if (!d) throw new Error(`HR reports isolation table: no department with employees in ${co}`)
  return d.id
}

const thisYear = (co: Co) => {
  const y = todayIsoIn(companyById(co)?.regional.timezone ?? 'UTC').slice(0, 4)
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}
const q = (co: Co, withDept = false): Sample => ({ query: { ...thisYear(co), ...(withDept ? { department_id: deptOf(co) } : {}) } })

const REPORTS = ['overview', 'headcount', 'turnover', 'nationalisation', 'attendance', 'leave', 'compliance', 'assets', 'recruitment', 'training', 'payroll-cost'] as const

/** Headcount export: one row per employee on the payroll today (own recomputation). */
const headcountRows = {
  of: (b: unknown) => ((b as { rows?: unknown[] })?.rows ?? []).length,
  expected: (co: Co) => {
    const today = todayIsoIn(companyById(co)?.regional.timezone ?? 'UTC')
    return hrEmployees.filter((e) => e.companyId === co && employedOn(e, today)).length
  },
}

export const HR_REPORTS_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/hr/reports/options', kind: 'company-list', module: 'hr', sample: hr(() => ({})), note: 'Departments of the caller’s company (team: the ones they head).' },
  ...REPORTS.map(
    (r, i): Endpoint => ({
      method: 'GET',
      path: `/hr/reports/${r}`,
      kind: 'company-export',
      module: 'hr',
      // Every other report with the department filter, so both shapes run in both directions.
      sample: hr((co) => q(co, i % 2 === 1)),
    }),
  ),
  {
    method: 'GET',
    path: '/hr/reports/:report/export',
    kind: 'company-export',
    module: 'hr',
    notOwned: ['report'],
    sample: hr((co) => ({ ...q(co), params: { report: 'headcount' } })),
    count: headcountRows,
  },
  {
    method: 'PUT',
    path: '/hr/reports/settings',
    kind: 'company-write',
    module: 'hr',
    sample: hr((co) => ({ body: { nationalisation_target_pct: co === 'co_apex' ? 12 : 35, training_budget: { year: Number(thisYear(co).from.slice(0, 4)), amount: 50000 } } })),
  },
]
