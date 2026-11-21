import { describe, expect, it } from 'vitest'
import {
  clipMonth,
  contractCoversMonth,
  daysToHire,
  employedOn,
  expiryBucket,
  funnel,
  gapToTarget,
  headcountOn,
  leftOn,
  monthEnd,
  monthlyPay,
  monthsBetween,
  nationalisationLabel,
  nationalisationOn,
  periodTurnover,
  resolveRange,
  companyToday,
  sharePct,
  tenureYears,
  toCsv,
  turnoverByMonth,
  turnoverPct,
} from './calc'

const emp = (hireDate: string, exitDate: string | null = null, extra: Partial<{ status: string; nationality: string; updatedAt: string }> = {}) => ({
  hireDate,
  exitDate,
  status: extra.status ?? (exitDate ? 'terminated' : 'active'),
  updatedAt: extra.updatedAt ?? `${hireDate}T08:00:00.000Z`,
  nationality: extra.nationality ?? 'IN',
})

describe('date range', () => {
  it('defaults to the company’s current year and takes point-in-time figures today', () => {
    expect(resolveRange('2026-11-20')).toEqual({ ok: true, from: '2026-01-01', to: '2026-12-31', asOf: '2026-11-20' })
  })
  it('asOf is the end of a past range and the start of a future one', () => {
    expect(resolveRange('2026-11-20', '2025-01-01', '2025-06-30')).toMatchObject({ asOf: '2025-06-30' })
    expect(resolveRange('2026-11-20', '2027-02-01', '2027-03-01')).toMatchObject({ asOf: '2027-02-01' })
  })
  it('rejects invalid, reversed and too long ranges', () => {
    expect(resolveRange('2026-11-20', '2026-02-30', '2026-03-01').ok).toBe(false)
    expect(resolveRange('2026-11-20', 'yesterday').ok).toBe(false)
    expect(resolveRange('2026-11-20', '2026-05-01', '2026-04-30').ok).toBe(false)
    expect(resolveRange('2026-11-20', '2020-01-01', '2026-01-01').ok).toBe(false)
    expect(resolveRange('2026-11-20', '2024-01-01', '2026-12-31').ok).toBe(true) // exactly 36 months
  })
  it('"this year" follows the company timezone at new year (Dubai is already in 2027, UTC still in 2026)', () => {
    const at = new Date('2026-12-31T21:30:00Z')
    const dubai = companyToday('Asia/Dubai', at)
    const utc = companyToday('UTC', at)
    expect(dubai).toBe('2027-01-01')
    expect(utc).toBe('2026-12-31')
    expect(resolveRange(dubai)).toMatchObject({ from: '2027-01-01', to: '2027-12-31' })
    expect(resolveRange(utc)).toMatchObject({ from: '2026-01-01', to: '2026-12-31' })
  })
  it('lists and clips months, including leap February', () => {
    expect(monthsBetween('2025-11-15', '2026-02-03')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthEnd('2024-02')).toBe('2024-02-29')
    expect(monthEnd('2026-02')).toBe('2026-02-28')
    expect(clipMonth('2025-11', '2025-11-15', '2026-02-03')).toEqual({ start: '2025-11-15', end: '2025-11-30' })
    expect(clipMonth('2026-02', '2025-11-15', '2026-02-03')).toEqual({ start: '2026-02-01', end: '2026-02-03' })
  })
})

describe('headcount', () => {
  it('counts an employee from the hire date through the last working day', () => {
    const e = emp('2026-03-10', '2026-06-30')
    expect(employedOn(e, '2026-03-09')).toBe(false)
    expect(employedOn(e, '2026-03-10')).toBe(true)
    expect(employedOn(e, '2026-06-30')).toBe(true)
    expect(employedOn(e, '2026-07-01')).toBe(false)
  })
  it('a terminated record without an exit date leaves on its last update', () => {
    const e = emp('2024-01-01', null, { status: 'terminated', updatedAt: '2026-04-02T10:00:00Z' })
    expect(leftOn(e)).toBe('2026-04-02')
    expect(employedOn(e, '2026-04-03')).toBe(false)
  })
  it('a notice-period employee with a future exit date still counts', () => {
    expect(headcountOn([emp('2025-01-01', '2026-12-31', { status: 'notice' })], '2026-11-20')).toBe(1)
  })
})

describe('turnover', () => {
  // 10 people on 1 Jan; 2 joiners in Feb; 1 leaver in Feb, 1 in Mar.
  const base = Array.from({ length: 10 }, () => emp('2025-01-01'))
  const rows = [...base.slice(0, 8), emp('2025-01-01', '2026-02-15'), emp('2025-01-01', '2026-03-31'), emp('2026-02-01'), emp('2026-02-20')]
  const months = turnoverByMonth(rows, '2026-01-01', '2026-03-31')
  it('monthly joiners, leavers, opening / closing and average headcount', () => {
    expect(months.map((m) => [m.month, m.joiners, m.leavers, m.opening, m.closing, m.averageHeadcount])).toEqual([
      ['2026-01', 0, 0, 10, 10, 10],
      ['2026-02', 2, 1, 10, 11, 10.5],
      ['2026-03', 0, 1, 11, 11, 11], // the March leaver's last day is 31 Mar: still on the payroll that day
    ])
    expect(months[1].turnoverPct).toBe(9.5) // 1 / 10.5
  })
  it('period turnover = leavers ÷ mean of the monthly averages', () => {
    const p = periodTurnover(months)
    expect(p).toEqual({ joiners: 2, leavers: 2, averageHeadcount: 10.5, turnoverPct: 19 })
  })
  it('no headcount → no rate (not 0 % and not Infinity)', () => {
    expect(turnoverPct(1, 0)).toBeNull()
    expect(periodTurnover([]).turnoverPct).toBeNull()
  })
  it('a range starting mid-month uses the day before as the opening', () => {
    const m = turnoverByMonth([emp('2026-05-10'), emp('2025-01-01', '2026-05-12')], '2026-05-10', '2026-05-20')
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ joiners: 1, leavers: 1, opening: 1, closing: 1 })
  })
  it('tenure in years', () => {
    expect(tenureYears('2024-11-20', '2026-11-20')).toBe(2)
    expect(tenureYears('2027-01-01', '2026-11-20')).toBe(0)
  })
})

describe('nationalisation', () => {
  const rows = [emp('2025-01-01', null, { nationality: 'AE' }), emp('2025-01-01', null, { nationality: 'AE' }), emp('2025-01-01'), emp('2025-01-01'), emp('2025-01-01'), emp('2026-06-01', null, { nationality: 'AE' })]
  it('share of nationals among the headcount on a day', () => {
    expect(nationalisationOn(rows, 'AE', '2026-01-31')).toEqual({ nationals: 2, total: 5, pct: 40 })
    expect(nationalisationOn(rows, 'AE', '2026-06-30')).toEqual({ nationals: 3, total: 6, pct: 50 })
    expect(nationalisationOn(rows, 'SA', '2026-06-30').pct).toBe(0)
    expect(nationalisationOn([], 'AE', '2026-06-30').pct).toBeNull()
  })
  it('labels and gap to target', () => {
    expect(nationalisationLabel('AE')).toBe('Emiratisation')
    expect(nationalisationLabel('SA')).toBe('Saudization')
    expect(nationalisationLabel('EG')).toBe('Nationalisation')
    expect(gapToTarget(40, 45.5)).toBe(5.5)
    expect(gapToTarget(50, 45)).toBe(0)
    expect(gapToTarget(null, 45)).toBeNull()
    expect(gapToTarget(40, null)).toBeNull()
  })
  it('shares round to one decimal', () => {
    expect(sharePct(1, 3)).toBe(33.3)
    expect(sharePct(0, 0)).toBeNull()
  })
})

describe('recruitment funnel', () => {
  const labels = { applied: 'Applied', screening: 'Screening', interview: 'Interview', assessment: 'Assessment', offer: 'Offer', hired: 'Hired' }
  it('counts every application in each stage it reached; conversion is from the previous stage', () => {
    const f = funnel(
      [
        { stage: 'applied' },
        { stage: 'screening' },
        { stage: 'interview' },
        { stage: 'rejected', interviewed: true },
        { stage: 'offer' },
        { stage: 'hired', offered: true, interviewed: true },
        { stage: 'withdrawn' },
        { stage: 'rejected', offered: true },
      ],
      labels,
    )
    expect(f.map((s) => [s.stage, s.reached, s.conversionPct])).toEqual([
      ['applied', 8, null],
      ['screening', 6, 75],
      ['interview', 5, 83.3],
      ['assessment', 3, 60],
      ['offer', 3, 100],
      ['hired', 1, 33.3],
    ])
  })
  it('an empty pipeline has no conversion rates', () => {
    expect(funnel([], labels).every((s) => s.reached === 0 && s.conversionPct === null)).toBe(true)
  })
  it('days to hire', () => {
    expect(daysToHire('2026-09-01T09:00:00Z', '2026-10-01T15:00:00Z')).toBe(30)
  })
})

describe('expiry buckets', () => {
  it('expired / 30 / 60 / 90 days, nothing beyond', () => {
    const t = '2026-11-20'
    expect(expiryBucket(t, '2026-11-19')).toBe('expired')
    expect(expiryBucket(t, '2026-11-20')).toBe('d30')
    expect(expiryBucket(t, '2026-12-20')).toBe('d30')
    expect(expiryBucket(t, '2026-12-21')).toBe('d60')
    expect(expiryBucket(t, '2027-02-18')).toBe('d90')
    expect(expiryBucket(t, '2027-02-19')).toBeNull()
  })
})

describe('committed pay', () => {
  const c = { status: 'active', startDate: '2026-03-15', endDate: '2026-08-10', basicSalary: 10000, housingAllowance: 2500, transportAllowance: 800, otherAllowance: 0 }
  it('monthly pay = basic + allowances; a contract covers every month it touches', () => {
    expect(monthlyPay(c)).toBe(13300)
    expect(contractCoversMonth(c, '2026-02')).toBe(false)
    expect(contractCoversMonth(c, '2026-03')).toBe(true)
    expect(contractCoversMonth(c, '2026-08')).toBe(true)
    expect(contractCoversMonth(c, '2026-09')).toBe(false)
    expect(contractCoversMonth({ ...c, status: 'draft' }, '2026-04')).toBe(false)
  })
})

describe('csv', () => {
  it('quotes and neutralises formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=SUM(A1)'], [1, null]])).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n1,')
  })
})
