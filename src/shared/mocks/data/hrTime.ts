import type { Employee } from '@/modules/hr/types'
import type {
  ApprovalDecision,
  ApprovalStep,
  AttendanceEntry,
  CorrectionStatus,
  HalfDay,
  LeaveSettings,
  LeaveStatus,
  LeaveType,
  Shift,
} from '@/modules/hr/time/types'
import { defaultHolidays, defaultLeaveTypes } from '@/modules/hr/time/defaults'
import { leaveDayCount, toMinutes, workingDates, workingDaysFromWeekend } from '@/modules/hr/time/calc'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { zonedToUtc } from '@/shared/lib/zonedTime'
import { scopeOf } from '@/shared/lib/permissions'
import type { Tenant } from '@/shared/mocks/tenant'
import { users } from '@/shared/mocks/db'
import { APEX_ID, companies, companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { employeeById, employeesOf } from '@/shared/mocks/data/hrEmployees'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * HR › Attendance and Leave stores (docs/API.md › HR). One array per entity for every company
 * (Tenant rows), ids globally unique so a foreign id is never an own one. Synthetic seed per company:
 * shifts, a month of attendance (some late / absent / overtime, one missing clock-out), leave types
 * (country defaults), requests at every approval stage, public holidays for the current and next year.
 * A company without HR data (a new sign-up) gets the defaults on first use (ensureHrTime).
 */

export type ShiftRecord = Omit<Shift, 'employeeCount'>
export interface ShiftAssignmentRecord {
  employeeId: string
  shiftId: string
}
export interface CorrectionRecord {
  id: string
  employeeId: string
  workDate: string
  entryId: string | null
  checkIn: string
  checkOut: string | null
  reason: string
  status: CorrectionStatus
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  comment: string
}
export interface ApprovalRecord {
  step: ApprovalStep
  /** Department-head step: the manager / head at submission. HR step: empty (every HR-full user, live). */
  approverIds: string[]
  decision: ApprovalDecision
  decidedBy: string | null
  comment: string
  decidedAt: string | null
}
export interface LeaveRequestRecord {
  id: string
  employeeId: string
  leaveTypeId: string
  startDate: string
  endDate: string
  halfDay: HalfDay | null
  days: number
  reason: string
  documentName: string | null
  status: LeaveStatus
  approvals: ApprovalRecord[]
  submittedAt: string
  submittedBy: string
  cancelledAt: string | null
  cancelledBy: string | null
}
export interface HolidayRecord {
  id: string
  date: string
  name: string
  isDefault: boolean
}

export const hrShifts = registerArray<Tenant<ShiftRecord>>('hr.shifts', [])
export const hrShiftAssignments = registerArray<Tenant<ShiftAssignmentRecord>>('hr.shiftAssignments', [])
export const hrAttendance = registerArray<Tenant<AttendanceEntry>>('hr.attendance', [])
export const hrCorrections = registerArray<Tenant<CorrectionRecord>>('hr.corrections', [])
export const hrLeaveTypes = registerArray<Tenant<LeaveType>>('hr.leaveTypes', [])
export const hrLeaveRequests = registerArray<Tenant<LeaveRequestRecord>>('hr.leaveRequests', [])
export const hrHolidays = registerArray<Tenant<HolidayRecord>>('hr.holidays', [])
export const hrLeaveSettings = registerArray<Tenant<LeaveSettings>>('hr.leaveSettings', [])

/** Next id of a store: prefix + (highest numeric suffix + 1); safe after a restore from IndexedDB. */
export function nextId(prefix: string, rows: readonly { id: string }[]): string {
  let max = 1000
  for (const r of rows) {
    if (!r.id.startsWith(prefix)) continue
    const n = Number(r.id.slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

export const DEFAULT_CONFLICT_PCT = 30

/* ---------------- Relationships used by seed and services ---------------- */

/** Users who may decide the HR step: active users of the company whose role has HR full scope. */
export function hrApproverIds(companyId: string): string[] {
  return users.filter((u) => u.companyId === companyId && u.active && scopeOf(u.role, 'hr') === 'full').map((u) => u.id)
}

/**
 * First approval step: the employee's manager and the head of their department (when the employee
 * heads it themselves, the head of the parent department). Never the employee. Empty → straight to HR.
 */
export function headApproverIds(companyId: string, emp: Pick<Employee, 'userId' | 'managerId' | 'departmentId'>): string[] {
  const ids = new Set<string>()
  const manager = emp.managerId ? employeeById(companyId, emp.managerId) : undefined
  if (manager?.userId) ids.add(manager.userId)
  const deptOf = (id: string | null) => (id ? departments.find((d) => d.companyId === companyId && d.id === id) : undefined)
  let dept = deptOf(emp.departmentId)
  for (let guard = 0; dept && emp.userId && dept.headId === emp.userId && guard < 20; guard++) dept = deptOf(dept.parentId)
  if (dept?.headId) ids.add(dept.headId)
  if (emp.userId) ids.delete(emp.userId)
  return [...ids].filter((id) => users.some((u) => u.id === id && u.companyId === companyId && u.active))
}

/* ---------------- Defaults (also for companies created later) ---------------- */

function seedDefaults(companyId: string, year: number): void {
  const c = companyById(companyId)
  const country = c?.regional.country ?? 'AE'
  const weekend = c?.regional.weekend ?? [0, 6]
  for (const t of defaultLeaveTypes(country)) hrLeaveTypes.push({ companyId, id: nextId('LVT-', hrLeaveTypes), ...t, isActive: true, isDefault: true })
  for (const y of [year, year + 1]) {
    for (const h of defaultHolidays(country, y)) hrHolidays.push({ companyId, id: nextId('HOL-', hrHolidays), ...h, isDefault: true })
  }
  hrShifts.push({
    companyId,
    id: nextId('SHF-', hrShifts),
    name: 'Office hours',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 60,
    graceMinutes: 10,
    workingDays: workingDaysFromWeekend(weekend),
    isDefault: true,
    isActive: true,
  })
  hrLeaveSettings.push({ companyId, conflictThresholdPct: DEFAULT_CONFLICT_PCT })
}

/** Seeds the defaults for a company that has no HR time data yet (a new sign-up). */
export function ensureHrTime(companyId: string, todayYear: number): void {
  if (hrLeaveSettings.some((s) => s.companyId === companyId)) return
  seedDefaults(companyId, todayYear)
}

/* ---------------- Synthetic seed for the two demo companies ---------------- */

/** Deterministic 0–99 from a string (stable seed). */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return Math.abs(h) % 100
}
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

function seedCompany(companyId: string, now: Date): void {
  const c = companyById(companyId)
  if (!c) return
  const tz = c.regional.timezone
  const weekend = c.regional.weekend
  const today = todayIsoIn(tz, now)
  const year = Number(today.slice(0, 4))
  seedDefaults(companyId, year)
  const apex = companyId === APEX_ID
  const def = hrShifts.find((s) => s.companyId === companyId && s.isDefault)!
  if (!apex) {
    Object.assign(def, { name: 'Day shift', startTime: '08:00', endTime: '17:00', graceMinutes: 15 })
  }
  const second: ShiftRecord & { companyId: string } = {
    companyId,
    id: nextId('SHF-', hrShifts),
    name: apex ? 'Early shift' : 'Warehouse shift',
    startTime: apex ? '07:30' : '07:00',
    endTime: apex ? '16:30' : '16:00',
    breakMinutes: apex ? 60 : 45,
    graceMinutes: apex ? 5 : 10,
    workingDays: workingDaysFromWeekend(weekend),
    isDefault: false,
    isActive: true,
  }
  hrShifts.push(second)
  for (const id of apex ? ['EMP-u14', 'EMP-u15'] : ['EMP-u107']) {
    if (employeeById(companyId, id)) hrShiftAssignments.push({ companyId, employeeId: id, shiftId: second.id })
  }
  const shiftOf = (empId: string) => (hrShiftAssignments.some((a) => a.companyId === companyId && a.employeeId === empId) ? second : def)

  const holidays = new Map(hrHolidays.filter((h) => h.companyId === companyId).map((h) => [h.date, h.name]))
  const working = (from: string, to: string) => workingDates(from, to, weekend, holidays)
  /** The n-th working day after (n > 0) or before (n < 0) today. */
  const nthWorking = (n: number) => {
    const list = n > 0 ? working(addDaysIso(today, 1), addDaysIso(today, 90)) : working(addDaysIso(today, -90), addDaysIso(today, -1)).reverse()
    return list[Math.abs(n) - 1]
  }
  const typeId = (code: string) => hrLeaveTypes.find((t) => t.companyId === companyId && t.code === code)!.id
  const at = (date: string, time: string) => zonedToUtc(date, time, tz)

  /* Leave requests at every stage. */
  interface Seed {
    emp: string
    type: string
    from: number
    span: number
    stage: LeaveStatus
    rejectAt?: ApprovalStep
    reason: string
  }
  const seeds: Seed[] = apex
    ? [
        { emp: 'EMP-u14', type: 'annual', from: -8, span: 3, stage: 'approved', reason: 'Family visit' },
        { emp: 'EMP-u15', type: 'annual', from: 12, span: 2, stage: 'pending_head', reason: 'Personal errands' },
        { emp: 'EMP-u14', type: 'annual', from: 12, span: 2, stage: 'pending_hr', reason: 'Short break' },
        { emp: 'EMP-u16', type: 'sick', from: -2, span: 1, stage: 'pending_hr', reason: 'Flu' },
        { emp: 'EMP-u17', type: 'annual', from: 6, span: 3, stage: 'rejected', rejectAt: 'department_head', reason: 'Trip' },
        { emp: 'EMP-u5', type: 'annual', from: 15, span: 2, stage: 'pending_head', reason: 'Wedding of a friend' },
        { emp: 'EMP-u8', type: 'annual', from: 3, span: 3, stage: 'approved', reason: 'Year-end rest' },
        { emp: 'EMP-u12', type: 'emergency', from: 4, span: 1, stage: 'cancelled', reason: 'Home repair' },
        { emp: 'EMP-u7', type: 'annual', from: 20, span: 4, stage: 'rejected', rejectAt: 'hr', reason: 'Holiday abroad' },
      ]
    : [
        { emp: 'EMP-u107', type: 'annual', from: -10, span: 2, stage: 'approved', reason: 'Family matter' },
        { emp: 'EMP-u104', type: 'annual', from: 20, span: 3, stage: 'pending_head', reason: 'Umrah trip' },
        { emp: 'EMP-u105', type: 'sick', from: -1, span: 1, stage: 'pending_hr', reason: 'Medical appointment' },
        { emp: 'EMP-u106', type: 'annual', from: 8, span: 2, stage: 'rejected', rejectAt: 'hr', reason: 'Rest days' },
        { emp: 'EMP-u103', type: 'annual', from: 5, span: 2, stage: 'approved', reason: 'Family visit' },
        { emp: 'EMP-u104', type: 'emergency', from: 2, span: 1, stage: 'cancelled', reason: 'Car breakdown' },
      ]
  const hrIds = hrApproverIds(companyId)
  for (const s of seeds) {
    const emp = employeeById(companyId, s.emp)
    const start = nthWorking(s.from)
    if (!emp || !start) continue
    const end = s.span > 1 ? (nthWorking(s.from + s.span - 1) ?? start) : start
    const [a, b] = start <= end ? [start, end] : [end, start]
    const days = leaveDayCount(a, b, null, weekend, holidays).days
    const heads = headApproverIds(companyId, emp)
    const submittedAt = at(addDaysIso(a < today ? a : today, -5), '10:15')
    const hrBy = hrIds.find((id) => id !== emp.userId) ?? null
    const approvals: ApprovalRecord[] = []
    const decided = (step: ApprovalStep, ok: boolean, by: string | null, comment: string): ApprovalRecord => ({
      step,
      approverIds: step === 'department_head' ? heads : [],
      decision: ok ? 'approved' : 'rejected',
      decidedBy: by,
      comment,
      decidedAt: at(addDaysIso(a < today ? a : today, -4), '11:00'),
    })
    const pending = (step: ApprovalStep): ApprovalRecord => ({ step, approverIds: step === 'department_head' ? heads : [], decision: 'pending', decidedBy: null, comment: '', decidedAt: null })
    if (heads.length) {
      if (s.stage === 'pending_head' || s.stage === 'cancelled') approvals.push(pending('department_head'))
      else if (s.rejectAt === 'department_head') approvals.push(decided('department_head', false, heads[0], 'Team is short that week.'))
      else approvals.push(decided('department_head', true, heads[0], 'Fine with me.'))
    }
    if (s.stage === 'pending_hr' || (s.stage === 'pending_head' && !heads.length)) approvals.push(pending('hr'))
    if (s.stage === 'approved') approvals.push(decided('hr', true, hrBy, 'Approved.'))
    if (s.rejectAt === 'hr') approvals.push(decided('hr', false, hrBy, 'Overlaps the year-end close.'))
    const status: LeaveStatus = s.stage === 'pending_head' && !heads.length ? 'pending_hr' : s.stage
    hrLeaveRequests.push({
      companyId,
      id: nextId('LVR-', hrLeaveRequests),
      employeeId: emp.id,
      leaveTypeId: typeId(s.type),
      startDate: a,
      endDate: b,
      halfDay: null,
      days,
      reason: s.reason,
      documentName: s.type === 'sick' ? 'medical-certificate.pdf' : null,
      status,
      approvals,
      submittedAt,
      submittedBy: emp.userId ?? '',
      cancelledAt: status === 'cancelled' ? at(today, '08:00') : null,
      cancelledBy: status === 'cancelled' ? emp.userId : null,
    })
  }

  /* A month of attendance (and part of today). */
  const onLeave = (empId: string, date: string) =>
    hrLeaveRequests.some((r) => r.companyId === companyId && r.employeeId === empId && r.status === 'approved' && r.startDate <= date && r.endDate >= date)
  const people = employeesOf(companyId).filter((e) => e.status !== 'terminated')
  const nowMs = now.getTime()
  people.forEach((emp, idx) => {
    const shift = shiftOf(emp.id)
    const start = toMinutes(shift.startTime)
    const end = toMinutes(shift.endTime)
    for (let d = addDaysIso(today, -35); d <= today; d = addDaysIso(d, 1)) {
      if (d < emp.hireDate) continue
      const h = hash(`${emp.id}|${d}|${companyId}`)
      const isShiftDay = shift.workingDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())
      if (holidays.has(d) || onLeave(emp.id, d)) continue
      if (!isShiftDay) {
        // Now and then a few hours on the weekend (all overtime).
        if (h < 3 && d < today) addEntry(emp, d, start + 60, start + 300, 'web')
        continue
      }
      if (h < 6) continue // absent
      let inMin = start - (h % 12)
      if (h < 20) inMin = start + shift.graceMinutes + 3 + (h % 35) // late
      let outMin = end + (h % 15)
      if (h % 9 === 0) outMin = end + 60 + (h % 50) // overtime
      if (h >= 20 && h < 24) outMin = end - 45 // early leave
      if (d === today) {
        if (h % 3 === 0 || Date.parse(at(d, hhmm(inMin))) > nowMs) continue
        addEntry(emp, d, inMin, null, 'web')
        continue
      }
      addEntry(emp, d, inMin, outMin, idx % 7 === 3 && h % 5 === 0 ? 'manual' : 'web')
    }
  })
  function addEntry(emp: Employee, date: string, inMin: number, outMin: number | null, source: AttendanceEntry['source']) {
    const checkInAt = at(date, hhmm(inMin))
    hrAttendance.push({
      companyId,
      id: nextId('ATT-', hrAttendance),
      employeeId: emp.id,
      workDate: date,
      checkInAt,
      checkOutAt: outMin === null ? null : at(date, hhmm(outMin)),
      source,
      note: '',
      location: source === 'web' ? (apex ? 'Business Bay office' : 'Olaya HQ') : '',
      createdBy: source === 'manual' ? (hrApproverIds(companyId)[0] ?? emp.userId ?? '') : (emp.userId ?? ''),
      createdAt: checkInAt,
      updatedAt: checkInAt,
    })
  }

  /* One missing clock-out (the latest past entry of the third employee) + a pending correction for it. */
  const third = people[2]
  const forgot = third
    ? hrAttendance.filter((e) => e.companyId === companyId && e.employeeId === third.id && e.workDate < today && e.checkOutAt).sort((x, y) => y.workDate.localeCompare(x.workDate))[0]
    : undefined
  if (third && forgot) {
    forgot.checkOutAt = null
    hrCorrections.push({
      companyId,
      id: nextId('ATC-', hrCorrections),
      employeeId: third.id,
      workDate: forgot.workDate,
      entryId: forgot.id,
      checkIn: hhmm(toMinutes(shiftOf(third.id).startTime)),
      checkOut: shiftOf(third.id).endTime,
      reason: 'Forgot to clock out before leaving.',
      status: 'pending',
      requestedBy: third.userId ?? '',
      requestedAt: at(today, '07:30'),
      decidedBy: null,
      decidedAt: null,
      comment: '',
    })
  }
  /* An approved correction from earlier in the month. */
  const fourth = people[3]
  const fixed = fourth ? hrAttendance.find((e) => e.companyId === companyId && e.employeeId === fourth.id && e.workDate < addDaysIso(today, -10) && e.checkOutAt) : undefined
  if (fourth && fixed) {
    const approver = headApproverIds(companyId, fourth)[0] ?? hrApproverIds(companyId)[0] ?? null
    hrCorrections.push({
      companyId,
      id: nextId('ATC-', hrCorrections),
      employeeId: fourth.id,
      workDate: fixed.workDate,
      entryId: fixed.id,
      checkIn: hhmm(toMinutes(shiftOf(fourth.id).startTime)),
      checkOut: shiftOf(fourth.id).endTime,
      reason: 'The badge reader was down; I was in on time.',
      status: 'approved',
      requestedBy: fourth.userId ?? '',
      requestedAt: fixed.checkInAt,
      decidedBy: approver,
      decidedAt: fixed.checkInAt,
      comment: 'Confirmed with the front desk.',
    })
    fixed.checkInAt = at(fixed.workDate, shiftOf(fourth.id).startTime)
    fixed.checkOutAt = at(fixed.workDate, shiftOf(fourth.id).endTime)
    fixed.source = 'manual'
  }
}

for (const c of companies) seedCompany(c.id, new Date())
