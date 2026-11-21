import { describe, expect, it } from 'vitest'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { changePct, dso, fiscalYearStartOf, grossMarginPct, payrollCostPct, presetPeriod, sharePct, toDatePeriods, winRate } from './calc'

describe('KPI formulas', () => {
  it('win rate = won ÷ (won + lost) of the deals closed in the period', () => {
    expect(winRate(6, 3)).toBe(66.7)
    expect(winRate(4, 0)).toBe(100)
    expect(winRate(0, 5)).toBe(0)
    expect(winRate(0, 0)).toBeNull()
  })
  it('DSO = open receivables ÷ credit sales × days', () => {
    expect(dso(71400, 231918.47 * 1.05, 325)).toBe(95.3)
    expect(dso(1, 0, 30)).toBeNull()
  })
  it('payroll cost % = payroll expense ÷ revenue', () => {
    expect(payrollCostPct(25000, 100000)).toBe(25)
    expect(payrollCostPct(1027603, 231918.47)).toBe(443.1)
    expect(payrollCostPct(5000, 0)).toBeNull()
  })
  it('gross margin, change and share', () => {
    expect(grossMarginPct(200000, 50000)).toBe(75)
    expect(grossMarginPct(0, 10)).toBeNull()
    expect(changePct(120, 100)).toBe(20)
    expect(changePct(80, 100)).toBe(-20)
    expect(changePct(50, -100)).toBe(150)
    expect(changePct(10, 0)).toBeNull()
    expect(sharePct(38850, 71400)).toBe(54.4)
    expect(sharePct(1, 0)).toBeNull()
  })
})

describe('period comparisons in the company timezone', () => {
  // 31 Dec 2026, 20:30 UTC: already 1 Jan 2027 in Dubai (UTC+4), still 31 Dec 2026 in Riyadh (UTC+3).
  const instant = new Date('2026-12-31T20:30:00Z')

  it('the company’s today decides MTD / YTD and the last-year comparison', () => {
    const dubai = todayIsoIn('Asia/Dubai', instant)
    const riyadh = todayIsoIn('Asia/Riyadh', instant)
    expect(dubai).toBe('2027-01-01')
    expect(riyadh).toBe('2026-12-31')

    expect(toDatePeriods(dubai)).toEqual({
      mtd: { from: '2027-01-01', to: '2027-01-01' },
      mtdLy: { from: '2026-01-01', to: '2026-01-01' },
      ytd: { from: '2027-01-01', to: '2027-01-01' },
      ytdLy: { from: '2026-01-01', to: '2026-01-01' },
    })
    expect(toDatePeriods(riyadh)).toEqual({
      mtd: { from: '2026-12-01', to: '2026-12-31' },
      mtdLy: { from: '2025-12-01', to: '2025-12-31' },
      ytd: { from: '2026-01-01', to: '2026-12-31' },
      ytdLy: { from: '2025-01-01', to: '2025-12-31' },
    })
  })

  it('a fiscal year starting in April', () => {
    expect(fiscalYearStartOf('2026-03-31', 4)).toBe('2025-04-01')
    expect(fiscalYearStartOf('2026-04-01', 4)).toBe('2026-04-01')
    expect(toDatePeriods('2026-11-21', 4).ytd).toEqual({ from: '2026-04-01', to: '2026-11-21' })
    expect(toDatePeriods('2026-11-21', 4).ytdLy).toEqual({ from: '2025-04-01', to: '2025-11-21' })
  })

  it('leap day compares with 28 Feb', () => {
    expect(toDatePeriods('2028-02-29').mtdLy).toEqual({ from: '2027-02-01', to: '2027-02-28' })
  })

  it('presets as of the company’s today', () => {
    expect(presetPeriod('this_month', '2026-11-21')).toEqual({ from: '2026-11-01', to: '2026-11-21' })
    expect(presetPeriod('this_quarter', '2026-11-21')).toEqual({ from: '2026-10-01', to: '2026-11-21' })
    expect(presetPeriod('ytd', '2026-11-21')).toEqual({ from: '2026-01-01', to: '2026-11-21' })
    expect(presetPeriod('last_12', '2026-11-21')).toEqual({ from: '2025-12-01', to: '2026-11-21' })
    expect(presetPeriod('last_12', '2026-12-05')).toEqual({ from: '2026-01-01', to: '2026-12-05' })
    expect(presetPeriod('last_year', '2026-11-21')).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })
})
