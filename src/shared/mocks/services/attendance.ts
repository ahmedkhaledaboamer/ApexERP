import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type {
  AttendanceCorrection,
  AttendanceEntry,
  ClockInput,
  CorrectionInput,
  DailyRecord,
  DecisionInput,
  EmployeeAttendance,
  ImportPunchesInput,
  ImportReport,
  ImportRowResult,
  ManualEntryInput,
  MonthSheet,
  MyAttendance,
  Shift,
  ShiftInput,
  ShiftsView,
  TodayBoard,
} from '@/modules/hr/time/types'
import { DAY_STATUSES } from '@/modules/hr/time/types'
import { computeDay, MONTH_RE, monthDates, summarize, toMinutes, workingDaysFromWeekend } from '@/modules/hr/time/calc'
import { HH_MM, isRealIsoDate, zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { addDaysIso, weekdayOfIso } from '@/shared/lib/companyDay'
import { nowIso } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { employeeById, employeesOf } from '@/shared/mocks/data/hrEmployees'
import {
  headApproverIds,
  hrApproverIds,
  hrAttendance,
  hrCorrections,
  hrHolidays,
  hrLeaveRequests,
  hrLeaveTypes,
  hrShiftAssignments,
  hrShifts,
  nextId,
  type CorrectionRecord,
  type ShiftRecord,
} from '@/shared/mocks/data/hrTime'
import type { Tenant } from '@/shared/mocks/tenant'
import {
  conflict,
  employeeRef,
  forbidden,
  hrCtx,
  invalid,
  isFull,
  isHeadOf,
  notFound,
  requireFull,
  requireManage,
  requireSelf,
  str,
  teamEmployeeIds,
  visibleEmployee,
  visibleEmployees,
  type HrCtx,
} from './hrTimeAccess'

/**
 * HR › Attendance (docs/API.md › HR › Attendance). Clock entries are stored; daily records are
 * computed in the company timezone from the entries, the employee's shift, public holidays and
 * approved leave (calc.ts). Self-service (clock in / out, my attendance, corrections) for every
 * user with an employee record; boards, sheets and other employees by the matrix `hr` scope.
 */

export const ATTENDANCE_LINK = '/hr/attendance'

/* ---------------- Building blocks ---------------- */

export function shiftFor(co: string, employeeId: string): ShiftRecord {
  const a = hrShiftAssignments.find((x) => x.companyId === co && x.employeeId === employeeId)
  const own = a ? hrShifts.find((s) => s.companyId === co && s.id === a.shiftId && s.isActive) : undefined
  const def = hrShifts.find((s) => s.companyId === co && s.isDefault) ?? hrShifts.find((s) => s.companyId === co)
  return own ?? def ?? { id: 'none', name: 'Office hours', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, workingDays: [1, 2, 3, 4, 5], isDefault: true, isActive: true }
}

export function holidayMap(co: string): Map<string, string> {
  return new Map(hrHolidays.filter((h) => h.companyId === co).map((h) => [h.date, h.name]))
}

/** Approved leave of an employee on a working date (weekend / holiday dates are never "on leave"). */
export function approvedLeaveOn(ctx: Pick<HrCtx, 'co' | 'weekend'>, holidays: Map<string, string>, employeeId: string, date: string) {
  if (ctx.weekend.includes(weekdayOfIso(date)) || holidays.has(date)) return null
  const r = hrLeaveRequests.find((x) => x.companyId === ctx.co && x.employeeId === employeeId && x.status === 'approved' && x.startDate <= date && x.endDate >= date)
  if (!r) return null
  return { typeName: hrLeaveTypes.find((t) => t.companyId === ctx.co && t.id === r.leaveTypeId)?.name ?? 'Leave', halfDay: r.halfDay }
}

const entriesOf = (co: string, employeeId: string) => hrAttendance.filter((e) => e.companyId === co && e.employeeId === employeeId)
const strip = (e: Tenant<AttendanceEntry>): AttendanceEntry => {
  const { companyId: _c, ...rest } = e // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest
}
const plainShift = (s: ShiftRecord & { companyId?: string }): Shift => {
  const { companyId: _c, ...rest } = s as ShiftRecord & { companyId: string } // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest
}

/** Daily records of an employee over some dates. */
export function daysOf(ctx: HrCtx, emp: Pick<Employee, 'id'>, dates: string[]): DailyRecord[] {
  const holidays = holidayMap(ctx.co)
  const shift = shiftFor(ctx.co, emp.id)
  const byDate = new Map<string, Tenant<AttendanceEntry>[]>()
  for (const e of entriesOf(ctx.co, emp.id)) byDate.set(e.workDate, [...(byDate.get(e.workDate) ?? []), e])
  return dates.map((date) =>
    computeDay({
      employeeId: emp.id,
      date,
      timezone: ctx.timezone,
      shift,
      entries: byDate.get(date) ?? [],
      holidayName: holidays.get(date) ?? null,
      leave: approvedLeaveOn(ctx, holidays, emp.id, date),
      now: ctx.now,
    }),
  )
}

function monthParam(ctx: HrCtx, month: unknown): string {
  return typeof month === 'string' && MONTH_RE.test(month) ? month : ctx.today.slice(0, 7)
}

/** Month dates up to today (the screens show the month so far; future days are "in progress"). */
const datesOf = (month: string) => monthDates(month)

/* ---------------- Self-service ---------------- */

export function myAttendanceOf(ctx: HrCtx, emp: Tenant<Employee>, month: string): MyAttendance {
  const days = daysOf(ctx, emp, datesOf(month))
  const [today] = daysOf(ctx, emp, [ctx.today])
  const open = entriesOf(ctx.co, emp.id).find((e) => e.workDate === ctx.today && !e.checkOutAt)
  return {
    employee: employeeRef(emp),
    timezone: ctx.timezone,
    today,
    openEntry: open ? strip(open) : null,
    shift: plainShift(shiftFor(ctx.co, emp.id)),
    month,
    days,
    entries: entriesOf(ctx.co, emp.id)
      .filter((e) => e.workDate.startsWith(month))
      .sort((a, b) => a.checkInAt.localeCompare(b.checkInAt))
      .map(strip),
    summary: summarize(days.filter((d) => d.workDate <= ctx.today)),
  }
}

/** GET /hr/attendance/me?month= */
export async function getMyAttendance(user: User, month?: unknown): Promise<MyAttendance> {
  const ctx = hrCtx(user)
  const emp = requireSelf(ctx)
  return delay(myAttendanceOf(ctx, emp, monthParam(ctx, month)))
}

/** POST /hr/attendance/clock-in — one open entry per employee (today's). */
export async function clockIn(user: User, input: ClockInput | null): Promise<MyAttendance> {
  const ctx = hrCtx(user)
  const emp = requireSelf(ctx)
  if (entriesOf(ctx.co, emp.id).some((e) => e.workDate === ctx.today && !e.checkOutAt)) throw conflict('You’re already clocked in. Clock out first.', 'already_clocked_in')
  const at = ctx.now.toISOString()
  hrAttendance.push({
    companyId: ctx.co,
    id: nextId('ATT-', hrAttendance),
    employeeId: emp.id,
    workDate: zonedParts(at, ctx.timezone).date,
    checkInAt: at,
    checkOutAt: null,
    source: 'web',
    note: str(input?.note, 300),
    location: str(input?.location, 120),
    createdBy: user.id,
    createdAt: at,
    updatedAt: at,
  })
  return delay(myAttendanceOf(ctx, emp, ctx.today.slice(0, 7)))
}

/** POST /hr/attendance/clock-out — closes today's open entry. */
export async function clockOut(user: User, input: ClockInput | null): Promise<MyAttendance> {
  const ctx = hrCtx(user)
  const emp = requireSelf(ctx)
  const open = entriesOf(ctx.co, emp.id).find((e) => e.workDate === ctx.today && !e.checkOutAt)
  if (!open) throw conflict('You aren’t clocked in today.', 'not_clocked_in')
  const at = ctx.now.toISOString()
  open.checkOutAt = at
  open.updatedAt = at
  const note = str(input?.note, 300)
  if (note) open.note = open.note ? `${open.note} · ${note}` : note
  const loc = str(input?.location, 120)
  if (loc && !open.location) open.location = loc
  return delay(myAttendanceOf(ctx, emp, ctx.today.slice(0, 7)))
}

/* ---------------- Manager / HR views ---------------- */

/** GET /hr/attendance/today — who's in, late, absent, on leave (full / team). */
export async function getTodayBoard(user: User): Promise<TodayBoard> {
  const ctx = hrCtx(user)
  requireManage(ctx)
  const rows = visibleEmployees(ctx)
    .filter((e) => e.status !== 'terminated')
    .map((e) => ({ employee: employeeRef(e), record: daysOf(ctx, e, [ctx.today])[0] }))
    .sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName))
  const counts = { in: 0, late: 0, absent: 0, onLeave: 0, notExpected: 0, total: rows.length }
  for (const { record: r } of rows) {
    if (r.status === 'present' || r.status === 'late' || (r.status === 'half_day' && r.checkInAt)) counts.in++
    if (r.status === 'late') counts.late++
    if (r.status === 'absent') counts.absent++
    if (r.status === 'on_leave' || r.status === 'half_day') counts.onLeave++
    if (r.status === 'weekend' || r.status === 'holiday') counts.notExpected++
  }
  return delay({ date: ctx.today, timezone: ctx.timezone, rows, counts })
}

/** GET /hr/attendance/sheet?month=&department_id=&employee_id=&status= (full / team). */
export async function getMonthSheet(user: User, q: { month?: unknown; departmentId?: unknown; employeeId?: unknown; status?: unknown }): Promise<MonthSheet> {
  const ctx = hrCtx(user)
  requireManage(ctx)
  const month = monthParam(ctx, q.month)
  const dates = datesOf(month)
  const status = typeof q.status === 'string' && (DAY_STATUSES as string[]).includes(q.status) ? q.status : null
  const rows = visibleEmployees(ctx)
    // Leavers stay on the sheet of the months they still worked in.
    .filter((e) => e.status !== 'terminated' || (e.exitDate !== null && e.exitDate >= `${month}-01`))
    .filter((e) => !q.departmentId || e.departmentId === q.departmentId)
    .filter((e) => !q.employeeId || e.id === q.employeeId)
    .map((e) => {
      const days = daysOf(ctx, e, dates)
      return { employee: employeeRef(e), days, summary: summarize(days.filter((d) => d.workDate <= ctx.today)) }
    })
    .filter((r) => !status || r.days.some((d) => d.status === status && d.workDate <= ctx.today))
    .sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName))
  return delay({ month, timezone: ctx.timezone, dates, rows })
}

/** GET /hr/attendance/employees/:employeeId?month= — one employee's month (in scope; else 404). */
export async function getEmployeeAttendance(user: User, employeeId: string, month?: unknown): Promise<EmployeeAttendance> {
  const ctx = hrCtx(user)
  const emp = visibleEmployee(ctx, employeeId)
  const m = monthParam(ctx, month)
  const mine = myAttendanceOf(ctx, emp, m)
  return delay({ employee: mine.employee, shift: mine.shift, month: m, days: mine.days, entries: mine.entries, summary: mine.summary })
}

function localTimes(workDate: unknown, checkIn: unknown, checkOut: unknown, today: string) {
  if (!isRealIsoDate(workDate)) throw invalid('Pick a valid date.', 'invalid_date')
  if (workDate > today) throw invalid('The date can’t be in the future.', 'future_date')
  if (typeof checkIn !== 'string' || !HH_MM.test(checkIn)) throw invalid('Enter the clock-in time as HH:mm.', 'invalid_time')
  const out = checkOut === null || checkOut === undefined || checkOut === '' ? null : checkOut
  if (out !== null && (typeof out !== 'string' || !HH_MM.test(out))) throw invalid('Enter the clock-out time as HH:mm.', 'invalid_time')
  if (out !== null && toMinutes(out) <= toMinutes(checkIn)) throw invalid('Clock-out must be after clock-in (same day).', 'invalid_time')
  return { workDate, checkIn, checkOut: out as string | null }
}

/** POST /hr/attendance/entries — a manual entry by HR (full). */
export async function createManualEntry(user: User, input: ManualEntryInput | null): Promise<AttendanceEntry> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const emp = visibleEmployee(ctx, String(input?.employeeId ?? ''))
  const t = localTimes(input?.workDate, input?.checkIn, input?.checkOut, ctx.today)
  const at = nowIso()
  const row: Tenant<AttendanceEntry> = {
    companyId: ctx.co,
    id: nextId('ATT-', hrAttendance),
    employeeId: emp.id,
    workDate: t.workDate,
    checkInAt: zonedToUtc(t.workDate, t.checkIn, ctx.timezone),
    checkOutAt: t.checkOut ? zonedToUtc(t.workDate, t.checkOut, ctx.timezone) : null,
    source: 'manual',
    note: str(input?.note, 300),
    location: '',
    createdBy: user.id,
    createdAt: at,
    updatedAt: at,
  }
  hrAttendance.push(row)
  recordAudit(user, { action: 'create', entity: 'attendance', entityId: row.id, summary: `Added a manual attendance entry for ${emp.fullName} on ${t.workDate}` })
  return delay(strip(row))
}

/* ---------------- CSV import ---------------- */

const LOCAL_TS = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/
const ZONED_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** A punch timestamp: an ISO instant with an offset, or a company-local "yyyy-MM-dd HH:mm". */
export function parsePunch(raw: string, timezone: string): string | null {
  const s = raw.trim()
  const local = LOCAL_TS.exec(s)
  if (local) return isRealIsoDate(local[1]) ? zonedToUtc(local[1], `${local[2]}:${local[3]}`, timezone) : null
  if (ZONED_TS.test(s) && isRealIsoDate(s.slice(0, 10))) {
    const ms = Date.parse(s)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  return null
}

export const IMPORT_MAX_ROWS = 5000

/** POST /hr/attendance/import { csv, dry_run } — punches `employee_no,timestamp`, paired in / out per employee and day. */
export async function importPunches(user: User, input: ImportPunchesInput | null): Promise<ImportReport> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const csv = typeof input?.csv === 'string' ? input.csv : ''
  const lines = csv.split(/\r?\n/)
  if (!csv.trim()) throw invalid('The file is empty.', 'empty_file')
  if (lines.length > IMPORT_MAX_ROWS + 1) throw invalid(`Up to ${IMPORT_MAX_ROWS} rows per file.`, 'too_many_rows')
  const byNo = new Map(employeesOf(ctx.co).map((e) => [e.employeeNo.toLowerCase(), e]))
  const existing = new Set(hrAttendance.filter((e) => e.companyId === ctx.co).flatMap((e) => [`${e.employeeId}|${e.checkInAt}`, `${e.employeeId}|${e.checkOutAt}`]))
  const seen = new Set<string>()
  const rows: ImportRowResult[] = []
  const valid: { emp: Tenant<Employee>; at: string; date: string }[] = []
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const [noRaw = '', tsRaw = ''] = line.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''))
    if (i === 0 && /employee/i.test(noRaw)) return // header
    const base = { line: i + 1, employeeNo: noRaw.slice(0, 40), timestamp: tsRaw.slice(0, 40), employeeName: null, workDate: null }
    const emp = byNo.get(noRaw.toLowerCase())
    if (!emp) return rows.push({ ...base, ok: false, error: 'Unknown employee number' })
    if (emp.status === 'terminated') return rows.push({ ...base, ok: false, error: 'The employee has left', employeeName: emp.fullName })
    const at = parsePunch(tsRaw, ctx.timezone)
    if (!at) return rows.push({ ...base, ok: false, error: 'Invalid timestamp (use yyyy-MM-dd HH:mm or ISO 8601)', employeeName: emp.fullName })
    if (Date.parse(at) > ctx.now.getTime()) return rows.push({ ...base, ok: false, error: 'Timestamp in the future', employeeName: emp.fullName })
    const key = `${emp.id}|${at}`
    if (existing.has(key) || seen.has(key)) return rows.push({ ...base, ok: false, error: 'Duplicate punch', employeeName: emp.fullName })
    seen.add(key)
    const date = zonedParts(at, ctx.timezone).date
    valid.push({ emp, at, date })
    rows.push({ ...base, ok: true, error: null, employeeName: emp.fullName, workDate: date })
  })
  let created = 0
  if (!input?.dryRun) {
    const groups = new Map<string, typeof valid>()
    for (const v of valid) groups.set(`${v.emp.id}|${v.date}`, [...(groups.get(`${v.emp.id}|${v.date}`) ?? []), v])
    const stamp = nowIso()
    for (const list of groups.values()) {
      list.sort((a, b) => a.at.localeCompare(b.at))
      for (let k = 0; k < list.length; k += 2) {
        hrAttendance.push({
          companyId: ctx.co,
          id: nextId('ATT-', hrAttendance),
          employeeId: list[k].emp.id,
          workDate: list[k].date,
          checkInAt: list[k].at,
          checkOutAt: list[k + 1]?.at ?? null,
          source: 'import',
          note: '',
          location: '',
          createdBy: user.id,
          createdAt: stamp,
          updatedAt: stamp,
        })
        created++
      }
    }
    if (created) recordAudit(user, { action: 'create', entity: 'attendance', entityId: 'import', summary: `Imported ${valid.length} punches (${created} attendance entries)` })
  }
  return delay({ rows, valid: valid.length, invalid: rows.length - valid.length, entriesCreated: created, dryRun: !!input?.dryRun })
}

/* ---------------- Shifts ---------------- */

function shiftsView(ctx: HrCtx): ShiftsView {
  const list = hrShifts.filter((s) => s.companyId === ctx.co)
  const people = employeesOf(ctx.co).filter((e) => e.status !== 'terminated')
  const assignments = people.map((e) => {
    const a = hrShiftAssignments.find((x) => x.companyId === ctx.co && x.employeeId === e.id)
    return { employeeId: e.id, employeeName: e.fullName, shiftId: shiftFor(ctx.co, e.id).id, isDefault: !a }
  })
  return {
    shifts: list.map((s) => ({ ...plainShift(s), employeeCount: assignments.filter((a) => a.shiftId === s.id).length })),
    assignments,
    weekend: [...ctx.weekend],
    timezone: ctx.timezone,
  }
}

/** GET /hr/attendance/shifts (full / team). */
export async function listShifts(user: User): Promise<ShiftsView> {
  const ctx = hrCtx(user)
  requireManage(ctx)
  return delay(shiftsView(ctx))
}

function validShift(input: ShiftInput | null, base: ShiftRecord | null, weekend: readonly number[]): Omit<ShiftRecord, 'id'> {
  const name = input?.name !== undefined ? str(input.name, 80) : (base?.name ?? '')
  if (!name) throw invalid('Give the shift a name.', 'name_required')
  const startTime = input?.startTime ?? base?.startTime ?? '09:00'
  const endTime = input?.endTime ?? base?.endTime ?? '18:00'
  if (!HH_MM.test(String(startTime)) || !HH_MM.test(String(endTime))) throw invalid('Times are HH:mm.', 'invalid_time')
  if (toMinutes(endTime) <= toMinutes(startTime)) throw invalid('The shift must end after it starts (same day).', 'invalid_time')
  const num = (v: unknown, fallback: number, max: number, what: string) => {
    const n = v === undefined ? fallback : Number(v)
    if (!Number.isInteger(n) || n < 0 || n > max) throw invalid(`${what} must be a whole number between 0 and ${max}.`, 'invalid_number')
    return n
  }
  const breakMinutes = num(input?.breakMinutes, base?.breakMinutes ?? 60, 240, 'Break minutes')
  const graceMinutes = num(input?.graceMinutes, base?.graceMinutes ?? 10, 120, 'Grace minutes')
  if (breakMinutes >= toMinutes(endTime) - toMinutes(startTime)) throw invalid('The break is longer than the shift.', 'invalid_number')
  const wd = input?.workingDays ?? base?.workingDays ?? workingDaysFromWeekend(weekend)
  if (!Array.isArray(wd) || !wd.length || wd.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw invalid('Pick at least one working day.', 'invalid_days')
  return {
    name,
    startTime,
    endTime,
    breakMinutes,
    graceMinutes,
    workingDays: [...new Set(wd)].sort(),
    isDefault: input?.isDefault !== undefined ? !!input.isDefault : (base?.isDefault ?? false),
    isActive: input?.isActive !== undefined ? !!input.isActive : (base?.isActive ?? true),
  }
}

function makeDefault(ctx: HrCtx, id: string) {
  for (const s of hrShifts) if (s.companyId === ctx.co) s.isDefault = s.id === id
}

/** POST /hr/attendance/shifts (full). */
export async function createShift(user: User, input: ShiftInput | null): Promise<ShiftsView> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const row = { companyId: ctx.co, id: nextId('SHF-', hrShifts), ...validShift(input, null, ctx.weekend) }
  if (row.isDefault && !row.isActive) throw invalid('The default shift must be active.', 'default_inactive')
  hrShifts.push(row)
  if (row.isDefault) makeDefault(ctx, row.id)
  recordAudit(user, { action: 'create', entity: 'shift', entityId: row.id, summary: `Created the shift ${row.name}` })
  return delay(shiftsView(ctx))
}

const ownShift = (ctx: HrCtx, id: string) => {
  const s = hrShifts.find((x) => x.companyId === ctx.co && x.id === id)
  if (!s) throw notFound()
  return s
}

/** PATCH /hr/attendance/shifts/:id (full). */
export async function updateShift(user: User, id: string, input: ShiftInput | null): Promise<ShiftsView> {
  const ctx = hrCtx(user)
  const s = ownShift(ctx, id)
  requireFull(ctx)
  const next = validShift(input, s, ctx.weekend)
  if (s.isDefault && !next.isDefault) throw invalid('Make another shift the default first.', 'default_required')
  if (next.isDefault && !next.isActive) throw invalid('The default shift must be active.', 'default_inactive')
  Object.assign(s, next)
  if (s.isDefault) makeDefault(ctx, s.id)
  recordAudit(user, { action: 'update', entity: 'shift', entityId: s.id, summary: `Updated the shift ${s.name}` })
  return delay(shiftsView(ctx))
}

/** DELETE /hr/attendance/shifts/:id (full; not the default; assigned employees fall back to the default). */
export async function deleteShift(user: User, id: string): Promise<ShiftsView> {
  const ctx = hrCtx(user)
  const s = ownShift(ctx, id)
  requireFull(ctx)
  if (s.isDefault) throw conflict('The default shift can’t be deleted.', 'default_shift')
  hrShifts.splice(hrShifts.indexOf(s), 1)
  for (let i = hrShiftAssignments.length - 1; i >= 0; i--) {
    const a = hrShiftAssignments[i]
    if (a.companyId === ctx.co && a.shiftId === s.id) hrShiftAssignments.splice(i, 1)
  }
  recordAudit(user, { action: 'delete', entity: 'shift', entityId: s.id, summary: `Deleted the shift ${s.name}` })
  return delay(shiftsView(ctx))
}

/** PUT /hr/attendance/assignments { employee_id, shift_id } (full). shift_id null → back to the default. */
export async function assignShift(user: User, input: { employeeId?: unknown; shiftId?: unknown } | null): Promise<ShiftsView> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const emp = visibleEmployee(ctx, String(input?.employeeId ?? ''))
  const shiftId = input?.shiftId === null || input?.shiftId === undefined || input?.shiftId === '' ? null : String(input.shiftId)
  const shift = shiftId ? hrShifts.find((s) => s.companyId === ctx.co && s.id === shiftId && s.isActive) : null
  if (shiftId && !shift) throw notFound()
  const i = hrShiftAssignments.findIndex((a) => a.companyId === ctx.co && a.employeeId === emp.id)
  if (i >= 0) hrShiftAssignments.splice(i, 1)
  if (shift && !shift.isDefault) hrShiftAssignments.push({ companyId: ctx.co, employeeId: emp.id, shiftId: shift.id })
  recordAudit(user, { action: 'update', entity: 'shift', entityId: emp.id, summary: `Assigned ${emp.fullName} to ${shift ? shift.name : 'the default shift'}` })
  return delay(shiftsView(ctx))
}

/* ---------------- Corrections ---------------- */

function canDecideCorrection(ctx: HrCtx, c: CorrectionRecord, emp: Tenant<Employee> | undefined): boolean {
  if (!emp || c.status !== 'pending' || emp.userId === ctx.user.id) return false
  return isFull(ctx) || isHeadOf(ctx, emp) || (ctx.scope === 'team' && teamEmployeeIds(ctx).has(emp.id))
}

function toCorrection(ctx: HrCtx, c: Tenant<CorrectionRecord>): AttendanceCorrection {
  const emp = employeeById(ctx.co, c.employeeId)
  const { companyId: _c, ...rest } = c // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ...rest,
    employeeName: emp?.fullName ?? '',
    decidedByName: c.decidedBy ? (users.find((u) => u.id === c.decidedBy && u.companyId === ctx.co)?.name ?? null) : null,
    canDecide: canDecideCorrection(ctx, c, emp),
  }
}

function correctionVisible(ctx: HrCtx, c: Tenant<CorrectionRecord>): boolean {
  if (c.companyId !== ctx.co) return false
  if (ctx.self && c.employeeId === ctx.self.id) return true
  const emp = employeeById(ctx.co, c.employeeId)
  if (!emp) return false
  return isFull(ctx) || isHeadOf(ctx, emp) || (ctx.scope === 'team' && teamEmployeeIds(ctx).has(emp.id))
}

/** GET /hr/attendance/corrections?status= — own requests + the ones the caller may decide. */
export async function listCorrections(user: User, status?: unknown): Promise<AttendanceCorrection[]> {
  const ctx = hrCtx(user)
  return delay(
    hrCorrections
      .filter((c) => correctionVisible(ctx, c))
      .filter((c) => !status || c.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map((c) => toCorrection(ctx, c)),
  )
}

/** POST /hr/attendance/corrections — the employee asks to fix a day (self-service). */
export async function createCorrection(user: User, input: CorrectionInput | null): Promise<AttendanceCorrection> {
  const ctx = hrCtx(user)
  const emp = requireSelf(ctx)
  const t = localTimes(input?.workDate, input?.checkIn, input?.checkOut, ctx.today)
  if (t.workDate < addDaysIso(ctx.today, -60)) throw invalid('Corrections go back 60 days at most.', 'too_old')
  const reason = str(input?.reason, 500)
  if (reason.length < 3) throw invalid('Say why the times need correcting.', 'reason_required')
  let entryId: string | null = null
  if (input?.entryId) {
    const entry = hrAttendance.find((e) => e.companyId === ctx.co && e.employeeId === emp.id && e.id === input.entryId)
    if (!entry) throw notFound()
    if (entry.workDate !== t.workDate) throw invalid('The entry is on another date.', 'entry_date_mismatch')
    entryId = entry.id
  }
  if (hrCorrections.some((c) => c.companyId === ctx.co && c.employeeId === emp.id && c.status === 'pending' && c.workDate === t.workDate && c.entryId === entryId)) {
    throw conflict('A correction for this day is already waiting for approval.', 'duplicate_correction')
  }
  const row: Tenant<CorrectionRecord> = {
    companyId: ctx.co,
    id: nextId('ATC-', hrCorrections),
    employeeId: emp.id,
    workDate: t.workDate,
    entryId,
    checkIn: t.checkIn,
    checkOut: t.checkOut,
    reason,
    status: 'pending',
    requestedBy: user.id,
    requestedAt: nowIso(),
    decidedBy: null,
    decidedAt: null,
    comment: '',
  }
  hrCorrections.push(row)
  const approvers = headApproverIds(ctx.co, emp)
  for (const id of approvers.length ? approvers : hrApproverIds(ctx.co).filter((x) => x !== user.id)) {
    pushNotification({ userId: id, companyId: ctx.co, type: 'hr', title: 'Attendance correction to review', body: `${emp.fullName} asks to correct ${t.workDate}: ${reason}`, link: `${ATTENDANCE_LINK}?tab=corrections` })
  }
  return delay(toCorrection(ctx, row))
}

/** POST /hr/attendance/corrections/:id/decide { decision, comment } — the manager / head or HR full (audited). */
export async function decideCorrection(user: User, id: string, input: DecisionInput | null): Promise<AttendanceCorrection> {
  const ctx = hrCtx(user)
  const c = hrCorrections.find((x) => x.id === id && correctionVisible(ctx, x))
  if (!c) throw notFound()
  const emp = employeeById(ctx.co, c.employeeId)
  if (c.status !== 'pending') throw conflict('This correction was already decided.', 'already_decided')
  if (!canDecideCorrection(ctx, c, emp) || !emp) throw forbidden('Only the employee’s manager or HR can decide this correction.')
  const decision = input?.decision
  if (decision !== 'approve' && decision !== 'reject') throw invalid('Choose approve or reject.', 'invalid_decision')
  const comment = str(input?.comment, 500)
  const at = nowIso()
  c.status = decision === 'approve' ? 'approved' : 'rejected'
  c.decidedBy = user.id
  c.decidedAt = at
  c.comment = comment
  if (decision === 'approve') {
    const checkInAt = zonedToUtc(c.workDate, c.checkIn, ctx.timezone)
    const checkOutAt = c.checkOut ? zonedToUtc(c.workDate, c.checkOut, ctx.timezone) : null
    const entry = c.entryId ? hrAttendance.find((e) => e.companyId === ctx.co && e.id === c.entryId) : undefined
    if (entry) Object.assign(entry, { checkInAt, checkOutAt, source: 'manual', updatedAt: at })
    else hrAttendance.push({ companyId: ctx.co, id: nextId('ATT-', hrAttendance), employeeId: emp.id, workDate: c.workDate, checkInAt, checkOutAt, source: 'manual', note: `Correction ${c.id}`, location: '', createdBy: user.id, createdAt: at, updatedAt: at })
  }
  recordAudit(user, {
    action: 'update',
    entity: 'attendance',
    entityId: c.id,
    summary: `${decision === 'approve' ? 'Approved' : 'Rejected'} the attendance correction of ${emp.fullName} for ${c.workDate} (${c.checkIn}–${c.checkOut ?? '—'})`,
  })
  if (emp.userId) {
    pushNotification({ userId: emp.userId, companyId: ctx.co, type: 'hr', title: `Correction ${decision === 'approve' ? 'approved' : 'rejected'}`, body: `${c.workDate}${comment ? `: ${comment}` : ''}`, link: ATTENDANCE_LINK })
  }
  return delay(toCorrection(ctx, c))
}
