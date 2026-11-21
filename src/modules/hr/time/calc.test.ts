import { describe, expect, it } from 'vitest'
import { accruedDays, carriedDays, computeDay, entitledDays, leaveDayCount, rangesOverlap, summarize, workingDates, type DayInput } from './calc'
import { defaultHolidays } from './defaults'
import { zonedParts } from '@/shared/lib/zonedTime'

const SHIFT = { id: 'S', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, workingDays: [1, 2, 3, 4, 5] }
const day = (over: Partial<DayInput>): DayInput => ({
  employeeId: 'E',
  date: '2026-11-18',
  timezone: 'Asia/Dubai',
  shift: SHIFT,
  entries: [],
  holidayName: null,
  leave: null,
  now: new Date('2026-11-25T12:00:00Z'),
  ...over,
})

describe('company timezone day boundaries (Dubai +4 vs Riyadh +3)', () => {
  it('the same instant near midnight is a different work date per company', () => {
    const at = '2026-11-19T20:30:00Z'
    expect(zonedParts(at, 'Asia/Dubai')).toEqual({ date: '2026-11-20', time: '00:30' })
    expect(zonedParts(at, 'Asia/Riyadh')).toEqual({ date: '2026-11-19', time: '23:30' })
  })

  it('late minutes are counted against the shift in the company timezone', () => {
    const entries = [{ id: 'a', checkInAt: '2026-11-18T05:15:00Z', checkOutAt: '2026-11-18T14:15:00Z' }]
    const dubai = computeDay(day({ entries }))
    expect(dubai.checkInLocal).toBe('09:15')
    expect(dubai.status).toBe('late')
    expect(dubai.lateMinutes).toBe(15)
    const riyadh = computeDay(day({ entries, timezone: 'Asia/Riyadh' }))
    expect(riyadh.checkInLocal).toBe('08:15')
    expect(riyadh.status).toBe('present')
    expect(riyadh.lateMinutes).toBe(0)
  })

  it('within the grace period is on time; one minute after is late from the shift start', () => {
    const at = (t: string) => [{ id: 'a', checkInAt: t, checkOutAt: '2026-11-18T14:00:00Z' }]
    expect(computeDay(day({ entries: at('2026-11-18T05:10:00Z') })).status).toBe('present')
    const late = computeDay(day({ entries: at('2026-11-18T05:11:00Z') }))
    expect([late.status, late.lateMinutes]).toEqual(['late', 11])
  })
})

describe('computeDay', () => {
  it('worked minutes (break deducted), overtime beyond the shift, early leave', () => {
    const ot = computeDay(day({ entries: [{ id: 'a', checkInAt: '2026-11-18T05:00:00Z', checkOutAt: '2026-11-18T16:00:00Z' }] }))
    expect(ot.minutesWorked).toBe(600) // 11 h − 1 h break
    expect(ot.overtimeMinutes).toBe(120) // scheduled 8 h
    const early = computeDay(day({ entries: [{ id: 'a', checkInAt: '2026-11-18T05:00:00Z', checkOutAt: '2026-11-18T13:00:00Z' }] }))
    expect(early.earlyLeaveMinutes).toBe(60)
    expect(early.overtimeMinutes).toBe(0)
  })

  it('a missing clock-out on a past day is flagged and not counted; today it is "open"', () => {
    const past = computeDay(day({ entries: [{ id: 'a', checkInAt: '2026-11-18T05:00:00Z', checkOutAt: null }] }))
    expect(past.missingCheckOut).toBe(true)
    expect(past.minutesWorked).toBe(0)
    const today = computeDay(day({ entries: [{ id: 'a', checkInAt: '2026-11-18T05:00:00Z', checkOutAt: null }], now: new Date('2026-11-18T08:00:00Z') }))
    expect(today.open).toBe(true)
    expect(today.missingCheckOut).toBe(false)
  })

  it('statuses: on_leave, holiday, weekend (all overtime), half_day, absent / in progress', () => {
    expect(computeDay(day({ leave: { typeName: 'Annual', halfDay: null } })).status).toBe('on_leave')
    expect(computeDay(day({ leave: { typeName: 'Annual', halfDay: 'am' } })).status).toBe('half_day')
    const hol = computeDay(day({ holidayName: 'National Day', entries: [{ id: 'a', checkInAt: '2026-11-18T05:00:00Z', checkOutAt: '2026-11-18T07:00:00Z' }] }))
    expect([hol.status, hol.overtimeMinutes]).toEqual(['holiday', 120])
    expect(computeDay(day({ date: '2026-11-21' })).status).toBe('weekend')
    expect(computeDay(day({})).status).toBe('absent')
    const morning = computeDay(day({ now: new Date('2026-11-18T06:00:00Z') }))
    expect([morning.status, morning.inProgress]).toEqual(['absent', true])
    expect(summarize([morning]).absent).toBe(0)
  })
})

describe('working days (weekend + public holidays excluded)', () => {
  const ae = new Map(defaultHolidays('AE', 2026).map((h) => [h.date, h.name]))
  const sa = new Map(defaultHolidays('SA', 2026).map((h) => [h.date, h.name]))

  it('Apex (Sat–Sun weekend, UAE National Day holidays)', () => {
    // Sun 29 Nov – Sat 5 Dec 2026: Mon 30 Nov and Fri 4 Dec; 1–3 Dec are public holidays.
    expect(workingDates('2026-11-29', '2026-12-05', [0, 6], ae)).toEqual(['2026-11-30', '2026-12-04'])
  })

  it('Crest (Fri–Sat weekend)', () => {
    expect(workingDates('2026-11-29', '2026-12-05', [5, 6], sa)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'])
    // Saudi National Day (Wed 23 Sep 2026) is excluded.
    expect(leaveDayCount('2026-09-20', '2026-09-24', null, [5, 6], sa).days).toBe(4)
  })

  it('half days count 0.5 on a working day, 0 on a weekend', () => {
    expect(leaveDayCount('2026-11-30', '2026-11-30', 'am', [0, 6], ae).days).toBe(0.5)
    expect(leaveDayCount('2026-11-29', '2026-11-29', 'pm', [0, 6], ae).days).toBe(0)
  })
})

describe('accrual', () => {
  const monthly = { daysPerYear: 30, accrual: 'monthly' as const }
  it('monthly: credited at the start of each month of service; the hire month counts up to the 15th', () => {
    expect(accruedDays(monthly, '2024-02-10', 2026, '2026-11-20')).toBe(27.5)
    expect(accruedDays(monthly, '2026-03-20', 2026, '2026-11-20')).toBe(20) // April–November
    expect(accruedDays(monthly, '2026-03-10', 2026, '2026-11-20')).toBe(22.5) // March–November
    expect(accruedDays(monthly, '2026-03-10', 2026, '2027-02-01')).toBe(25) // a past year: to December
    expect(accruedDays(monthly, '2027-01-05', 2026, '2026-11-20')).toBe(0)
  })
  it('yearly: upfront, prorated in the hire year (0.5 steps)', () => {
    expect(accruedDays({ daysPerYear: 21, accrual: 'yearly' }, '2026-07-10', 2026, '2026-07-11')).toBe(10.5)
    expect(accruedDays({ daysPerYear: 21, accrual: 'yearly' }, '2020-07-10', 2026, '2026-01-02')).toBe(21)
    expect(entitledDays(30, '2026-03-20', 2026)).toBe(22.5)
  })
  it('carry-over: last year’s leftover, capped', () => {
    const rule = { ...monthly, carryOverMax: 10 }
    expect(carriedDays(rule, '2024-01-01', 2026, 25)).toBe(5)
    expect(carriedDays(rule, '2024-01-01', 2026, 2)).toBe(10)
    expect(carriedDays(rule, '2026-01-01', 2026, 0)).toBe(0)
  })
})

describe('overlap', () => {
  it('ranges overlap; two different halves of the same day do not', () => {
    const r = (s: string, e: string, h: 'am' | 'pm' | null = null) => ({ startDate: s, endDate: e, halfDay: h })
    expect(rangesOverlap(r('2026-12-07', '2026-12-09'), r('2026-12-09', '2026-12-10'))).toBe(true)
    expect(rangesOverlap(r('2026-12-07', '2026-12-08'), r('2026-12-09', '2026-12-10'))).toBe(false)
    expect(rangesOverlap(r('2026-12-07', '2026-12-07', 'am'), r('2026-12-07', '2026-12-07', 'pm'))).toBe(false)
    expect(rangesOverlap(r('2026-12-07', '2026-12-07', 'am'), r('2026-12-07', '2026-12-07', 'am'))).toBe(true)
  })
})
