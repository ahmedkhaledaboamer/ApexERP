import { describe, expect, it } from 'vitest'
import { addDaysIso, companyDay, daysBetweenIso, todayIsoIn, weekEndIso, weekStartIso, weekdayOfIso, workingWeekLabel } from '@/shared/lib/companyDay'

// 22:30 UTC on Wednesday 18 Nov 2026 = 01:30 on Thursday 19 Nov in Riyadh (UTC+3) and Dubai (UTC+4).
const LATE_UTC = new Date('2026-11-18T22:30:00Z')

describe('company calendar days', () => {
  it('today is the company’s date, not UTC’s or the machine’s', () => {
    expect(todayIsoIn('UTC', LATE_UTC)).toBe('2026-11-18')
    expect(todayIsoIn('Asia/Riyadh', LATE_UTC)).toBe('2026-11-19')
    expect(todayIsoIn('Asia/Dubai', LATE_UTC)).toBe('2026-11-19')
    // West of UTC it is still the 18th in the afternoon.
    expect(todayIsoIn('America/New_York', LATE_UTC)).toBe('2026-11-18')
  })

  it('a date that is "tomorrow" in Riyadh is "today" in UTC', () => {
    const riyadh = companyDay({ timezone: 'Asia/Riyadh', weekStartsOn: 0 }, LATE_UTC)
    const utc = companyDay({ timezone: 'UTC', weekStartsOn: 0 }, LATE_UTC)
    expect(utc.today).toBe('2026-11-18')
    expect(riyadh.yesterday).toBe('2026-11-18')
    expect(utc.tomorrow).toBe(riyadh.today)
  })

  it('an unknown timezone falls back to UTC instead of throwing', () => {
    expect(todayIsoIn('Not/AZone', LATE_UTC)).toBe('2026-11-18')
  })

  it('date arithmetic crosses months, years and leap days', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetweenIso('2026-11-18', '2026-11-25')).toBe(7)
    expect(daysBetweenIso('2026-11-25', '2026-11-18')).toBe(-7)
    expect(weekdayOfIso('2026-11-18')).toBe(3) // Wednesday
  })

  it('weeks start on the company’s day: Saturday, Sunday or Monday', () => {
    // Friday 20 Nov 2026.
    expect(weekStartIso('2026-11-20', 6)).toBe('2026-11-14') // Saturday start
    expect(weekEndIso('2026-11-20', 6)).toBe('2026-11-20')
    expect(weekStartIso('2026-11-20', 0)).toBe('2026-11-15') // Sunday start
    expect(weekEndIso('2026-11-20', 0)).toBe('2026-11-21')
    expect(weekStartIso('2026-11-20', 1)).toBe('2026-11-16') // Monday start
    expect(weekEndIso('2026-11-20', 1)).toBe('2026-11-22')
    // A Saturday starts its own Saturday week.
    expect(weekStartIso('2026-11-21', 6)).toBe('2026-11-21')
  })

  it('companyDay gives the whole week by the company’s week start', () => {
    const fri = new Date('2026-11-20T08:00:00Z')
    expect(companyDay({ timezone: 'Asia/Dubai', weekStartsOn: 6 }, fri)).toMatchObject({ today: '2026-11-20', weekStart: '2026-11-14', weekEnd: '2026-11-20', weekStartsOn: 6 })
    expect(companyDay({ timezone: 'Asia/Dubai', weekStartsOn: 1 }, fri)).toMatchObject({ weekStart: '2026-11-16', weekEnd: '2026-11-22' })
    // An invalid week start falls back to Monday.
    expect(companyDay({ timezone: 'UTC', weekStartsOn: 9 }, fri).weekStartsOn).toBe(1)
  })

  it('labels the working week from the weekend', () => {
    expect(workingWeekLabel([0, 6])).toBe('Mon–Fri')
    expect(workingWeekLabel([5, 6])).toBe('Sun–Thu')
    expect(workingWeekLabel([5])).toBe('Sat–Thu')
    expect(workingWeekLabel([])).toBe('Every day')
    expect(workingWeekLabel([0, 2, 4, 6])).toBe('Mon, Wed, Fri')
  })
})
