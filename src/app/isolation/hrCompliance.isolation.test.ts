import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrProfiles } from '@/shared/mocks/data/hrPeople'
import { hrLetterTypes } from '@/shared/mocks/data/hrSelfService'
import { hrDisciplinary, hrPolicies } from '@/shared/mocks/data/hrCompliance'
import { hrCtx, teamEmployeeIds } from '@/shared/mocks/services/hrTimeAccess'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * HR gaps part A (Discipline, Policies, letter revocation, public letter verification) for EVERY role of
 * PERMISSION_MATRIX in BOTH companies (Crest gets `hr` through a platform module override), through the real MSW
 * handlers. Expectations come from the matrix `hr` column:
 *   full: every disciplinary record and policy of the company, the only writers;
 *   team (Department Head): the records of their team, the policy dashboards for their team, read-only;
 *   everyone with an employee record (own / hidden scopes too): their OWN records (acknowledge / appeal) and the
 *   policies addressed to them (acknowledge).
 * Another company's ids → 404; spoofed company fields are ignored; the public verification looks a code up in the
 * address's company only; without the plan module → 403 module_not_in_plan.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']
const WORKSPACE: Record<Co, string> = { co_apex: 'apexaora', co_crest: 'crest' }

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
        id: `u-hco-${co}-${slug}`, companyId: co, name: `HCO ${role} ${co}`, email: `hco-${slug}@${co}.test`, role, title: role,
        managerId: mgmt.id, mobile: '', departmentId: dept.id, active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: at,
      }
      users.push(user)
      addMembership(user.id, co, role)
      const emp: Tenant<Employee> = {
        companyId: co, id: `EMP-${user.id}`, userId: user.id, employeeNo: `HCO-${slug}`, fullName: user.name, jobTitle: role, departmentId: dept.id,
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
const today = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

/** Every full IBAN stored for the company (none may appear in an answer). */
const ibansOf = (co: Co) => hrProfiles.filter((p) => p.companyId === co && p.iban.length >= 15).map((p) => p.iban)

describe('HR › Discipline and Policies: every role of the matrix, both companies', { timeout: 60_000 }, () => {
  it('the matrix uses only scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'hr'))
  })

  for (const co of COMPANIES) {
    const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: own records and acknowledgement, scope of others, policies, foreign ids`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(role, 'hr')
        const full = scope === 'full'
        const token = tokenFor(u)
        const me = `EMP-${u.id}`

        // A written warning for the caller, issued by another HR-full user (nobody issues their own).
        const issuer = users.find((x) => x.companyId === co && x.active && x.id !== u.id && scopeOf(roleOf(x), 'hr') === 'full' && hrEmployees.some((e) => e.userId === x.id))!
        const issued = await callApi(tokenFor(issuer), 'POST', '/hr/discipline', { employee_id: me, type: 'written_warning', category: 'conduct', incident_date: today(), description: 'Role test record.', company_id: them, tenant_id: them })
        expect(issued.status, `${role} issued ${JSON.stringify(issued.body).slice(0, 200)}`).toBe(200)
        expect(hrDisciplinary.find((r) => r.id === issued.body.id)?.companyId).toBe(co)

        // List: full → the company; team → their team; anyone else → their own only.
        const list = await callApi(token, 'GET', '/hr/discipline')
        expect(list.status, `${role} list`).toBe(200)
        const ids = list.body.map((r: { id: string }) => r.id).sort()
        const team = scope === 'team' ? teamEmployeeIds(hrCtx(u)) : null
        const want = hrDisciplinary.filter((r) => r.companyId === co && (full || (team ? team.has(r.employeeId) : r.employeeId === me))).map((r) => r.id).sort()
        expect(ids, `${role} discipline list`).toEqual(want)
        expect((await callApi(token, 'GET', '/hr/discipline?mine=1')).body.every((r: { employee_id: string }) => r.employee_id === me)).toBe(true)

        // Own record: read and acknowledge (self-service, whatever the scope).
        const own = await callApi(token, 'GET', `/hr/discipline/${issued.body.id}`)
        expect([own.status, own.body.can_acknowledge]).toEqual([200, true])
        const ack = await callApi(token, 'POST', `/hr/discipline/${issued.body.id}/acknowledge`, { comment: 'Seen', company_id: them })
        expect([ack.status, ack.body.ack_status], role).toEqual([200, 'acknowledged'])

        // Somebody else's record outside the caller's scope: 404 like a missing id; writes are HR-full only.
        const outsider = hrDisciplinary.find((r) => r.companyId === co && r.employeeId !== me && !(team?.has(r.employeeId)))
        if (outsider) {
          const read = await callApi(token, 'GET', `/hr/discipline/${outsider.id}`)
          const missing = await callApi(token, 'GET', '/hr/discipline/HDA-0')
          if (full) expect(read.status).toBe(200)
          else expect([read.status, read.body]).toEqual([missing.status, missing.body])
        }
        const create = await callApi(token, 'POST', '/hr/discipline', { employee_id: hrEmployees.find((e) => e.companyId === co && e.id !== me && e.status === 'active')!.id, type: 'verbal_warning', category: 'other', incident_date: today(), description: 'Role test create.' })
        expect(create.status, `${role} create`).toBe(full ? 200 : 403)
        const withdraw = await callApi(token, 'POST', `/hr/discipline/${issued.body.id}/withdraw`, { reason: 'x' })
        expect(withdraw.status, `${role} withdraw`).toBe(full ? 200 : 403)

        // Policies: the screens for full / team; own policies + acknowledging for everyone with an employee record.
        const pol = await callApi(token, 'GET', '/hr/policies')
        expect(pol.status, `${role} /hr/policies`).toBe(full || scope === 'team' ? 200 : 403)
        if (pol.status === 200) {
          const wantP = hrPolicies.filter((p) => p.companyId === co && (full || p.status === 'published')).map((p) => p.id).sort()
          expect(pol.body.map((p: { id: string }) => p.id).sort()).toEqual(wantP)
        }
        const my = await callApi(token, 'GET', '/hr/policies/my')
        expect(my.status).toBe(200)
        const conduct = hrPolicies.find((p) => p.companyId === co && p.status === 'published' && p.audience.kind === 'all')!
        expect(my.body.map((p: { id: string }) => p.id)).toContain(conduct.id)
        const pAck = await callApi(token, 'POST', `/hr/policies/${conduct.id}/acknowledge`, { version: conduct.version, company_id: them })
        expect([pAck.status, pAck.body.acknowledged]).toEqual([200, true])
        const patch = await callApi(token, 'PATCH', `/hr/policies/${conduct.id}`, { title: 'Renamed by a role test' })
        expect(patch.status, `${role} patch policy`).toBe(full ? 200 : 403)
        const status = await callApi(token, 'GET', `/hr/policies/${conduct.id}/status`)
        expect(status.status).toBe(full || scope === 'team' ? 200 : 403)
        if (scope === 'team') for (const e of status.body.employees) expect(team!.has(e.employee_id), `${role} sees ${e.employee_id}`).toBe(true)

        // No full IBAN anywhere.
        for (const body of [list.body, own.body, my.body, pol.body]) for (const iban of ibansOf(co)) expect(JSON.stringify(body).includes(iban)).toBe(false)

        // The other company: 404 for everyone.
        const foreign = hrDisciplinary.find((r) => r.companyId === them)!
        expect((await callApi(token, 'GET', `/hr/discipline/${foreign.id}`)).status).toBe(404)
        expect((await callApi(token, 'POST', `/hr/discipline/${foreign.id}/acknowledge`, {})).status).toBe(404)
        const foreignPolicy = hrPolicies.find((p) => p.companyId === them && p.status === 'published')!
        expect((await callApi(token, 'POST', `/hr/policies/${foreignPolicy.id}/acknowledge`, { version: foreignPolicy.version })).status).toBe(404)
        expect((await callApi(token, 'GET', `/hr/policies/${foreignPolicy.id}`)).status).toBe(full || scope === 'team' ? 404 : 403)
      })
    }
  }

  it('an Employee sees only their own warnings; the Department Head their team’s, without the deduction amount', async () => {
    for (const [co, headId, reportEmp] of [['co_apex', 'u10', 'EMP-u14'], ['co_crest', 'u106', 'EMP-u107']] as const) {
      const hr = tokenFor(userFor(co, 'Company Admin'))
      const d = await callApi(hr, 'POST', '/hr/discipline', { employee_id: reportEmp, type: 'deduction', category: 'attendance', incident_date: today(), description: 'Deduction role test.', deduction_amount: 150 })
      expect(d.status, JSON.stringify(d.body)).toBe(200)
      const head = tokenFor(users.find((u) => u.id === headId)!)
      const viaHead = await callApi(head, 'GET', `/hr/discipline/${d.body.id}`)
      expect([viaHead.status, viaHead.body.deduction_amount]).toEqual([200, null])
      const report = users.find((u) => `EMP-${u.id}` === reportEmp)!
      const own = await callApi(tokenFor(report), 'GET', `/hr/discipline/${d.body.id}`)
      expect(own.body.deduction_amount).toBe(150)
      // Another employee of the same team doesn't see it.
      const peer = hrEmployees.find((e) => e.companyId === co && e.id !== reportEmp && !!e.userId && e.userId !== headId && scopeOf(roleOf(users.find((u) => u.id === e.userId)!), 'hr') !== 'full')!
      expect((await callApi(tokenFor(users.find((u) => u.id === peer.userId)!), 'GET', `/hr/discipline/${d.body.id}`)).status).toBe(404)
      const peerList = await callApi(tokenFor(users.find((u) => u.id === peer.userId)!), 'GET', '/hr/discipline')
      expect(peerList.body.every((r: { employee_id: string }) => r.employee_id === peer.id)).toBe(true)
    }
  })

  it('public verification: a code resolves only on its own company’s address; revoked shows as revoked; no pay or personal data', async () => {
    const codes: Record<Co, { id: string; code: string; ref: string }> = {} as never
    for (const co of COMPANIES) {
      const emp = hrEmployees.find((e) => e.companyId === co && !!e.userId && e.userId !== userFor(co, 'Company Admin').id && e.status === 'active')!
      const type = hrLetterTypes.find((t) => t.companyId === co && t.code === 'employment_certificate')!
      const req = await callApi(tokenFor(users.find((u) => u.id === emp.userId)!), 'POST', '/hr/letters/requests', { letter_type_id: type.id })
      const ok = await callApi(tokenFor(userFor(co, 'Company Admin')), 'POST', `/hr/letters/requests/${req.body.id}/approve`, {})
      expect(ok.status, JSON.stringify(ok.body).slice(0, 200)).toBe(200)
      codes[co] = { id: req.body.id, code: ok.body.letter.verification_code, ref: ok.body.letter.reference_no }
    }
    for (const co of COMPANIES) {
      const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
      const own = await callApi(null, 'GET', `/public/letters/verify?code=${codes[co].code}&workspace=${WORKSPACE[co]}`)
      expect([own.status, own.body.status, own.body.reference_no]).toEqual([200, 'valid', codes[co].ref])
      for (const iban of ibansOf(co)) expect(JSON.stringify(own.body).includes(iban)).toBe(false)
      const cross = await callApi(null, 'GET', `/public/letters/verify?code=${codes[co].code}&workspace=${WORKSPACE[them]}`)
      const unknown = await callApi(null, 'GET', `/public/letters/verify?code=ABCD-EFGH-JKMN&workspace=${WORKSPACE[them]}`)
      expect([cross.status, cross.body]).toEqual([unknown.status, unknown.body])
      expect(cross.status).toBe(404)
      expect(JSON.stringify(cross.body)).not.toContain(codes[co].ref)
      // Revoking is HR full of the letter's company only; the other company's admin gets 404.
      expect((await callApi(tokenFor(userFor(them, 'Company Admin')), 'POST', `/hr/letters/requests/${codes[co].id}/revoke`, { reason: 'x' })).status).toBe(404)
      expect((await callApi(tokenFor(userFor(co, 'Employee')), 'POST', `/hr/letters/requests/${codes[co].id}/revoke`, { reason: 'x' })).status).toBe(403)
      expect((await callApi(tokenFor(userFor(co, 'Company Admin')), 'POST', `/hr/letters/requests/${codes[co].id}/revoke`, { reason: 'Wrong addressee' })).status).toBe(200)
      expect((await callApi(null, 'GET', `/public/letters/verify?code=${codes[co].code}&workspace=${WORKSPACE[co]}`)).body.status).toBe('revoked')
    }
  })

  it('plan gate: without the hr module (Crest’s plan, no override) → 403 module_not_in_plan; the public page answers 404', async () => {
    const crestCode = await (async () => {
      const emp = hrEmployees.find((e) => e.companyId === 'co_crest' && e.userId === 'u107')!
      const type = hrLetterTypes.find((t) => t.companyId === 'co_crest' && t.code === 'noc')!
      const req = await callApi(tokenFor(users.find((u) => u.id === emp.userId)!), 'POST', '/hr/letters/requests', { letter_type_id: type.id, noc_purpose: 'travel', purpose: 'Travel to Bahrain' })
      const ok = await callApi(tokenFor(userFor('co_crest', 'Company Admin')), 'POST', `/hr/letters/requests/${req.body.id}/approve`, {})
      return ok.body.letter.verification_code as string
    })()
    moduleOverrides.splice(0, moduleOverrides.length, ...moduleOverrides.filter((o) => !(o.companyId === 'co_crest' && o.module === 'hr')))
    for (const path of ['/hr/discipline', '/hr/policies', '/hr/policies/my', '/hr/discipline/HDA-101']) {
      const res = await callApi(tokenFor(userFor('co_crest', 'Employee')), 'GET', path)
      expect([res.status, res.body.code], path).toEqual([403, 'module_not_in_plan'])
    }
    expect((await callApi(null, 'GET', `/public/letters/verify?code=${crestCode}&workspace=crest`)).status).toBe(404)
  })
})
