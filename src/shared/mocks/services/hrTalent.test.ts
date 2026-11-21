import { describe, expect, it } from 'vitest'
import { notifications } from '@/shared/mocks/data/tasks'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrCertificates, hrInterviews, hrOpenings } from '@/shared/mocks/data/hrTalent'
import { runTrainingReminders } from '@/shared/mocks/services/trainingReminders'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { usedOf } from '@/shared/mocks/services/billing'
import { addDaysIso } from '@/shared/lib/companyDay'
import { addMonthsIso, certificateExpiry, certificateState, compliancePct, matrixCell, moveError, overallOf, scorecardAverage } from '@/modules/hr/lib/talent'
import { DEFAULT_CRITERIA } from '@/modules/hr/recruitmentTypes'
import { APEX, CREST, api, useSeedPerTest, userToken } from '@/shared/mocks/isolation/harness'
import { withHr } from '@/shared/mocks/isolation/hrTalentEndpoints'

/**
 * HR recruitment and training through the real handlers: pipeline stage rules, scorecards and the
 * overall score, offer → hire (once, headcount, filling the opening), duplicate candidates per company,
 * salary range and interviewer-only visibility, certificate validity and once-only expiry alerts in
 * the company timezone, the training matrix, storage and the plan gate.
 */

useSeedPerTest()

const R = '/hr/recruitment'
const T = '/hr/training'
const call = (as: string, method: string, path: string, body?: unknown) => api(userToken(as), method, path, { body })
const ok = async (as: string, method: string, path: string, body?: unknown) => {
  const r = await call(as, method, path, body)
  expect(r.status, `${method} ${path} as ${as}: ${r.text}`).toBe(200)
  return r.body
}
const today = (co = APEX) => companyDayOf(co).today
const scores = (n: number) => DEFAULT_CRITERIA.map((criterion) => ({ criterion, score: n }))

describe('pipeline rules', () => {
  it('moveError: hired only through an offer, a reason to reject, an offer only after an interview, closed openings', () => {
    const open = { openingActive: true, offerStatus: null }
    expect(moveError('applied', 'screening', open)).toBeNull()
    expect(moveError('applied', 'hired', open)).toMatch(/accepting their offer/)
    expect(moveError('applied', 'offer', open)).toMatch(/interview first/)
    expect(moveError('assessment', 'offer', open)).toBeNull()
    expect(moveError('screening', 'rejected', open)).toMatch(/reason/)
    expect(moveError('screening', 'rejected', { ...open, reason: 'No fit' })).toBeNull()
    expect(moveError('hired', 'applied', open)).toMatch(/final/)
    expect(moveError('offer', 'interview', { openingActive: true, offerStatus: 'sent' })).toMatch(/offer has been sent/)
    expect(moveError('offer', 'withdrawn', { openingActive: true, offerStatus: 'sent' })).toBeNull()
    expect(moveError('rejected', 'screening', { openingActive: false, offerStatus: null })).toMatch(/no longer open/)
    expect(moveError('rejected', 'screening', open)).toBeNull()
  })

  it('the API applies them: 409 invalid_stage_move, a stored rejection reason, a reopened candidate', async () => {
    const bad = await call('u9', 'POST', `${R}/applications/APP-105/stage`, { stage: 'offer' })
    expect(bad.status).toBe(409)
    expect(bad.body.code).toBe('invalid_stage_move')
    expect((await call('u9', 'POST', `${R}/applications/APP-105/stage`, { stage: 'rejected' })).status).toBe(409)
    const rejected = await ok('u9', 'POST', `${R}/applications/APP-105/stage`, { stage: 'rejected', reason: 'Salary expectations' })
    expect(rejected).toMatchObject({ stage: 'rejected', rejection_reason: 'Salary expectations' })
    expect((await ok('u9', 'POST', `${R}/applications/APP-105/stage`, { stage: 'screening' })).rejection_reason).toBeNull()
    // Only HR moves candidates: the hiring manager (department head) can't.
    expect((await call('u10', 'POST', `${R}/applications/APP-105/stage`, { stage: 'interview' })).status).toBe(403)
  })
})

describe('interviews and scorecards', () => {
  it('averages: per scorecard (criteria) and overall (mean of scorecards)', () => {
    expect(scorecardAverage([{ criterion: 'a', score: 5 }, { criterion: 'b', score: 4 }, { criterion: 'c', score: 4 }])).toBe(4.3)
    expect(overallOf([4.5, 4])).toBe(4.3)
    expect(overallOf([])).toBeNull()
  })

  it('an interviewer scores every criterion 1–5; the overall updates; re-submitting replaces their card', async () => {
    const bad = await call('u11', 'PUT', `${R}/interviews/INT-103/scorecard`, { scores: scores(6), recommendation: 'yes' })
    expect(bad.status).toBe(422)
    const once = await ok('u11', 'PUT', `${R}/interviews/INT-103/scorecard`, { scores: scores(3), recommendation: 'no', notes: 'Hmm' })
    expect(once.scorecards).toHaveLength(1)
    expect(once.overall_score).toBe(3)
    await ok('u10', 'PUT', `${R}/interviews/INT-103/scorecard`, { scores: scores(5), recommendation: 'strong_yes' })
    const again = await ok('u11', 'PUT', `${R}/interviews/INT-103/scorecard`, { scores: scores(4), recommendation: 'yes' })
    // The employee sees their own card only; HR sees both and the overall of both.
    expect(again.scorecards.map((s: { interviewer_id: string }) => s.interviewer_id)).toEqual(['u11'])
    const detail = await ok('u9', 'GET', `${R}/openings/JOB-101`)
    const int = detail.interviews.find((i: { id: string }) => i.id === 'INT-103')
    expect(int.scorecards).toHaveLength(2)
    expect(int.overall_score).toBe(4.5)
    expect(int.status).toBe('completed')
    // Not on the panel → refused.
    expect((await call('u9', 'PUT', `${R}/interviews/INT-103/scorecard`, { scores: scores(4), recommendation: 'yes' })).status).toBe(403)
  })

  it('interview times are entered in the company timezone (Dubai +4, Riyadh +3)', async () => {
    const a = await ok('u9', 'POST', `${R}/applications/APP-103/interviews`, { date: '2026-12-01', time: '09:00', type: 'video', interviewer_ids: ['u10'] })
    expect(a.scheduled_at).toBe('2026-12-01T05:00:00.000Z')
    withHr(CREST)
    const c = await ok('u101', 'POST', `${R}/applications/APP-203/interviews`, { date: '2026-12-01', time: '09:00', type: 'phone', interviewer_ids: ['u106'] })
    expect(c.scheduled_at).toBe('2026-12-01T06:00:00.000Z')
    // Scheduling from screening moves the candidate to interview.
    expect((await ok('u9', 'GET', `${R}/openings/JOB-101`)).applications.find((x: { id: string }) => x.id === 'APP-103').stage).toBe('interview')
  })
})

describe('offers and the hire', () => {
  async function acceptedOffer(applicationId: string, salary = 24000) {
    const offer = await ok('u9', 'POST', `${R}/applications/${applicationId}/offers`, { salary, start_date: addDaysIso(today(), 30), expiry_date: addDaysIso(today(), 7) })
    await ok('u9', 'POST', `${R}/offers/${offer.id}/status`, { status: 'sent' })
    return ok('u9', 'POST', `${R}/offers/${offer.id}/status`, { status: 'accepted' })
  }

  it('accepting creates the employee exactly once (idempotent), marks the application hired, never a login', async () => {
    const before = hrEmployees.length
    const accepted = await acceptedOffer('APP-104')
    expect(accepted.employee_id).toMatch(/^EMP-/)
    expect(hrEmployees.length).toBe(before + 1)
    const again = await ok('u9', 'POST', `${R}/offers/${accepted.id}/status`, { status: 'accepted' })
    expect(again.employee_id).toBe(accepted.employee_id)
    expect(hrEmployees.length).toBe(before + 1)
    const emp = hrEmployees.find((e) => e.id === accepted.employee_id)!
    expect(emp).toMatchObject({ companyId: APEX, userId: null, fullName: 'Elena Petrova', jobTitle: 'Senior Frontend Engineer', departmentId: 'd-delivery', managerId: 'EMP-u10', hireDate: addDaysIso(today(), 30) })
    const app = (await ok('u9', 'GET', `${R}/openings/JOB-101`)).applications.find((x: { id: string }) => x.id === 'APP-104')
    expect(app).toMatchObject({ stage: 'hired', employee_id: accepted.employee_id })
  })

  it('headcount: each hire lowers the remaining positions; the last one fills the opening, further offers are refused', async () => {
    await acceptedOffer('APP-104')
    let o = await ok('u9', 'GET', `${R}/openings/JOB-101`)
    expect(o).toMatchObject({ headcount: 2, hired_count: 1, remaining: 1, status: 'open' })
    await ok('u9', 'POST', `${R}/offers/OFR-101/status`, { status: 'accepted' })
    o = await ok('u9', 'GET', `${R}/openings/JOB-101`)
    expect(o).toMatchObject({ hired_count: 2, remaining: 0, status: 'filled' })
    // No more pipeline moves on a filled opening; reopening needs a higher headcount.
    expect((await call('u9', 'POST', `${R}/applications/APP-102/stage`, { stage: 'assessment' })).status).toBe(409)
    expect((await call('u9', 'POST', `${R}/openings/JOB-101/status`, { status: 'open' })).body.code).toBe('opening_filled')
  })

  it('an expired offer can’t be accepted; only one open offer per application', async () => {
    const f = await ok('u9', 'POST', `${R}/applications/APP-104/offers`, { salary: 20000, start_date: addDaysIso(today(), 30), expiry_date: addDaysIso(today(), 2) })
    expect((await call('u9', 'POST', `${R}/applications/APP-104/offers`, { salary: 1, start_date: addDaysIso(today(), 30), expiry_date: addDaysIso(today(), 2) })).body.code).toBe('offer_exists')
    await ok('u9', 'POST', `${R}/offers/${f.id}/status`, { status: 'sent' })
    const { advanceClock } = await import('@/shared/mocks/clock')
    advanceClock(5)
    const late = await call('u9', 'POST', `${R}/offers/${f.id}/status`, { status: 'accepted' })
    expect(late.status).toBe(409)
    expect(late.body.code).toBe('offer_expired')
  })
})

describe('candidates', () => {
  it('duplicate email (any case) or mobile (any format) is refused within the company only', async () => {
    const byEmail = await call('u9', 'POST', `${R}/candidates`, { full_name: 'Tamer A.', email: 'TAMER.ABDELAZIZ@mailbox.test' })
    expect(byEmail.status).toBe(409)
    expect(byEmail.body).toMatchObject({ code: 'duplicate_candidate', candidateId: 'CAN-101' })
    const byMobile = await call('u9', 'POST', `${R}/candidates`, { full_name: 'Someone', mobile: '00971504102231' })
    expect(byMobile.status).toBe(409)
    const check = await ok('u9', 'GET', `${R}/candidates/check?mobile=${encodeURIComponent('050 410 2231')}`)
    expect(check.matches.map((m: { id: string }) => m.id)).toEqual(['CAN-101'])
    // Another company may have the same person.
    withHr(CREST)
    expect((await call('u101', 'POST', `${R}/candidates`, { full_name: 'Tamer A.', email: 'tamer.abdelaziz@mailbox.test' })).status).toBe(200)
    expect((await ok('u101', 'GET', `${R}/candidates/check?email=tamer.abdelaziz@mailbox.test`)).matches).toHaveLength(1)
  })

  it('accepts international mobiles; a CV counts against storage', async () => {
    const c = await ok('u9', 'POST', `${R}/candidates`, { full_name: 'Abroad', mobile: '+44 7700 900456', source: 'agency' })
    expect(c.mobile).toBe('+447700900456')
    const before = usedOf(APEX, 'storageMb')
    await ok('u9', 'POST', `${R}/candidates/${c.id}/cv`, { name: 'cv.pdf', size_bytes: 2 * 1024 * 1024, mime_type: 'application/pdf' })
    expect(usedOf(APEX, 'storageMb')).toBeCloseTo(before + 2, 1)
    expect((await call('u9', 'POST', `${R}/candidates/${c.id}/cv`, { name: 'cv.exe', size_bytes: 10, mime_type: 'application/x-msdownload' })).status).toBe(422)
  })
})

describe('visibility', () => {
  it('salary range: HR and the hiring manager only; a department head sees openings of their departments', async () => {
    const mine = await ok('u10', 'GET', `${R}/openings/JOB-101`)
    expect(mine).toMatchObject({ salary_visible: true, salary_min: 22000 })
    const hrOwned = await ok('u9', 'POST', `${R}/openings`, { title: 'Delivery Analyst', department_id: 'd-delivery', hiring_manager_id: 'u9', headcount: 1, salary_min: 9000, salary_max: 11000, status: 'open' })
    const seen = await ok('u10', 'GET', `${R}/openings/${hrOwned.id}`)
    expect(seen).toMatchObject({ salary_visible: false, salary_min: null, salary_max: null, offers: [] })
    expect((await call('u10', 'GET', `${R}/openings/JOB-102`)).status).toBe(404)
    const list = (await ok('u10', 'GET', `${R}/openings`)).map((o: { id: string }) => o.id)
    expect(list).toContain('JOB-101')
    expect(list).not.toContain('JOB-102')
  })

  it('a department head requests openings for their departments only; HR approves', async () => {
    expect((await call('u10', 'POST', `${R}/openings`, { title: 'Sales role', department_id: 'd-sales', headcount: 1 })).status).toBe(422)
    expect((await call('u10', 'POST', `${R}/openings`, { title: 'Dev', department_id: 'd-delivery', headcount: 1, status: 'open' })).status).toBe(422)
    const req = await ok('u10', 'POST', `${R}/openings`, { title: 'Dev', department_id: 'd-delivery', headcount: 1, status: 'pending_approval' })
    expect((await call('u10', 'POST', `${R}/openings/${req.id}/status`, { status: 'open' })).status).toBe(403)
    expect((await ok('u9', 'POST', `${R}/openings/${req.id}/status`, { status: 'open' })).approved_by).toBe('u9')
  })

  it('an employee invited to interview sees that interview card only (no contact data, own scorecard)', async () => {
    expect((await call('u11', 'GET', `${R}/openings`)).status).toBe(403)
    expect((await call('u11', 'GET', `${R}/candidates`)).status).toBe(403)
    expect((await call('u11', 'GET', `${R}/openings/JOB-101`)).status).toBe(404)
    expect((await call('u11', 'GET', `${R}/candidates/CAN-104`)).status).toBe(404)
    const cards = await ok('u11', 'GET', `${R}/my-interviews`)
    expect(cards.map((c: { id: string }) => c.id).sort()).toEqual(['INT-102', 'INT-103'])
    const card = cards.find((c: { id: string }) => c.id === 'INT-102')
    expect(card.my_scorecard).toBeNull()
    expect(JSON.stringify(card)).not.toMatch(/mailbox\.test|\+44/)
    // Not on INT-101's panel: invisible.
    expect((await call('u11', 'PUT', `${R}/interviews/INT-101/scorecard`, { scores: scores(4), recommendation: 'yes' })).status).toBe(404)
  })
})

describe('training: certificates', () => {
  it('validity: issue + months, clamped to the month end; 0 months = no certificate; state from the company day', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsIso('2026-11-20', 12)).toBe('2027-11-20')
    expect(certificateExpiry('2026-03-15', 24)).toBe('2028-03-15')
    expect(certificateExpiry('2026-03-15', null)).toBeNull()
    expect(certificateState('2026-11-20', '2026-12-10')).toEqual({ state: 'expiring', daysLeft: 20 })
    expect(certificateState('2026-11-20', '2026-11-19').state).toBe('expired')
    expect(certificateState('2026-11-20', '2027-11-19').state).toBe('valid')
  })

  it('completing an enrollment issues one certificate dated the company’s today; the course decides its expiry', async () => {
    const session = await ok('u9', 'POST', `${T}/courses/CRS-101/sessions`, { start_date: today(), end_date: today(), location: 'Room 1', capacity: 5 })
    const [en] = await ok('u9', 'POST', `${T}/sessions/${session.id}/enrollments`, { employee_ids: ['EMP-u12'] })
    const done = await ok('u9', 'PATCH', `${T}/enrollments/${en.id}`, { status: 'completed', score: 90 })
    expect(done.certificate_id).toBeTruthy()
    await ok('u9', 'PATCH', `${T}/enrollments/${en.id}`, { score: 95 })
    const certs = hrCertificates.filter((c) => c.enrollmentId === en.id)
    expect(certs).toHaveLength(1)
    expect(certs[0]).toMatchObject({ issueDate: companyDayOf(APEX).today, expiryDate: addMonthsIso(companyDayOf(APEX).today, 12) })
    // A future session can't be completed.
    const later = await ok('u9', 'POST', `${T}/courses/CRS-101/sessions`, { start_date: addDaysIso(today(), 9), location: 'Room 1', capacity: 5 })
    const [en2] = await ok('u9', 'POST', `${T}/sessions/${later.id}/enrollments`, { employee_ids: ['EMP-u12'] })
    expect((await call('u9', 'PATCH', `${T}/enrollments/${en2.id}`, { status: 'completed' })).body.code).toBe('session_not_started')
  })

  it('expiry alerts: once, to the employee, their manager and HR full; a date change re-arms them', () => {
    const before = notifications.length
    const sent = runTrainingReminders(APEX)
    expect(sent).toBeGreaterThan(0)
    const fresh = notifications.slice(0, notifications.length - before).filter((n) => n.type === 'hr')
    const cert = hrCertificates.find((c) => c.companyId === APEX && c.employeeId === 'EMP-u14' && c.courseId === 'CRS-101')!
    const forCert = fresh.filter((n) => n.link.includes(cert.id))
    expect(forCert.map((n) => n.userId).sort()).toEqual(['u1', 'u10', 'u14', 'u2', 'u9'].sort())
    expect(runTrainingReminders(APEX)).toBe(0)
    cert.expiryDate = addDaysIso(companyDayOf(APEX).today, 60)
    cert.expiryNotifiedAt = null
    expect(runTrainingReminders(APEX)).toBe(0)
  })

  it('PATCH certificate dates re-arms the alert; GET /alerts runs the tick for the caller’s company only', async () => {
    const cert = hrCertificates.find((c) => c.companyId === APEX && c.employeeId === 'EMP-u14' && c.courseId === 'CRS-101')!
    await ok('u14', 'GET', '/alerts')
    expect(cert.expiryNotifiedAt).not.toBeNull()
    await ok('u9', 'PATCH', `${T}/certificates/${cert.id}`, { expiry_date: addDaysIso(today(), 10) })
    expect(cert.expiryNotifiedAt).toBeNull()
    const alerts = await ok('u14', 'GET', '/alerts')
    expect(alerts.filter((a: { link: string }) => a.link.includes(cert.id))).toHaveLength(2)
    // Crest has no HR module: its expiring certificates stay silent.
    expect(runTrainingReminders(CREST)).toBe(0)
  })
})

describe('training: matrix and budget', () => {
  it('cells and compliance math', () => {
    expect(compliancePct(['compliant', 'expiring', 'missing', 'overdue'])).toBe(50)
    expect(compliancePct([])).toBe(100)
    expect(matrixCell('2026-11-20', '2026-11-01', null)).toBe('missing')
    expect(matrixCell('2026-11-20', '2026-09-01', null)).toBe('overdue')
    expect(matrixCell('2026-11-20', '2020-01-01', { expiryDate: '2026-11-10' })).toBe('expired')
    expect(matrixCell('2026-11-20', '2020-01-01', { expiryDate: null })).toBe('compliant')
  })

  it('the matrix compliance equals a recomputation from its own cells; overdue counted', async () => {
    const m = await ok('u9', 'GET', `${T}/matrix`)
    expect(m.courses.map((c: { id: string }) => c.id).sort()).toEqual(['CRS-101', 'CRS-102'])
    const cells: string[] = m.rows.flatMap((r: { cells: Record<string, string> }) => Object.values(r.cells))
    expect(m.compliance_pct).toBe(Math.round((cells.filter((c) => c === 'compliant' || c === 'expiring').length / cells.length) * 100))
    expect(m.overdue_count).toBe(cells.filter((c) => c === 'overdue' || c === 'expired').length)
    expect(m.rows.find((r: { employee_id: string }) => r.employee_id === 'EMP-u14').cells['CRS-101']).toBe('expiring')
    // Team scope: the department head sees their team only.
    const team = await ok('u10', 'GET', `${T}/matrix`)
    expect(team.rows.length).toBeLessThan(m.rows.length)
    const ids = team.rows.map((r: { employee_id: string }) => r.employee_id)
    expect(ids).toEqual(expect.arrayContaining(['EMP-u10', 'EMP-u11', 'EMP-u14']))
    expect(ids).not.toContain('EMP-u3')
  })

  it('budget sums course fees per participant and session costs per department for the year', async () => {
    const year = Number(today().slice(0, 4))
    const b = await ok('u9', 'GET', `${T}/budget?year=${year}`)
    expect(b.total).toBeCloseTo(b.rows.reduce((s: number, r: { total: number }) => s + r.total, 0), 2)
    expect((await call('u10', 'GET', `${T}/budget?year=${year}`)).status).toBe(403)
  })
})

describe('plan gate', () => {
  it('HR endpoints answer 403 module_not_in_plan without the module, 200 with a platform override', async () => {
    const no = await call('u101', 'GET', `${R}/openings`)
    expect(no.status).toBe(403)
    expect(no.body.code).toBe('module_not_in_plan')
    expect((await call('u101', 'GET', `${T}/courses`)).status).toBe(403)
    withHr(CREST)
    expect((await ok('u101', 'GET', `${R}/openings`)).map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining(['JOB-201', 'JOB-204']))
    expect(hrOpenings.filter((o) => o.companyId === CREST)).toHaveLength(4)
    expect(hrInterviews.some((i) => i.companyId === CREST)).toBe(true)
  })
})
