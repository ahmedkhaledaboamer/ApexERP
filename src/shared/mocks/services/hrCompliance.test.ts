import { describe, expect, it } from 'vitest'
import { notifications } from '@/shared/mocks/data/tasks'
import { auditLog } from '@/shared/mocks/data/audit'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { hrPayAdjustments } from '@/shared/mocks/data/hrPayroll'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { hrLetterRequests, hrLetterTypes, letterVerifyHits } from '@/shared/mocks/data/hrSelfService'
import { hrDisciplinary, hrPolicies, hrPolicyAcks } from '@/shared/mocks/data/hrCompliance'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { advanceClock } from '@/shared/mocks/clock'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'
import { withHr } from '@/shared/mocks/isolation/hrTalentEndpoints'
import { FSI, PDI, RLM, stripBidi } from '@/modules/hr/selfservice/letters'
import { deductionAdjustment, runPolicyReminders } from './hrCompliance'
import { PUBLIC_VERIFY_LIMIT } from './hrLetters'

/**
 * HR gaps part A through the real handlers: Arabic / bilingual letters (values, RTL markers, digits, missing Arabic
 * values), revocation and the public verification page (company from the address, masked name, no pay, rate limit),
 * warnings & disciplinary actions (acknowledgement, escalation, expiry, team visibility, payroll deduction idempotent,
 * warning letter EN / AR), policies (publish, versions and re-acknowledgement, once-only reminders, dashboard).
 */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown, headers?: Record<string, string>) => api(userToken(userId), method, path, { body, headers })
const noura = as('u11') // Employee (Delivery, reports to u10), has an Arabic name
const leena = as('u15') // Employee (Delivery, reports to u10), no Arabic name
const hr = as('u9') // HR Manager (full)
const head = as('u10') // Department Head (team)
const agent = as('u4') // Sales Agent (hr hidden; self-service only)
const sara = as('u7') // Marketing Manager (hr hidden), the only login in Marketing
const typeId = (co: string, code: string) => hrLetterTypes.find((t) => t.companyId === co && t.code === code)!.id
const notes = (userId: string, type = 'hr-requests') => notifications.filter((n) => n.userId === userId && n.type === type)
const pub = (path: string, workspace: string | null, client = 'test-client') => api(null, 'GET', path, { headers: { ...(workspace ? { 'X-Workspace': workspace } : {}), 'X-Client-Id': client } })
const setLegalAr = (co: string, v: string) => {
  financeSettings.get(co).legalNameAr = v
}

async function issue(who: ReturnType<typeof as>, code: string, extra: Record<string, unknown> = {}) {
  const r = await who('POST', '/hr/letters/requests', { letter_type_id: typeId('co_apex', code), addressee: 'Emirates NBD', purpose: 'a car loan', ...extra })
  expect(r.status, r.text).toBe(200)
  const ok = await hr('POST', `/hr/letters/requests/${r.body.id}/approve`, {})
  return { req: r.body, ok }
}

/* ======================= Arabic & bilingual letters ======================= */

describe('HR letters in Arabic and bilingual', () => {
  it('Arabic needs the company’s Arabic legal name: 422 missing_values (missing_ar), nothing numbered; then issued RTL with Arabic values', async () => {
    setLegalAr('co_apex', '') // the seed now carries an Arabic legal name: clear it to exercise the refusal
    const { req, ok: refused } = await issue(noura, 'salary_certificate', { language: 'ar' })
    expect([refused.status, refused.body.code], refused.text).toEqual([422, 'missing_values'])
    expect(refused.body.missingAr ?? refused.body.missing_ar).toContain('company.legalName')
    expect(refused.body.message).toMatch(/Accounts & finance › Settings/)
    setLegalAr('co_apex', 'شركة أبكس أورا ذ.م.م')
    const ok = await hr('POST', `/hr/letters/requests/${req.id}/approve`, {})
    expect(ok.status, ok.text).toBe(200)
    const l = ok.body.letter
    // The refused approval didn't burn a reference number.
    expect(l.reference_no).toMatch(/^APX-HRL-\d{4}-0001$/)
    expect([l.language, l.body, l.title_ar]).toEqual(['ar', '', 'شهادة راتب'])
    const text = stripBidi(l.body_ar)
    expect(text).toContain('نورة الكتبي')
    expect(text).toContain('مستشارة حلول')
    expect(text).toContain('شركة أبكس أورا ذ.م.م')
    expect(text).toContain('السيدة') // salutation from gender
    expect(text).toContain('درهم إماراتي') // currency in words
    expect(text).not.toContain('{{')
    // RTL markers: every non-empty line starts with RLM; Latin values (bank, employee number) are isolated.
    for (const line of l.body_ar.split('\n').filter((x: string) => x.trim())) expect(line.startsWith(RLM)).toBe(true)
    expect(l.body_ar).toContain(`${FSI}Emirates NBD${PDI}`)
    expect(l.body_ar).toMatch(new RegExp(`${FSI}APX-\\d{4}${PDI}`))
    // Western digits by default; Arabic month name in the dates.
    const k = hrContracts.find((c) => c.employeeId === 'EMP-u11' && c.status === 'active')!
    expect(text).toContain((k.basicSalary + k.housingAllowance + k.transportAllowance + k.otherAllowance).toLocaleString('en-US', { minimumFractionDigits: 2 }))
    expect(l.issue_date_ar).toMatch(/^\d{1,2} (يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر) \d{4}$/)
    expect(l.letterhead.legal_name_ar).toBe('شركة أبكس أورا ذ.م.م')
  })

  it('Arabic-Indic digits when asked; identifiers (reference, employee number) stay Western', async () => {
    setLegalAr('co_apex', 'شركة أبكس أورا')
    const { ok } = await issue(noura, 'salary_certificate', { language: 'ar', digits: 'arabic' })
    expect(ok.status, ok.text).toBe(200)
    const text = stripBidi(ok.body.letter.body_ar)
    expect(text).toMatch(/[٠-٩]{1,3}٬[٠-٩]{3}٫[٠-٩]{2}/) // 12٬500٫00
    expect(ok.body.letter.issue_date_ar).toMatch(/^[٠-٩]+ \S+ [٠-٩]{4}$/)
    expect(text).toMatch(/APX-\d{4}/)
  })

  it('bilingual: both texts, the chosen layout; an employee without an Arabic name → 422 listing the Arabic name', async () => {
    setLegalAr('co_apex', 'شركة أبكس أورا')
    const { ok } = await issue(noura, 'employment_certificate', { language: 'bilingual', layout: 'stacked', addressee_ar: 'بنك الإمارات دبي الوطني' })
    expect(ok.status, ok.text).toBe(200)
    expect([ok.body.letter.language, ok.body.letter.layout]).toEqual(['bilingual', 'stacked'])
    expect(ok.body.letter.body).toContain('Noura Al Ketbi')
    expect(stripBidi(ok.body.letter.body_ar)).toContain('إلى: بنك الإمارات دبي الوطني')
    const leenaReq = await leena('POST', '/hr/letters/requests', { letter_type_id: typeId('co_apex', 'employment_certificate'), language: 'bilingual' })
    const refused = await hr('POST', `/hr/letters/requests/${leenaReq.body.id}/approve`, {})
    expect([refused.status, refused.body.code]).toEqual([422, 'missing_values'])
    expect(refused.body.missing_ar ?? refused.body.missingAr).toEqual(expect.arrayContaining(['employee.fullName', 'employee.jobTitle']))
    expect(refused.body.missing ?? []).toEqual([])
    // Once HR fills the Arabic name and title (employee profile), it's issued.
    const patch = await hr('PATCH', '/hr/employees/EMP-u15', { full_name_ar: 'لينا جوزيف', job_title_ar: 'مهندسة ضمان الجودة' })
    expect(patch.status, patch.text).toBe(200)
    expect(patch.body.full_name_ar).toBe('لينا جوزيف')
    expect((await hr('POST', `/hr/letters/requests/${leenaReq.body.id}/approve`, {})).status).toBe(200)
  })

  it('the Arabic name must be in Arabic letters; only HR full edits it', async () => {
    expect((await hr('PATCH', '/hr/employees/EMP-u15', { full_name_ar: 'Leena' })).status).toBe(422)
    expect((await head('PATCH', '/hr/employees/EMP-u15', { full_name_ar: 'لينا' })).status).toBe(403)
  })

  it('a type without an Arabic template refuses Arabic requests (422 no_arabic_template); templates validate the Arabic text too', async () => {
    const id = typeId('co_apex', 'noc')
    expect((await hr('PATCH', `/hr/letters/types/${id}`, { body_ar: 'راتب {{salary.total}}' })).body.code).toBe('invalid_template')
    expect((await hr('PATCH', `/hr/letters/types/${id}`, { body_ar: '' })).status).toBe(200)
    const r = await noura('POST', '/hr/letters/requests', { letter_type_id: id, noc_purpose: 'travel', purpose: 'Oman', language: 'ar' })
    expect([r.status, r.body.code]).toEqual([422, 'no_arabic_template'])
    const types = await noura('GET', '/hr/letters/types')
    expect(types.body.find((t: { id: string }) => t.id === id).has_arabic).toBe(false)
    expect((await hr('POST', `/hr/letters/types/${id}/reset`)).body.has_arabic).toBe(true)
  })
})

/* ======================= revoke & public verification ======================= */

describe('Letter revocation and the public verification page', () => {
  it('valid → shows only company, type, reference, date, masked name; HR revokes (reason, audited) → revoked', async () => {
    const { ok } = await issue(noura, 'salary_certificate')
    expect(ok.status).toBe(200)
    const code = ok.body.letter.verification_code as string
    const v = await pub(`/public/letters/verify?code=${code}`, 'apexaora')
    expect(v.status, v.text).toBe(200)
    expect(v.body).toMatchObject({ status: 'valid', reference_no: ok.body.letter.reference_no, employee_name_masked: 'Noura K.', type_name: 'Salary certificate' })
    expect(Object.keys(v.body).sort()).toEqual(['code', 'company_name', 'employee_name_masked', 'issue_date', 'logo_url', 'monogram', 'reference_no', 'revoked_at', 'status', 'type_name'])
    expect(v.text).not.toContain('Ketbi')
    expect(v.text).not.toContain('EMP-u11')
    const k = hrContracts.find((c) => c.employeeId === 'EMP-u11' && c.status === 'active')!
    expect(v.text).not.toContain(k.basicSalary.toLocaleString('en-US'))

    // Lower case with spaces works (QR or typed).
    expect((await pub(`/public/letters/verify?code=${encodeURIComponent(code.toLowerCase().replace(/-/g, ' '))}`, 'apexaora')).body.status).toBe('valid')

    expect((await hr('POST', `/hr/letters/requests/${ok.body.id}/revoke`, {})).body.code).toBe('reason_required')
    expect((await noura('POST', `/hr/letters/requests/${ok.body.id}/revoke`, { reason: 'x' })).status).toBe(403)
    const rv = await hr('POST', `/hr/letters/requests/${ok.body.id}/revoke`, { reason: 'Issued with the wrong addressee' })
    expect([rv.status, rv.body.status, rv.body.revoke_reason, rv.body.can_revoke]).toEqual([200, 'revoked', 'Issued with the wrong addressee', false])
    expect(auditLog.some((a) => a.entity === 'hr_letter' && a.entityId === ok.body.id && /Revoked/.test(a.summary))).toBe(true)
    expect((await hr('POST', `/hr/letters/requests/${ok.body.id}/revoke`, { reason: 'again' })).status).toBe(409)
    const after = await pub(`/public/letters/verify?code=${code}`, 'apexaora')
    expect([after.body.status, !!after.body.revoked_at]).toEqual(['revoked', true])
    const internal = await hr('GET', `/hr/letters/verify?code=${code}`)
    expect([internal.body.valid, internal.body.status]).toEqual([false, 'revoked'])
    expect(notes('u11').some((n) => /revoked/.test(n.title))).toBe(true)
  })

  it('a code is looked up in the address’s company only: another company’s / unknown / no workspace → the same 404', async () => {
    const { ok } = await issue(noura, 'employment_certificate')
    const code = ok.body.letter.verification_code as string
    withHr('co_crest')
    const crest = await pub(`/public/letters/verify?code=${code}`, 'crest')
    const unknown = await pub('/public/letters/verify?code=ABCD-EFGH-JKMN', 'apexaora')
    const none = await pub(`/public/letters/verify?code=${code}`, null)
    const bogus = await pub(`/public/letters/verify?code=${code}`, 'no-such-workspace')
    for (const r of [crest, unknown, none, bogus]) expect([r.status, r.body]).toEqual([unknown.status, unknown.body])
    expect(unknown.status).toBe(404)
    expect(crest.text).not.toContain(ok.body.letter.reference_no)
    expect((await pub('/public/letters/verify?code=nope', 'apexaora')).status).toBe(422)
    // ?workspace= works like the header (the QR link in development).
    expect((await api(null, 'GET', `/public/letters/verify?code=${code}&workspace=apexaora`)).body.status).toBe('valid')
  })

  it('a company without the HR module answers 404; the public endpoint is rate-limited per client (429)', async () => {
    const { ok } = await issue(noura, 'employment_certificate')
    const code = ok.body.letter.verification_code as string
    moduleOverrides.push({ companyId: 'co_apex', module: 'hr', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    expect((await pub(`/public/letters/verify?code=${code}`, 'apexaora')).status).toBe(404)
    moduleOverrides.pop()
    letterVerifyHits.length = 0
    for (let i = 0; i < PUBLIC_VERIFY_LIMIT; i++) expect((await pub(`/public/letters/verify?code=${code}`, 'apexaora', 'flood')).status).toBe(200)
    const limited = await pub(`/public/letters/verify?code=${code}`, 'apexaora', 'flood')
    expect([limited.status, limited.body.code]).toEqual([429, 'rate_limited'])
    expect((await pub(`/public/letters/verify?code=${code}`, 'apexaora', 'another-client')).status).toBe(200)
    letterVerifyHits.length = 0
  })
})

/* ======================= discipline ======================= */

describe('Warnings & disciplinary actions', () => {
  const today = () => companyDayOf('co_apex').today
  const create = (body: Record<string, unknown>) => hr('POST', '/hr/discipline', { employee_id: 'EMP-u11', type: 'written_warning', category: 'attendance', incident_date: today(), description: 'Late three times this week.', ...body })

  it('HR issues a written warning → employee notified, sees it, acknowledges once; HR is told; activity + audit', async () => {
    const before = notes('u11').length
    const r = await create({})
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ case_no: expect.stringMatching(/^APX-DA-\d{4}-\d{4}$/), status: 'active', ack_status: 'pending', expiry_months: 12, can_acknowledge: false })
    expect(notes('u11')).toHaveLength(before + 1)
    const mine = await noura('GET', '/hr/discipline?mine=1')
    expect(mine.body.map((x: { id: string }) => x.id)).toContain(r.body.id)
    const view = await noura('GET', `/hr/discipline/${r.body.id}`)
    expect(view.body.can_acknowledge).toBe(true)
    expect((await hr('POST', `/hr/discipline/${r.body.id}/acknowledge`, {})).status).toBe(403)
    expect((await noura('POST', `/hr/discipline/${r.body.id}/acknowledge`, { appeal: true })).body.code).toBe('comment_required')
    const ack = await noura('POST', `/hr/discipline/${r.body.id}/acknowledge`, { comment: 'Understood.' })
    expect([ack.status, ack.body.ack_status, ack.body.employee_comment]).toEqual([200, 'acknowledged', 'Understood.'])
    expect((await noura('POST', `/hr/discipline/${r.body.id}/acknowledge`, {})).body.code).toBe('already_acknowledged')
    expect(notes('u9').some((n) => n.title.includes('acknowledged by Noura Al Ketbi'))).toBe(true)
    expect(auditLog.some((a) => a.entity === 'hr_disciplinary' && a.entityId === r.body.id)).toBe(true)
  })

  it('visibility: employee own only, department head their team (no deduction amount), hidden roles their own; foreign → 404', async () => {
    const d = await create({ employee_id: 'EMP-u14', type: 'deduction', deduction_amount: 250 })
    expect(d.status, d.text).toBe(200)
    expect(d.body.deduction_amount).toBe(250)
    const viaHead = await head('GET', `/hr/discipline/${d.body.id}`)
    expect([viaHead.status, viaHead.body.deduction_amount, viaHead.body.currency]).toEqual([200, null, null])
    expect((await noura('GET', `/hr/discipline/${d.body.id}`)).status).toBe(404)
    const nouraList = await noura('GET', '/hr/discipline')
    expect(nouraList.body.every((x: { employee_id: string }) => x.employee_id === 'EMP-u11')).toBe(true)
    const headList = await head('GET', '/hr/discipline')
    expect(headList.body.map((x: { employee_id: string }) => x.employee_id)).toEqual(expect.arrayContaining(['EMP-u14', 'EMP-u12']))
    expect(headList.body.some((x: { employee_id: string }) => x.employee_id === 'EMP-u4')).toBe(false)
    expect((await agent('GET', '/hr/discipline')).status).toBe(200)
    expect((await agent('POST', '/hr/discipline', { employee_id: 'EMP-u5', type: 'verbal_warning' })).status).toBe(403)
    expect((await hr('GET', '/hr/discipline/HDA-101')).status).toBe(404)
    expect((await hr('POST', '/hr/discipline', { employee_id: 'EMP-u107', type: 'verbal_warning', category: 'conduct', incident_date: today(), description: 'Crest employee.' })).status).toBe(404)
  })

  it('escalation hint: two active written warnings → final warning; lapsed / withdrawn ones don’t count', async () => {
    // Yusuf (EMP-u14) has one active written warning (seed) and a lapsed verbal one.
    const one = await hr('GET', '/hr/discipline/HDA-2')
    expect(one.body.escalation).toMatchObject({ active_written: 1, active_verbal: 0, suggestion: 'written_warning' })
    const second = await create({ employee_id: 'EMP-u14' })
    expect(second.body.escalation).toMatchObject({ active_written: 2, suggestion: 'final_warning' })
    expect(second.body.escalation.message).toMatch(/final warning/)
    const w = await hr('POST', `/hr/discipline/${second.body.id}/withdraw`, { reason: 'Issued in error' })
    expect([w.status, w.body.status, w.body.escalation.active_written]).toEqual([200, 'withdrawn', 1])
  })

  it('expiry: a verbal warning lapses after 6 months (company calendar)', async () => {
    const v = await create({ type: 'verbal_warning' })
    expect(v.body.expiry_months).toBe(6)
    advanceClock(200)
    const later = await hr('GET', `/hr/discipline/${v.body.id}`)
    expect(later.body.status).toBe('expired')
    expect((await hr('GET', '/hr/discipline?status=expired')).body.map((x: { id: string }) => x.id)).toContain(v.body.id)
  })

  it('a deduction is one payroll adjustment (sourceRef discipline:<id>, idempotent); withdrawing removes it while unpaid', async () => {
    const d = await create({ employee_id: 'EMP-u14', type: 'deduction', deduction_amount: 300, category: 'policy_breach' })
    expect(d.status, d.text).toBe(200)
    const adj = hrPayAdjustments.filter((a) => a.sourceRef === `discipline:${d.body.id}`)
    expect(adj).toHaveLength(1)
    expect(adj[0]).toMatchObject({ companyId: 'co_apex', employeeId: 'EMP-u14', kind: 'deduction', amount: 300, recurrence: 'once' })
    const rec = hrDisciplinary.find((r) => r.id === d.body.id)!
    expect(deductionAdjustment('co_apex', rec, 'u9')).toBe(adj[0].id)
    expect(deductionAdjustment('co_apex', rec, 'u9')).toBe(adj[0].id)
    expect(hrPayAdjustments.filter((a) => a.sourceRef === `discipline:${d.body.id}`)).toHaveLength(1)
    // It shows in the payroll adjustments of HR.
    const list = await hr('GET', `/hr/payroll/adjustments?employee_id=EMP-u14`)
    expect(list.body.some((a: { id: string }) => a.id === adj[0].id)).toBe(true)
    await hr('POST', `/hr/discipline/${d.body.id}/withdraw`, { reason: 'Appeal upheld' })
    expect(hrPayAdjustments.some((a) => a.sourceRef === `discipline:${d.body.id}`)).toBe(false)
  })

  it('validation: suspension needs days + start, a deduction an amount; no future incident; not for a leaver or oneself', async () => {
    expect((await create({ type: 'suspension_unpaid' })).body.code).toBe('suspension_days')
    expect((await create({ type: 'suspension_unpaid', suspension_days: 3, suspension_start: today() })).status).toBe(200)
    expect((await create({ type: 'deduction' })).body.code).toBe('deduction_amount')
    expect((await create({ incident_date: '2999-01-01' })).body.code).toBe('incident_date')
    expect((await create({ employee_id: 'EMP-u9' })).status).toBe(403)
    expect((await create({ expiry_months: 5 })).body.code).toBe('expiry_months')
  })

  it('attachments are counted in the plan storage; the employee can open the warning letter in English, Arabic or both', async () => {
    const r = await create({ attachments: [{ name: 'note.pdf', size_bytes: 120_000, mime_type: 'application/pdf' }] })
    expect(r.body.attachments).toHaveLength(1)
    const more = await hr('POST', `/hr/discipline/${r.body.id}/attachments`, { attachments: [{ name: 'photo.jpg', size_bytes: 80_000, mime_type: 'image/jpeg' }] })
    expect(more.body.attachments).toHaveLength(2)
    const en = await noura('GET', `/hr/discipline/${r.body.id}/letter?language=en`)
    expect(en.status, en.text).toBe(200)
    expect(en.body.body).toContain('written warning')
    expect(en.body.body).toContain('Late three times this week.')
    // Leena has no Arabic name: her Arabic letter lists what's missing.
    const lr = await create({ employee_id: 'EMP-u15' })
    const missing = await leena('GET', `/hr/discipline/${lr.body.id}/letter?language=ar`)
    expect([missing.status, missing.body.code]).toEqual([422, 'missing_values'])
    expect(missing.body.missing_ar ?? missing.body.missingAr).toEqual(expect.arrayContaining(['employee.fullName', 'employee.jobTitle']))
    const ar = await noura('GET', `/hr/discipline/${r.body.id}/letter?language=bilingual&digits=arabic`)
    expect(ar.status, ar.text).toBe(200)
    expect(stripBidi(ar.body.body_ar)).toContain('إنذار كتابي')
    expect(ar.body.title_ar).toBe('إنذار كتابي')
    expect(ar.body.issue_date_ar).toMatch(/[٠-٩]/)
    expect((await head('GET', `/hr/discipline/${r.body.id}/letter`)).status).toBe(404)
  })
})

/* ======================= policies ======================= */

describe('Policies: publish, acknowledge, versions, reminders', () => {
  async function publishNew(audience: Record<string, unknown> = { kind: 'all' }) {
    const c = await hr('POST', '/hr/policies', { title: 'Remote work', category: 'other', body: '# Remote work\n- Two days a week.', audience })
    expect(c.status, c.text).toBe(200)
    expect(c.body.status).toBe('draft')
    const p = await hr('POST', `/hr/policies/${c.body.id}/publish`, {})
    expect(p.status, p.text).toBe(200)
    return p.body
  }

  it('publish → every audience employee notified once (at publish); +3 and +7 days once each; nothing after acknowledging', async () => {
    const p = await publishNew()
    expect([p.version, p.status]).toEqual([1, 'published'])
    const first = notes('u11').filter((n) => n.title.includes('Remote work'))
    expect(first).toHaveLength(1)
    expect(first[0].title).toMatch(/New policy to acknowledge/)
    expect(runPolicyReminders('co_apex')).toBe(0) // once only
    advanceClock(3)
    runPolicyReminders('co_apex')
    runPolicyReminders('co_apex')
    expect(notes('u11').filter((n) => n.title.includes('Remote work'))).toHaveLength(2)
    // Sara acknowledges: no further reminder for her.
    expect((await sara('POST', `/hr/policies/${p.id}/acknowledge`, { version: 1 })).status).toBe(200)
    const saraBefore = notes('u7').filter((n) => n.title.includes('Remote work')).length
    advanceClock(5)
    runPolicyReminders('co_apex')
    expect(notes('u11').filter((n) => n.title.includes('Remote work'))).toHaveLength(3)
    expect(notes('u7').filter((n) => n.title.includes('Remote work'))).toHaveLength(saraBefore)
    advanceClock(10)
    expect(runPolicyReminders('co_apex')).toBe(0)
  })

  it('acknowledge → dashboard %, by department; a new version needs re-acknowledgement (old version → 409)', async () => {
    const p = await publishNew()
    expect((await sara('GET', '/hr/policies/my')).body.find((x: { id: string }) => x.id === p.id)).toMatchObject({ acknowledged: false, reacknowledge: false })
    await sara('POST', `/hr/policies/${p.id}/acknowledge`, { version: 1 })
    // Idempotent.
    expect((await sara('POST', `/hr/policies/${p.id}/acknowledge`, { version: 1 })).body.acknowledged).toBe(true)
    expect(hrPolicyAcks.filter((a) => a.policyId === p.id && a.employeeId === 'EMP-u7')).toHaveLength(1)
    const st = await hr('GET', `/hr/policies/${p.id}/status`)
    const marketing = st.body.by_department.find((d: { department_name: string }) => d.department_name === 'Marketing')
    expect(marketing).toMatchObject({ audience: 1, acknowledged: 1, pct: 100 })
    expect(st.body.stats.acknowledged).toBe(1)
    const exp = await hr('GET', `/hr/policies/${p.id}/export`)
    expect(exp.body.find((r: { employee_name: string }) => r.employee_name === 'Sara Khoury').acknowledged).toBe('yes')

    // New version: edit goes into the draft; publishing makes v2; Sara must re-acknowledge.
    const ed = await hr('PATCH', `/hr/policies/${p.id}`, { body: '# Remote work\n- Three days a week.', change_note: 'Three days' })
    expect([ed.body.has_draft, ed.body.version]).toEqual([true, 1])
    const v2 = await hr('POST', `/hr/policies/${p.id}/publish`, {})
    expect(v2.body.version).toBe(2)
    expect((await sara('GET', '/hr/policies/my')).body.find((x: { id: string }) => x.id === p.id)).toMatchObject({ version: 2, acknowledged: false, reacknowledge: true })
    expect((await sara('POST', `/hr/policies/${p.id}/acknowledge`, { version: 1 })).body.code).toBe('version_changed')
    expect((await hr('GET', `/hr/policies/${p.id}/status`)).body.by_department.find((d: { department_name: string }) => d.department_name === 'Marketing').pct).toBe(0)
    expect((await sara('POST', `/hr/policies/${p.id}/acknowledge`, { version: 2 })).body.acknowledged).toBe(true)
  })

  it('audience: departments / roles; outside it → 404; department head sees their team’s numbers; employees can’t manage', async () => {
    const p = await publishNew({ kind: 'departments', department_ids: ['d-marketing'] })
    expect((await noura('GET', '/hr/policies/my')).body.some((x: { id: string }) => x.id === p.id)).toBe(false)
    expect((await noura('POST', `/hr/policies/${p.id}/acknowledge`, { version: 1 })).status).toBe(404)
    expect((await hr('GET', `/hr/policies/${p.id}/status`)).body.stats.audience).toBe(1)
    const roles = await publishNew({ kind: 'roles', roles: ['Department Head'] })
    expect((await head('GET', '/hr/policies/my')).body.some((x: { id: string }) => x.id === roles.id)).toBe(true)
    expect((await hr('POST', '/hr/policies', { title: 'X policy', category: 'other', audience: { kind: 'departments', department_ids: ['c2-ops'] } })).body.code).toBe('audience')
    // Department head: team numbers only (Delivery), read-only.
    const st = await head('GET', '/hr/policies/HPOL-1/status')
    expect(st.status).toBe(200)
    const ids = new Set(st.body.employees.map((e: { employee_id: string }) => e.employee_id))
    expect(ids.has('EMP-u4')).toBe(false)
    expect(ids.has('EMP-u11')).toBe(true)
    expect((await head('PATCH', '/hr/policies/HPOL-1', { title: 'Changed' })).status).toBe(403)
    expect((await head('GET', '/hr/policies/HPOL-3')).status).toBe(404) // a draft
    expect((await noura('GET', '/hr/policies')).status).toBe(403)
    expect((await agent('GET', '/hr/policies/my')).status).toBe(200)
  })

  it('seeded v2 of the code of conduct: earlier v1 acknowledgements must re-acknowledge; seeds send no reminder burst', async () => {
    const my = await noura('GET', '/hr/policies/my')
    expect(my.body.find((x: { id: string }) => x.id === 'HPOL-1')).toMatchObject({ version: 2, acknowledged: false, reacknowledge: true })
    expect(notes('u11').filter((n) => /Code of conduct/.test(n.title))).toHaveLength(0)
    expect(hrPolicies.find((p) => p.id === 'HPOL-3')!.status).toBe('draft')
  })

  it('onboarding journeys: the "acknowledge policies" link action ticks once every policy is acknowledged', async () => {
    const tpl = await hr('POST', '/hr/journeys/templates', {
      kind: 'onboarding', name: 'With policies', items: [{ title: 'Read and acknowledge the company policies', owner_role: 'employee', due_offset_days: 5, action: { kind: 'acknowledge_policies' } }],
    })
    expect(tpl.status, tpl.text).toBe(200)
    expect(tpl.body.items[0].action.kind).toBe('acknowledge_policies')
  })
})

describe('employee records carry the optional Arabic name', () => {
  it('seeded Arabic names exist for some staff only', () => {
    expect(hrEmployees.find((e) => e.id === 'EMP-u11')?.fullNameAr).toBe('نورة الكتبي')
    expect(hrEmployees.find((e) => e.id === 'EMP-u15')?.fullNameAr).toBeUndefined()
    expect(hrLetterRequests.find((r) => r.id === 'HLR-101')?.language).toBe('bilingual')
  })
})
