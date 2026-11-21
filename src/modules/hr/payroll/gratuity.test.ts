import { describe, expect, it } from 'vitest'
import { addDays, buildMudadCsv, buildSif, computeLine, defaultSocialInsurance, gratuity, inclusiveDays, installmentDue, ksaResignationFactor, loanSchedule, r2 } from './calc'

/**
 * Worked examples of the end-of-service award (both countries), the payroll line arithmetic (proration,
 * deductions, social insurance) and the bank files. Service of N years = N × 365 calendar days, both ends
 * included (start 2014-01-01).
 */

const START = '2014-01-01'
/** The last day of exactly `years` × 365 days of service. */
const endAfter = (years: number) => addDays(START, Math.round(years * 365) - 1)

describe('UAE gratuity (Federal Decree-Law 33/2021)', () => {
  const uae = (years: number, basic = 10_000, reason: 'resignation' | 'termination' = 'termination', unpaidLeaveDays = 0) =>
    gratuity({ country: 'AE', reason, basic, housing: 2_500, startDate: START, endDate: endAfter(years), unpaidLeaveDays })

  it('less than 1 year: nothing', () => {
    const g = uae(0.9)
    expect(g.eligible).toBe(false)
    expect(g.amount).toBe(0)
  })

  it('3 years: 21 days a year on the basic only (daily wage = basic × 12 / 365)', () => {
    const g = uae(3)
    expect(g.serviceDays).toBe(1095)
    expect(g.dailyWage).toBe(328.77)
    // 3 × 21 = 63 days × 10,000 × 12 / 365
    expect(g.amount).toBe(r2((63 * 10_000 * 12) / 365))
    expect(g.amount).toBe(20_712.33)
  })

  it('7 years: 5 × 21 + 2 × 30 = 165 days', () => {
    expect(uae(7).amount).toBe(r2((165 * 10_000 * 12) / 365))
  })

  it('12 years: 105 + 7 × 30 = 315 days, under the cap', () => {
    const g = uae(12)
    expect(g.amount).toBe(r2((315 * 10_000 * 12) / 365))
    expect(g.capped).toBe(false)
  })

  it('partial years are prorated (1.4 years = 29.4 days)', () => {
    expect(uae(1.4).amount).toBe(r2((29.4 * 10_000 * 12) / 365))
  })

  it('is capped at 2 years’ basic wage (30 years → 24 × basic)', () => {
    const g = uae(30)
    expect(g.fullAmount).toBeGreaterThan(240_000)
    expect(g.capped).toBe(true)
    expect(g.amount).toBe(240_000)
  })

  it('a resignation does not reduce it', () => {
    expect(uae(3, 10_000, 'resignation').amount).toBe(uae(3, 10_000, 'termination').amount)
    expect(uae(3, 10_000, 'resignation').factor).toBe(1)
  })

  it('unpaid leave days are not service (and can drop it under 1 year)', () => {
    const g = uae(3, 10_000, 'termination', 30)
    expect(g.serviceDays).toBe(1065)
    expect(g.amount).toBe(r2((((1065 / 365) * 21 * 10_000 * 12) / 365)))
    expect(uae(1.05, 10_000, 'termination', 30).eligible).toBe(false)
  })
})

describe('KSA end-of-service award (Labor Law art. 84–85)', () => {
  const ksa = (years: number, reason: 'resignation' | 'termination' | 'contract_end') =>
    gratuity({ country: 'SA', reason, basic: 8_000, housing: 2_000, startDate: START, endDate: endAfter(years) })

  it('wage basis basic + housing; half a month a year for 5 years, a month after', () => {
    expect(ksa(3, 'termination').amount).toBe(15_000) // 1.5 × 10,000
    expect(ksa(7, 'termination').amount).toBe(45_000) // 2.5 + 2
    expect(ksa(12, 'termination').amount).toBe(95_000) // 2.5 + 7
    expect(ksa(12, 'contract_end').amount).toBe(95_000)
  })

  it('basic-only basis when configured', () => {
    expect(gratuity({ country: 'SA', reason: 'termination', basic: 8_000, housing: 2_000, startDate: START, endDate: endAfter(3), basis: 'basic' }).amount).toBe(12_000)
  })

  it('resignation: < 2 years nothing, 2–5 one third, 5–10 two thirds, ≥ 10 full', () => {
    expect(ksa(1.4, 'resignation').amount).toBe(0)
    expect(ksa(1.4, 'termination').amount).toBe(7_000)
    expect(ksa(3, 'resignation').amount).toBe(5_000)
    expect(ksa(7, 'resignation').amount).toBe(30_000)
    expect(ksa(12, 'resignation').amount).toBe(95_000)
    expect([1.99, 2, 4.99, 5, 9.99, 10].map(ksaResignationFactor)).toEqual([0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1])
  })

  it('partial years are prorated (6.4 years, termination = 2.5 + 1.4 months)', () => {
    expect(ksa(6.4, 'termination').amount).toBe(39_000)
  })
})

describe('payroll line', () => {
  const si = defaultSocialInsurance('AE')
  const base = { month: '2026-11', contract: { basic: 12_000, housing: 3_000, transport: 1_000, other: 0 }, unpaidLeaveDays: 0, absenceDays: 0, overtimeMinutes: 0, overtime: { enabled: false, multiplier: 1.25 }, national: false, si, adjustments: [], loans: [] }

  it('a full month for an expat: earnings = contract, no social insurance', () => {
    const l = computeLine({ ...base, window: { start: '2026-11-01', end: '2026-11-30' } })
    expect(l.paidDays).toBe(30)
    expect(l.gross).toBe(16_000)
    expect(l.net).toBe(16_000)
    expect(l.employerSocialInsurance).toBe(0)
    expect(l.employerCost).toBe(16_000)
  })

  it('a joiner on the 10th is paid 21 of 30 calendar days', () => {
    const l = computeLine({ ...base, window: { start: '2026-11-10', end: '2026-11-30' } })
    expect(l.paidDays).toBe(21)
    expect(l.basic).toBe(8_400)
    expect(l.gross).toBe(r2((16_000 * 21) / 30))
  })

  it('unpaid leave and absence are deducted at the calendar daily rate; UAE national pays GPSSA 11 % / employer 12.5 %', () => {
    const l = computeLine({ ...base, national: true, unpaidLeaveDays: 2, absenceDays: 1, window: { start: '2026-11-01', end: '2026-11-30' } })
    const daily = 16_000 / 30
    expect(l.items.find((i) => i.code === 'unpaid_leave')!.amount).toBe(r2(2 * daily))
    expect(l.items.find((i) => i.code === 'absence')!.amount).toBe(r2(daily))
    expect(l.employeeSocialInsurance).toBe(1_650) // 11 % of 15,000
    expect(l.employerSocialInsurance).toBe(1_875) // 12.5 %
    expect(l.net).toBe(r2(16_000 - r2(2 * daily) - r2(daily) - 1_650))
    expect(l.employerCost).toBe(17_875)
  })

  it('KSA: Saudi 9.75 % / 11.75 % capped at 45,000; non-Saudi employer 2 % only', () => {
    const sa = defaultSocialInsurance('SA')
    const rich = { ...base, si: sa, contract: { basic: 50_000, housing: 10_000, transport: 0, other: 0 }, window: { start: '2026-11-01', end: '2026-11-30' } }
    expect(computeLine({ ...rich, national: true }).employeeSocialInsurance).toBe(4_387.5)
    expect(computeLine({ ...rich, national: true }).employerSocialInsurance).toBe(5_287.5)
    const expat = computeLine({ ...base, si: sa, national: false, window: { start: '2026-11-01', end: '2026-11-30' } })
    expect(expat.employeeSocialInsurance).toBe(0)
    expect(expat.employerSocialInsurance).toBe(300)
  })

  it('loans, adjustments, overtime; variable pay = overtime + allowances / bonuses', () => {
    const l = computeLine({
      ...base,
      window: { start: '2026-11-01', end: '2026-11-30' },
      overtimeMinutes: 600,
      overtime: { enabled: true, multiplier: 1.25 },
      adjustments: [
        { id: 'A1', kind: 'bonus', label: 'Bonus', amount: 1_000 },
        { id: 'A2', kind: 'deduction', label: 'Fine', amount: 200 },
      ],
      loans: [{ id: 'L1', label: 'Loan repayment', amount: 500 }],
    })
    const ot = r2(10 * (12_000 / 30 / 8) * 1.25)
    expect(l.items.find((i) => i.code === 'overtime')!.amount).toBe(ot)
    expect(l.gross).toBe(r2(16_000 + ot + 1_000))
    expect(l.totalDeductions).toBe(700)
    expect(l.variablePay).toBe(r2(ot + 1_000))
    expect(r2(l.fixedPay + l.variablePay)).toBe(l.net)
  })

  it('no contract → nothing paid', () => {
    const l = computeLine({ ...base, contract: null, window: null })
    expect(l.gross).toBe(0)
    expect(l.items).toEqual([])
  })
})

describe('loans', () => {
  const loan = { principal: 4_500, installmentAmount: 2_000, startMonth: '2026-09' }
  it('the last installment is what is left; nothing before the start month', () => {
    expect(installmentDue(loan, 0, '2026-08')).toBe(0)
    expect(installmentDue(loan, 4_000, '2026-11')).toBe(500)
    expect(loanSchedule(loan, [{ runId: 'PR-1', month: '2026-09', amount: 2_000, source: 'run' }])).toEqual([
      { month: '2026-09', amount: 2_000, status: 'paid' },
      { month: '2026-10', amount: 2_000, status: 'planned' },
      { month: '2026-11', amount: 500, status: 'planned' },
    ])
  })
})

describe('bank files', () => {
  it('WPS SIF: an EDR per employee and the SCR control line; file name <employer><yyMMdd><HHmmss>.SIF', () => {
    const f = buildSif({
      employerId: '1000000425517',
      routingCode: '803320101',
      localDate: '2026-11-28',
      localTime: '09:05:07',
      month: '2026-11',
      reference: 'PR-1004',
      lines: [
        { personId: '10004829310001', routingCode: '803320101', iban: 'AE070331234567890123456', payStart: '2026-11-01', payEnd: '2026-11-30', days: 30, fixed: 15_000, variable: 1_250.5, leaveDays: 2 },
        { personId: '10004829317920', routingCode: '602620101', iban: 'AE460260001015333439101', payStart: '2026-11-10', payEnd: '2026-11-30', days: 21, fixed: 7_350, variable: 0, leaveDays: 0 },
      ],
    })
    expect(f.fileName).toBe('1000000425517261128090507.SIF')
    const lines = f.content.trim().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('EDR,10004829310001,803320101,AE070331234567890123456,2026-11-01,2026-11-30,30,15000.00,1250.50,2')
    expect(lines[2]).toBe('SCR,1000000425517,803320101,2026-11-28,0905,112026,2,23600.50,AED,PR-1004')
    expect(f.total).toBe(23_600.5)
  })

  it('Mudad CSV: header + one row per employee, CSV-quoted', () => {
    const f = buildMudadCsv('7-0012345', '2026-11', [{ personId: '2412345678', name: 'Ramesh, Nair', bank: 'SNB', iban: 'SA4480000000608010167519', basic: 6_000, housing: 1_500, otherAllowances: 1_000, deductions: 120, net: 8_380 }])
    const rows = f.content.trim().split('\r\n')
    expect(rows[0]).toContain('Employee ID / Iqama')
    expect(rows[1]).toBe('2412345678,"Ramesh, Nair",SNB,SA4480000000608010167519,6000.00,1500.00,1000.00,120.00,8380.00')
    expect(f.fileName).toBe('mudad-7-0012345-2026-11.csv')
  })

  it('inclusiveDays counts both ends', () => {
    expect(inclusiveDays('2026-11-10', '2026-11-30')).toBe(21)
    expect(inclusiveDays('2026-11-30', '2026-11-10')).toBe(0)
  })
})
