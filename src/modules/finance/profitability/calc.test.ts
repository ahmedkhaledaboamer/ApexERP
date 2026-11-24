import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STANDARD_HOURS,
  daysInclusive,
  dso,
  eventCosts,
  eventRevenue,
  hourlyCost,
  labourCostOf,
  lastYear,
  marginPct,
  monthsIn,
  naturalAmount,
  perUnit,
  projectMargin,
  roiPct,
  sameRangeLastYear,
} from './calc'

describe('labour allocation', () => {
  it('hourly cost = monthly contract pay ÷ standard hours (default 176)', () => {
    expect(DEFAULT_STANDARD_HOURS).toBe(176)
    expect(hourlyCost(17600, 176)).toBe(100)
    expect(hourlyCost(16000, 160)).toBe(100)
    expect(hourlyCost(null, 176)).toBe(0)
    expect(hourlyCost(10000, 0)).toBe(0)
  })

  it('Σ hours × hourly cost; hours without a known pay are unrated and cost nothing', () => {
    const r = labourCostOf(
      [
        { hours: 10, monthlyPay: 17600 }, // 10 × 100
        { hours: 4.5, monthlyPay: 35200 }, // 4.5 × 200
        { hours: 3, monthlyPay: null }, // no employee / contract
      ],
      176,
    )
    expect(r).toEqual({ hours: 17.5, cost: 1900, unratedHours: 3 })
    // A different standard month changes the rate, never the hours.
    expect(labourCostOf([{ hours: 10, monthlyPay: 17600 }], 160).cost).toBe(1100)
  })
})

describe('project margin', () => {
  it('revenue − direct costs − labour, margin % of revenue', () => {
    expect(projectMargin(50000, 12000, 8000)).toEqual({ totalCost: 20000, margin: 30000, marginPct: 60 })
  })
  it('labour hidden (null) → margin before labour', () => {
    expect(projectMargin(50000, 12000, null)).toEqual({ totalCost: 12000, margin: 38000, marginPct: 76 })
  })
  it('negative margins and no revenue', () => {
    expect(projectMargin(1000, 1500, 200)).toEqual({ totalCost: 1700, margin: -700, marginPct: -70 })
    expect(projectMargin(0, 0, 342.9).marginPct).toBeNull()
    expect(marginPct(0, -10)).toBeNull()
  })
})

describe('events: no double counting', () => {
  it('a budget line billed through finance counts once (the bill), the rest of its actual is added', () => {
    // Ledger: 5,200 of event bills; one of them (2,000) is linked to the venue line whose actual is 2,500.
    const c = eventCosts(5200, [
      { actual: 2500, billed: 2000 }, // +500 not billed
      { actual: 3000, billed: 0 }, // +3,000 typed by the event team only
      { actual: 1000, billed: 1200 }, // over-billed: nothing extra (never negative)
    ])
    expect(c).toEqual({ ledger: 5200, budgetLines: 3500, total: 8700 })
  })
  it('a line fully billed adds nothing; no lines → ledger only', () => {
    expect(eventCosts(2000, [{ actual: 2000, billed: 2000 }]).total).toBe(2000)
    expect(eventCosts(0, []).total).toBe(0)
  })
  it('sponsorship: only the part not invoiced yet is added to the ledger income', () => {
    expect(eventRevenue(30000, 42500)).toEqual({ ledger: 30000, notInvoiced: 12500, total: 42500 })
    expect(eventRevenue(50000, 42500)).toEqual({ ledger: 50000, notInvoiced: 0, total: 50000 })
    expect(eventRevenue(0, 0).total).toBe(0)
  })
  it('ROI and per-unit costs', () => {
    expect(roiPct(15000, 10000)).toBe(50)
    expect(roiPct(0, 8700)).toBe(-100)
    expect(roiPct(5000, 0)).toBeNull()
    expect(perUnit(8700, 3)).toBe(2900)
    expect(perUnit(8700, 0)).toBeNull()
    expect(perUnit(0, 5)).toBeNull()
  })
})

describe('customer DSO', () => {
  it('open receivables ÷ credit sales × days in the period', () => {
    // 30 days, 60,000 invoiced, 20,000 still open → 10 days.
    expect(dso(20000, 60000, 30)).toBe(10)
    expect(dso(5985, 77070, daysInclusive('2026-01-01', '2026-11-21'))).toBe(25.2)
  })
  it('no sales in the period → null; nothing open → 0', () => {
    expect(dso(5000, 0, 90)).toBeNull()
    expect(dso(0, 1000, 90)).toBe(0)
  })
  it('days are inclusive calendar days', () => {
    expect(daysInclusive('2026-01-01', '2026-01-31')).toBe(31)
    expect(daysInclusive('2024-02-01', '2024-02-29')).toBe(29)
    expect(daysInclusive('2026-03-05', '2026-03-05')).toBe(1)
  })
})

describe('ledger signs and periods', () => {
  it('income is credit − debit (credit notes reduce it); expenses debit − credit', () => {
    expect(naturalAmount('income', 0, 1000)).toBe(1000)
    expect(naturalAmount('income', 1200, 0)).toBe(-1200)
    expect(naturalAmount('expense', 500, 0)).toBe(500)
    expect(naturalAmount('expense', 0, 50)).toBe(-50)
  })
  it('months of a range, capped to the latest ones', () => {
    expect(monthsIn('2025-11-15', '2026-02-03')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthsIn('2024-01-01', '2026-12-31', 3)).toEqual(['2026-10', '2026-11', '2026-12'])
  })
  it('same dates last year (29 Feb → 28 Feb)', () => {
    expect(lastYear('2026-11-21')).toBe('2025-11-21')
    expect(lastYear('2028-02-29')).toBe('2027-02-28')
    expect(sameRangeLastYear('2026-01-01', '2026-11-21')).toEqual({ from: '2025-01-01', to: '2025-11-21' })
  })
})
