import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import { hrAttendance, hrCorrections, hrHolidays, hrLeaveRequests, hrLeaveTypes, nextId } from '@/shared/mocks/data/hrTime'
import { defaultHolidays } from '@/modules/hr/time/defaults'
import { notifications } from '@/shared/mocks/data/tasks'
import { auditLog } from '@/shared/mocks/data/audit'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { clockIn, clockOut, createCorrection, decideCorrection, getEmployeeAttendance, getMyAttendance } from '@/shared/mocks/services/attendance'
import { cancelLeaveRequest, createLeaveRequest, decideLeaveRequest, getMyLeave, previewLeave } from '@/shared/mocks/services/leave'

/**
 * HR › Attendance and Leave services (the mock API contract): company-timezone clocking, working-day
 * counts, balances, overlap, the two-step approval (manager / head → HR), on_leave marking and
 * corrections. Time is pinned with fake Date; the seed is restored before every test.
 */

vi.useFakeTimers({ toFake: ['Date'] })
const seed = takeSnapshot(true)
afterAll(() => {
  vi.useRealTimers()
  restoreSnapshot(seed)
})

const u = (id: string) => users.find((x) => x.id === id)! as User
// EMP-u5 too: the seed gives u5 a pending leave relative to today, which can overlap the dates used below.
const TEST_EMPS = ['EMP-u11', 'EMP-u14', 'EMP-u104', 'EMP-u12', 'EMP-u5']
const typeId = (co: string, code: string) => hrLeaveTypes.find((t) => t.companyId === co && t.code === code)!.id

beforeEach(() => {
  restoreSnapshot(seed)
  vi.setSystemTime(new Date('2026-11-10T06:00:00Z')) // Tue 10 Nov: Dubai 10:00, Riyadh 09:00
  // Independent of the real date the seed was generated on: clean slate for the test employees,
  // a long-standing hire date and the 2026 country holidays.
  for (const store of [hrAttendance, hrLeaveRequests, hrCorrections] as { employeeId: string }[][]) {
    for (let i = store.length - 1; i >= 0; i--) if (TEST_EMPS.includes(store[i].employeeId)) store.splice(i, 1)
  }
  for (const id of TEST_EMPS) {
    const e = employeeById(APEX_ID, id) ?? employeeById(CREST_ID, id)
    if (e) e.hireDate = '2024-01-01'
  }
  for (const [co, country] of [[APEX_ID, 'AE'], [CREST_ID, 'SA']] as const) {
    for (const h of defaultHolidays(country, 2026)) {
      if (!hrHolidays.some((x) => x.companyId === co && x.date === h.date)) hrHolidays.push({ companyId: co, id: nextId('HOL-', hrHolidays), ...h, isDefault: true })
    }
  }
})

describe('clock in / out in the company timezone', () => {
  it('the same instant near midnight lands on different work dates (Dubai vs Riyadh)', async () => {
    vi.setSystemTime(new Date('2026-11-19T20:30:00Z'))
    const apex = await clockIn(u('u11'), { note: 'late start' })
    expect(apex.openEntry?.workDate).toBe('2026-11-20') // 00:30 in Dubai
    const crest = await clockIn(u('u104'), {})
    expect(crest.openEntry?.workDate).toBe('2026-11-19') // 23:30 in Riyadh
  })

  it('late minutes follow each company’s shift and timezone', async () => {
    vi.setSystemTime(new Date('2026-11-18T05:30:00Z')) // Wed: Dubai 09:30, Riyadh 08:30
    const apex = await clockIn(u('u11'), {}) // Office hours 09:00, grace 10
    expect([apex.today.status, apex.today.lateMinutes]).toEqual(['late', 30])
    const crest = await clockIn(u('u104'), {}) // Day shift 08:00, grace 15
    expect([crest.today.status, crest.today.lateMinutes]).toEqual(['late', 30])
  })

  it('one open entry per employee; clock-out closes it and counts the minutes', async () => {
    vi.setSystemTime(new Date('2026-11-18T04:55:00Z')) // Dubai 08:55
    await clockIn(u('u11'), {})
    await expect(clockIn(u('u11'), {})).rejects.toMatchObject({ status: 409, code: 'already_clocked_in' })
    vi.setSystemTime(new Date('2026-11-18T14:55:00Z')) // 18:55
    const out = await clockOut(u('u11'), { note: 'done' })
    expect(out.openEntry).toBeNull()
    expect(out.today.status).toBe('present')
    expect(out.today.minutesWorked).toBe(540) // 10 h − 1 h break
    expect(out.today.overtimeMinutes).toBe(60)
    await expect(clockOut(u('u11'), {})).rejects.toMatchObject({ status: 409, code: 'not_clocked_in' })
  })

  it('every employee may clock in, even with a hidden HR scope (Sales Agent)', async () => {
    const me = await clockIn(u('u12'), {})
    expect(me.employee.id).toBe('EMP-u12')
  })
})

describe('leave requests: working days, balance, overlap', () => {
  it('working days exclude the weekend and public holidays', async () => {
    const p = await previewLeave(u('u11'), { leaveTypeId: typeId(APEX_ID, 'annual'), startDate: '2026-11-29', endDate: '2026-12-05' })
    expect(p.days).toBe(2)
    expect(p.excludedHolidays.map((h) => h.date)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03'])
    expect(p.problem).toBeNull()
    const crest = await previewLeave(u('u104'), { leaveTypeId: typeId(CREST_ID, 'annual'), startDate: '2026-11-29', endDate: '2026-12-05' })
    expect(crest.days).toBe(5) // Fri–Sat weekend
  })

  it('overlap with an own request is refused; insufficient balance is refused unless the type is unpaid', async () => {
    const annual = typeId(APEX_ID, 'annual')
    await createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-23', endDate: '2026-11-24' })
    await expect(createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-24', endDate: '2026-11-25' })).rejects.toMatchObject({ status: 409, code: 'overlap' })
    await expect(createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-12-07', endDate: '2027-02-26' })).rejects.toMatchObject({ status: 422, code: 'insufficient_balance' })
    const unpaid = await createLeaveRequest(u('u11'), { leaveTypeId: typeId(APEX_ID, 'unpaid'), startDate: '2026-12-07', endDate: '2027-02-26' })
    expect(unpaid.status).toBe('pending_head')
  })

  it('pending days reduce the remaining balance; notice, gender and document rules apply', async () => {
    const annual = typeId(APEX_ID, 'annual')
    const before = (await getMyLeave(u('u11'), 2026)).balances.find((b) => b.leaveTypeId === annual)!
    expect(before.accruedDays).toBe(27.5) // 30 / 12 × 11 months (Jan–Nov)
    await createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-23', endDate: '2026-11-24' })
    const after = (await getMyLeave(u('u11'), 2026)).balances.find((b) => b.leaveTypeId === annual)!
    expect([after.pendingDays, after.remainingDays]).toEqual([2, before.remainingDays - 2])
    await expect(createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-12', endDate: '2026-11-12' })).rejects.toMatchObject({ code: 'notice_too_short' })
    await expect(createLeaveRequest(u('u12'), { leaveTypeId: typeId(APEX_ID, 'maternity'), startDate: '2026-12-07', endDate: '2026-12-08' })).rejects.toMatchObject({ code: 'gender_restricted' })
    await expect(createLeaveRequest(u('u11'), { leaveTypeId: typeId(APEX_ID, 'sick'), startDate: '2026-11-09', endDate: '2026-11-12' })).rejects.toMatchObject({ code: 'document_required' })
  })
})

describe('two-step approval: manager / department head, then HR', () => {
  it('approve → approve; the right approvers, notifications, balance and on_leave days', async () => {
    const annual = typeId(APEX_ID, 'annual')
    const r = await createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-23', endDate: '2026-11-24', reason: 'Trip' })
    expect(r.status).toBe('pending_head')
    expect(r.approvals[0]).toMatchObject({ step: 'department_head', approverIds: ['u10'] })
    expect(notifications.some((n) => n.userId === 'u10' && n.type === 'hr')).toBe(true)
    // HR can't skip the first step; a peer can't see it at all.
    await expect(decideLeaveRequest(u('u9'), r.id, { decision: 'approve' })).rejects.toMatchObject({ status: 403 })
    await expect(decideLeaveRequest(u('u14'), r.id, { decision: 'approve' })).rejects.toMatchObject({ status: 404 })
    const step1 = await decideLeaveRequest(u('u10'), r.id, { decision: 'approve', comment: 'ok' })
    expect(step1.status).toBe('pending_hr')
    expect(notifications.some((n) => n.userId === 'u9' && n.title.includes('HR'))).toBe(true)
    expect(notifications.some((n) => n.userId === 'u11' && n.title.includes('manager'))).toBe(true)
    await expect(decideLeaveRequest(u('u10'), r.id, { decision: 'approve' })).rejects.toMatchObject({ status: 403 })
    const done = await decideLeaveRequest(u('u9'), r.id, { decision: 'approve' })
    expect(done.status).toBe('approved')
    const bal = (await getMyLeave(u('u11'), 2026)).balances.find((b) => b.leaveTypeId === annual)!
    expect([bal.usedDays, bal.pendingDays]).toEqual([2, 0])
    const att = await getEmployeeAttendance(u('u9'), 'EMP-u11', '2026-11')
    expect(att.days.filter((d) => d.status === 'on_leave').map((d) => d.workDate)).toEqual(['2026-11-23', '2026-11-24'])
    expect(auditLog.some((a) => a.entityId === r.id)).toBe(true)
  })

  it('rejections need a comment and close the request (step 1 or HR)', async () => {
    const annual = typeId(APEX_ID, 'annual')
    const a = await createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-23', endDate: '2026-11-23' })
    await expect(decideLeaveRequest(u('u10'), a.id, { decision: 'reject' })).rejects.toMatchObject({ code: 'comment_required' })
    expect((await decideLeaveRequest(u('u10'), a.id, { decision: 'reject', comment: 'Release week' })).status).toBe('rejected')
    const b = await createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-25', endDate: '2026-11-25' })
    await decideLeaveRequest(u('u10'), b.id, { decision: 'approve' })
    expect((await decideLeaveRequest(u('u1'), b.id, { decision: 'reject', comment: 'Year-end close' })).status).toBe('rejected')
  })

  it('a Sales Agent’s request goes to their Sales Manager first (approver inbox, hr scope hidden)', async () => {
    const r = await createLeaveRequest(u('u12'), { leaveTypeId: typeId(APEX_ID, 'unpaid'), startDate: '2026-12-07', endDate: '2026-12-08' })
    // Hassan (u12) reports to u10 but sits in Sales (head u3): either may decide step 1.
    expect(r.approvals[0].approverIds).toEqual(['u10', 'u3'])
    const sa = await createLeaveRequest(u('u5'), { leaveTypeId: typeId(APEX_ID, 'unpaid'), startDate: '2026-12-21', endDate: '2026-12-22' })
    expect(sa.approvals[0].approverIds).toEqual(['u3'])
    expect((await decideLeaveRequest(u('u3'), sa.id, { decision: 'approve' })).status).toBe('pending_hr')
  })

  it('cancel: the employee before the start; after the start only HR', async () => {
    const annual = typeId(APEX_ID, 'annual')
    const a = await createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-23', endDate: '2026-11-23' })
    expect((await cancelLeaveRequest(u('u11'), a.id, null)).status).toBe('cancelled')
    const b = await createLeaveRequest(u('u11'), { leaveTypeId: annual, startDate: '2026-11-24', endDate: '2026-11-25' })
    vi.setSystemTime(new Date('2026-11-24T08:00:00Z'))
    await expect(cancelLeaveRequest(u('u11'), b.id, null)).rejects.toMatchObject({ status: 403 })
    expect((await cancelLeaveRequest(u('u9'), b.id, null)).status).toBe('cancelled')
  })
})

describe('attendance corrections', () => {
  it('the employee asks; a peer can’t decide; the manager approves (entry fixed, audited)', async () => {
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
    const c = await createCorrection(u('u11'), { workDate: '2026-11-17', checkIn: '09:00', checkOut: '18:00', reason: 'Forgot to clock' })
    expect(c.status).toBe('pending')
    await expect(decideCorrection(u('u11'), c.id, { decision: 'approve' })).rejects.toMatchObject({ status: 403 })
    await expect(decideCorrection(u('u14'), c.id, { decision: 'approve' })).rejects.toMatchObject({ status: 404 })
    const ok = await decideCorrection(u('u10'), c.id, { decision: 'approve', comment: 'Seen him' })
    expect(ok.status).toBe('approved')
    const mine = await getMyAttendance(u('u11'), '2026-11')
    const d = mine.days.find((x) => x.workDate === '2026-11-17')!
    expect([d.status, d.checkInLocal, d.checkOutLocal, d.minutesWorked]).toEqual(['present', '09:00', '18:00', 480])
    expect(auditLog.some((a) => a.entityId === c.id && a.userId === 'u10')).toBe(true)
  })
})
