import { describe, expect, it } from 'vitest'
import { notifications } from '@/shared/mocks/data/tasks'
import { auditLog } from '@/shared/mocks/data/audit'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import { hrContracts, hrProfiles } from '@/shared/mocks/data/hrPeople'
import { hrAttendance, hrLeaveRequests, hrLeaveTypes } from '@/shared/mocks/data/hrTime'
import { hrFinalSettlements, hrPayLoans, hrPayrollProfiles, hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { addMonths, daysInMonth, inclusiveDays, r2 } from '@/modules/hr/payroll/calc'
import { workingDates } from '@/modules/hr/time/calc'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyById } from '@/shared/mocks/data/tenancy'
import { holidayMap } from '@/shared/mocks/services/attendance'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * HR › Salary Management through the real handlers: the seed, a run from calculation to paid (proration of a
 * joiner, unpaid leave, the absence rule, loans, adjustments, social insurance, warnings), maker–checker,
 * immutability, payslip scopes, the bank files, the final settlement and the offboarding step, masking.
 */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const hrApex = as('u9') // HR Manager
const mdApex = as('u2') // Management (second approver)
const adminCrest = as('u101')
const mgmtCrest = as('u102')
const crestOn = () => moduleOverrides.push({ companyId: 'co_crest', module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
const today = (co = 'co_apex') => companyDayOf(co).today
const cur = (co = 'co_apex') => today(co).slice(0, 7)
const runOf = (co: string, month: string) => hrPayrollRuns.find((r) => r.companyId === co && r.month === month)!
const lineOf = (body: { lines: { employee_id: string }[] }, emp: string) => body.lines.find((l) => l.employee_id === emp) as any // eslint-disable-line @typescript-eslint/no-explicit-any
const item = (line: { items: { code: string; amount: number }[] }, code: string) => line.items.find((i) => i.code === code)?.amount ?? 0

describe('seed', () => {
  it('both companies: three paid months, a draft for the current month, different data', () => {
    for (const co of ['co_apex', 'co_crest']) {
      const runs = hrPayrollRuns.filter((r) => r.companyId === co).sort((a, b) => a.month.localeCompare(b.month))
      expect(runs.map((r) => r.status)).toEqual(['paid', 'paid', 'paid', 'draft'])
      expect(runs[3].month).toBe(cur(co))
      expect(runs[0].month).toBe(addMonths(cur(co), -3))
      expect(runs[2].lines.length).toBeGreaterThan(5)
    }
    expect(runOf('co_apex', addMonths(cur(), -1)).currency).toBe('AED')
    expect(runOf('co_crest', addMonths(cur('co_crest'), -1)).currency).toBe('SAR')
  })

  it('a loan in repayment, a joiner this month, unpaid leave deducted (Crest, last month)', () => {
    const loan = hrPayLoans.find((l) => l.companyId === 'co_apex' && l.employeeId === 'EMP-u14')!
    expect(loan.status).toBe('active')
    expect(loan.repayments.map((r) => r.amount)).toEqual([1000, 1000, 1000])
    expect(employeeById('co_apex', 'EMP-X4')!.hireDate.slice(0, 7)).toBe(cur())
    expect(hrContracts.some((c) => c.employeeId === 'EMP-X4' && c.status === 'active')).toBe(true)
    const crestLast = runOf('co_crest', addMonths(cur('co_crest'), -1))
    const ramesh = crestLast.lines.find((l) => l.employeeId === 'EMP-X102')!
    expect(ramesh.unpaidLeaveDays).toBe(2)
    expect(item(ramesh, 'unpaid_leave')).toBeGreaterThan(0)
    // The Crest advance: two installments paid, one to go.
    const adv = hrPayLoans.find((l) => l.companyId === 'co_crest')!
    expect(adv.repayments).toHaveLength(2)
  })
})

describe('a monthly run (Apex)', () => {
  it('calculate → lines from the contracts; joiner prorated; unpaid leave; loan; adjustment; GPSSA for a national; warnings', async () => {
    const run = runOf('co_apex', cur())
    const res = await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`)
    expect(res.status, res.text).toBe(200)
    expect(res.body.status).toBe('calculated')
    const dim = daysInMonth(cur())
    // Joiner: hired this month → paid calendar days from the hire date.
    const joiner = lineOf(res.body, 'EMP-X4')
    const hire = employeeById('co_apex', 'EMP-X4')!.hireDate
    expect(joiner.paid_days).toBe(inclusiveDays(hire, `${cur()}-${dim}`))
    expect(item(joiner, 'basic')).toBe(r2((9000 * joiner.paid_days) / dim))
    expect(joiner.warnings.map((w: { code: string }) => w.code)).toContain('no_iban')
    // Emirati joiner: GPSSA 11 % / 12.5 % of basic + housing.
    expect(joiner.employee_social_insurance).toBe(r2(((item(joiner, 'basic') + item(joiner, 'housing')) * 11) / 100))
    expect(joiner.employer_social_insurance).toBe(r2(((item(joiner, 'basic') + item(joiner, 'housing')) * 12.5) / 100))
    // Unpaid leave of Priya (EMP-u6): 2 working days × monthly fixed / days in month.
    const fatima = lineOf(res.body, 'EMP-u6')
    const c = hrContracts.find((x) => x.employeeId === 'EMP-u6' && x.status === 'active')!
    expect(fatima.unpaid_leave_days).toBe(2)
    expect(item(fatima, 'unpaid_leave')).toBe(r2((2 * (c.basicSalary + c.housingAllowance + c.transportAllowance + c.otherAllowance)) / dim))
    // Loan installment and the one-off deduction.
    expect(item(lineOf(res.body, 'EMP-u14'), 'loan:' + hrPayLoans.find((l) => l.employeeId === 'EMP-u14')!.id)).toBe(1000)
    expect(lineOf(res.body, 'EMP-u12').items.some((i: { label: string }) => i.label.startsWith('Traffic fine'))).toBe(true)
    // Missing WPS id warning; cash-paid driver has no bank warnings.
    expect(lineOf(res.body, 'EMP-X3').warnings.map((w: { code: string }) => w.code)).toContain('no_person_id')
    expect(lineOf(res.body, 'EMP-X1').warnings).toEqual([])
    // Totals add up.
    const lines = res.body.lines as { gross: number; total_deductions: number; net: number }[]
    for (const l of lines) expect(r2(l.gross - l.total_deductions)).toBe(l.net)
    expect(res.body.totals.net).toBe(r2(lines.reduce((s, l) => s + l.net, 0)))
  })

  it('maker–checker, warnings, approve, pay (locked), loan + adjustments applied, notifications once', async () => {
    const run = runOf('co_apex', cur())
    await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`)
    await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`) // re-calculation refreshes, no second notice
    const awaiting = notifications.filter((n) => n.type === 'hr-payroll' && n.link.includes(run.id))
    expect(awaiting.map((n) => n.userId).sort()).toEqual(['u1', 'u2']) // every other HR-full user, once
    expect((await hrApex('POST', `/hr/payroll/runs/${run.id}/approve`)).body.code).toBe('maker_checker')
    const blocked = await mdApex('POST', `/hr/payroll/runs/${run.id}/approve`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('unresolved_warnings')
    const ack = await mdApex('POST', `/hr/payroll/runs/${run.id}/acknowledge`, { all: true })
    expect(ack.body.open_warnings).toBe(0)
    const ok = await mdApex('POST', `/hr/payroll/runs/${run.id}/approve`)
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.approved_by_name).toBe('Layla Mansour')
    expect((await mdApex('POST', `/hr/payroll/runs/${run.id}/calculate`)).status).toBe(409)
    const paid = await hrApex('POST', `/hr/payroll/runs/${run.id}/pay`)
    expect(paid.status, paid.text).toBe(200)
    expect(paid.body.status).toBe('paid')
    for (const p of ['calculate', 'reopen', 'approve']) expect((await hrApex('POST', `/hr/payroll/runs/${run.id}/${p}`)).status).toBe(409)
    expect((await hrApex('DELETE', `/hr/payroll/runs/${run.id}`)).status).toBe(409)
    const loan = hrPayLoans.find((l) => l.employeeId === 'EMP-u14')!
    expect(loan.repayments).toHaveLength(4)
    // The paid one-off can't change any more; a correction goes into a later month.
    const fine = (await hrApex('GET', '/hr/payroll/adjustments')).body.find((a: { label: string }) => a.label.startsWith('Traffic fine'))
    expect(fine.locked).toBe(true)
    expect((await hrApex('PATCH', `/hr/payroll/adjustments/${fine.id}`, { amount: 100 })).status).toBe(409)
    expect((await hrApex('POST', '/hr/payroll/adjustments', { employee_id: 'EMP-u12', kind: 'allowance', label: 'Refund', amount: 100, month: cur() })).body.code).toBe('month_paid')
    expect((await hrApex('POST', '/hr/payroll/adjustments', { employee_id: 'EMP-u12', kind: 'allowance', label: 'Refund', amount: 100, month: addMonths(cur(), 1) })).status).toBe(200)
    // Payslip available → the employee, once.
    const slips = notifications.filter((n) => n.type === 'hr-payroll' && n.userId === 'u11' && n.title.includes('payslip'))
    expect(slips).toHaveLength(1)
    expect(slips[0].companyId).toBe('co_apex')
    expect(auditLog.some((a) => a.entityId === run.id && a.summary.includes('paid'))).toBe(true)
  })

  it('reopen sends a calculated run back to draft; a new month can be created once', async () => {
    const run = runOf('co_apex', cur())
    await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`)
    expect((await hrApex('POST', `/hr/payroll/runs/${run.id}/reopen`)).body.status).toBe('draft')
    expect((await mdApex('POST', `/hr/payroll/runs/${run.id}/approve`)).status).toBe(409)
    expect((await hrApex('POST', '/hr/payroll/runs', { month: cur() })).body.code).toBe('run_exists')
    expect((await hrApex('POST', '/hr/payroll/runs', { month: addMonths(cur(), -5) })).body.code).toBe('month_paid')
    const next = await hrApex('POST', '/hr/payroll/runs', { month: addMonths(cur(), 1) })
    expect(next.status, next.text).toBe(200)
    // Paying out of order is refused.
    await hrApex('POST', `/hr/payroll/runs/${next.body.id}/calculate`)
    await mdApex('POST', `/hr/payroll/runs/${next.body.id}/acknowledge`, { all: true })
    expect((await mdApex('POST', `/hr/payroll/runs/${next.body.id}/approve`)).status).toBe(200)
    expect((await hrApex('POST', `/hr/payroll/runs/${next.body.id}/pay`)).body.code).toBe('earlier_run_unpaid')
  })
})

describe('the absence rule', () => {
  it('a working day without a clock-in (and no leave / holiday) after the first recorded attendance is deducted; no attendance at all → none', async () => {
    const co = 'co_apex'
    const c = companyById(co)!.regional
    const run = runOf(co, cur())
    const before = lineOf((await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`)).body, 'EMP-u11')
    // A past working day of this month on which Noura clocked in, before the cut-off (25th) and yesterday.
    const limit = [`${cur()}-25`, today()].sort()[0]
    const day = workingDates(`${cur()}-01`, limit, c.weekend, holidayMap(co))
      .filter((d) => d < today())
      .find((d) => hrAttendance.some((a) => a.companyId === co && a.employeeId === 'EMP-u11' && a.workDate === d) && !hrLeaveRequests.some((r) => r.employeeId === 'EMP-u11' && r.status === 'approved' && r.startDate <= d && r.endDate >= d))
    if (!day || hrAttendance.filter((a) => a.employeeId === 'EMP-u11' && a.workDate < day).length === 0) return // too early in the month to test
    for (let i = hrAttendance.length - 1; i >= 0; i--) if (hrAttendance[i].employeeId === 'EMP-u11' && hrAttendance[i].workDate === day) hrAttendance.splice(i, 1)
    const after = lineOf((await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`)).body, 'EMP-u11')
    expect(after.absence_days).toBe(before.absence_days + 1)
    const cc = hrContracts.find((x) => x.employeeId === 'EMP-u11' && x.status === 'active')!
    expect(item(after, 'absence')).toBe(r2(((before.absence_days + 1) * (cc.basicSalary + cc.housingAllowance + cc.transportAllowance + cc.otherAllowance)) / daysInMonth(cur())))
    // Approved leave on that day excuses it again.
    hrLeaveRequests.push({ companyId: co, id: 'LVR-9999', employeeId: 'EMP-u11', leaveTypeId: hrLeaveTypes.find((t) => t.companyId === co && t.code === 'annual')!.id, startDate: day, endDate: day, halfDay: null, days: 1, reason: 't', documentName: null, status: 'approved', approvals: [], submittedAt: '', submittedBy: 'u11', cancelledAt: null, cancelledBy: null })
    expect(lineOf((await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`)).body, 'EMP-u11').absence_days).toBe(before.absence_days)
    // An employee who never clocks in is not "absent" (not tracked): remove every entry of Noura.
    for (let i = hrAttendance.length - 1; i >= 0; i--) if (hrAttendance[i].employeeId === 'EMP-u11') hrAttendance.splice(i, 1)
    expect(lineOf((await hrApex('POST', `/hr/payroll/runs/${run.id}/calculate`)).body, 'EMP-u11').absence_days).toBe(0)
    // Switching the setting off removes the deduction.
    expect((await hrApex('PATCH', '/hr/payroll/settings', { deduct_absences: false })).status).toBe(200)
  })
})

describe('payslips', () => {
  it('HR full sees every paid one; an employee and a department head only their own; a hidden role 403', async () => {
    const all = await hrApex('GET', '/hr/payroll/payslips')
    expect(all.status).toBe(200)
    const paidLines = hrPayrollRuns.filter((r) => r.companyId === 'co_apex' && r.status === 'paid').flatMap((r) => r.lines.filter((l) => l.paidDays > 0))
    expect(all.body).toHaveLength(paidLines.length)
    for (const [uid, emp] of [['u11', 'EMP-u11'], ['u10', 'EMP-u10']]) {
      const own = await as(uid)('GET', '/hr/payroll/payslips')
      expect(own.status).toBe(200)
      expect(own.body.length).toBe(3)
      expect(new Set(own.body.map((p: { employee_id: string }) => p.employee_id))).toEqual(new Set([emp]))
      const mine = await as(uid)('GET', `/hr/payroll/payslips/${own.body[0].id}`)
      expect(mine.status).toBe(200)
      expect(mine.body.items.length).toBeGreaterThan(0)
      expect(mine.body.iban_masked).toMatch(/^•••• /)
      const other = paidLines.find((l) => l.employeeId !== emp)!
      expect((await as(uid)('GET', `/hr/payroll/payslips/${other.id}`)).status).toBe(404)
      expect((await as(uid)('GET', '/hr/payroll/runs')).status).toBe(403)
    }
    expect((await as('u3')('GET', '/hr/payroll/payslips')).status).toBe(403)
    // The current month is not paid: no payslip yet.
    expect(all.body.some((p: { month: string }) => p.month === cur())).toBe(false)
  })
})

describe('bank files', () => {
  it('Apex WPS SIF: EDR per bank-paid employee with id + IBAN, SCR total = their net; cash / missing id skipped; audited', async () => {
    const run = runOf('co_apex', addMonths(cur(), -1))
    const res = await hrApex('POST', `/hr/payroll/runs/${run.id}/bank-file`, { format: 'wps' })
    expect(res.status, res.text).toBe(200)
    expect(res.body.file_name).toMatch(/^1000000425517\d{12}\.SIF$/)
    const rows = (res.body.content as string).trim().split('\r\n')
    const edr = rows.filter((r) => r.startsWith('EDR,'))
    expect(edr).toHaveLength(res.body.count)
    const included = run.lines.filter((l) => l.payMethod === 'bank' && l.net > 0 && hrPayrollProfiles.find((p) => p.employeeId === l.employeeId)?.personId && hrProfiles.find((p) => p.employeeId === l.employeeId)?.iban)
    expect(res.body.count).toBe(included.length)
    const scr = rows[rows.length - 1].split(',')
    expect(scr[0]).toBe('SCR')
    expect(scr[6]).toBe(String(included.length))
    expect(Number(scr[7])).toBeCloseTo(included.reduce((s, l) => s + l.net, 0), 2)
    expect(scr[8]).toBe('AED')
    expect(res.body.skipped.map((s: { employee_id: string }) => s.employee_id)).toEqual(expect.arrayContaining(['EMP-X1', 'EMP-X3']))
    const iban = hrProfiles.find((p) => p.employeeId === included[0].employeeId)!.iban
    expect(res.body.content).toContain(iban)
    expect(auditLog.some((a) => a.entityId === run.id && a.summary.includes('WPS'))).toBe(true)
    expect((await hrApex('POST', `/hr/payroll/runs/${run.id}/bank-file`, { format: 'mudad' })).status).toBe(422)
    expect((await as('u11')('POST', `/hr/payroll/runs/${run.id}/bank-file`, { format: 'wps' })).status).toBe(403)
    expect((await hrApex('POST', `/hr/payroll/runs/${runOf('co_apex', cur()).id}/bank-file`, { format: 'wps' })).body.code).toBe('run_not_approved')
  })

  it('Crest Mudad CSV (iqama / national id, IBAN, net)', async () => {
    crestOn()
    const run = runOf('co_crest', addMonths(cur('co_crest'), -1))
    const res = await adminCrest('POST', `/hr/payroll/runs/${run.id}/bank-file`, { format: 'mudad' })
    expect(res.status, res.text).toBe(200)
    const rows = (res.body.content as string).trim().split('\r\n')
    expect(rows[0]).toContain('Employee ID / Iqama')
    expect(rows).toHaveLength(res.body.count + 1)
    expect(rows[1]).toMatch(/^[12]\d{9},/)
    expect(res.body.skipped.map((s: { employee_id: string }) => s.employee_id)).toContain('EMP-X103') // cheque
    expect((await adminCrest('POST', `/hr/payroll/runs/${run.id}/bank-file`, { format: 'wps' })).status).toBe(422)
  })
})

describe('final settlement', () => {
  it('UAE: gratuity + unpaid salary + leave encashment − loan; paying it settles the loan and ticks the offboarding step', async () => {
    const exit = today()
    expect((await hrApex('POST', '/hr/payroll/settlements', { employee_id: 'EMP-u14', reason: 'resignation' })).body.code).toBe('not_leaving')
    expect((await hrApex('PATCH', '/hr/employees/EMP-u14', { status: 'notice', exit_date: exit })).status).toBe(200)
    const pre = await hrApex('POST', '/hr/payroll/settlements/preview', { employee_id: 'EMP-u14', reason: 'resignation' })
    expect(pre.status, pre.text).toBe(200)
    const e = employeeById('co_apex', 'EMP-u14')!
    const c = hrContracts.find((x) => x.employeeId === 'EMP-u14' && x.status === 'active')!
    expect(pre.body.gratuity.country).toBe('AE')
    expect(pre.body.gratuity.service_days).toBe(inclusiveDays(e.hireDate, exit))
    expect(pre.body.loan_balance).toBe(3000)
    // Salary owed from the 1st of this month (last month is paid) to the exit date.
    expect(pre.body.unpaid_salary_from).toBe(`${cur()}-01`)
    expect(pre.body.unpaid_salary).toBe(r2(((c.basicSalary + c.housingAllowance + c.transportAllowance + c.otherAllowance) * inclusiveDays(`${cur()}-01`, exit)) / daysInMonth(cur())))
    expect(pre.body.total).toBe(r2(pre.body.gratuity.amount + pre.body.unpaid_salary + pre.body.leave_encashment - 3000))
    const created = await hrApex('POST', '/hr/payroll/settlements', { employee_id: 'EMP-u14', reason: 'resignation', adjustments: [{ label: 'Notice pay waived', amount: -100 }] })
    expect(created.status, created.text).toBe(200)
    expect(created.body.total).toBe(r2(pre.body.total - 100))
    let detail = await hrApex('GET', '/hr/employees/EMP-u14')
    expect(detail.body.offboarding.steps.find((s: { key: string }) => s.key === 'settlement')).toMatchObject({ done: false })
    expect(detail.body.offboarding.steps.find((s: { key: string }) => s.key === 'settlement').detail).toContain('Draft')
    const paid = await mdApex('POST', `/hr/payroll/settlements/${created.body.id}/pay`)
    expect(paid.body.status).toBe('paid')
    expect(hrPayLoans.find((l) => l.employeeId === 'EMP-u14')!.status).toBe('settled')
    detail = await hrApex('GET', '/hr/employees/EMP-u14')
    expect(detail.body.offboarding.steps.find((s: { key: string }) => s.key === 'settlement').done).toBe(true)
    expect((await hrApex('PATCH', `/hr/payroll/settlements/${created.body.id}`, { notes: 'x' })).status).toBe(409)
    // The settled employee is no longer in this month's run.
    const run = await hrApex('POST', `/hr/payroll/runs/${runOf('co_apex', cur()).id}/calculate`)
    expect(run.body.lines.some((l: { employee_id: string }) => l.employee_id === 'EMP-u14')).toBe(false)
    expect(hrFinalSettlements.filter((f) => f.companyId === 'co_apex')).toHaveLength(1)
  })

  it('KSA: resignation factor applies to the award', async () => {
    crestOn()
    await adminCrest('PATCH', '/hr/employees/EMP-X101', { status: 'notice', exit_date: today('co_crest') })
    const res = await adminCrest('POST', '/hr/payroll/settlements/preview', { employee_id: 'EMP-X101', reason: 'resignation' })
    expect(res.status, res.text).toBe(200)
    const term = await adminCrest('POST', '/hr/payroll/settlements/preview', { employee_id: 'EMP-X101', reason: 'termination' })
    expect(res.body.gratuity.country).toBe('SA')
    expect(res.body.gratuity.amount).toBe(r2(term.body.gratuity.amount * res.body.gratuity.factor))
    expect(res.body.gratuity.factor).toBeLessThan(1)
  })
})

describe('profiles, settings, masking', () => {
  it('person ids and IBANs are served masked; HR full reveals (audited); a department head can’t', async () => {
    const list = await hrApex('GET', '/hr/payroll/profiles')
    expect(list.status).toBe(200)
    const p = list.body.find((x: { employee_id: string }) => x.employee_id === 'EMP-u11')
    expect(p.person_id_masked).toMatch(/^•••• \d{4}$/)
    expect(p.iban_masked).toMatch(/^•••• /)
    expect(p.basic_salary).toBeGreaterThan(0)
    const full = hrPayrollProfiles.find((x) => x.employeeId === 'EMP-u11')!.personId
    expect(list.text).not.toContain(full)
    expect((await as('u10')('POST', '/hr/payroll/profiles/EMP-u11/reveal')).status).toBe(403)
    const rev = await hrApex('POST', '/hr/payroll/profiles/EMP-u11/reveal')
    expect(rev.body.person_id).toBe(full)
    expect(auditLog.some((a) => a.entity === 'payroll_profile' && a.entityId === 'EMP-u11')).toBe(true)
    expect((await hrApex('PATCH', '/hr/payroll/profiles/EMP-u11', { person_id: '123' })).status).toBe(422)
    expect((await hrApex('PATCH', '/hr/payroll/profiles/EMP-X3', { person_id: '10004829319997' })).body.person_id_masked).toBe('•••• 9997')
  })

  it('settings: country defaults, validation, confirmation stamp', async () => {
    const s = await hrApex('GET', '/hr/payroll/settings')
    expect(s.body.social_insurance).toMatchObject({ national_employee_rate: 11, national_employer_rate: 12.5, base: 'basic_housing' })
    expect(s.body.defaults_confirmed).toBe(false)
    crestOn()
    expect((await adminCrest('GET', '/hr/payroll/settings')).body.social_insurance).toMatchObject({ national_employee_rate: 9.75, national_employer_rate: 11.75, expat_employer_rate: 2, cap: 45000 })
    expect((await hrApex('PATCH', '/hr/payroll/settings', { wps_employer_id: '12' })).status).toBe(422)
    const ok = await hrApex('PATCH', '/hr/payroll/settings', { defaults_confirmed: true, social_insurance: { national_employee_rate: 11.5 } })
    expect(ok.body.defaults_confirmed_by_name).toBe('Mariam Saeed')
    expect(ok.body.social_insurance.national_employee_rate).toBe(11.5)
    expect((await as('u10')('GET', '/hr/payroll/settings')).status).toBe(403)
    expect((await mgmtCrest('GET', '/hr/payroll/summary')).status).toBe(200)
  })

  it('loans: schedule until repaid, cancel only before repayment', async () => {
    const res = await hrApex('POST', '/hr/payroll/loans', { employee_id: 'EMP-u15', kind: 'advance', principal: 2500, installment_amount: 1000, start_month: addMonths(cur(), 1) })
    expect(res.status, res.text).toBe(200)
    expect(res.body.schedule.map((x: { amount: number }) => x.amount)).toEqual([1000, 1000, 500])
    expect((await hrApex('PATCH', `/hr/payroll/loans/${res.body.id}`, { status: 'cancelled' })).body.status).toBe('cancelled')
    const repaying = hrPayLoans.find((l) => l.employeeId === 'EMP-u14')!
    expect((await hrApex('PATCH', `/hr/payroll/loans/${repaying.id}`, { status: 'cancelled' })).body.code).toBe('loan_repaying')
  })

  it('summary: cost by department and month from the paid runs', async () => {
    const res = await hrApex('GET', '/hr/payroll/summary')
    expect(res.status).toBe(200)
    expect(res.body.months).toHaveLength(3)
    const runs = hrPayrollRuns.filter((r) => r.companyId === 'co_apex' && r.status === 'paid')
    const cost = r2(runs.flatMap((r) => r.lines).reduce((s, l) => s + l.employerCost, 0))
    expect(res.body.totals.employer_cost).toBe(cost)
    expect(r2(res.body.departments.reduce((s: number, d: { total: number }) => s + d.total, 0))).toBe(cost)
    const m = res.body.months[0].month
    expect(Object.keys(res.body.departments[0].by_month)).toContain(m)
  })
})
