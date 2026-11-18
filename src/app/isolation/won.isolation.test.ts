import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { contacts, customers, leads, users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { services } from '@/shared/mocks/data/services'
import { projects, tasks } from '@/shared/mocks/data/tasks'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { hasRealContact } from '@/shared/mocks/services/won'
import { callApi } from './helpers'

/**
 * The Won flow (POST /leads/:id/won/preview and POST /leads/:id/won) for EVERY role of
 * PERMISSION_MATRIX in BOTH companies, through the real MSW handlers. Expectations are derived from
 * the matrix at run time (sales column):
 *  - hidden → 403 on every lead;
 *  - own / team / full / view → a lead outside the scope is 403; a lead inside it is 200 for the
 *    preview and the submit when the scope can edit (full / team / own), else 403 (view is read-only,
 *    and the preview of a write action needs the same right);
 *  - team = me + my direct reports + members of the departments I head (and their sub-departments).
 * Another company's lead is 404 for everyone, and a spoofed companyId (body, query, headers) is ignored.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'view', 'hidden']
const writable = (s: Scope) => s === 'full' || s === 'team' || s === 'own'

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

/** Adds an active user + membership for a role a company has no seeded user for. */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const mgmt = users.find((u) => u.companyId === co && roleOf(u) === 'Management')
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-won-${co}-${slug}`,
        companyId: co,
        name: `Won ${role} ${co}`,
        email: `won-${slug}@${co}.test`,
        role,
        title: role,
        managerId: mgmt?.id ?? null,
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
})

function userFor(co: Co, role: Role): User {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role)
  if (!u) throw new Error(`No ${role} in ${co}`)
  return u
}

/** "My team" straight from the seed (same definition as permissions.isolation.test.ts). */
function teamOf(u: User): Set<string> {
  const coUsers = users.filter((x) => x.companyId === u.companyId)
  const coDepts = departments.filter((d) => d.companyId === u.companyId)
  const deptIds = new Set<string>()
  const queue = coDepts.filter((d) => d.active && d.headId === u.id).map((d) => d.id)
  while (queue.length) {
    const id = queue.shift()!
    if (deptIds.has(id)) continue
    deptIds.add(id)
    for (const child of coDepts) if (child.active && child.parentId === id) queue.push(child.id)
  }
  return new Set([u.id, ...coUsers.filter((x) => x.managerId === u.id || (x.departmentId && deptIds.has(x.departmentId))).map((x) => x.id)])
}

function inScope(u: User, scope: Scope, ownerId: string): boolean {
  if (!HANDLED.includes(scope)) throw new Error(`PERMISSION_MATRIX uses sales scope "${scope}"; won.isolation has no expectation for it`)
  if (scope === 'hidden') return false
  if (scope === 'own') return ownerId === u.id
  if (scope === 'team') return teamOf(u).has(ownerId)
  return true
}

const CLOSED = ['Won', 'Lost', 'Not interested', 'Cold']
const winnable = (co: string) => leads.filter((l) => l.companyId === co && !CLOSED.includes(l.status) && !l.customerId && hasRealContact(l))

/**
 * A winnable lead inside the user's sales scope. Own / team scopes with no such lead get one assigned
 * to themselves (seed-only change, undone by the next test's restore), so every role is exercised.
 */
function leadInScope(u: User, scope: Scope) {
  const list = winnable(u.companyId)
  const hit = list.find((l) => inScope(u, scope, l.ownerId))
  if (hit || scope === 'hidden') return hit ?? list[0]
  const lead = list[0]
  lead.ownerId = u.id
  return lead
}

const serviceOf = (co: string) => services.find((s) => s.companyId === co && s.active)!
let seq = 0
/** A Won body in the API's snake_case. */
const body = (co: string, pm: string, extra: Record<string, unknown> = {}) => ({
  service_ids: [serviceOf(co).id],
  project_manager_id: pm,
  start_date: '2026-12-07',
  idempotency_key: `won-iso-${++seq}`,
  ...extra,
})

describe('Won flow per role, derived from PERMISSION_MATRIX (both companies)', () => {
  it('the matrix only uses sales scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'sales'))
  })

  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(role, 'sales')
        const token = tokenFor(u)
        const where = `${u.id} (${role}, sales=${scope})`
        const lead = leadInScope(u, scope)
        const pm = u.id

        // Preview: inside the scope with sales edit 200; view (read-only) and hidden 403.
        const preview = await callApi(token, 'POST', `/leads/${lead.id}/won/preview`, { service_ids: [serviceOf(co).id] })
        const previewOk = scope !== 'hidden' && inScope(u, scope, lead.ownerId) && can(role, 'sales', 'edit')
        // The preview is a read of a write action: it needs the same right as the submit.
        expect(preview.status, `${where}: preview own-scope lead ${JSON.stringify(preview.body)}`).toBe(previewOk ? 200 : 403)

        // Out of scope (same company): 403 for preview and submit.
        const outside = leads.find((l) => l.companyId === co && !inScope(u, scope, l.ownerId))
        if (outside && scope !== 'hidden') {
          expect((await callApi(token, 'POST', `/leads/${outside.id}/won/preview`, {})).status, `${where}: preview out of scope`).toBe(403)
          expect((await callApi(token, 'POST', `/leads/${outside.id}/won`, body(co, pm))).status, `${where}: win out of scope`).toBe(403)
        }

        // Another company's lead: 404 for everyone, like a missing one.
        const foreign = winnable(co === 'co_apex' ? 'co_crest' : 'co_apex')[0]
        const foreignPreview = await callApi(token, 'POST', `/leads/${foreign.id}/won/preview`, {})
        const missingPreview = await callApi(token, 'POST', `/leads/L-missing/won/preview`, {})
        expect(foreignPreview, `${where}: foreign preview`).toEqual(missingPreview)
        expect(foreignPreview.status).toBe(404)
        const foreignWin = await callApi(token, 'POST', `/leads/${foreign.id}/won`, body(co, pm))
        expect(foreignWin.status, `${where}: foreign win`).toBe(404)
        expect(foreignWin.body.message).toBe((await callApi(token, 'POST', `/leads/L-missing/won`, body(co, pm))).body.message)

        // Submit on the in-scope lead.
        const win = await callApi(token, 'POST', `/leads/${lead.id}/won`, body(co, pm))
        const canWin = scope !== 'hidden' && writable(scope) && inScope(u, scope, lead.ownerId)
        expect(win.status, `${where}: win own-scope lead ${JSON.stringify(win.body)}`).toBe(canWin ? 200 : 403)
        if (canWin) {
          const customer = customers.find((c) => c.id === win.body.customer_id)!
          expect(customer.companyId).toBe(co)
          expect(projects.filter((p) => win.body.project_ids.includes(p.id)).every((p) => p.companyId === co)).toBe(true)
          expect(tasks.filter((t) => win.body.task_ids.includes(t.id)).every((t) => t.companyId === co)).toBe(true)
        } else {
          expect(leads.find((l) => l.id === lead.id)?.customerId ?? null).toBeNull()
        }
      })
    }
  }
})

describe('Won flow: spoofed company and error bodies over HTTP', () => {
  for (const co of COMPANIES) {
    const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
    it(`${co}: a companyId / tenant in body, query and headers is ignored`, async () => {
      const admin = userFor(co, 'Company Admin')
      const lead = winnable(co)[0]
      const theirs = JSON.stringify({
        leads: leads.filter((l) => l.companyId === them),
        customers: customers.filter((c) => c.companyId === them),
        projects: projects.filter((p) => p.companyId === them),
        tasks: tasks.filter((t) => t.companyId === them),
      })
      const { getResponse } = await import('msw')
      const { handlers } = await import('@/shared/mocks/handlers')
      const req = new Request(`http://localhost/api/leads/${lead.id}/won?companyId=${them}&tenantId=${them}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(admin)}`, 'X-Company-Id': them, 'X-Tenant-Id': them },
        body: JSON.stringify(body(co, admin.id, { companyId: them, company_id: them, tenantId: them, tenant: them })),
      })
      const res = await getResponse(handlers, req)
      expect(res?.status).toBe(200)
      const out = (await res!.json()) as { customer_id: string; project_ids: string[] }
      expect(customers.find((c) => c.id === out.customer_id)?.companyId).toBe(co)
      expect(projects.filter((p) => out.project_ids.includes(p.id)).every((p) => p.companyId === co)).toBe(true)
      expect(
        JSON.stringify({
          leads: leads.filter((l) => l.companyId === them),
          customers: customers.filter((c) => c.companyId === them),
          projects: projects.filter((p) => p.companyId === them),
          tasks: tasks.filter((t) => t.companyId === them),
        }),
      ).toBe(theirs)
    })
  }

  afterEach(() => {
    const g = globalThis as { __apexWonFailAt?: string; __apexWonFailWith?: string }
    delete g.__apexWonFailAt
    delete g.__apexWonFailWith
  })

  it('a LIMIT_REACHED inside the flow answers 402 { message, code, limit, current, max, planId, step } and saves nothing', async () => {
    const admin = userFor('co_crest', 'Company Admin')
    const lead = winnable('co_crest')[0]
    const g = globalThis as { __apexWonFailAt?: string; __apexWonFailWith?: string }
    g.__apexWonFailAt = 'projects'
    g.__apexWonFailWith = 'limit'
    const before = JSON.stringify({ leads, customers, projects, tasks, contacts })
    const res = await callApi(tokenFor(admin), 'POST', `/leads/${lead.id}/won`, body('co_crest', admin.id))
    expect(res.status).toBe(402)
    expect(res.body).toMatchObject({ code: 'LIMIT_REACHED', limit: 'leadsContacts', max: 25000, planId: 'business', step: 'projects' })
    expect(typeof res.body.current).toBe('number')
    expect(res.body.message).toMatch(/Nothing was saved/)
    expect(JSON.stringify({ leads, customers, projects, tasks, contacts })).toBe(before)
  })

  it('a refused quotation answers 422 with code quotation_not_accepted and step validate', async () => {
    const admin = userFor('co_apex', 'Company Admin')
    const { quotations } = await import('@/shared/mocks/data/quotations')
    const lead = winnable('co_apex')[0]
    const q = quotations.find((x) => x.companyId === 'co_apex' && x.status === 'draft')!
    q.leadId = lead.id
    const res = await callApi(tokenFor(admin), 'POST', `/leads/${lead.id}/won`, body('co_apex', admin.id, { quotation_id: q.id }))
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ code: 'quotation_not_accepted', step: 'validate' })
  })
})
