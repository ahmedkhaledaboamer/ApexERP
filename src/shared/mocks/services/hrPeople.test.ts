import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import { notifications } from '@/shared/mocks/data/tasks'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrAssets, hrContracts, hrDocuments, hrProfiles, maskLast4 } from '@/shared/mocks/data/hrPeople'
import { addDaysIso } from '@/shared/lib/companyDay'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { advanceClock } from '@/shared/mocks/clock'
import { createEmployee } from '@/shared/mocks/services/hrEmployees'
import { documentStatusOf, runHrPeopleAlerts } from '@/shared/mocks/services/hrPeopleAlerts'
import { api, secretsIn, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * HR › Employees, contracts, assets: createEmployee, document status + once-only expiry alerts (re-armed on a
 * date change, company timezone), contract rules and alerts, asset assign / return / lost, the offboarding
 * block, masking of document numbers / IBAN / pay.
 */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const hr = as('u9') // HR Manager (Apex)
const today = () => companyDayOf('co_apex').today
const hrNotes = (employeeNo: string) => notifications.filter((n) => n.companyId === 'co_apex' && n.type === 'hr-people' && n.body.includes(employeeNo))

function fresh(name = 'Test Person') {
  return createEmployee('co_apex', { fullName: name, jobTitle: 'Technician', hireDate: today(), nationality: 'IN', departmentId: 'd-delivery', managerId: 'EMP-u10' }, null)
}

describe('createEmployee (shared entry point)', () => {
  it('creates an EMP-X employee with the next employee number, a profile, and no login', () => {
    const userCount = users.length
    const e = fresh('Hiring Test')
    expect(e.id).toMatch(/^EMP-X\d+$/)
    expect(e.userId).toBeNull()
    expect(e.employeeNo).toMatch(/^APX-\d{4}$/)
    expect(hrEmployees.filter((x) => x.employeeNo === e.employeeNo)).toHaveLength(1)
    expect(hrProfiles.some((p) => p.employeeId === e.id)).toBe(true)
    expect(users.length).toBe(userCount)
    // Ids stay unique across companies.
    const c = createEmployee('co_crest', { fullName: 'Crest Hire', jobTitle: 'Driver', hireDate: today(), nationality: 'SA' }, null)
    expect(c.id).not.toBe(e.id)
    expect(c.employeeNo).toMatch(/^CRS-/)
  })

  it('validates: required fields, foreign department / manager, duplicate email in the company', () => {
    expect(() => createEmployee('co_apex', { fullName: 'X', jobTitle: '', hireDate: '' }, null)).toThrow(/required/)
    expect(() => createEmployee('co_apex', { fullName: 'Ok Name', jobTitle: 'T', hireDate: today(), departmentId: 'c2-ops' }, null)).toThrow(/department/i)
    expect(() => createEmployee('co_apex', { fullName: 'Ok Name', jobTitle: 'T', hireDate: today(), managerId: 'EMP-u106' }, null)).toThrow(/manager/i)
    expect(() => createEmployee('co_apex', { fullName: 'Ok Name', jobTitle: 'T', hireDate: today(), email: 'noura@apexaora.ae' }, null)).toThrow(/already/)
    expect(() => createEmployee('co_apex', { fullName: 'Ok Name', jobTitle: 'T', hireDate: today(), userId: 'u11' }, null)).toThrow(/already linked/)
  })

  it('POST /hr/employees as HR creates it; status Left needs an exit date', async () => {
    const r = await hr('POST', '/hr/employees', { full_name: 'Api Hire', job_title: 'Analyst', hire_date: today(), nationality: 'EG', bank: { bank_name: 'ADCB', iban: 'AE070331234567890123456' } })
    expect(r.status).toBe(200)
    expect(r.body.bank.iban_masked).toBe('•••• 3456')
    expect(r.text).not.toContain('AE070331234567890123456')
    expect((await hr('POST', '/hr/employees', { full_name: 'Gone', job_title: 'X', hire_date: today(), status: 'terminated' })).status).toBe(422)
  })
})

describe('documents: status, masking and the once-only expiry alerts', () => {
  it('status follows the company-local day', () => {
    expect(documentStatusOf(null, '2027-01-01')).toEqual({ status: 'valid', days: null })
    expect(documentStatusOf('2027-03-02', '2027-01-01')).toEqual({ status: 'expiring', days: 60 })
    expect(documentStatusOf('2027-03-03', '2027-01-01').status).toBe('valid')
    expect(documentStatusOf('2027-01-01', '2027-01-01').status).toBe('expiring')
    expect(documentStatusOf('2026-12-31', '2027-01-01')).toEqual({ status: 'expired', days: -1 })
  })

  it('the 60-day alert is stored once (HR full + the manager), re-armed when the expiry date changes, and the expiry notice follows', async () => {
    const e = fresh()
    const doc = await hr('POST', `/hr/employees/${e.id}/documents`, { type: 'passport', number: 'Z98765432', expiry_date: addDaysIso(today(), 59), issuing_country: 'IN' })
    expect(doc.status).toBe(200)
    expect(doc.body).toMatchObject({ number_masked: '•••• 5432', status: 'expiring', days_to_expiry: 59 })
    expect(doc.text).not.toContain('Z98765432')
    runHrPeopleAlerts('co_apex')
    const first = hrNotes(e.employeeNo)
    expect(new Set(first.map((n) => n.userId))).toEqual(new Set(['u1', 'u2', 'u9', 'u10']))
    expect(first.every((n) => /Passport expires in 59 days/.test(n.title))).toBe(true)
    runHrPeopleAlerts('co_apex')
    await hr('GET', '/hr/employees')
    expect(hrNotes(e.employeeNo)).toHaveLength(first.length)
    // Further out: no alert; back within 60 days with a NEW date: re-armed.
    await hr('PATCH', `/hr/documents/${doc.body.id}`, { expiry_date: addDaysIso(today(), 200) })
    runHrPeopleAlerts('co_apex')
    expect(hrNotes(e.employeeNo)).toHaveLength(first.length)
    await hr('PATCH', `/hr/documents/${doc.body.id}`, { expiry_date: addDaysIso(today(), 30) })
    runHrPeopleAlerts('co_apex')
    expect(hrNotes(e.employeeNo)).toHaveLength(first.length * 2)
    // Expiry: one more notice, then nothing.
    advanceClock(31)
    runHrPeopleAlerts('co_apex')
    const after = hrNotes(e.employeeNo)
    expect(after).toHaveLength(first.length * 3)
    expect(after[0].title).toBe('Passport expired')
    runHrPeopleAlerts('co_apex')
    expect(hrNotes(e.employeeNo)).toHaveLength(first.length * 3)
  })

  it('uses the company timezone (Dubai, UTC+4) for the 60-day threshold', async () => {
    const e = fresh()
    await hr('POST', `/hr/employees/${e.id}/documents`, { type: 'iqama', number: '2345678901', expiry_date: '2027-03-02' })
    // 19:30 UTC on 31 Dec = 23:30 in Dubai: still 31 Dec there → 61 days, no alert.
    runHrPeopleAlerts('co_apex', new Date('2026-12-31T19:30:00Z'))
    expect(hrNotes(e.employeeNo)).toHaveLength(0)
    // 21:30 UTC on 31 Dec = 1 Jan in Dubai → 60 days → alert (UTC would still say 61).
    runHrPeopleAlerts('co_apex', new Date('2026-12-31T21:30:00Z'))
    expect(hrNotes(e.employeeNo).length).toBeGreaterThan(0)
  })

  it('the seed has expiring and expired documents in both companies, with the alert badge on the list', async () => {
    const list = (await hr('GET', '/hr/employees')).body as { id: string; doc_alert: string | null }[]
    expect(list.find((r) => r.id === 'EMP-u11')?.doc_alert).toBe('expiring')
    expect(list.find((r) => r.id === 'EMP-X1')?.doc_alert).toBe('expired')
    const t = companyDayOf('co_crest').today
    const crest = hrDocuments.filter((d) => d.companyId === 'co_crest' && d.expiryDate)
    expect(crest.some((d) => d.expiryDate! < t)).toBe(true)
    expect(crest.some((d) => d.expiryDate! >= t && d.expiryDate! <= addDaysIso(t, 60))).toBe(true)
  })

  it('Crest without HR in its plan gets no HR alerts', () => {
    expect(runHrPeopleAlerts('co_crest')).toEqual({ documents: 0, contracts: 0, assets: 0 })
    moduleOverrides.push({ companyId: 'co_crest', module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
    expect(runHrPeopleAlerts('co_crest').documents).toBeGreaterThan(0)
  })
})

describe('masking: document numbers, IBAN, pay', () => {
  it('a department head sees the team member with masked numbers, no bank and no pay; the employee sees their own pay; only HR full reveals', async () => {
    const head = await as('u10')('GET', '/hr/employees/EMP-u11')
    expect(head.status).toBe(200)
    expect(head.body.bank).toBeNull()
    for (const d of head.body.documents) expect(d.number_masked).toMatch(/^•••• .{4}$/)
    expect(head.body.contracts[0]).toMatchObject({ salary_visible: false, basic_salary: null, total_salary: null })
    const own = await as('u11')('GET', '/hr/employees/EMP-u11')
    expect(own.body.contracts[0].salary_visible).toBe(true)
    expect(own.body.contracts[0].basic_salary).toBeGreaterThan(0)
    expect(own.body.bank.iban_masked).toMatch(/^•••• \d{4}$/)
    const docId = own.body.documents[0].id
    expect((await as('u11')('POST', `/hr/documents/${docId}/reveal`)).status).toBe(403)
    expect((await as('u10')('POST', `/hr/documents/${docId}/reveal`)).status).toBe(403)
    const rev = await hr('POST', `/hr/documents/${docId}/reveal`)
    expect(rev.status).toBe(200)
    expect(rev.body.number).toBe(hrDocuments.find((d) => d.id === docId)!.number)
    expect((await hr('POST', '/hr/employees/EMP-u11/reveal', { field: 'iban' })).body.value).toBe(hrProfiles.find((p) => p.employeeId === 'EMP-u11')!.iban)
    expect((await as('u10')('POST', '/hr/employees/EMP-u11/reveal', { field: 'iban' })).status).toBe(403)
  })

  it('no full document number or IBAN appears in any list, detail or export, for any viewer', async () => {
    const secrets = [...hrDocuments.filter((d) => d.companyId === 'co_apex').map((d) => d.number), ...hrProfiles.filter((p) => p.companyId === 'co_apex' && p.iban).map((p) => p.iban)]
    for (const uid of ['u1', 'u2', 'u9', 'u10', 'u11']) {
      const bodies = [await as(uid)('GET', '/hr/employees'), await as(uid)('GET', '/hr/contracts'), await as(uid)('GET', '/hr/assets')]
      if (uid !== 'u10' && uid !== 'u11') bodies.push(await as(uid)('GET', '/hr/employees/export'))
      const ids = (bodies[0].body as { id: string }[]).map((r) => r.id)
      for (const id of ids) bodies.push(await as(uid)('GET', `/hr/employees/${id}`))
      for (const b of bodies) {
        expect(b.status).toBe(200)
        expect(secretsIn(b.body, `GET ${b.path}`)).toEqual([])
        for (const s of secrets) expect(b.text.includes(s), `${uid} ${b.path} contains a full number`).toBe(false)
      }
    }
    expect(maskLast4('784-1990-1234567-1')).toBe('•••• 67-1')
  })
})

describe('contracts', () => {
  it('one active contract per employee; renewing creates a new active contract and marks the old one renewed', async () => {
    const active = hrContracts.find((c) => c.employeeId === 'EMP-u14' && c.status === 'active')!
    const dup = await hr('POST', '/hr/contracts', { employee_id: 'EMP-u14', type: 'unlimited', start_date: today(), status: 'active' })
    expect(dup.status).toBe(422)
    const draft = await hr('POST', '/hr/contracts', { employee_id: 'EMP-u14', type: 'unlimited', start_date: today() })
    expect(draft.body.status).toBe('draft')
    expect((await hr('PATCH', `/hr/contracts/${draft.body.id}`, { status: 'active' })).status).toBe(422)
    expect((await hr('POST', '/hr/contracts', { employee_id: 'EMP-u14', type: 'limited', start_date: today() })).status).toBe(422)
    const renewed = await hr('POST', `/hr/contracts/${active.id}/renew`, { basic_salary: 20000 })
    expect(renewed.status).toBe(200)
    expect(renewed.body).toMatchObject({ status: 'active', renewed_from_id: active.id, basic_salary: 20000 })
    expect(active.status).toBe('renewed')
    expect(active.renewedToId).toBe(renewed.body.id)
    expect(hrContracts.filter((c) => c.employeeId === 'EMP-u14' && c.status === 'active')).toHaveLength(1)
    expect((await hr('POST', `/hr/contracts/${active.id}/renew`, {})).status).toBe(422)
    // Team viewers can't write.
    expect((await as('u10')('PATCH', `/hr/contracts/${renewed.body.id}`, { notes: 'x' })).status).toBe(403)
  })

  it('stores the probation (14 days) and contract-end (60 / 30 days) reminders once; past the end the contract ends', async () => {
    const e = fresh('Contract Alert')
    const start = addDaysIso(today(), -80)
    const c = await hr('POST', '/hr/contracts', { employee_id: e.id, type: 'limited', start_date: start, end_date: addDaysIso(today(), 45), probation_months: 3, status: 'active' })
    expect(c.status).toBe(200)
    runHrPeopleAlerts('co_apex')
    const titles = () => hrNotes(e.employeeNo).filter((n) => n.userId === 'u9').map((n) => n.title)
    expect(titles().some((t) => t.startsWith('Probation ends'))).toBe(true)
    expect(titles().filter((t) => t.startsWith('Contract ends'))).toHaveLength(1)
    runHrPeopleAlerts('co_apex')
    expect(titles().filter((t) => t.startsWith('Contract ends'))).toHaveLength(1)
    advanceClock(20)
    runHrPeopleAlerts('co_apex')
    expect(titles().filter((t) => t.startsWith('Contract ends'))).toHaveLength(2)
    advanceClock(30)
    runHrPeopleAlerts('co_apex')
    expect(hrContracts.find((x) => x.id === c.body.id)!.status).toBe('ended')
  })
})

describe('assets and offboarding', () => {
  it('assign → return, mark lost; tag unique per company (Crest may reuse an Apex tag)', async () => {
    const a = hrAssets.find((x) => x.companyId === 'co_apex' && x.status === 'in_stock')!
    const assigned = await hr('POST', `/hr/assets/${a.id}/assign`, { employee_id: 'EMP-u12', date: today(), condition: 'good', note: 'With charger' })
    expect(assigned.body).toMatchObject({ status: 'assigned', assigned_to_id: 'EMP-u12' })
    expect((await hr('POST', `/hr/assets/${a.id}/assign`, { employee_id: 'EMP-u13', date: today(), condition: 'good' })).status).toBe(422)
    expect((await hr('POST', `/hr/assets/${a.id}/assign`, { employee_id: 'EMP-u106', date: today(), condition: 'good' })).status).toBe(404)
    const back = await hr('POST', `/hr/assets/${a.id}/return`, { date: today(), condition: 'fair', note: 'Scratched lid' })
    expect(back.body).toMatchObject({ status: 'in_stock', condition: 'fair', assigned_to_id: null })
    expect(back.body.history[0]).toMatchObject({ employee_id: 'EMP-u12', returned_condition: 'fair' })
    expect((await hr('POST', `/hr/assets/${a.id}/lost`, { note: '' })).status).toBe(422)
    expect((await hr('POST', `/hr/assets/${a.id}/lost`, { note: 'Stolen from the car' })).body.status).toBe('lost')
    expect((await hr('POST', '/hr/assets', { tag: a.tag, name: 'Dup', category: 'other' })).status).toBe(422)
    moduleOverrides.push({ companyId: 'co_crest', module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const crest = await as('u101')('POST', '/hr/assets', { tag: 'AST-900', name: 'Reuse', category: 'other' })
    expect(crest.status).toBe(200)
    expect((await hr('POST', '/hr/assets', { tag: 'ast-900', name: 'Apex same tag', category: 'other' })).status).toBe(200)
  })

  it('offboarding: leaving needs an exit date; completing is blocked until assets are returned (or lost)', async () => {
    const noExit = await hr('PATCH', '/hr/employees/EMP-u11', { status: 'notice' })
    expect(noExit.status).toBe(422)
    const started = await hr('PATCH', '/hr/employees/EMP-u11', { status: 'notice', exit_date: addDaysIso(today(), 30) })
    expect(started.status).toBe(200)
    expect(started.body.offboarding.steps.map((s: { key: string }) => s.key)).toEqual(['assets', 'login', 'settlement'])
    expect(started.body.offboarding.can_complete).toBe(false)
    const blocked = await hr('POST', '/hr/employees/EMP-u11/offboarding/complete')
    expect(blocked.status).toBe(422)
    expect(blocked.body.message).toMatch(/AST-001/)
    const held = started.body.assets as { id: string }[]
    expect(held.length).toBeGreaterThan(1)
    for (const [i, a] of held.entries()) {
      if (i === 0) await hr('POST', `/hr/assets/${a.id}/lost`, { note: 'Lost while travelling' })
      else await hr('POST', `/hr/assets/${a.id}/return`, { date: today(), condition: 'good' })
    }
    const done = await hr('POST', '/hr/employees/EMP-u11/offboarding/complete')
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({ status: 'terminated' })
    expect(done.body.offboarding.completed_at).toBeTruthy()
    expect(done.body.activity[0].summary).toBe('Offboarding completed')
  })

  it('linking a user: only users of the company that no employee links', async () => {
    const created = await as('u1')('POST', '/settings/users', { name: 'Link Me', email: 'link.me@apexaora.ae', mobile: '+971 50 555 0199', role: 'Employee', title: 'Analyst', department_id: 'd-delivery', manager_id: null })
    expect(created.status).toBe(200)
    const unlinked = (await hr('GET', '/hr/users/unlinked')).body as { id: string }[]
    expect(unlinked.map((u) => u.id)).toEqual([created.body.id])
    const e = fresh('Link Target')
    expect((await hr('POST', `/hr/employees/${e.id}/link-user`, { user_id: 'u11' })).status).toBe(422)
    expect((await hr('POST', `/hr/employees/${e.id}/link-user`, { user_id: 'u101' })).status).toBe(404)
    const linked = await hr('POST', `/hr/employees/${e.id}/link-user`, { user_id: created.body.id })
    expect(linked.body.linked_user).toMatchObject({ id: created.body.id, active: true })
  })
})
