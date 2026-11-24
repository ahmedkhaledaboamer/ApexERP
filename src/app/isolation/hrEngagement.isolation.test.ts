import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { activeMembershipOf, addMembership, companyById } from '@/shared/mocks/data/tenancy'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrEngResponses, hrEngSurveys, hrFbRounds } from '@/shared/mocks/data/hrEngagement'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * HR › Engagement surveys and 360° feedback for EVERY role of PERMISSION_MATRIX in BOTH companies (Crest via a
 * platform module override), through the real MSW handlers. Expectations come from the matrix `hr` column:
 *   answering      every role with an employee record (self-service, even `hr` hidden); own answers editable until
 *                  the survey closes, then 409
 *   surveys        full → manage + every result + export; team → the aggregated results of their departments only
 *                  (threshold 5, never individuals, never exit surveys, no export); own / hidden → 403
 *   anonymity      no result names or ids a respondent, for any role
 *   360°           every role reads its own feedback requests; another company's ids → 404
 * Without `hr` in the plan → 403 module_not_in_plan.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
const today = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)

function enableHr(co: Co) {
  if (!moduleOverrides.some((o) => o.companyId === co && o.module === 'hr' && o.enabled)) {
    moduleOverrides.push({ companyId: co, module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
  }
}

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const mgmt = users.find((u) => u.companyId === co && roleOf(u) === 'Management')!
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)!
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const at = new Date().toISOString()
      const user: User = {
        id: `u-eng-${co}-${slug}`, companyId: co, name: `ENG ${role} ${co}`, email: `eng-${slug}@${co}.test`, role, title: role,
        managerId: mgmt.id, mobile: '', departmentId: dept.id, active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: at,
      }
      users.push(user)
      addMembership(user.id, co, role)
      const emp: Tenant<Employee> = {
        companyId: co, id: `EMP-${user.id}`, userId: user.id, employeeNo: `ENG-${slug}`, fullName: user.name, jobTitle: role, departmentId: dept.id,
        managerId: `EMP-${mgmt.id}`, email: user.email, mobile: '', nationality: 'AE', gender: null, dateOfBirth: null, hireDate: '2024-01-01',
        employmentType: 'full_time', status: 'active', exitDate: null, createdAt: at, updatedAt: at,
      }
      hrEmployees.push(emp)
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
  enableHr('co_crest')
})

function userFor(co: Co, role: Role): User {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role && hrEmployees.some((e) => e.userId === x.id && e.status !== 'terminated'))
  if (!u) throw new Error(`No ${role} employee in ${co}`)
  return u
}

/** Departments a user heads (+ sub-departments): the independent re-statement of the team rule for results. */
function headed(u: User): Set<string> {
  const coDepts = departments.filter((d) => d.companyId === u.companyId)
  const out = new Set<string>()
  const queue = coDepts.filter((d) => d.active && d.headId === u.id).map((d) => d.id)
  while (queue.length) {
    const id = queue.shift()!
    if (out.has(id)) continue
    out.add(id)
    for (const c of coDepts) if (c.active && c.parentId === id) queue.push(c.id)
  }
  return out
}

const pulseAnswers = (score: number, why = '') => [
  { question_id: 'enps', value: score, choice_ids: [], text: '' },
  { question_id: 'enps-why', value: null, choice_ids: [], text: why },
]

describe('HR › Engagement: every role of the matrix, both companies', () => {
  it('the matrix uses only scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'hr'))
  })

  for (const co of COMPANIES) {
    const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: answers and edits own answers until close; results by scope; no identities`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(role, 'hr')
        const token = tokenFor(u)
        const me = `EMP-${u.id}`
        const hrUser = users.find((x) => x.companyId === co && x.active && x.id !== u.id && scopeOf(roleOf(x), 'hr') === 'full')!
        const hrToken = tokenFor(hrUser)

        // HR launches an anonymous pulse to everyone (spoofed company ignored).
        const created = await callApi(hrToken, 'POST', '/hr/engagement/surveys', { name: `Role pulse ${role}`, template_key: 'enps_pulse', opens_on: today(co), closes_on: addDaysIso(today(co), 7), company_id: them })
        expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(200)
        expect(hrEngSurveys.find((s) => s.id === created.body.id)?.companyId).toBe(co)
        const launched = await callApi(hrToken, 'POST', `/hr/engagement/surveys/${created.body.id}/launch`)
        expect(launched.status).toBe(200)
        const sid = launched.body.id as string

        // Self-service: every role with an employee record sees and answers it, and edits until close.
        const my = await callApi(token, 'GET', '/hr/engagement/my')
        expect(my.status, `${role} my`).toBe(200)
        expect(my.body.to_answer.map((r: { survey_id: string }) => r.survey_id)).toContain(sid)
        expect((await callApi(token, 'PUT', `/hr/engagement/my/${sid}`, { answers: pulseAnswers(9, 'Good'), language: 'en' })).status, `${role} answer`).toBe(200)
        const edited = await callApi(token, 'PUT', `/hr/engagement/my/${sid}`, { answers: pulseAnswers(4, 'Changed my mind'), language: 'ar', company_id: them })
        expect(edited.status).toBe(200)
        expect([edited.body.answers[0].value, edited.body.language, edited.body.editable]).toEqual([4, 'ar', true])
        const mine = hrEngResponses.filter((r) => r.surveyId === sid)
        expect(mine).toHaveLength(1)
        expect([mine[0].companyId, mine[0].respondentEmployeeId]).toEqual([co, null])

        // Four more colleagues answer: 5 responses in total.
        // (Not the HR user: their name is on the survey as its author.)
        const others = hrEmployees.filter((e) => e.companyId === co && e.id !== me && e.userId !== hrUser.id && hrEngSurveys.find((s) => s.id === sid)!.targetEmployeeIds.includes(e.id)).slice(0, 4)
        for (const e of others) expect((await callApi(tokenFor(users.find((x) => x.id === e.userId)!), 'PUT', `/hr/engagement/my/${sid}`, { answers: pulseAnswers(8), language: 'en' })).status).toBe(200)

        // Surveys and results by scope.
        const list = await callApi(token, 'GET', '/hr/engagement/surveys')
        const results = await callApi(token, 'GET', `/hr/engagement/surveys/${sid}/results`)
        const exp = await callApi(token, 'GET', `/hr/engagement/surveys/${sid}/export`)
        const heads = headed(u)
        if (scope === 'full') {
          expect([list.status, results.status, exp.status], role).toEqual([200, 200, 200])
          expect([results.body.scope, results.body.response_count, results.body.individual]).toEqual(['company', 5, null])
        } else if (scope === 'team' && heads.size) {
          expect([list.status, results.status, exp.status], role).toEqual([200, 200, 403])
          expect(list.body.every((s: { kind: string }) => s.kind !== 'exit' && s.kind !== 'onboarding')).toBe(true)
          const inMine = hrEngResponses.filter((r) => r.surveyId === sid && r.departmentId && heads.has(r.departmentId)).length
          expect([results.body.scope, results.body.response_count, results.body.suppressed, results.body.individual]).toEqual(['departments', inMine, inMine < 5, null])
          // Aggregates only: no breakdown of departments they don't head.
          expect(results.body.by_department.every((g: { key: string }) => heads.has(g.key))).toBe(true)
          expect((await callApi(token, 'GET', `/hr/engagement/surveys/${sid}/results?department_id=${departments.find((d) => d.companyId === co && !heads.has(d.id))!.id}`)).status).toBe(422)
        } else {
          expect([list.status, results.status, exp.status], role).toEqual([403, 403, 403])
          expect((await callApi(token, 'GET', '/hr/engagement/overview')).status).toBe(403)
        }
        // No identity in any engagement read, for this role.
        for (const res of [results, exp, my, await callApi(token, 'GET', `/hr/engagement/my/${sid}`)]) {
          const text = JSON.stringify(res.body)
          for (const e of [...others, hrEmployees.find((x) => x.id === me)!]) {
            if (res === my || res.body?.survey_id) continue // the caller's own reads name nobody else; checked below
            for (const needle of [e.id, `"${e.userId}"`, e.fullName]) expect(text, `${role}: ${needle}`).not.toContain(needle)
          }
        }
        expect(JSON.stringify((await callApi(token, 'GET', `/hr/engagement/my/${sid}`)).body)).not.toContain(me)

        // Writes are HR full only.
        expect((await callApi(token, 'POST', `/hr/engagement/surveys/${sid}/close`)).status).toBe(scope === 'full' ? 200 : 403)
        if (scope !== 'full') expect((await callApi(hrToken, 'POST', `/hr/engagement/surveys/${sid}/close`)).status).toBe(200)
        // Closed: answers are final.
        expect((await callApi(token, 'PUT', `/hr/engagement/my/${sid}`, { answers: pulseAnswers(10), language: 'en' })).status).toBe(409)

        // Another company's survey / round → 404.
        const foreign = hrEngSurveys.find((s) => s.companyId === them && s.status === 'open')!
        expect((await callApi(token, 'GET', `/hr/engagement/my/${foreign.id}`)).status).toBe(404)
        expect((await callApi(token, 'PUT', `/hr/engagement/my/${foreign.id}`, { answers: [], language: 'en' })).status).toBe(404)
        expect((await callApi(token, 'GET', `/hr/engagement/surveys/${foreign.id}/results`)).status).toBe(scope === 'full' || (scope === 'team' && heads.size) ? 404 : 403)
        const foreignRound = hrFbRounds.find((r) => r.companyId === them)!
        expect((await callApi(token, 'GET', `/hr/feedback/rounds/${foreignRound.id}`)).status).toBe(404)

        // 360°: everyone reads their own requests.
        const fb = await callApi(token, 'GET', '/hr/feedback/my')
        expect([fb.status, fb.body.employee_linked], role).toEqual([200, true])
      })
    }
  }

  it('the employee nominates, the manager (Sales Manager, hr hidden) approves, the colleague answers or declines', async () => {
    const round = hrFbRounds.find((r) => r.companyId === 'co_crest' && r.reviewId)!
    const subject = tokenFor(users.find((x) => x.id === 'u105')!)
    const manager = tokenFor(users.find((x) => x.id === 'u103')!)
    const nom = await callApi(subject, 'POST', `/hr/feedback/rounds/${round.id}/nominations`, { employee_ids: ['EMP-u102'] })
    expect(nom.status).toBe(200)
    expect(nom.body.nominations).toEqual([{ employee_id: 'EMP-u102', name: 'Noura Al Qahtani', status: 'awaiting' }])
    expect(nom.body.providers).toEqual([])
    // The employee can't approve their own nominations; the manager can.
    expect((await callApi(subject, 'POST', `/hr/feedback/rounds/${round.id}/nominations/decide`, { approve_ids: ['x'] })).status).toBe(403)
    const view = await callApi(manager, 'GET', `/hr/feedback/rounds/${round.id}`)
    const nominated = view.body.providers.find((p: { status: string }) => p.status === 'nominated')
    expect((await callApi(manager, 'POST', `/hr/feedback/rounds/${round.id}/nominations/decide`, { approve_ids: [nominated.id], reject_ids: [] })).status).toBe(200)
    const colleague = tokenFor(users.find((x) => x.id === 'u102')!)
    const inv = (await callApi(colleague, 'GET', '/hr/feedback/my')).body.invitations.find((i: { round_id: string }) => i.round_id === round.id)
    expect(inv.status).toBe('pending')
    expect((await callApi(colleague, 'POST', `/hr/feedback/invitations/${inv.id}/decline`, { reason: '' })).status).toBe(422)
    expect((await callApi(colleague, 'POST', `/hr/feedback/invitations/${inv.id}/decline`, { reason: 'Not enough contact this year' })).status).toBe(200)
    const after = await callApi(manager, 'GET', `/hr/feedback/rounds/${round.id}`)
    expect(after.body.providers.find((p: { id: string }) => p.id === inv.id).decline_reason).toBe('Not enough contact this year')
    // The subject never learns who declined.
    const mine = await callApi(subject, 'GET', '/hr/feedback/my')
    expect(JSON.stringify(mine.body)).not.toContain('Not enough contact')
    expect(mine.body.about_me[0].nominations[0].status).toBe('approved')
    // Someone else's invitation answers 404.
    expect((await callApi(subject, 'GET', `/hr/feedback/invitations/${inv.id}`)).status).toBe(404)
  })

  it('plan gate: without the hr module (Crest’s plan, no override) → 403 module_not_in_plan', async () => {
    moduleOverrides.splice(0, moduleOverrides.length, ...moduleOverrides.filter((o) => !(o.companyId === 'co_crest' && o.module === 'hr')))
    for (const path of ['/hr/engagement/my', '/hr/engagement/surveys', '/hr/feedback/my']) {
      const res = await callApi(tokenFor(userFor('co_crest', 'Employee')), 'GET', path)
      expect([res.status, res.body.code], path).toEqual([403, 'module_not_in_plan'])
    }
  })
})
