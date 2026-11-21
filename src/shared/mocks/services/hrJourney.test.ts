import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import { notifications } from '@/shared/mocks/data/tasks'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { addMembership } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrAssets, hrContracts } from '@/shared/mocks/data/hrPeople'
import { hrJourneys, hrJourneyTemplates, type JourneyRecord } from '@/shared/mocks/data/hrJourney'
import { hrFinalSettlements } from '@/shared/mocks/data/hrPayroll'
import { dueDateFor, matchTemplate, progressOf } from '@/modules/hr/journey/calc'
import { addDaysIso } from '@/shared/lib/companyDay'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { createEmployee } from '@/shared/mocks/services/hrEmployees'
import { hireEmployee } from '@/shared/mocks/services/hrTalentAccess'
import { completeProbationReviewItem, probationReviewItemOf, runJourneyAlerts } from '@/shared/mocks/services/hrJourney'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * HR › Onboarding & offboarding: template matching, due-date math (company calendar), auto-start from
 * createEmployee / a recruitment hire / a status change, system items following their source, linked items ticking
 * themselves, finishing (activate / complete offboarding), notifications sent once.
 */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const hr = as('u9') // HR Manager (Apex)
const head = as('u10') // Department Head of Delivery (Apex)
const today = (co = 'co_apex') => companyDayOf(co).today
const journeyOf = (employeeId: string, kind: 'onboarding' | 'offboarding' = 'onboarding') => hrJourneys.find((j) => j.employeeId === employeeId && j.kind === kind && j.status === 'active') as (JourneyRecord & { companyId: string }) | undefined
const journeyNotes = (pred: (n: { userId: string; title: string; body: string }) => boolean = () => true) => notifications.filter((n) => n.type === 'hr-journey' && pred(n))

/** A new Delivery employee with a login (Employee role, manager Daniel u10), in onboarding. */
function joiner(name = 'Journey Joiner', extra: Record<string, unknown> = {}) {
  const id = `u-jr-${Math.random().toString(36).slice(2, 8)}`
  users.push({ id, companyId: 'co_apex', name, email: `${id}@apexaora.ae`, role: 'Employee', title: 'Engineer', managerId: 'u10', mobile: '', departmentId: 'd-delivery', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() })
  addMembership(id, 'co_apex', 'Employee')
  const e = createEmployee('co_apex', { fullName: name, jobTitle: 'Engineer', hireDate: addDaysIso(today(), 7), nationality: 'IN', departmentId: 'd-delivery', managerId: 'EMP-u10', status: 'onboarding', userId: id, ...extra }, { id: 'u9', name: 'Mariam Saeed' })
  return { e, userId: id }
}

describe('template matching and due dates (pure)', () => {
  const base = { active: true, updatedAt: '2026-01-01', employmentType: null, departmentId: null }
  const T = [
    { ...base, id: 'A', kind: 'onboarding' as const },
    { ...base, id: 'B', kind: 'onboarding' as const, departmentId: 'd-delivery' },
    { ...base, id: 'C', kind: 'onboarding' as const, employmentType: 'contractor' as const },
    { ...base, id: 'D', kind: 'onboarding' as const, departmentId: 'd-delivery', employmentType: 'contractor' as const, active: false },
    { ...base, id: 'E', kind: 'offboarding' as const, departmentId: 'd-delivery' },
  ]
  it('more specific wins; inactive / other kind / other targets are skipped; ties go to the newest', () => {
    expect(matchTemplate(T, 'onboarding', { departmentId: 'd-delivery', employmentType: 'full_time' })?.id).toBe('B')
    expect(matchTemplate(T, 'onboarding', { departmentId: 'd-sales', employmentType: 'contractor' })?.id).toBe('C')
    expect(matchTemplate(T, 'onboarding', { departmentId: 'd-delivery', employmentType: 'contractor' })?.id).toBe('B')
    expect(matchTemplate(T, 'onboarding', { departmentId: null, employmentType: 'intern' })?.id).toBe('A')
    expect(matchTemplate(T, 'offboarding', { departmentId: 'd-sales', employmentType: 'full_time' })).toBeNull()
    expect(matchTemplate([...T, { ...base, id: 'A2', kind: 'onboarding' as const, updatedAt: '2026-02-01' }], 'onboarding', { departmentId: null, employmentType: 'intern' })?.id).toBe('A2')
  })

  it('offsets count from the hire / exit date; probation end falls back to hire + 90 days', () => {
    const ctx = { kind: 'onboarding' as const, hireDate: '2026-03-01', exitDate: null, probationEndDate: null }
    expect(dueDateFor('start', -7, ctx)).toBe('2026-02-22')
    expect(dueDateFor('start', 0, ctx)).toBe('2026-03-01')
    expect(dueDateFor('probation_end', -10, ctx)).toBe('2026-05-20') // day 80
    expect(dueDateFor('probation_end', -10, { ...ctx, probationEndDate: '2026-09-01' })).toBe('2026-08-22')
    expect(dueDateFor('start', 7, { ...ctx, kind: 'offboarding', exitDate: '2026-12-31' })).toBe('2027-01-07')
    expect(progressOf([{ status: 'done', required: true }, { status: 'open', required: false }, { status: 'skipped', required: true }])).toEqual({ done: 1, total: 2, requiredDone: 1, requiredTotal: 1, pct: 50 })
  })

  it('overdue follows the company calendar (Dubai is a day ahead of UTC late in the evening)', () => {
    const { e } = joiner('Tz Joiner')
    const j = journeyOf(e.id)!
    const item = j.items.find((i) => !i.action && i.ownerRole === 'manager')!
    // 21:30 UTC on day D = 01:30 on D+1 in Dubai.
    const D = '2030-06-10'
    const at = new Date(`${D}T21:30:00.000Z`)
    item.dueDate = D
    item.dueOverridden = true
    item.alertMarks = item.alertMarks.filter((m) => m.startsWith('assigned:'))
    expect(companyDayOf('co_apex', at).today).toBe('2030-06-11')
    runJourneyAlerts('co_apex', at)
    expect(item.alertMarks).toContain(`overdue:${D}`)
    expect(journeyNotes((n) => n.userId === 'u10' && n.title === `Overdue: ${item.title}`)).toHaveLength(1)
  })
})

describe('auto-start', () => {
  it('createEmployee with status onboarding starts one from the best template (department), assignees resolved', () => {
    const { e, userId } = joiner()
    const j = journeyOf(e.id)!
    expect(j).toBeTruthy()
    expect(j.templateName).toBe('Delivery team onboarding')
    const byRole = (r: string) => j.items.filter((i) => i.ownerRole === r)
    expect(byRole('employee').every((i) => i.assigneeUserId === userId)).toBe(true)
    expect(byRole('manager').every((i) => i.assigneeUserId === 'u10')).toBe(true)
    expect(byRole('it').every((i) => i.assigneeUserId === 'u1')).toBe(true)
    expect(byRole('hr').every((i) => i.assigneeUserId === null)).toBe(true)
    const probation = j.items.find((i) => i.action?.kind === 'probation_review')!
    expect(probation.dueDate).toBe(addDaysIso(e.hireDate, 80))
    // An active employee gets none; a contractor gets the contractor template.
    const active = createEmployee('co_apex', { fullName: 'Already Active', jobTitle: 'X', hireDate: today(), nationality: 'IN' }, null)
    expect(hrJourneys.some((x) => x.employeeId === active.id)).toBe(false)
    const contractor = createEmployee('co_apex', { fullName: 'Short Term', jobTitle: 'X', hireDate: today(), nationality: 'IN', status: 'onboarding', employmentType: 'contractor' }, null)
    expect(journeyOf(contractor.id)!.templateName).toBe('Contractor onboarding')
  })

  it('a recruitment hire (status onboarding) starts it too; Crest uses its KSA template', () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const hired = hireEmployee('co_crest', { fullName: 'Hired Crest', email: '', mobile: '', jobTitle: 'Clerk', departmentId: 'c2-sales', managerId: 'EMP-u103', hireDate: today('co_crest'), employmentType: 'full_time' }, users.find((u) => u.id === 'u101')!)
    const j = journeyOf(hired.id)!
    expect(j.companyId).toBe('co_crest')
    expect(j.templateName).toBe('Standard onboarding (KSA)')
    expect(j.items.some((i) => i.title.includes('GOSI'))).toBe(true)
    expect(j.items.find((i) => i.ownerRole === 'manager')!.assigneeUserId).toBe('u103')
  })

  it('a probation review follows the contract’s probation end once a contract exists', async () => {
    const { e } = joiner('Probation Joiner')
    const r = await hr('POST', '/hr/contracts', { employee_id: e.id, type: 'unlimited', start_date: e.hireDate, probation_months: 6, status: 'active', signed_date: today() })
    expect(r.status, r.text).toBe(200)
    const detail = await hr('GET', `/hr/journeys/${journeyOf(e.id)!.id}`)
    const item = (detail.body.items as { action: { kind: string } | null; due_date: string; status: string; title: string }[])
    expect(item.find((i) => i.action?.kind === 'probation_review')!.due_date).toBe(addDaysIso(r.body.probation_end_date, -10))
    // The "sign contract" item ticked itself from the signed contract.
    expect(item.find((i) => i.action?.kind === 'sign_contract')!.status).toBe('done')
    // Seam for HR › Performance.
    expect(probationReviewItemOf('co_apex', e.id)!.status).toBe('open')
    expect(completeProbationReviewItem('co_apex', e.id, { reviewId: 'PR-1' })).toBe(true)
    expect(probationReviewItemOf('co_apex', e.id)!.status).toBe('done')
  })

  it('status → notice starts the offboarding with system items; back to active cancels it', async () => {
    expect((await hr('PATCH', '/hr/employees/EMP-u11', { status: 'notice', exit_date: addDaysIso(today(), 30) })).status).toBe(200)
    const j = journeyOf('EMP-u11', 'offboarding')!
    expect(j.templateName).toBe('Standard offboarding (UAE)')
    expect(j.items.filter((i) => i.system).map((i) => i.system)).toEqual(['assets', 'login', 'settlement'])
    expect(j.items.find((i) => i.system === 'assets')!.blocking).toBe(true)
    expect(j.items.find((i) => i.title === 'Exit interview')!.dueDate).toBe(addDaysIso(today(), 27))
    expect((await hr('PATCH', '/hr/employees/EMP-u11', { status: 'active', exit_date: null })).status).toBe(200)
    expect(j.status).toBe('cancelled')
  })
})

describe('system items and finishing', () => {
  it('offboarding: assets / login / settlement complete from their source; completion is blocked by assets only', async () => {
    await hr('PATCH', '/hr/employees/EMP-u11', { status: 'notice', exit_date: today() })
    const j = journeyOf('EMP-u11', 'offboarding')!
    let d = await hr('GET', `/hr/journeys/${j.id}`)
    const sys = (key: string) => (d.body.items as { system: string | null; status: string; can_complete: boolean }[]).find((i) => i.system === key)!
    expect(sys('assets').status).toBe('open')
    expect(sys('assets').can_complete).toBe(false)
    expect(d.body.can_finish).toBe(false)
    expect(d.body.finish_blockers[0]).toMatch(/AST-/)
    // A system item can't be ticked by hand.
    const assetsId = j.items.find((i) => i.system === 'assets')!.id
    expect((await hr('POST', `/hr/journeys/${j.id}/items/${assetsId}/complete`)).status).toBe(422)
    expect((await hr('POST', '/hr/employees/EMP-u11/offboarding/complete')).status).toBe(422)
    for (const a of hrAssets.filter((x) => x.companyId === 'co_apex' && x.status === 'assigned' && x.assignments.at(-1)!.employeeId === 'EMP-u11')) {
      expect((await hr('POST', `/hr/assets/${a.id}/return`, { date: today(), condition: 'good' })).status).toBe(200)
    }
    // Login: deactivate Noura's user; settlement: a paid settlement record.
    users.find((u) => u.id === 'u11')!.active = false
    hrFinalSettlements.push({ ...(hrFinalSettlements[0] ?? ({} as never)), companyId: 'co_apex', id: 'FS-T1', employeeId: 'EMP-u11', status: 'paid', paidAt: new Date().toISOString(), total: 1000, currency: 'AED' } as never)
    d = await hr('GET', `/hr/journeys/${j.id}`)
    expect(['assets', 'login', 'settlement'].map((k) => sys(k).status)).toEqual(['done', 'done', 'done'])
    expect(d.body.can_finish).toBe(true)
    const before = journeyNotes().length
    const done = await hr('POST', '/hr/employees/EMP-u11/offboarding/complete')
    expect(done.status, done.text).toBe(200)
    expect(j.status).toBe('completed')
    // Open manual items are skipped; HR + the manager hear about it once.
    expect(j.items.filter((i) => !i.system).every((i) => i.status !== 'open')).toBe(true)
    const completed = journeyNotes((n) => n.title === 'Offboarding completed: Noura Al Ketbi')
    expect(completed.map((n) => n.userId).sort()).toEqual(expect.arrayContaining(['u10', 'u9']))
    expect(journeyNotes().length - before).toBe(completed.length)
  })

  it('a system item reopens if its source goes back (asset assigned again while the journey runs)', async () => {
    await hr('PATCH', '/hr/employees/EMP-u14', { status: 'notice', exit_date: addDaysIso(today(), 20) })
    const j = journeyOf('EMP-u14', 'offboarding')!
    for (const a of hrAssets.filter((x) => x.companyId === 'co_apex' && x.status === 'assigned' && x.assignments.at(-1)!.employeeId === 'EMP-u14')) await hr('POST', `/hr/assets/${a.id}/return`, { date: today(), condition: 'good' })
    await hr('GET', `/hr/journeys/${j.id}`)
    expect(j.items.find((i) => i.system === 'assets')!.status).toBe('done')
    const stock = hrAssets.find((x) => x.companyId === 'co_apex' && x.status === 'in_stock')!
    const r = await hr('POST', `/hr/assets/${stock.id}/assign`, { employee_id: 'EMP-u14', date: today(), condition: 'good' })
    if (r.status === 200) {
      await hr('GET', `/hr/journeys/${j.id}`)
      expect(j.items.find((i) => i.system === 'assets')!.status).toBe('open')
    }
  })

  it('onboarding: linked items tick themselves; HR marks active only when every required item is done', async () => {
    const { e, userId } = joiner('Activate Joiner')
    const j = journeyOf(e.id)!
    const blocked = await hr('POST', `/hr/journeys/${j.id}/activate`)
    expect(blocked.status).toBe(422)
    expect(blocked.body.code).toBe('items_open')
    // Upload a passport: the "passport copy" item ticks itself.
    expect((await hr('POST', `/hr/employees/${e.id}/documents`, { type: 'passport', number: 'P1234567' })).status).toBe(200)
    await hr('GET', `/hr/journeys/${j.id}`)
    expect(j.items.find((i) => i.action?.kind === 'upload_document' && i.action.documentType === 'passport')!.detail).toBe('Passport on file')
    // The employee ticks their own items, the manager theirs, HR the rest.
    for (const item of j.items.filter((i) => i.status === 'open' && i.required)) {
      const who = item.assigneeUserId === userId ? as(userId) : item.ownerRole === 'manager' ? head : hr
      const r = await who('POST', `/hr/journeys/${j.id}/items/${item.id}/complete`)
      expect(r.status, `${item.title}: ${r.text}`).toBe(200)
    }
    const ok = await hr('POST', `/hr/journeys/${j.id}/activate`)
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.status).toBe('completed')
    expect(hrEmployees.find((x) => x.id === e.id)!.status).toBe('active')
    expect(journeyNotes((n) => n.title === 'Onboarding completed: Activate Joiner' && n.userId === 'u10')).toHaveLength(1)
  })
})

describe('notifications are sent once', () => {
  it('assigned once per assignee; due / overdue once per item and due date; a new due date re-arms', () => {
    const { e, userId } = joiner('Notify Joiner')
    const j = journeyOf(e.id)!
    // One "assigned" message per assignee (batched), never repeated.
    const assigned = () => journeyNotes((n) => /^New onboarding task|onboarding tasks (for|$)/.test(n.title))
    expect(assigned().filter((n) => n.userId === userId).length).toBe(1)
    expect(assigned().filter((n) => n.userId === 'u10').length).toBe(1)
    // The actor (HR u9) isn't told about HR items; IT (u1) is.
    expect(assigned().filter((n) => n.userId === 'u1').length).toBe(1)
    expect(assigned().filter((n) => n.userId === 'u9').length).toBe(0)
    const count = assigned().length
    runJourneyAlerts('co_apex')
    runJourneyAlerts('co_apex')
    expect(assigned().length).toBe(count)

    const item = j.items.find((i) => i.ownerRole === 'employee' && i.status === 'open')!
    item.dueDate = addDaysIso(today(), 1)
    item.dueOverridden = true
    runJourneyAlerts('co_apex')
    runJourneyAlerts('co_apex')
    expect(journeyNotes((n) => n.userId === userId && n.title === `Due tomorrow: ${item.title}`)).toHaveLength(1)
    item.dueDate = addDaysIso(today(), -2)
    runJourneyAlerts('co_apex')
    runJourneyAlerts('co_apex')
    expect(journeyNotes((n) => n.userId === userId && n.title === `Overdue: ${item.title}`)).toHaveLength(1)
    // Unassigned (HR team) items remind every HR-full user.
    const hrItem = j.items.find((i) => i.ownerRole === 'hr' && i.status === 'open' && !i.assigneeUserId)!
    hrItem.dueDate = addDaysIso(today(), -1)
    hrItem.dueOverridden = true
    runJourneyAlerts('co_apex')
    const hrFull = users.filter((u) => u.companyId === 'co_apex' && u.active && ['Company Admin', 'Management', 'HR Manager'].includes(u.role)).map((u) => u.id).sort()
    expect(journeyNotes((n) => n.title === `Overdue: ${hrItem.title}`).map((n) => n.userId).sort()).toEqual(hrFull)
  })

  it('reassigning tells the new assignee once; the company tick never touches the other company', async () => {
    const { e } = joiner('Reassign Joiner')
    const j = journeyOf(e.id)!
    const item = j.items.find((i) => i.ownerRole === 'hr' && i.status === 'open')!
    const r = await hr('PATCH', `/hr/journeys/${j.id}/items/${item.id}`, { assignee_user_id: 'u8' })
    expect(r.status, r.text).toBe(200)
    await hr('PATCH', `/hr/journeys/${j.id}/items/${item.id}`, { due_date: addDaysIso(today(), 3) })
    expect(journeyNotes((n) => n.userId === 'u8' && n.title === `New onboarding task: ${item.title}`)).toHaveLength(1)
    // Foreign user → like a missing one.
    expect((await hr('PATCH', `/hr/journeys/${j.id}/items/${item.id}`, { assignee_user_id: 'u101' })).status).toBe(422)
    const crestBefore = JSON.stringify(notifications.filter((n) => n.companyId === 'co_crest'))
    runJourneyAlerts('co_apex', new Date(Date.now() + 400 * 86_400_000))
    expect(JSON.stringify(notifications.filter((n) => n.companyId === 'co_crest'))).toBe(crestBefore)
  })
})

describe('templates (HR full)', () => {
  it('validates items, targeting and names; foreign ids behave like missing ones', async () => {
    const ok = await hr('POST', '/hr/journeys/templates', { kind: 'onboarding', name: 'Sales onboarding', department_id: 'd-sales', items: [{ title: 'CRM training', owner_role: 'manager', due_offset_days: 3, action: { kind: 'enrol_course', course_id: null } }] })
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.department_name).toBe('Sales')
    expect((await hr('POST', '/hr/journeys/templates', { kind: 'onboarding', name: 'Sales onboarding', items: [{ title: 'X1', owner_role: 'hr', due_offset_days: 0 }] })).status).toBe(422)
    expect((await hr('POST', '/hr/journeys/templates', { kind: 'onboarding', name: 'Empty', items: [] })).status).toBe(422)
    expect((await hr('POST', '/hr/journeys/templates', { kind: 'offboarding', name: 'Bad anchor', items: [{ title: 'Review', owner_role: 'hr', due_offset_days: 0, due_anchor: 'probation_end' }] })).status).toBe(422)
    expect((await hr('POST', '/hr/journeys/templates', { kind: 'onboarding', name: 'Foreign dept', department_id: 'c2-ops', items: [{ title: 'X1', owner_role: 'hr', due_offset_days: 0 }] })).body.message).toBe('Pick a department.')
    expect((await hr('POST', '/hr/journeys/templates', { kind: 'onboarding', name: 'No person', items: [{ title: 'X1', owner_role: 'user', due_offset_days: 0 }] })).status).toBe(422)
    // Used by the next Sales hire.
    const e = createEmployee('co_apex', { fullName: 'Sales Joiner', jobTitle: 'Rep', hireDate: today(), nationality: 'IN', departmentId: 'd-sales', status: 'onboarding' }, null)
    expect(journeyOf(e.id)!.templateName).toBe('Sales onboarding')
    expect((await head('GET', '/hr/journeys/templates')).status).toBe(403)
    expect(hrJourneyTemplates.filter((t) => t.companyId === 'co_crest').every((t) => t.name !== 'Sales onboarding')).toBe(true)
    expect(hrContracts.length).toBeGreaterThan(0)
  })
})
