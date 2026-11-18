import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns'
import type { ModuleKey, Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { ROLES } from '@/shared/lib/constants'
import { customers, leads, users } from '@/shared/mocks/db'
import { services } from '@/shared/mocks/data/services'
import { departments } from '@/shared/mocks/data/departments'
import { projects, tasks } from '@/shared/mocks/data/tasks'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { orderedIndustries, orderedSources } from '@/shared/mocks/lookupChecks'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { REPORT_IDS } from '@/modules/reports/lib/reportCatalog'
import { customSheet, sheetsFor } from '@/modules/reports/lib/reportSheets'
import type { CustomReport, SalesReport } from '@/modules/reports/types'
import { callApi } from './helpers'

/**
 * Permission scopes (§4), TABLE-DRIVEN FROM PERMISSION_MATRIX: for every role × {leads (sales),
 * tasks, reports, exports} the expected visibility is derived from the matrix at run time and
 * compared with what the real mock API (MSW handlers) answers, in both companies. A matrix change
 * changes the expectations automatically; the guard test fails when the matrix gains a role,
 * module or scope value this table doesn't know how to check.
 *
 * Definitions (from the code, not guessed):
 *  - team (shared/lib/permissions.ts teamIdsFor): me + users whose managerId is me (direct reports)
 *    + every member of the active departments I head and their active sub-departments, inside my company.
 *  - leads: full / view = every lead of the company (view is read-only); team = owner in my team;
 *    own = owner is me; hidden = 403 on the list and on every lead.
 *  - tasks (selectors/tasks.ts canSeeTask): full / view = every task (view read-only); own = tasks I
 *    own, follow, created or whose project I manage; team = those + tasks owned by my team; hidden = 403.
 *  - projects (services/projects.ts; the TASKS column governs them): full / view = every project of
 *    the company; team = managed by my team or with a task owned by my team or followed by me; own =
 *    the same with "my team" = me; hidden = 403 on the list and on every project. Out-of-scope project
 *    of my company = 403, another company's = 404. Create: full and team only. Change (name, manager,
 *    status): the tasks edit right (not view) and full scope, the manager, or team scope over the manager.
 *  - reports (services/reports.ts reportScopeOf): the narrower of the Sales and Reports scopes
 *    (hidden → 403, own, team, otherwise full); family scopes (marketing / finance / hr) and view
 *    don't narrow the sales data.
 *  - exports: report exports are built client-side from the scoped report (reportSheets.ts), so
 *    they carry exactly the report's scope; the workspace data export (GET /billing/export) needs
 *    Settings edit (Company Admin) and contains the whole company.
 */

/* ---------------- The table: what this suite knows how to check ---------------- */

const KNOWN_ROLES: readonly Role[] = [
  'Company Admin',
  'Management',
  'Sales Manager',
  'Sales Agent',
  'Marketing Manager',
  'Accountant',
  'HR Manager',
  'Department Head',
  'Employee',
]

/** Scope values each checked module's expectations handle. */
const HANDLED: Partial<Record<ModuleKey, readonly Scope[]>> = {
  sales: ['full', 'team', 'own', 'view', 'hidden'],
  tasks: ['full', 'team', 'own', 'view', 'hidden'],
  reports: ['full', 'team', 'own', 'view', 'hidden', 'marketing', 'finance', 'hr'],
  // Only the edit bit gates the workspace data export; any value is fine.
  settings: ['full', 'team', 'own', 'view', 'hidden', 'marketing', 'finance', 'hr'],
}

/** Every module key of the matrix, and what (if anything) this suite checks for it. */
const MODULE_COVERAGE: Record<ModuleKey, string> = {
  sales: 'leads: list, detail, create, update; feeds reports and exports',
  tasks: 'tasks: list, detail, create, update; projects: list, detail, create, patch, manager change, status; overdue tasks in reports',
  reports: 'sales report + report builder + their Excel exports',
  settings: 'workspace data export gate (Settings edit)',
  services: 'not checked here',
  marketing: 'not checked here',
  accounting: 'not checked here',
  hr: 'not checked here',
  departments: 'not checked here',
}

/* ---------------- Fixtures: one user per role in both companies ---------------- */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]

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
        id: `u-iso-${co}-${slug}`,
        companyId: co,
        name: `Isolation ${role} ${co}`,
        email: `iso-${slug}@${co}.test`,
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

/* ---------------- Expectations derived from the matrix ---------------- */

/** "My team" computed straight from the seed (see the header). */
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

function assertHandled(module: ModuleKey, scope: Scope): void {
  if (!HANDLED[module]?.includes(scope)) throw new Error(`PERMISSION_MATRIX uses scope "${scope}" for ${module}; this table has no expectation for it`)
}

/** Lead ids the user may see under a scope, or null when the module is refused (403). */
function expectedLeads(u: User, scope: Scope): Set<string> | null {
  assertHandled('sales', scope)
  if (scope === 'hidden') return null
  const team = teamOf(u)
  return new Set(
    leads
      .filter((l) => l.companyId === u.companyId)
      .filter((l) => (scope === 'own' ? l.ownerId === u.id : scope === 'team' ? team.has(l.ownerId) : true))
      .map((l) => l.id),
  )
}

function expectedTasks(u: User, scope: Scope): Set<string> | null {
  assertHandled('tasks', scope)
  if (scope === 'hidden') return null
  const team = teamOf(u)
  const involved = (t: (typeof tasks)[number]) =>
    t.ownerId === u.id ||
    t.followerIds.includes(u.id) ||
    t.createdBy === u.id ||
    (!!t.projectId && projects.some((p) => p.id === t.projectId && p.managerId === u.id))
  return new Set(
    tasks
      .filter((t) => t.companyId === u.companyId)
      .filter((t) => (scope === 'full' || scope === 'view' ? true : scope === 'own' ? involved(t) : involved(t) || team.has(t.ownerId)))
      .map((t) => t.id),
  )
}

/** Project ids the user may see (tasks scope), or null when refused (403). */
function expectedProjects(u: User, scope: Scope): Set<string> | null {
  assertHandled('tasks', scope)
  if (scope === 'hidden') return null
  const mine = projects.filter((p) => p.companyId === u.companyId)
  if (scope === 'full' || scope === 'view') return new Set(mine.map((p) => p.id))
  const team = scope === 'team' ? teamOf(u) : new Set([u.id])
  return new Set(
    mine
      .filter((p) => team.has(p.managerId) || tasks.some((t) => t.projectId === p.id && (team.has(t.ownerId) || t.followerIds.includes(u.id))))
      .map((p) => p.id),
  )
}

/** May the user change this project (name, manager, dates, status)? */
function expectedManage(u: User, scope: Scope, p: (typeof projects)[number]): boolean {
  if (!writable(scope)) return false
  if (scope === 'full' || p.managerId === u.id) return true
  return scope === 'team' && teamOf(u).has(p.managerId)
}

type ReportScope = 'hidden' | 'own' | 'team' | 'full'
function expectedReportScope(role: Role): ReportScope {
  const sales = scopeOf(role, 'sales')
  const reports = scopeOf(role, 'reports')
  assertHandled('sales', sales)
  assertHandled('reports', reports)
  if (sales === 'hidden' || reports === 'hidden') return 'hidden'
  if (sales === 'own' || reports === 'own') return 'own'
  if (sales === 'team' || reports === 'team') return 'team'
  return 'full'
}

const writable = (scope: Scope) => scope === 'full' || scope === 'team' || scope === 'own'

/* ---------------- The checks ---------------- */

const TO = format(new Date(), 'yyyy-MM-dd')
const FROM = format(subDays(new Date(), 1000), 'yyyy-MM-dd')
const inRange = (iso: string) => {
  const t = new Date(iso).getTime()
  return t >= startOfDay(parseISO(FROM)).getTime() && t <= endOfDay(parseISO(TO)).getTime()
}

const nameOf = (id: string) => users.find((u) => u.id === id)?.name
const sorted = (s: Iterable<string>) => [...s].sort()

async function checkLeads(u: User, token: string): Promise<void> {
  const scope = scopeOf(roleOf(u), 'sales')
  const want = expectedLeads(u, scope)
  const where = `${u.id} (${roleOf(u)}, sales=${scope})`
  const list = await callApi(token, 'GET', '/leads')
  const sameCo = leads.filter((l) => l.companyId === u.companyId)
  const otherCo = leads.find((l) => l.companyId !== u.companyId)!

  // Another company's lead never exists for this user, whatever the role.
  expect((await callApi(token, 'GET', `/leads/${otherCo.id}`)).status, `${where}: other company's lead`).toBe(404)

  if (!want) {
    expect(list.status, `${where}: GET /leads`).toBe(403)
    expect((await callApi(token, 'GET', `/leads/${sameCo[0].id}`)).status, `${where}: GET a lead`).toBe(403)
    expect((await callApi(token, 'PATCH', `/leads/${sameCo[0].id}`, { nextStep: 'x' })).status, `${where}: PATCH a lead`).toBe(403)
    expect((await callApi(token, 'POST', '/leads', quickAdd(u))).status, `${where}: POST /leads`).toBe(403)
    return
  }
  expect(list.status, `${where}: GET /leads`).toBe(200)
  const got = (list.body as { id: string }[]).map((l) => l.id)
  expect(sorted(got), `${where}: visible leads`).toEqual(sorted(want))
  expect(got.every((id) => sameCo.some((l) => l.id === id)), `${where}: rows of another company`).toBe(true)

  const outside = sameCo.find((l) => !want.has(l.id))
  if (outside) {
    expect((await callApi(token, 'GET', `/leads/${outside.id}`)).status, `${where}: GET out-of-scope lead`).toBe(403)
    expect((await callApi(token, 'PATCH', `/leads/${outside.id}`, { nextStep: 'x' })).status, `${where}: PATCH out-of-scope lead`).toBe(403)
  }
  const inside = sameCo.find((l) => want.has(l.id))
  if (inside) {
    expect((await callApi(token, 'GET', `/leads/${inside.id}`)).status, `${where}: GET own-scope lead`).toBe(200)
    const patch = await callApi(token, 'PATCH', `/leads/${inside.id}`, { nextStep: 'Isolation check' })
    expect(patch.status, `${where}: PATCH in-scope lead`).toBe(writable(scope) ? 200 : 403)
  }

  const created = await callApi(token, 'POST', '/leads', quickAdd(u))
  if (!writable(scope)) {
    expect(created.status, `${where}: POST /leads`).toBe(403)
    return
  }
  expect(created.status, `${where}: POST /leads ${JSON.stringify(created.body)}`).toBe(200)
  const owner = users.find((x) => x.id === created.body.ownerId)
  expect(owner?.companyId, `${where}: new lead's owner`).toBe(u.companyId)
  if (scope === 'own') expect(created.body.ownerId).toBe(u.id)
  if (scope === 'team') expect(teamOf(u).has(created.body.ownerId), `${where}: new lead assigned outside the team`).toBe(true)
  const after = await callApi(token, 'GET', '/leads')
  expect((after.body as { id: string }[]).some((l) => l.id === created.body.id), `${where}: own new lead visible`).toBe(true)
}

let probe = 0
function quickAdd(u: User) {
  probe++
  return {
    company: `Isolation Probe ${probe} ${u.id}`,
    contactName: 'Probe Contact',
    mobile: '',
    email: '',
    sourceType: orderedSources(u.companyId).find((s) => s.active)!.key,
    industry: orderedIndustries(u.companyId).find((i) => i.active)!.key,
  }
}

async function checkTasks(u: User, token: string): Promise<Set<string> | null> {
  const scope = scopeOf(roleOf(u), 'tasks')
  const want = expectedTasks(u, scope)
  const where = `${u.id} (${roleOf(u)}, tasks=${scope})`
  const sameCo = tasks.filter((t) => t.companyId === u.companyId)
  const otherCo = tasks.find((t) => t.companyId !== u.companyId)!
  const list = await callApi(token, 'GET', '/tasks?includeDone=true')

  expect((await callApi(token, 'GET', `/tasks/${otherCo.id}`)).status, `${where}: other company's task`).toBe(404)
  expect((await callApi(token, 'PATCH', `/tasks/${otherCo.id}`, { title: 'x' })).status, `${where}: PATCH other company's task`).toBe(404)

  if (!want) {
    expect(list.status, `${where}: GET /tasks`).toBe(403)
    // Not even a task they own, follow or created (sampled: one of each kind plus any other).
    const probes = new Set(
      [
        sameCo.find((t) => t.ownerId === u.id),
        sameCo.find((t) => t.followerIds.includes(u.id)),
        sameCo.find((t) => t.createdBy === u.id),
        sameCo.find((t) => t.ownerId !== u.id),
      ].filter((t): t is (typeof sameCo)[number] => t !== undefined),
    )
    for (const t of probes) expect((await callApi(token, 'GET', `/tasks/${t.id}`)).status, `${where}: GET /tasks/${t.id}`).toBe(404)
    expect((await callApi(token, 'POST', '/tasks', { title: 'Isolation probe' })).status, `${where}: POST /tasks`).toBe(403)
    return null
  }
  expect(list.status, `${where}: GET /tasks`).toBe(200)
  const got = (list.body as { id: string }[]).map((t) => t.id)
  expect(sorted(got), `${where}: visible tasks`).toEqual(sorted(want))

  const outside = sameCo.find((t) => !want.has(t.id))
  if (outside) {
    expect((await callApi(token, 'GET', `/tasks/${outside.id}`)).status, `${where}: GET out-of-scope task`).toBe(404)
    expect((await callApi(token, 'PATCH', `/tasks/${outside.id}`, { title: outside.title })).status, `${where}: PATCH out-of-scope task`).toBe(404)
  }
  const inside = sameCo.find((t) => want.has(t.id))
  if (inside) {
    expect((await callApi(token, 'GET', `/tasks/${inside.id}`)).status, `${where}: GET visible task`).toBe(200)
    const patch = await callApi(token, 'PATCH', `/tasks/${inside.id}`, { title: inside.title })
    expect(patch.status, `${where}: PATCH visible task`).toBe(writable(scope) ? 200 : 403)
  }
  const created = await callApi(token, 'POST', '/tasks', { title: 'Isolation probe' })
  expect(created.status, `${where}: POST /tasks`).toBe(writable(scope) ? 200 : 403)
  return want
}

async function checkProjects(u: User, token: string): Promise<void> {
  const scope = scopeOf(roleOf(u), 'tasks')
  const want = expectedProjects(u, scope)
  const where = `${u.id} (${roleOf(u)}, tasks=${scope}, projects)`
  const sameCo = projects.filter((p) => p.companyId === u.companyId)
  const otherCo = projects.find((p) => p.companyId !== u.companyId)!
  const customer = customers.find((c) => c.companyId === u.companyId)!
  const service = services.find((x) => x.companyId === u.companyId && x.active)!
  const body = () => ({ name: `Isolation project ${u.id}`, customerId: customer.id, serviceId: service.id, managerId: u.id, startDate: TO, endDate: TO, status: 'Planned', estimatedHours: 0, generateTasks: false })

  // Another company's project answers exactly like a missing one: 404, or 403 for everything when Tasks is hidden.
  const missing = want ? 404 : 403
  for (const id of [otherCo.id, 'PRJ-NOPE']) {
    expect((await callApi(token, 'GET', `/projects/${id}`)).status, `${where}: GET ${id}`).toBe(missing)
    expect((await callApi(token, 'PATCH', `/projects/${id}`, { name: 'x' })).status, `${where}: PATCH ${id}`).toBe(missing)
  }

  const list = await callApi(token, 'GET', '/projects')
  if (!want) {
    expect(list.status, `${where}: GET /projects`).toBe(403)
    expect((await callApi(token, 'GET', `/projects/${sameCo[0].id}`)).status, `${where}: GET a project`).toBe(403)
    expect((await callApi(token, 'PATCH', `/projects/${sameCo[0].id}`, { status: 'On hold' })).status, `${where}: PATCH a project`).toBe(403)
    expect((await callApi(token, 'POST', '/projects', body())).status, `${where}: POST /projects`).toBe(403)
    return
  }
  expect(list.status, `${where}: GET /projects`).toBe(200)
  expect(sorted((list.body as { id: string }[]).map((p) => p.id)), `${where}: visible projects`).toEqual(sorted(want))

  const outside = sameCo.find((p) => !want.has(p.id))
  if (outside) {
    expect((await callApi(token, 'GET', `/projects/${outside.id}`)).status, `${where}: GET out-of-scope project`).toBe(403)
    expect((await callApi(token, 'PATCH', `/projects/${outside.id}`, { status: 'On hold' })).status, `${where}: PATCH out-of-scope project`).toBe(403)
  }

  const visible = sameCo.filter((x) => want.has(x.id))
  for (const p of visible) {
    const detail = await callApi(token, 'GET', `/projects/${p.id}`)
    expect(detail.status, `${where}: GET ${p.id}`).toBe(200)
    expect(detail.body.canManage, `${where}: ${p.id} canManage`).toBe(expectedManage(u, scope, p))
    // Every task of the project (whoever owns it).
    const projectTasks = tasks.filter((t) => t.projectId === p.id)
    expect(sorted((detail.body.tasks as { id: string }[]).map((t) => t.id)), `${where}: ${p.id} tasks`).toEqual(sorted(projectTasks.map((t) => t.id)))
  }

  // Changes: one project the user may manage (if any) and one they may only see (if any).
  const manageable = visible.find((p) => expectedManage(u, scope, p))
  const readOnly = visible.find((p) => !expectedManage(u, scope, p))
  if (readOnly) {
    expect((await callApi(token, 'PATCH', `/projects/${readOnly.id}`, { name: readOnly.name })).status, `${where}: PATCH read-only project`).toBe(403)
    const other = users.find((x) => x.companyId === u.companyId && x.active && x.id !== readOnly.managerId)!
    expect((await callApi(token, 'PATCH', `/projects/${readOnly.id}`, { managerId: other.id })).status, `${where}: manager change on read-only project`).toBe(403)
    expect((await callApi(token, 'PATCH', `/projects/${readOnly.id}`, { status: 'On hold' })).status, `${where}: status on read-only project`).toBe(403)
  }
  if (manageable) {
    expect((await callApi(token, 'PATCH', `/projects/${manageable.id}`, { name: manageable.name })).status, `${where}: PATCH ${manageable.id}`).toBe(200)
    const status = await callApi(token, 'PATCH', `/projects/${manageable.id}`, { status: 'On hold' })
    expect(status.status, `${where}: status On hold`).toBe(200)
    expect(status.body.status).toBe('On hold')
    const open = tasks.filter((t) => t.projectId === manageable.id && t.status !== 'Done').length
    expect((await callApi(token, 'PATCH', `/projects/${manageable.id}`, { status: 'Completed' })).status, `${where}: complete with open tasks`).toBe(open ? 409 : 200)
    const foreign = users.find((x) => x.companyId !== u.companyId && x.active)!
    expect((await callApi(token, 'PATCH', `/projects/${manageable.id}`, { managerId: foreign.id })).status, `${where}: another company's manager`).toBe(422)
    const next = users.find((x) => x.companyId === u.companyId && x.active && x.id !== manageable.managerId)!
    const moved = await callApi(token, 'PATCH', `/projects/${manageable.id}`, { managerId: next.id })
    expect(moved.status, `${where}: manager change`).toBe(200)
    expect(moved.body.managerId).toBe(next.id)
  }

  const created = await callApi(token, 'POST', '/projects', body())
  const mayCreate = scope === 'full' || scope === 'team'
  expect(created.status, `${where}: POST /projects ${JSON.stringify(created.body)}`).toBe(mayCreate ? 200 : 403)
  if (mayCreate) {
    expect(projects.find((p) => p.id === created.body.id)?.companyId, `${where}: new project's company`).toBe(u.companyId)
    expect(((await callApi(token, 'GET', '/projects')).body as { id: string }[]).some((p) => p.id === created.body.id), `${where}: new project visible`).toBe(true)
  }
}

async function checkReportsAndExports(u: User, token: string, visibleTasks: Set<string> | null): Promise<void> {
  const role = roleOf(u)
  const scope = expectedReportScope(role)
  const where = `${u.id} (${role}, report scope=${scope})`
  const q = `from=${FROM}&to=${TO}`
  const res = await callApi(token, 'GET', `/reports/sales?${q}`)
  const custom = await callApi(token, 'POST', '/reports/custom', { from: FROM, to: TO, dimension: 'owner', measure: 'count' })
  if (scope === 'hidden') {
    expect(res.status, `${where}: GET /reports/sales`).toBe(403)
    expect(custom.status, `${where}: POST /reports/custom`).toBe(403)
    return
  }
  expect(res.status, `${where}: GET /reports/sales ${JSON.stringify(res.body)}`).toBe(200)
  expect(custom.status, `${where}: POST /reports/custom`).toBe(200)
  const report = res.body as SalesReport
  expect(report.scope, `${where}: report scope`).toBe(scope)

  const leadIds = expectedLeads(u, scope)!
  const scopedLeads = leads.filter((l) => leadIds.has(l.id))
  const owners = scope === 'own' ? new Set([u.id]) : scope === 'team' ? teamOf(u) : new Set(users.filter((x) => x.companyId === u.companyId).map((x) => x.id))
  const created = scopedLeads.filter((l) => inRange(l.createdAt)).length

  expect(report.kpis.leadsCreated, `${where}: leads counted`).toBe(created)
  expect(report.byStatus.reduce((s, r) => s + r.count, 0), `${where}: by status`).toBe(created)
  for (const f of report.overdueFollowUps) expect(leadIds.has(f.leadId), `${where}: overdue follow-up ${f.leadId}`).toBe(true)
  for (const a of report.agents) expect(owners.has(a.userId), `${where}: agent row ${a.userId}`).toBe(true)
  for (const o of report.owners) expect(owners.has(o.id), `${where}: owner filter ${o.id}`).toBe(true)
  for (const r of report.targets.rows) expect(owners.has(r.userId), `${where}: target row ${r.userId}`).toBe(true)
  const taskOwners = new Set(tasks.filter((t) => visibleTasks?.has(t.id)).map((t) => t.ownerId))
  for (const t of report.overdueTasks) {
    expect(visibleTasks?.has(t.taskId), `${where}: overdue task ${t.taskId}`).toBe(true)
    if (scope === 'own') expect(t.ownerId).toBe(u.id)
  }

  const builder = custom.body as CustomReport
  expect(builder.total, `${where}: report builder total`).toBe(created)
  for (const r of builder.rows) expect(owners.has(r.key), `${where}: report builder owner ${r.key}`).toBe(true)

  // Excel exports: built from the same scoped responses; no name or lead outside the scope.
  const cells = [...REPORT_IDS.flatMap((id) => sheetsFor(id, report)), customSheet(builder)].flatMap((s) =>
    s.rows.flatMap((row) => row.filter((c): c is string => typeof c === 'string')),
  )
  const allowedNames = new Set([...owners, ...taskOwners].map(nameOf))
  const visibleCompanies = new Set(scopedLeads.map((l) => l.company))
  const people = new Map(users.map((x) => [x.name, x]))
  const leadNames = new Set(leads.filter((l) => !visibleCompanies.has(l.company)).map((l) => l.company))
  for (const c of cells) {
    const person = people.get(c)
    if (person) {
      expect(person.companyId, `${where}: export names ${c} of another company`).toBe(u.companyId)
      expect(allowedNames.has(c), `${where}: export names ${c}, outside the scope`).toBe(true)
    }
    expect(leadNames.has(c), `${where}: export contains lead "${c}" outside the scope`).toBe(false)
  }
}

async function checkDataExport(u: User, token: string): Promise<void> {
  const role = roleOf(u)
  const res = await callApi(token, 'GET', '/billing/export')
  const where = `${u.id} (${role})`
  if (!can(role, 'settings', 'edit')) {
    expect(res.status, `${where}: GET /billing/export`).toBe(403)
    return
  }
  expect(res.status, `${where}: GET /billing/export`).toBe(200)
  // The workspace export holds every lead of the company: only a role that already sees them all may run it.
  expect(scopeOf(role, 'sales'), `${where}: can export the whole workspace but its sales scope isn't full`).toBe('full')
  const ids = (res.body.data.leads as { id: string }[]).map((l) => l.id)
  expect(sorted(ids)).toEqual(sorted(leads.filter((l) => l.companyId === u.companyId).map((l) => l.id)))
  const userIds = (res.body.data.users as { id: string }[]).map((x) => x.id)
  expect(userIds.every((id) => users.find((x) => x.id === id)?.companyId === u.companyId)).toBe(true)
  expect(JSON.stringify(res.body)).not.toContain('companyId')
}

async function checkRole(co: Co, role: Role): Promise<void> {
  const u = userFor(co, role)
  const token = tokenFor(u)
  // Reads first (expectations are computed from the seed), then writes.
  const visibleTasks = expectedTasks(u, scopeOf(role, 'tasks'))
  await checkReportsAndExports(u, token, visibleTasks)
  await checkDataExport(u, token)
  await checkLeads(u, token)
  await checkTasks(u, token)
  await checkProjects(u, token)
}

/* ---------------- Guard ---------------- */

describe('the table covers the whole permission matrix', () => {
  it('knows every role, module and scope value of PERMISSION_MATRIX', () => {
    const roles = Object.keys(PERMISSION_MATRIX)
    const unknownRoles = roles.filter((r) => !KNOWN_ROLES.includes(r as Role))
    expect(unknownRoles, `PERMISSION_MATRIX has roles this table doesn't handle: ${unknownRoles.join(', ')}. Add them to KNOWN_ROLES.`).toEqual([])
    const missingRoles = KNOWN_ROLES.filter((r) => !roles.includes(r))
    expect(missingRoles, `Roles removed from PERMISSION_MATRIX: ${missingRoles.join(', ')}. Update KNOWN_ROLES.`).toEqual([])
    expect([...ROLES].sort(), 'ROLES (constants.ts) and PERMISSION_MATRIX disagree').toEqual([...roles].sort())
    for (const role of roles as Role[]) {
      const modules = Object.keys(PERMISSION_MATRIX[role]) as ModuleKey[]
      const unknown = modules.filter((m) => !(m in MODULE_COVERAGE))
      expect(unknown, `PERMISSION_MATRIX["${role}"] has modules this table doesn't handle: ${unknown.join(', ')}. Add them to MODULE_COVERAGE.`).toEqual([])
      for (const m of Object.keys(HANDLED) as ModuleKey[]) {
        const scope = PERMISSION_MATRIX[role][m]
        expect(HANDLED[m]!.includes(scope), `PERMISSION_MATRIX["${role}"].${m} = "${scope}" has no expectation in this table`).toBe(true)
      }
    }
  })
})

/* ---------------- The real matrix, every role, both companies ---------------- */

describe('scopes from PERMISSION_MATRIX hold in the mock API', () => {
  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role} (sales=${PERMISSION_MATRIX[role].sales}, tasks=${PERMISSION_MATRIX[role].tasks}, reports=${PERMISSION_MATRIX[role].reports})`, async () => {
        await checkRole(co, role)
      }, 20_000)
    }
  }

  it('a full-scope user of one company sees zero rows of the other', async () => {
    for (const co of COMPANIES) {
      const u = userFor(co, 'Company Admin')
      const token = tokenFor(u)
      const l = await callApi(token, 'GET', '/leads')
      const t = await callApi(token, 'GET', '/tasks?includeDone=true')
      const r = await callApi(token, 'GET', `/reports/sales?from=${FROM}&to=${TO}`)
      const foreignLeads = new Set(leads.filter((x) => x.companyId !== co).map((x) => x.id))
      const foreignTasks = new Set(tasks.filter((x) => x.companyId !== co).map((x) => x.id))
      const foreignUsers = new Set(users.filter((x) => x.companyId !== co).map((x) => x.id))
      expect((l.body as { id: string }[]).filter((x) => foreignLeads.has(x.id))).toEqual([])
      expect((t.body as { id: string }[]).filter((x) => foreignTasks.has(x.id))).toEqual([])
      const report = r.body as SalesReport
      expect(report.owners.filter((o) => foreignUsers.has(o.id))).toEqual([])
      expect(report.overdueFollowUps.filter((f) => foreignLeads.has(f.leadId))).toEqual([])
      expect(report.overdueTasks.filter((x) => foreignTasks.has(x.taskId))).toEqual([])
    }
  })
})

/* ---------------- Every scope value, by changing the matrix ---------------- */

/**
 * The real matrix doesn't use every scope in every module (no role has tasks "view" or "hidden"
 * today). Setting each handled scope on two roles proves the API follows the matrix for values it
 * doesn't use yet, so a future matrix change can't expose an untested branch.
 */
describe('every scope value behaves as defined when the matrix uses it', () => {
  const MUTATED_ROLES: Role[] = ['Sales Agent', 'Department Head']
  for (const module of ['sales', 'tasks', 'reports'] as const) {
    for (const scope of HANDLED[module]!) {
      it(`${module} = ${scope}`, async () => {
        const saved = MUTATED_ROLES.map((r) => PERMISSION_MATRIX[r][module])
        try {
          for (const r of MUTATED_ROLES) PERMISSION_MATRIX[r][module] = scope
          for (const co of COMPANIES) {
            for (const r of MUTATED_ROLES) {
              restoreSnapshot(seed)
              ensureRoleUsers()
              await checkRole(co, r)
            }
          }
        } finally {
          MUTATED_ROLES.forEach((r, i) => (PERMISSION_MATRIX[r][module] = saved[i]))
        }
      }, 30_000)
    }
  }
})
