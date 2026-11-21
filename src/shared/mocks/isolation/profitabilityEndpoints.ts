import { todayIsoIn } from '@/shared/lib/companyDay'
import { users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { projects } from '@/shared/mocks/data/tasks'
import { events } from '@/shared/mocks/data/events'
import { customers } from '@/shared/mocks/db'
import type { Co } from './harness'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of Accounts & finance › Profitability (handlers/financeProfitability.ts) and Reports ›
 * Company performance / Reports hub (handlers/reportsPerformance.ts), spread into ENDPOINTS (endpoints.ts). Both seeded
 * companies have `accounting` (reports is in every plan). Samples run as the company admin (accounting full, reports
 * full) and name the company's own project, event, customer and department in the filters.
 */

const year = (co: Co) => todayIsoIn(companyById(co)?.regional.timezone ?? 'UTC').slice(0, 4)
const range = (co: Co) => ({ from: `${year(co)}-01-01`, to: `${year(co)}-12-31` })

function pick<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Profitability isolation table: no ${what} in ${co}`)
  return row
}
const project = (co: Co) => pick(projects, co, 'project')
const event = (co: Co) => pick(events, co, 'event', (e) => e.status !== 'cancelled')
const customer = (co: Co) => pick(customers, co, 'customer')
/** The department of the first project's manager (the project filter's department). */
const projectDept = (co: Co) => {
  const id = users.find((u) => u.id === project(co).managerId)?.departmentId
  return pick(departments, co, 'project department', (d) => d.id === id || (!id && d.active))
}

const q = (co: Co, extra: Record<string, string> = {}): Sample => ({ query: { ...range(co), ...extra } })
const M = 'finance/profitability'

export const PROFITABILITY_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/finance/profitability/options', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PUT', path: '/finance/profitability/settings', kind: 'company-write', module: M, sample: (co) => ({ body: { standard_hours_per_month: co === 'co_apex' ? 168 : 180, overdue_receivables_alert_pct: 25 } }) },
  { method: 'GET', path: '/finance/profitability/projects', kind: 'company-export', module: M, sample: (co) => q(co, { department_id: projectDept(co).id }) },
  {
    method: 'GET',
    path: '/finance/profitability/projects/:id',
    kind: 'company-item',
    module: M,
    sample: (co) => ({ params: { id: project(co).id }, query: range(co) }),
  },
  { method: 'GET', path: '/finance/profitability/events', kind: 'company-export', module: M, sample: (co) => q(co, { event_id: event(co).id }) },
  { method: 'GET', path: '/finance/profitability/customers', kind: 'company-export', module: M, sample: (co) => q(co, { customer_id: customer(co).id }) },
  { method: 'GET', path: '/finance/profitability/departments', kind: 'company-export', module: M, sample: (co) => q(co) },
  {
    method: 'GET',
    path: '/finance/profitability/:report/export',
    kind: 'company-export',
    module: M,
    notOwned: ['report'],
    sample: (co) => ({ ...q(co), params: { report: 'projects' } }),
    // One row per project of the company (no filter): own recomputation.
    count: { of: (b) => ((b as { rows?: unknown[] })?.rows ?? []).length, expected: (co) => projects.filter((p) => p.companyId === co).length },
  },
]

export const PERFORMANCE_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/reports/performance', kind: 'company-export', module: 'reports/performance', sample: (co) => q(co) },
  { method: 'GET', path: '/reports/hub', kind: 'company-list', module: 'reports/hub', sample: () => ({}) },
  {
    method: 'PUT',
    path: '/reports/hub/favourites/:reportId',
    kind: 'company-item',
    module: 'reports/hub',
    notOwned: ['reportId'],
    sample: () => ({ params: { reportId: 'company-performance' } }),
    note: 'Report ids are catalog keys, not company records; favourites are stored per company and user.',
  },
  { method: 'DELETE', path: '/reports/hub/favourites/:reportId', kind: 'company-item', module: 'reports/hub', notOwned: ['reportId'], sample: () => ({ params: { reportId: 'company-performance' } }) },
  { method: 'POST', path: '/reports/hub/recent', kind: 'company-write', module: 'reports/hub', sample: () => ({ body: { report_id: 'finance-profitability-projects' } }) },
]
