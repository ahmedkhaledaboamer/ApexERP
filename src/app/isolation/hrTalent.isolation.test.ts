import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { employeeForUser, employeesOf } from '@/shared/mocks/data/hrEmployees'
import { hrCandidates, hrCertificates, hrCourses, hrInterviews, hrOpenings, hrSessions } from '@/shared/mocks/data/hrTalent'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { teamEmployeeIds, headedDepartmentIds } from '@/shared/mocks/services/hrTalentAccess'
import { callApi } from './helpers'

/**
 * HR › Recruitment and Training per role, TABLE-DRIVEN FROM PERMISSION_MATRIX (`hr` column), for every
 * role in both companies (Crest gets HR through a platform module override), through the real handlers:
 *   hidden → 403 on every endpoint
 *   full   → every opening, candidate, certificate, the whole matrix, the budget; writes allowed
 *   team   → openings of the departments they head (or hire for), their candidates, their team's training;
 *            no budget, no candidate / course writes
 *   own    → no openings / candidates (403); their own training only; interview cards they were invited to
 * and another company's ids answer 404 for every role that can see HR.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-hrt-${co}-${slug}`,
        companyId: co,
        name: `Talent ${role} ${co}`,
        email: `hrt-${slug}@${co}.test`,
        role,
        title: role,
        managerId: null,
        mobile: '',
        departmentId: dept?.id ?? '',
        active: true,
        twoFactorEnabled: false,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
  moduleOverrides.push({ companyId: 'co_crest', module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
})

const userFor = (co: Co, role: Role) => {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role)
  if (!u) throw new Error(`No ${role} in ${co}`)
  return u
}
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
const firstId = <T extends { companyId: string; id: string }>(rows: readonly T[], co: Co, pred: (r: T) => boolean = () => true) => rows.find((r) => r.companyId === co && pred(r))!.id
const ids = (b: unknown) => (Array.isArray(b) ? b.map((x: { id?: string; employee_id?: string }) => x.id ?? x.employee_id) : [])
const R = '/hr/recruitment'
const T = '/hr/training'

describe('HR recruitment & training per role, derived from PERMISSION_MATRIX (both companies)', () => {
  it('the matrix only uses hr scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'hr'))
  })

  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role} (hr=${PERMISSION_MATRIX[role].hr})`, async () => {
        const u = userFor(co, role)
        const token = tokenFor(u)
        const scope = scopeOf(role, 'hr')
        const where = `${u.id} (${role}, hr=${scope})`
        const get = (path: string) => callApi(token, 'GET', path)
        const opening = firstId(hrOpenings, co, (o) => o.status === 'open')
        const course = firstId(hrCourses, co)
        const session = firstId(hrSessions, co, (s) => s.status === 'scheduled')
        const everyGet = [`${R}/options`, `${R}/openings`, `${R}/candidates`, `${R}/my-interviews`, `${T}/options`, `${T}/courses`, `${T}/certificates`, `${T}/matrix`, `${T}/my`, `${T}/budget`, `${R}/openings/${opening}`, `${T}/courses/${course}`]

        if (scope === 'hidden') {
          for (const p of everyGet) expect((await get(p)).status, `${where} GET ${p}`).toBe(403)
          const writes: [string, string, unknown][] = [
            ['POST', `${R}/openings`, { title: 'x', department_id: departments.find((d) => d.companyId === co)!.id }],
            ['POST', `${R}/candidates`, { full_name: 'x', email: 'x@y.test' }],
            ['POST', `${T}/courses`, { title: 'x' }],
            ['POST', `${T}/sessions/${session}/enrollments`, { employee_ids: [employeesOf(co)[0].id] }],
          ]
          for (const [m, p, b] of writes) expect((await callApi(token, m, p, b)).status, `${where} ${m} ${p}`).toBe(403)
          return
        }

        // Catalogue and own pages: every HR role.
        for (const p of [`${R}/options`, `${R}/my-interviews`, `${T}/options`, `${T}/courses`, `${T}/my`, `${T}/courses/${course}`]) {
          expect((await get(p)).status, `${where} GET ${p}`).toBe(200)
        }
        const visibleEmp = scope === 'full' ? new Set(employeesOf(co).map((e) => e.id)) : scope === 'team' ? teamEmployeeIds(u) : new Set([employeeForUser(co, u.id)?.id].filter(Boolean) as string[])
        const certs = await get(`${T}/certificates`)
        expect(certs.status, where).toBe(200)
        expect(certs.body.every((c: { employee_id: string }) => visibleEmp.has(c.employee_id)), `${where} certificates in scope`).toBe(true)
        expect(certs.body.length, where).toBe(hrCertificates.filter((c) => c.companyId === co && visibleEmp.has(c.employeeId)).length)
        const matrix = await get(`${T}/matrix`)
        expect(ids(matrix.body.rows).every((id) => visibleEmp.has(id!)), `${where} matrix rows in scope`).toBe(true)
        expect((await get(`${T}/budget`)).status, `${where} budget`).toBe(scope === 'full' ? 200 : 403)
        expect((await callApi(token, 'POST', `${T}/courses`, { title: 'Probe course' })).status, `${where} create course`).toBe(scope === 'full' ? 200 : 403)

        const openings = await get(`${R}/openings`)
        const candidates = await get(`${R}/candidates`)
        if (scope === 'own') {
          expect(openings.status, where).toBe(403)
          expect(candidates.status, where).toBe(403)
          expect((await get(`${R}/openings/${opening}`)).status, where).toBe(404)
        } else {
          expect(openings.status, where).toBe(200)
          const headed = new Set(headedDepartmentIds(u))
          const expected = hrOpenings.filter((o) => o.companyId === co && (scope === 'full' || o.hiringManagerId === u.id || o.requestedBy === u.id || headed.has(o.departmentId))).map((o) => o.id).sort()
          expect(ids(openings.body).sort(), `${where} openings`).toEqual(expected)
          expect(candidates.status, where).toBe(200)
          if (scope === 'full') expect(candidates.body.length, where).toBe(hrCandidates.filter((c) => c.companyId === co).length)
          const salaryShown = openings.body.filter((o: { salary_visible: boolean }) => o.salary_visible).map((o: { id: string }) => o.id)
          expect(salaryShown.sort(), `${where} salary visible`).toEqual(hrOpenings.filter((o) => expected.includes(o.id) && (scope === 'full' || o.hiringManagerId === u.id)).map((o) => o.id).sort())
          expect((await callApi(token, 'POST', `${R}/candidates`, { full_name: 'Probe', email: `probe-${u.id}@cand.test` })).status, `${where} add candidate`).toBe(scope === 'full' ? 200 : 403)
        }

        // Interview cards: exactly the interviews the user sits on.
        const cards = await get(`${R}/my-interviews`)
        expect(ids(cards.body).sort(), `${where} my interviews`).toEqual(hrInterviews.filter((i) => i.companyId === co && i.interviewerIds.includes(u.id)).map((i) => i.id).sort())

        // Another company's ids: 404, like missing ones.
        const them = other(co)
        for (const p of [`${R}/openings/${firstId(hrOpenings, them)}`, `${T}/courses/${firstId(hrCourses, them)}`, `${R}/candidates/${firstId(hrCandidates, them)}`]) {
          expect((await get(p)).status, `${where} foreign ${p}`).toBe(404)
        }
      })
    }
  }

  it('an Employee invited as interviewer scores that interview, and sees nothing else of the candidate', async () => {
    const u11 = users.find((u) => u.id === 'u11')!
    const token = tokenFor(u11)
    const res = await callApi(token, 'PUT', `${R}/interviews/INT-102/scorecard`, { scores: ['Skills', 'Experience', 'Communication', 'Culture fit'].map((criterion) => ({ criterion, score: 4 })), recommendation: 'yes' })
    expect(res.status).toBe(200)
    expect(res.body.scorecards.map((s: { interviewer_id: string }) => s.interviewer_id)).toEqual(['u11'])
    expect((await callApi(token, 'GET', `${R}/candidates/CAN-104`)).status).toBe(404)
    expect((await callApi(token, 'PATCH', `${R}/interviews/INT-102`, { location: 'x' })).status).toBe(403)
  })
})
