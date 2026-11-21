import { moduleOverrides } from '@/shared/mocks/data/platform'
import { companyById } from '@/shared/mocks/data/tenancy'
import { empIdForUser, employeeById } from '@/shared/mocks/data/hrEmployees'
import { hrCorrections, hrHolidays, hrLeaveRequests, hrLeaveTypes, hrShifts } from '@/shared/mocks/data/hrTime'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { APEX, ADMIN, adminToken, api, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR › Attendance, Leave and Public holidays (handlers/hrTime.ts), spread
 * into ENDPOINTS (endpoints.ts). Crest's plan has no HR: every sample turns it on for Crest with a
 * platform module override first. Samples run as the company admin (HR full, and an employee:
 * EMP-<admin>) and name the company's own seed rows, or create fresh ones through the API.
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)

function withHrTime(co: Co): void {
  if (co === APEX) return
  if (moduleOverrides.some((o) => o.companyId === co && o.module === 'hr' && o.enabled)) return
  moduleOverrides.push({ companyId: co, module: 'hr', enabled: true, reason: 'Isolation: HR enabled', by: 'p1', at: new Date().toISOString() })
}
const hr = (f: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  withHrTime(co)
  return f(co)
}

/** Company-local today (+ n days). */
const day = (co: Co, n = 0) => addDaysIso(todayIsoIn(companyById(co)!.regional.timezone), n)
const adminEmp = (co: Co) => empIdForUser(ADMIN[co])
function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}
const extraShift = (co: Co) => first(hrShifts, co, 'non-default shift', (s) => !s.isDefault)
const typeId = (co: Co, code: string) => first(hrLeaveTypes, co, `${code} leave type`, (t) => t.code === code).id

async function created(co: Co, method: string, path: string, body: unknown, pick: (b: any) => string): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(adminToken(co), method, path, { body })
  if (r.status !== 200) throw new Error(`Isolation table: ${method} ${path} for ${co} answered ${r.status}: ${r.text}`)
  return pick(r.body)
}

const M = 'hr'

export const HR_TIME_ENDPOINTS: Endpoint[] = [
  /* Attendance: self-service */
  { method: 'GET', path: '/hr/attendance/me', kind: 'company-list', module: M, sample: hr(() => ({ query: {} })) },
  { method: 'POST', path: '/hr/attendance/clock-in', kind: 'company-write', module: M, sample: hr(() => ({ body: { note: 'Isolation', location: 'Office' }, expect: [200, 409] })), note: '409 when the seed already clocked the admin in today.' },
  { method: 'POST', path: '/hr/attendance/clock-out', kind: 'company-write', module: M, sample: hr(() => ({ body: { note: 'Isolation' }, expect: [200, 409] })), note: '409 when the admin isn’t clocked in.' },
  /* Attendance: manager / HR */
  { method: 'GET', path: '/hr/attendance/today', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/attendance/sheet', kind: 'company-export', module: M, sample: hr((co) => ({ query: { month: day(co).slice(0, 7) } })) },
  { method: 'GET', path: '/hr/attendance/employees/:employeeId', kind: 'company-item', module: M, sample: hr((co) => ({ params: { employeeId: adminEmp(co) } })) },
  {
    method: 'POST', path: '/hr/attendance/entries', kind: 'company-write', module: M,
    sample: hr((co) => ({ body: { employee_id: adminEmp(co), work_date: day(co, -3), check_in: '09:00', check_out: '17:00', note: 'Isolation' } })),
  },
  {
    method: 'POST', path: '/hr/attendance/import', kind: 'company-write', module: M,
    sample: hr((co) => ({ body: { csv: `employee_no,timestamp\n${employeeById(co, adminEmp(co))!.employeeNo},${day(co, -2)} 08:01\n`, dry_run: true } })),
  },
  { method: 'GET', path: '/hr/attendance/shifts', kind: 'company-list', module: M, sample: hr(() => ({})) },
  {
    method: 'POST', path: '/hr/attendance/shifts', kind: 'company-write', module: M,
    sample: hr(() => ({ body: { name: `Iso shift ${uniq()}`, start_time: '10:00', end_time: '19:00', break_minutes: 60, grace_minutes: 5 } })),
  },
  { method: 'PATCH', path: '/hr/attendance/shifts/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: extraShift(co).id }, body: { grace_minutes: 7 } })) },
  {
    method: 'DELETE', path: '/hr/attendance/shifts/:id', kind: 'company-item', module: M,
    sample: hr(async (co) => {
      const view = await created(co, 'POST', '/hr/attendance/shifts', { name: `Iso delete ${uniq()}`, start_time: '11:00', end_time: '15:00', break_minutes: 0 }, (b) =>
        JSON.stringify(b.shifts.map((s: { id: string }) => s.id)),
      )
      const ids = JSON.parse(view) as string[]
      return { params: { id: ids[ids.length - 1] } }
    }),
  },
  { method: 'PUT', path: '/hr/attendance/assignments', kind: 'company-write', module: M, sample: hr((co) => ({ body: { employee_id: adminEmp(co), shift_id: extraShift(co).id } })) },
  /* Corrections */
  {
    method: 'GET', path: '/hr/attendance/corrections', kind: 'company-list', module: M, sample: hr(() => ({})),
    count: { of: len, expected: (co) => hrCorrections.filter((c) => c.companyId === co).length },
  },
  {
    method: 'POST', path: '/hr/attendance/corrections', kind: 'company-write', module: M,
    sample: hr((co) => ({ body: { work_date: day(co, -2), check_in: '09:00', check_out: '18:00', reason: 'Isolation correction' } })),
  },
  {
    method: 'POST', path: '/hr/attendance/corrections/:id/decide', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: first(hrCorrections, co, 'pending correction', (c) => c.status === 'pending').id }, body: { decision: 'approve', comment: 'ok' } })),
  },

  /* Leave */
  { method: 'GET', path: '/hr/leave/me', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/leave/types', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'POST', path: '/hr/leave/types', kind: 'company-write', module: M, sample: hr(() => ({ body: { name: `Iso leave ${uniq()}`, code: 'other', days_per_year: 2, is_paid: false } })) },
  { method: 'PATCH', path: '/hr/leave/types/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: typeId(co, 'other') }, body: { color: '#123456' } })) },
  { method: 'PUT', path: '/hr/leave/settings', kind: 'company-write', module: M, sample: hr(() => ({ body: { conflict_threshold_pct: 40 } })) },
  { method: 'GET', path: '/hr/leave/balances', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/leave/calendar', kind: 'company-list', module: M, sample: hr((co) => ({ query: { month: day(co).slice(0, 7) } })) },
  {
    method: 'GET', path: '/hr/leave/requests', kind: 'company-list', module: M, sample: hr(() => ({})),
    count: { of: len, expected: (co) => hrLeaveRequests.filter((r) => r.companyId === co).length },
  },
  {
    method: 'POST', path: '/hr/leave/requests/preview', kind: 'company-write', module: M,
    sample: hr((co) => ({ body: { leave_type_id: typeId(co, 'unpaid'), start_date: day(co, 40), end_date: day(co, 46) } })),
  },
  {
    method: 'POST', path: '/hr/leave/requests', kind: 'company-write', module: M,
    sample: hr((co) => ({ body: { leave_type_id: typeId(co, 'unpaid'), start_date: day(co, 40), end_date: day(co, 46), reason: 'Isolation' } })),
  },
  { method: 'GET', path: '/hr/leave/requests/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: first(hrLeaveRequests, co, 'leave request').id } })) },
  {
    method: 'POST', path: '/hr/leave/requests/:id/decide', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: first(hrLeaveRequests, co, 'request waiting for HR', (r) => r.status === 'pending_hr' && r.employeeId !== adminEmp(co)).id }, body: { decision: 'approve' } })),
  },
  {
    method: 'POST', path: '/hr/leave/requests/:id/cancel', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: first(hrLeaveRequests, co, 'request waiting for a manager', (r) => r.status === 'pending_head').id }, body: { comment: 'Isolation' } })),
  },

  /* Public holidays */
  {
    method: 'GET', path: '/hr/holidays', kind: 'company-list', module: M, sample: hr(() => ({})),
    count: { of: len, expected: (co) => hrHolidays.filter((h) => h.companyId === co).length },
  },
  {
    method: 'POST', path: '/hr/holidays', kind: 'company-write', module: M,
    sample: hr((co) => {
      let date = day(co, 200)
      while (hrHolidays.some((h) => h.companyId === co && h.date === date)) date = addDaysIso(date, 1)
      return { body: { date, name: 'Isolation holiday' } }
    }),
  },
  { method: 'PATCH', path: '/hr/holidays/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: first(hrHolidays, co, 'holiday').id }, body: { name: 'Renamed holiday' } })) },
  { method: 'DELETE', path: '/hr/holidays/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: first(hrHolidays, co, 'holiday').id } })) },
]
