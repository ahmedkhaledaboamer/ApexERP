import { describe, expect, it } from 'vitest'
import { notifications } from '@/shared/mocks/data/tasks'
import { auditLog } from '@/shared/mocks/data/audit'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrActivity, hrContracts, hrProfiles } from '@/shared/mocks/data/hrPeople'
import { hrLetterRequests, hrLetterTypes, hrProfileChanges, hrLetterSeq } from '@/shared/mocks/data/hrSelfService'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'
import { withHr } from '@/shared/mocks/isolation/hrTalentEndpoints'

/**
 * HR › Self-service and HR letters: the request → approve / reject → issue flows, reference numbering per company and
 * year, the experience-letter rule, own-request rule, salary only in salary letters, profile change requests (mobile,
 * IBAN with masking, reveal and audit), once-only notifications.
 */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const noura = as('u11') // Employee, reports to u10
const hr = as('u9') // HR Manager
const admin = as('u1') // Company Admin (HR full)
const head = as('u10') // Department Head of u11
const agent = as('u4') // Sales Agent (hr hidden)
const typeId = (co: string, code: string) => hrLetterTypes.find((t) => t.companyId === co && t.code === code)!.id
const year = (co = 'co_apex') => Number(companyDayOf(co).today.slice(0, 4))
const notes = (userId: string) => notifications.filter((n) => n.userId === userId && n.type === 'hr-requests')
const contractOf = (empId: string) => hrContracts.find((c) => c.employeeId === empId && c.status === 'active')!

async function requestLetter(who: ReturnType<typeof as>, code: string, extra: Record<string, unknown> = {}, co = 'co_apex') {
  const r = await who('POST', '/hr/letters/requests', { letter_type_id: typeId(co, code), addressee: 'Emirates NBD', purpose: 'a car loan', ...extra })
  expect(r.status, r.text).toBe(200)
  return r.body
}

describe('HR letters: request → approve → issued letter', () => {
  it('an employee requests a salary certificate, HR approves, the letter carries the reference, code, letterhead and pay', async () => {
    const hrBefore = notes('u9').length
    const req = await requestLetter(noura, 'salary_certificate')
    expect(req.status).toBe('pending')
    expect(req.letter).toBeNull()
    expect(notes('u9')).toHaveLength(hrBefore + 1)
    expect(notes('u11')).toHaveLength(0)

    const ok = await hr('POST', `/hr/letters/requests/${req.id}/approve`, {})
    expect(ok.status, ok.text).toBe(200)
    const l = ok.body.letter
    expect(ok.body.status).toBe('issued')
    expect(l.reference_no).toBe(`APX-HRL-${year()}-0001`)
    expect(l.verification_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(l.signatory_name).toBe('Mariam Saeed')
    expect(l.letterhead.name).toBeTruthy()
    const k = contractOf('EMP-u11')
    const total = (k.basicSalary + k.housingAllowance + k.transportAllowance + k.otherAllowance).toLocaleString('en-US', { minimumFractionDigits: 2 })
    expect(l.body).toContain(total)
    expect(l.body).toContain('Noura Al Ketbi')
    expect(l.body).toContain('Emirates NBD')
    expect(l.body).not.toContain('{{')
    expect(l.body).not.toContain('________')
    // The employee is notified once; the activity log has it.
    expect(notes('u11')).toHaveLength(1)
    expect(hrActivity.some((a) => a.employeeId === 'EMP-u11' && a.summary.includes(l.reference_no))).toBe(true)
    // Approving again: already decided.
    expect((await hr('POST', `/hr/letters/requests/${req.id}/approve`, {})).status).toBe(409)
    expect(notes('u11')).toHaveLength(1)

    // The employee reads the letter (with their pay); their Department Head can't (404, like a missing one).
    const mine = await noura('GET', `/hr/letters/requests/${req.id}`)
    expect(mine.status).toBe(200)
    expect(mine.body.letter.body).toContain(total)
    const theirs = await head('GET', `/hr/letters/requests/${req.id}`)
    const missing = await head('GET', '/hr/letters/requests/HLR-999999')
    expect([theirs.status, theirs.body]).toEqual([missing.status, missing.body])
    expect(JSON.stringify((await head('GET', '/hr/letters/requests')).body)).not.toContain(req.id)

    // Verification: HR full only, own company only.
    const v = await hr('GET', `/hr/letters/verify?code=${encodeURIComponent(l.verification_code.toLowerCase().replace(/-/g, ' '))}`)
    expect(v.body).toMatchObject({ valid: true, reference_no: l.reference_no, employee_name: 'Noura Al Ketbi' })
    expect(JSON.stringify(v.body)).not.toContain(total)
    expect((await noura('GET', `/hr/letters/verify?code=${l.verification_code}`)).status).toBe(403)
    withHr('co_crest')
    const crest = await as('u101')('GET', `/hr/letters/verify?code=${l.verification_code}`)
    expect(crest.body.valid).toBe(false)
    expect((await hr('GET', '/hr/letters/verify?code=nope')).status).toBe(422)
  })

  it('reference numbers: a yearly sequence per company; a refused approval doesn’t use a number', async () => {
    withHr('co_crest')
    const a = await requestLetter(noura, 'employment_certificate')
    const b = await requestLetter(as('u14'), 'employment_certificate')
    // An employee without a department: the template needs it → 422 missing_values, no number used.
    const e17 = hrEmployees.find((e) => e.id === 'EMP-u17')!
    e17.departmentId = null
    const c = await requestLetter(as('u17'), 'employment_certificate')
    const refused = await hr('POST', `/hr/letters/requests/${c.id}/approve`, {})
    expect([refused.status, refused.body.code]).toEqual([422, 'missing_values'])
    expect(refused.body.message).toMatch(/Department/)
    expect(hrLetterSeq[`co_apex:${year()}`] ?? 0).toBe(0)

    const ra = (await hr('POST', `/hr/letters/requests/${a.id}/approve`, {})).body.letter.reference_no
    const rb = (await admin('POST', `/hr/letters/requests/${b.id}/approve`, {})).body.letter.reference_no
    expect([ra, rb]).toEqual([`APX-HRL-${year()}-0001`, `APX-HRL-${year()}-0002`])
    const cr = await requestLetter(as('u107'), 'salary_certificate', {}, 'co_crest')
    const crRef = (await as('u101')('POST', `/hr/letters/requests/${cr.id}/approve`, {})).body.letter
    expect(crRef.reference_no).toBe(`CRS-HRL-${year('co_crest')}-0001`)
    expect(crRef.body).toContain('SAR')
  })

  it('salary only in salary letters: an employment certificate has no pay, and templates can’t add it', async () => {
    const k = contractOf('EMP-u11')
    const req = await requestLetter(noura, 'employment_certificate')
    const l = (await hr('POST', `/hr/letters/requests/${req.id}/approve`, {})).body.letter
    expect(l.body).not.toContain(k.basicSalary.toLocaleString('en-US', { minimumFractionDigits: 2 }))
    expect(l.body).not.toContain(k.currency)
    const bad = await hr('PATCH', `/hr/letters/types/${typeId('co_apex', 'employment_certificate')}`, { body: 'Pay: {{salary.total}}' })
    expect([bad.status, bad.body.code]).toEqual([422, 'invalid_template'])
    // A value typed by the employee can't pull pay in either (no recursive expansion).
    const sneaky = await requestLetter(noura, 'noc', { addressee: '{{salary.total}}', noc_purpose: 'travel', purpose: 'Travel {{salary.basic}}' })
    const s = (await hr('POST', `/hr/letters/requests/${sneaky.id}/approve`, {})).body.letter.body
    expect(s).toContain('{{salary.total}}')
    expect(s).not.toContain(k.basicSalary.toLocaleString('en-US', { minimumFractionDigits: 2 }))
  })

  it('templates: HR full edits and resets; others can’t; employees don’t get the template text', async () => {
    const id = typeId('co_apex', 'noc')
    const up = await hr('PATCH', `/hr/letters/types/${id}`, { body: 'To {{addressee}}: {{employee.fullName}} may travel ({{purpose}}).' })
    expect(up.body.is_default).toBe(false)
    expect((await noura('PATCH', `/hr/letters/types/${id}`, { body: 'x {{addressee}}' })).status).toBe(403)
    expect((await head('PATCH', `/hr/letters/types/${id}`, { body: 'x {{addressee}}' })).status).toBe(403)
    const mine = await noura('GET', '/hr/letters/types')
    expect(mine.body.every((t: { body: string }) => t.body === '')).toBe(true)
    const reset = await hr('POST', `/hr/letters/types/${id}/reset`)
    expect(reset.body.is_default).toBe(true)
  })

  it('experience letters: only for leavers, unless HR overrides with a reason', async () => {
    const id = typeId('co_apex', 'experience_letter')
    const types = (await noura('GET', '/hr/letters/types')).body
    expect(types.find((t: { id: string }) => t.id === id).available).toBe(false)
    const own = await noura('POST', '/hr/letters/requests', { letter_type_id: id })
    expect([own.status, own.body.code]).toEqual([422, 'not_leaving'])
    const noReason = await hr('POST', '/hr/letters/requests', { letter_type_id: id, employee_id: 'EMP-u11' })
    expect(noReason.body.code).toBe('not_leaving')
    const ovr = await hr('POST', '/hr/letters/requests', { letter_type_id: id, employee_id: 'EMP-u11', override_reason: 'Needed for a professional licence' })
    expect(ovr.status, ovr.text).toBe(200)
    expect(ovr.body.on_behalf).toBe(true)
    const issued = await admin('POST', `/hr/letters/requests/${ovr.body.id}/approve`, {})
    // No exit date for an active employee: the template's {{employee.exitDate}} can't be filled.
    expect([issued.status, issued.body.code]).toEqual([422, 'missing_values'])
    // An employee in the notice period may ask themselves.
    const e = hrEmployees.find((x) => x.id === 'EMP-u14')!
    Object.assign(e, { status: 'notice', exitDate: '2030-01-31' })
    const req = await requestLetter(as('u14'), 'experience_letter', { addressee: '' })
    const ok = await hr('POST', `/hr/letters/requests/${req.id}/approve`, {})
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.letter.body).toContain('31 January 2030')
    expect(ok.body.letter.body).toContain('To whom it may concern')
  })

  it('nobody decides their own request; reject needs a reason and notifies the employee; cancel', async () => {
    const own = await requestLetter(hr, 'employment_certificate')
    expect((await hr('POST', `/hr/letters/requests/${own.id}/approve`, {})).body.code).toBe('own_request')
    expect((await admin('POST', `/hr/letters/requests/${own.id}/approve`, {})).status).toBe(200)

    const req = await requestLetter(noura, 'salary_certificate')
    expect((await noura('POST', `/hr/letters/requests/${req.id}/approve`, {})).status).toBe(403)
    expect((await hr('POST', `/hr/letters/requests/${req.id}/reject`, {})).body.code).toBe('reason_required')
    const rej = await hr('POST', `/hr/letters/requests/${req.id}/reject`, { reason: 'Use the salary transfer letter for a loan.' })
    expect(rej.body.status).toBe('rejected')
    expect(notes('u11').map((n) => n.title)).toEqual(['Your salary certificate request was rejected'])

    const dup1 = await requestLetter(noura, 'salary_certificate')
    const dup2 = await noura('POST', '/hr/letters/requests', { letter_type_id: typeId('co_apex', 'salary_certificate') })
    expect([dup2.status, dup2.body.code]).toEqual([409, 'duplicate_request'])
    expect((await noura('POST', `/hr/letters/requests/${dup1.id}/cancel`)).body.status).toBe('cancelled')
    expect((await noura('POST', `/hr/letters/requests/${dup1.id}/cancel`)).status).toBe(409)
  })

  it('a hidden-role employee (Sales Agent) requests and reads their own letters only', async () => {
    const req = await requestLetter(agent, 'salary_transfer')
    const list = await agent('GET', '/hr/letters/requests')
    expect(list.body.map((r: { employee_id: string }) => r.employee_id)).toEqual(['EMP-u4'])
    expect((await agent('GET', `/hr/letters/requests/${hrLetterRequests.find((r) => r.employeeId === 'EMP-u14')!.id}`)).status).toBe(404)
    expect((await agent('POST', '/hr/letters/requests', { letter_type_id: typeId('co_apex', 'noc'), employee_id: 'EMP-u5', noc_purpose: 'travel', purpose: 'x' })).status).toBe(403)
    const missing = await agent('POST', '/hr/letters/requests', { letter_type_id: typeId('co_apex', 'salary_transfer'), addressee: '' })
    expect(missing.body.code).toBe('addressee')
    const ok = await hr('POST', `/hr/letters/requests/${req.id}/approve`, {})
    expect(ok.status, ok.text).toBe(200)
    const iban = hrProfiles.find((p) => p.employeeId === 'EMP-u4')!.iban
    expect(ok.body.letter.body).toContain(iban.slice(-4))
    expect(ok.text).not.toContain(iban)
  })
})

describe('Profile change requests', () => {
  it('mobile: the employee asks, HR approves, the record is updated, the employee is notified', async () => {
    const r = await noura('POST', '/hr/profile-changes', { mobile: '+971 50 999 1234', note: 'New number' })
    expect(r.status, r.text).toBe(200)
    expect(r.body.fields).toEqual(['mobile'])
    expect(notes('u9')).toHaveLength(1)
    expect((await noura('POST', '/hr/profile-changes', { mobile: '+971 50 999 0000' })).body.code).toBe('pending_exists')
    const ok = await hr('POST', `/hr/profile-changes/${r.body.id}/approve`, {})
    expect(ok.body.status).toBe('approved')
    expect(hrEmployees.find((e) => e.id === 'EMP-u11')!.mobile).toBe('+971 50 999 1234')
    expect((await noura('GET', '/hr/me')).body.profile.mobile).toBe('+971 50 999 1234')
    expect(notes('u11').map((n) => n.title)).toEqual(['Your profile change was approved'])
    expect(auditLog.some((a) => a.entityId === 'EMP-u11' && a.summary.includes(r.body.id))).toBe(true)
  })

  it('IBAN: masked everywhere (also while pending), HR reveal audited, approval audited as security, wiped once closed', async () => {
    const before = hrProfiles.find((p) => p.employeeId === 'EMP-u4')!.iban
    const iban = 'AE070331234567890123456'
    const r = await agent('POST', '/hr/profile-changes', { bank: { bank_name: 'Mashreq', account_name: 'Bincy Thomas', iban } })
    expect(r.status, r.text).toBe(200)
    expect(r.body.iban_change).toBe(true)
    expect(r.body.proposed.bank.iban_masked).toBe('•••• 3456')
    for (const res of [r, await agent('GET', '/hr/me'), await hr('GET', '/hr/profile-changes'), await hr('GET', '/hr/self-service/inbox'), await agent('GET', '/hr/profile-changes')]) {
      expect(res.text).not.toContain(iban)
      expect(res.text).not.toContain(before)
    }
    expect((await agent('POST', `/hr/profile-changes/${r.body.id}/reveal`)).status).toBe(403)
    const rev = await hr('POST', `/hr/profile-changes/${r.body.id}/reveal`)
    expect(rev.body.iban).toBe(iban)
    const ok = await hr('POST', `/hr/profile-changes/${r.body.id}/approve`, { comment: 'Checked with the employee' })
    expect(ok.status, ok.text).toBe(200)
    expect(hrProfiles.find((p) => p.employeeId === 'EMP-u4')!.iban).toBe(iban)
    expect(hrProfileChanges.find((c) => c.id === r.body.id)!.proposed.bank!.iban).toBe('')
    const sec = auditLog.find((a) => a.entityId === 'EMP-u4' && a.action === 'security' && a.summary.includes('bank account'))
    expect(sec?.changes).toEqual([{ field: 'IBAN', from: `•••• ${before.slice(-4)}`, to: '•••• 3456' }])
    expect(JSON.stringify(auditLog)).not.toContain(iban)
  })

  it('validation: nothing changed, bad IBAN, bad mobile, incomplete emergency contact; reject needs a reason; own requests', async () => {
    const me = (await noura('GET', '/hr/me')).body
    expect((await noura('POST', '/hr/profile-changes', { mobile: me.profile.mobile })).body.code).toBe('no_changes')
    expect((await noura('POST', '/hr/profile-changes', { bank: { iban: 'NOT-AN-IBAN' } })).status).toBe(422)
    expect((await noura('POST', '/hr/profile-changes', { mobile: 'call me' })).body.code).toBe('mobile')
    expect((await noura('POST', '/hr/profile-changes', { emergency_contact: { name: 'Only a name', phone: '' } })).body.code).toBe('emergency_contact')
    const r = await noura('POST', '/hr/profile-changes', { address: { line1: 'Villa 3, Street 12', city: 'Dubai', country: 'AE' } })
    expect((await hr('POST', `/hr/profile-changes/${r.body.id}/reject`, {})).body.code).toBe('reason_required')
    expect((await hr('POST', `/hr/profile-changes/${r.body.id}/reject`, { reason: 'Attach the tenancy contract.' })).body.status).toBe('rejected')
    const mine = await hr('POST', '/hr/profile-changes', { mobile: '+971 50 111 2222' })
    expect((await hr('POST', `/hr/profile-changes/${mine.body.id}/approve`, {})).body.code).toBe('own_request')
    expect((await head('POST', `/hr/profile-changes/${mine.body.id}/approve`, {})).status).toBe(403)
    expect((await admin('POST', `/hr/profile-changes/${mine.body.id}/approve`, {})).status).toBe(200)
  })
})

describe('My HR portal', () => {
  it('answers only the caller’s own data, for a hidden-role employee too', async () => {
    const me = await agent('GET', '/hr/me')
    expect(me.status, me.text).toBe(200)
    expect(me.body.employee.id).toBe('EMP-u4')
    expect(me.body.hr_scope).toBe('hidden')
    expect(me.body.contract?.employee_id ?? 'EMP-u4').toBe('EMP-u4')
    expect(me.body.contract?.salary_visible ?? true).toBe(true)
    for (const p of me.body.payslips) expect(p.employee_id).toBe('EMP-u4')
    for (const d of me.body.documents) expect(d.employee_id).toBe('EMP-u4')
    expect(me.body.interviews).toEqual([])
    if (me.body.payslips.length) {
      expect((await agent('GET', `/hr/me/payslips/${me.body.payslips[0].id}`)).status).toBe(200)
      const other = (await hr('GET', '/hr/payroll/payslips')).body.find((p: { employee_id: string }) => p.employee_id !== 'EMP-u4')
      expect((await agent('GET', `/hr/me/payslips/${other.id}`)).status).toBe(404)
    }
  })
})
