import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrDocuments, hrProfiles } from '@/shared/mocks/data/hrPeople'
import { hrLetterRequests, hrLetterTypes, hrProfileChanges } from '@/shared/mocks/data/hrSelfService'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * HR › Self-service ("My HR") and HR letters for EVERY role of PERMISSION_MATRIX in BOTH companies (Crest gets `hr`
 * through a platform module override), through the real MSW handlers. Expectations come from the matrix `hr` column:
 *   every role with an employee record: its own portal, its own letter requests and profile changes (self-service,
 *   like clock-in and leave, whatever the scope);
 *   full: the company's requests, decisions, templates, the inbox and verification;
 *   everyone else: nothing of other employees (404 like a missing id), no decisions / templates / inbox (403).
 * Another company's request → 404 for everyone; spoofed company fields are ignored; no full IBAN or document number in
 * any answer; without the plan module → 403 module_not_in_plan.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']

// The snapshot is taken once every mock store is registered (the handlers import them lazily), so restores apply.
let seed: ReturnType<typeof takeSnapshot>
beforeAll(async () => {
  await import('@/shared/mocks/handlers')
  seed = takeSnapshot(true)
})
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function enableHr(co: Co) {
  if (!moduleOverrides.some((o) => o.companyId === co && o.module === 'hr' && o.enabled)) {
    moduleOverrides.push({ companyId: co, module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
  }
}

/** A user (+ membership + employee record) for every role a company has no seeded active user for. */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const mgmt = users.find((u) => u.companyId === co && roleOf(u) === 'Management')!
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)!
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const at = new Date().toISOString()
      const user: User = {
        id: `u-hss-${co}-${slug}`, companyId: co, name: `HSS ${role} ${co}`, email: `hss-${slug}@${co}.test`, role, title: role,
        managerId: mgmt.id, mobile: '', departmentId: dept.id, active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: at,
      }
      users.push(user)
      addMembership(user.id, co, role)
      const emp: Tenant<Employee> = {
        companyId: co, id: `EMP-${user.id}`, userId: user.id, employeeNo: `HSS-${slug}`, fullName: user.name, jobTitle: role, departmentId: dept.id,
        managerId: `EMP-${mgmt.id}`, email: user.email, mobile: '', nationality: 'AE', gender: null, dateOfBirth: null, hireDate: '2024-01-01',
        employmentType: 'full_time', status: 'active', exitDate: null, createdAt: at, updatedAt: at,
      }
      hrEmployees.push(emp)
    }
  }
}

beforeEach(() => {
  expect(restoreSnapshot(seed)).toBe(true)
  ensureRoleUsers()
  enableHr('co_crest')
})

function userFor(co: Co, role: Role): User {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role && hrEmployees.some((e) => e.userId === x.id && e.status !== 'terminated'))
  if (!u) throw new Error(`No ${role} employee in ${co}`)
  return u
}

const typeId = (co: Co, code: string) => hrLetterTypes.find((t) => t.companyId === co && t.code === code)!.id

/** Every full IBAN and document number stored for the company (none may appear in an answer). */
function secretsOf(co: Co): string[] {
  return [
    ...hrProfiles.filter((p) => p.companyId === co && p.iban.length >= 15).map((p) => p.iban),
    ...hrDocuments.filter((d) => d.companyId === co && d.number.length >= 6).map((d) => d.number),
    ...hrProfileChanges.filter((c) => c.companyId === co).map((c) => c.proposed.bank?.iban ?? '').filter((v) => v.length >= 15),
  ]
}
function expectNoSecrets(co: Co, body: unknown, where: string) {
  const text = JSON.stringify(body)
  for (const s of secretsOf(co)) expect(text.includes(s), `${where}: full identifier ending ${s.slice(-4)}`).toBe(false)
}

// Generous timeout: each test makes many real handler calls, slow under the full parallel suite.
describe('HR › Self-service and letters: every role of the matrix, both companies', { timeout: 60_000 }, () => {
  it('the matrix uses only scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'hr'))
  })

  for (const co of COMPANIES) {
    const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: own portal, own requests, scope of others, foreign ids`, async () => {
        const u = userFor(co, role)
        const full = scopeOf(role, 'hr') === 'full'
        const token = tokenFor(u)
        const me = `EMP-${u.id}`

        // Own portal: the caller's own data only.
        const portal = await callApi(token, 'GET', '/hr/me')
        expect(portal.status, `${role} /hr/me ${JSON.stringify(portal.body).slice(0, 200)}`).toBe(200)
        expect(portal.body.employee.id).toBe(me)
        for (const list of ['documents', 'payslips', 'assets', 'letters', 'profile_changes'] as const) {
          for (const row of portal.body[list]) expect(row.employee_id ?? row.assigned_to_id, `${role} ${list}`).toBe(me)
        }
        if (portal.body.contract) {
          expect(portal.body.contract.employee_id).toBe(me)
          expect(portal.body.contract.salary_visible).toBe(true)
        }
        expectNoSecrets(co, portal.body, `${role} /hr/me`)

        // Self-service writes, with spoofed company fields ignored.
        const req = await callApi(token, 'POST', '/hr/letters/requests', { letter_type_id: typeId(co, 'noc'), noc_purpose: 'travel', purpose: 'Travel to Oman', addressee: 'Test Embassy', company_id: them, tenant_id: them })
        expect(req.status, `${role} request letter: ${JSON.stringify(req.body).slice(0, 200)}`).toBe(200)
        expect(hrLetterRequests.find((r) => r.id === req.body.id)?.companyId).toBe(co)
        const change = await callApi(token, 'POST', '/hr/profile-changes', { mobile: '+971 50 765 4321', company_id: them })
        expect([200, 409], `${role} profile change`).toContain(change.status)
        if (change.status === 200) expect(hrProfileChanges.find((c) => c.id === change.body.id)?.companyId).toBe(co)

        // Lists: full → the whole company; anyone else → only their own.
        const letters = await callApi(token, 'GET', '/hr/letters/requests')
        const changes = await callApi(token, 'GET', '/hr/profile-changes')
        const wantLetters = hrLetterRequests.filter((r) => r.companyId === co && (full || r.employeeId === me)).map((r) => r.id).sort()
        const wantChanges = hrProfileChanges.filter((c) => c.companyId === co && (full || c.employeeId === me)).map((c) => c.id).sort()
        expect(letters.body.map((r: { id: string }) => r.id).sort(), `${role} letters`).toEqual(wantLetters)
        expect(changes.body.map((r: { id: string }) => r.id).sort(), `${role} changes`).toEqual(wantChanges)
        expectNoSecrets(co, changes.body, `${role} /hr/profile-changes`)

        // Somebody else's request: HR full reads it; anyone else 404 (like a missing id) and can't act on it.
        let others = hrLetterRequests.find((r) => r.companyId === co && r.employeeId !== me && r.status === 'pending')
        if (!others) {
          // Filed by HR for another employee so every role has someone else's pending request to probe.
          const target = hrEmployees.find((e) => e.companyId === co && e.id !== me && e.status === 'active')!
          const made = await callApi(tokenFor(userFor(co, 'Company Admin')), 'POST', '/hr/letters/requests', { letter_type_id: typeId(co, 'noc'), employee_id: target.id, noc_purpose: 'visa', purpose: 'Visa' })
          others = hrLetterRequests.find((r) => r.id === made.body.id)!
        }
        const read = await callApi(token, 'GET', `/hr/letters/requests/${others.id}`)
        const missing = await callApi(token, 'GET', '/hr/letters/requests/HLR-0')
        if (full) expect(read.status).toBe(200)
        else expect([read.status, read.body]).toEqual([missing.status, missing.body])
        const approve = await callApi(token, 'POST', `/hr/letters/requests/${others.id}/approve`, {})
        if (full) expect([200, 422], `${role} approve ${JSON.stringify(approve.body).slice(0, 160)}`).toContain(approve.status)
        // Deciding is HR full only: 403 before any lookup, so it's the same answer for any id (no existence probe).
        else expect(approve.status, `${role} approve`).toBe(403)
        const ownApprove = await callApi(token, 'POST', `/hr/letters/requests/${req.body.id}/approve`, {})
        expect(ownApprove.status, `${role} approves own`).toBe(403)

        // HR-full only: inbox, templates, verification.
        const inbox = await callApi(token, 'GET', '/hr/self-service/inbox')
        const tpl = await callApi(token, 'PATCH', `/hr/letters/types/${typeId(co, 'noc')}`, { description: 'Edited' })
        const verify = await callApi(token, 'GET', '/hr/letters/verify?code=ABCD-EFGH-JKMN')
        if (full) expect([inbox.status, tpl.status, verify.status]).toEqual([200, 200, 200])
        else expect([inbox.status, tpl.status, verify.status], role).toEqual([403, 403, 403])
        const types = await callApi(token, 'GET', '/hr/letters/types')
        expect(types.status).toBe(200)
        if (!full) expect(types.body.every((t: { body: string }) => t.body === '')).toBe(true)

        // The other company: 404 for everyone.
        const foreign = hrLetterRequests.find((r) => r.companyId === them)!
        expect((await callApi(token, 'GET', `/hr/letters/requests/${foreign.id}`)).status).toBe(404)
        expect((await callApi(token, 'POST', `/hr/letters/requests/${foreign.id}/cancel`)).status).toBe(404)
        const foreignChange = hrProfileChanges.find((c) => c.companyId === them)!
        expect((await callApi(token, 'POST', `/hr/profile-changes/${foreignChange.id}/approve`, {})).status).toBe(full ? 404 : 403)
        expect((await callApi(token, 'POST', '/hr/letters/requests', { letter_type_id: typeId(them, 'employment_certificate') })).status).toBe(404)
      })
    }
  }

  it('a Sales Agent (hr hidden) sees only their own portal data', async () => {
    for (const co of COMPANIES) {
      const u = userFor(co, 'Sales Agent')
      const me = `EMP-${u.id}`
      const token = tokenFor(u)
      const portal = await callApi(token, 'GET', '/hr/me')
      expect(portal.status).toBe(200)
      expect(portal.body.hr_scope).toBe('hidden')
      const text = JSON.stringify(portal.body)
      for (const e of hrEmployees.filter((x) => x.companyId === co && x.id !== me && x.id !== `EMP-${u.managerId}`)) expect(text.includes(`"${e.id}"`), `${co}: ${e.id} in a Sales Agent's portal`).toBe(false)
      expect(portal.body.interviews).toEqual([])
      // Other HR screens stay closed for the hidden scope.
      expect((await callApi(token, 'GET', '/hr/employees')).status).toBe(403)
      // Their own payslip prints through the portal; someone else's is 404.
      const otherSlip = (await callApi(tokenFor(userFor(co, 'Company Admin')), 'GET', '/hr/payroll/payslips')).body.find((p: { employee_id: string }) => p.employee_id !== me)
      if (otherSlip) expect((await callApi(token, 'GET', `/hr/me/payslips/${otherSlip.id}`)).status).toBe(404)
      for (const p of portal.body.payslips) expect((await callApi(token, 'GET', `/hr/me/payslips/${p.id}`)).status).toBe(200)
    }
  })

  it('a Department Head can’t read a report’s letter (even a salary one), nor the list entry', async () => {
    for (const [co, headId, reportEmp] of [['co_apex', 'u10', 'EMP-u14'], ['co_crest', 'u106', 'EMP-u107']] as const) {
      const report = hrEmployees.find((e) => e.id === reportEmp)!
      expect(report.managerId).toBe(`EMP-${headId}`)
      const hr = tokenFor(userFor(co, 'Company Admin'))
      // The seeded pending request of the report (a salary letter for Apex); filed by HR if the seed has none, so the test
      // never depends on what other tests did.
      let letter = hrLetterRequests.find((r) => r.companyId === co && r.employeeId === reportEmp && r.status === 'pending')
      if (!letter) {
        const made = await callApi(hr, 'POST', '/hr/letters/requests', { letter_type_id: typeId(co, 'employment_certificate'), employee_id: reportEmp })
        letter = hrLetterRequests.find((r) => r.id === made.body.id)!
      }
      const issued = await callApi(hr, 'POST', `/hr/letters/requests/${letter.id}/approve`, {})
      expect(issued.status, `${co} ${letter.id} ${letter.status} ${JSON.stringify(issued.body).slice(0, 200)}`).toBe(200)
      const head = tokenFor(users.find((u) => u.id === headId)!)
      const res = await callApi(head, 'GET', `/hr/letters/requests/${letter.id}`)
      expect(res.status).toBe(404)
      expect(JSON.stringify(res.body)).not.toContain(issued.body.letter.reference_no)
      const list = await callApi(head, 'GET', '/hr/letters/requests')
      expect(list.body.some((r: { id: string }) => r.id === letter.id)).toBe(false)
      expect((await callApi(head, 'GET', `/hr/letters/requests?employee_id=${reportEmp}`)).body).toEqual([])
      // The employee reads it.
      const own = await callApi(tokenFor(users.find((u) => u.id === report.userId)!), 'GET', `/hr/letters/requests/${letter.id}`)
      expect(own.body.letter.reference_no).toBe(issued.body.letter.reference_no)
    }
  })

  it('a user without an employee record gets 403 no_employee_record on the portal and self-service writes', async () => {
    const u = userFor('co_apex', 'Sales Agent')
    hrEmployees.splice(hrEmployees.findIndex((e) => e.userId === u.id), 1)
    for (const [method, path, body] of [['GET', '/hr/me', undefined], ['POST', '/hr/profile-changes', { mobile: '+971 50 000 1111' }], ['POST', '/hr/letters/requests', { letter_type_id: typeId('co_apex', 'noc') }]] as const) {
      const res = await callApi(tokenFor(u), method, path, body)
      expect([res.status, res.body.code], path).toEqual([403, 'no_employee_record'])
    }
  })

  it('plan gate: without the hr module (Crest’s plan, no override) → 403 module_not_in_plan', async () => {
    moduleOverrides.splice(0, moduleOverrides.length, ...moduleOverrides.filter((o) => !(o.companyId === 'co_crest' && o.module === 'hr')))
    for (const path of ['/hr/me', '/hr/letters/requests', '/hr/profile-changes', '/hr/letters/types']) {
      const res = await callApi(tokenFor(userFor('co_crest', 'Employee')), 'GET', path)
      expect([res.status, res.body.code], path).toEqual([403, 'module_not_in_plan'])
    }
  })
})
