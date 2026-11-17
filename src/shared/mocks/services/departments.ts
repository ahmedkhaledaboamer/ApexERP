import { isBefore, isSameMonth, startOfDay, startOfMonth } from 'date-fns'
import type { User } from '@/shared/types'
import { departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import type {
  Department,
  DepartmentDetail,
  DepartmentFigures,
  DepartmentGoal,
  DepartmentInput,
  DepartmentMember,
  DepartmentRow,
  DepartmentTask,
  DepartmentUpdateInput,
  GoalInput,
  MoveMembersInput,
  OrgNode,
} from '@/modules/departments/types'
import { departments } from '@/shared/mocks/data/departments'
import { leads, tasks, users } from '@/shared/mocks/db'
import { isClosedStatus, isWonStatus } from '@/shared/mocks/data/lookups'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import { rowFor } from '@/shared/mocks/services/targets'
import { delay, fail } from '@/shared/mocks/server'

/* ---------------- Access ---------------- */

type Access = { scope: ReturnType<typeof scopeOf>; visible: Set<string>; managed: Set<string> }

/**
 * full: every department, manage all. team: the departments the user heads + their
 * sub-departments (managed), plus their own (visible). view: their own department, read-only.
 */
function accessOf(user: User): Access {
  const scope = scopeOf(user.role, 'departments')
  if (scope === 'full') {
    const all = new Set(departments.map((d) => d.id))
    return { scope, visible: all, managed: all }
  }
  const managed = new Set<string>(
    scope === 'team' ? departments.filter((d) => d.headId === user.id).flatMap((d) => departmentSubtree(d.id, departments)) : [],
  )
  const visible = new Set<string>(managed)
  if (scope !== 'hidden' && user.departmentId) visible.add(user.departmentId)
  return { scope, visible, managed }
}

async function guardVisible(user: User, id: string): Promise<{ dept: Department; access: Access }> {
  const access = accessOf(user)
  if (access.scope === 'hidden') return fail('Your role has no access to departments.', 403)
  const dept = departments.find((d) => d.id === id)
  if (!dept) return fail('That department doesn’t exist.', 404)
  if (!access.visible.has(id)) return fail('This department is outside your team.', 403)
  return { dept, access }
}

async function guardFull(user: User): Promise<void> {
  if (scopeOf(user.role, 'departments') !== 'full') await fail('Only System Admin, Management or HR can change the company structure.', 403)
}

/* ---------------- Helpers ---------------- */

const userName = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null)
const membersOf = (id: string, includeInactive = false) =>
  users.filter((u) => u.departmentId === id && (includeInactive || u.active !== false))

function depthOf(d: Department): number {
  let depth = 0
  let p = d.parentId
  const seen = new Set<string>()
  while (p && !seen.has(p)) {
    seen.add(p)
    depth++
    p = departments.find((x) => x.id === p)?.parentId ?? null
  }
  return depth
}

function pathOf(d: Department): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  let cur: Department | undefined = d
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift({ id: cur.id, name: cur.name })
    cur = cur.parentId ? departments.find((x) => x.id === cur!.parentId) : undefined
  }
  return out
}

/** Would making `parentId` the parent of `id` create a loop? */
function createsCycle(id: string, parentId: string | null): boolean {
  if (!parentId) return false
  if (parentId === id) return true
  return departmentSubtree(id, departments.map((d) => ({ ...d, active: true }))).includes(parentId)
}

function memberTasks(memberIds: Set<string>): DepartmentTask[] {
  const today = startOfDay(new Date())
  return tasks
    .filter((t) => memberIds.has(t.ownerId) && t.status !== 'Done')
    .map((t) => {
      const lead = leads.find((l) => l.id === t.leadId)
      return {
        id: t.id,
        title: t.title,
        ownerId: t.ownerId,
        ownerName: userName(t.ownerId) ?? '—',
        dueDate: t.dueDate,
        status: t.status,
        priority: t.priority,
        overdue: isBefore(new Date(t.dueDate), today),
        leadId: lead?.id ?? null,
        leadCompany: lead?.company ?? null,
      }
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

function toRow(d: Department): DepartmentRow {
  const members = membersOf(d.id)
  const memberIds = new Set(members.map((m) => m.id))
  const open = memberTasks(memberIds)
  return {
    id: d.id,
    name: d.name,
    headId: d.headId,
    parentId: d.parentId,
    costCenter: d.costCenter,
    active: d.active,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    headName: userName(d.headId),
    parentName: d.parentId ? (departments.find((x) => x.id === d.parentId)?.name ?? null) : null,
    memberCount: members.length,
    childCount: departments.filter((x) => x.parentId === d.id && x.active).length,
    depth: depthOf(d),
    openTasks: open.length,
    overdueTasks: open.filter((t) => t.overdue).length,
    openGoals: d.goals.filter((g) => g.status === 'Open').length,
  }
}

function figuresOf(d: Department): DepartmentFigures {
  const members = membersOf(d.id)
  const ids = new Set(members.map((m) => m.id))
  const owned = leads.filter((l) => ids.has(l.ownerId))
  const open = owned.filter((l) => !isClosedStatus(l.status))
  const now = new Date()
  const today = startOfDay(now)
  // Targets: members with at least one activity target (sales agents today).
  let pctSum = 0
  let counted = 0
  for (const m of members.filter((u) => u.role === 'Sales Agent')) {
    const row = rowFor(m, startOfMonth(now))
    const kinds = (Object.keys(row.values) as (keyof typeof row.values)[]).filter((k) => k !== 'events' && row.values[k] > 0)
    if (!kinds.length) continue
    pctSum += kinds.reduce((s, k) => s + Math.min(1, row.actuals[k] / row.values[k]), 0) / kinds.length
    counted++
  }
  const subtree = departmentSubtree(d.id, departments)
  return {
    headcount: members.length,
    headcountWithSubs: users.filter((u) => u.active !== false && subtree.includes(u.departmentId)).length,
    leadsOwned: owned.length,
    openLeads: open.length,
    openPipelineValue: open.reduce((s, l) => s + l.value, 0),
    wonThisMonth: owned.filter((l) => isWonStatus(l.status) && isSameMonth(new Date(l.stageChangedAt), now)).length,
    overdueFollowUps: open.filter((l) => l.nextFollowUpDate && isBefore(new Date(l.nextFollowUpDate), today)).length,
    targetsCompletion: counted ? Math.round((pctSum / counted) * 100) : null,
    membersWithTargets: counted,
  }
}

function memberView(u: User, d: Department): DepartmentMember {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    title: u.title,
    role: u.role,
    managerId: u.managerId,
    managerName: userName(u.managerId),
    active: u.active !== false,
    isHead: d.headId === u.id,
  }
}

/* ---------------- Reads ---------------- */

export async function listDepartments(user: User, includeInactive: boolean): Promise<DepartmentRow[]> {
  const access = accessOf(user)
  if (access.scope === 'hidden') return fail('Your role has no access to departments.', 403)
  return delay(
    departments
      .filter((d) => access.visible.has(d.id) && (includeInactive || d.active))
      .map(toRow)
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name)),
  )
}

/** Flat nodes for the org chart, limited to what the caller can see (plus ancestors for context). */
export async function getOrgChart(user: User): Promise<OrgNode[]> {
  const access = accessOf(user)
  if (access.scope === 'hidden') return fail('Your role has no access to departments.', 403)
  const ids = new Set(access.visible)
  for (const id of access.visible) {
    const d = departments.find((x) => x.id === id)
    if (d) pathOf(d).forEach((p) => ids.add(p.id))
  }
  return delay(
    departments
      .filter((d) => ids.has(d.id))
      .map((d) => {
        const head = d.headId ? users.find((u) => u.id === d.headId) : undefined
        return {
          id: d.id,
          name: d.name,
          parentId: d.parentId && ids.has(d.parentId) ? d.parentId : null,
          active: d.active,
          head: head ? { id: head.id, name: head.name, title: head.title } : null,
          memberCount: membersOf(d.id).length,
          context: !access.visible.has(d.id),
        }
      }),
  )
}

export async function getDepartment(user: User, id: string): Promise<DepartmentDetail> {
  const { dept, access } = await guardVisible(user, id)
  const managed = access.managed.has(id)
  const members = membersOf(id, true)
    .map((u) => memberView(u, dept))
    .sort((a, b) => Number(b.isHead) - Number(a.isHead) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
  return delay({
    ...toRow(dept),
    goals: [...dept.goals].sort((a, b) => (a.status === b.status ? (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') : a.status === 'Open' ? -1 : 1)),
    members,
    children: departments
      .filter((x) => x.parentId === id)
      .map((x) => ({ id: x.id, name: x.name, headName: userName(x.headId), memberCount: membersOf(x.id).length, active: x.active })),
    path: pathOf(dept),
    tasks: memberTasks(new Set(members.filter((m) => m.active).map((m) => m.id))),
    figures: figuresOf(dept),
    can: {
      edit: access.scope === 'full',
      manageMembers: access.scope === 'full' || managed,
      editGoals: access.scope === 'full' || managed,
    },
  })
}

/* ---------------- Writes: structure (full scope) ---------------- */

function validateName(name: string | undefined, selfId?: string): string | null {
  const n = String(name ?? '').trim()
  if (!n) return 'Department name is required.'
  if (n.length > 80) return 'Keep the name under 80 characters.'
  if (departments.some((d) => d.id !== selfId && d.name.toLowerCase() === n.toLowerCase())) return 'A department with that name already exists.'
  return null
}

function validateParent(id: string | null, parentId: string | null | undefined): string | null {
  if (parentId === undefined || parentId === null) return null
  const parent = departments.find((d) => d.id === parentId)
  if (!parent) return 'Pick a parent department from the list.'
  if (!parent.active) return 'The parent department is inactive.'
  if (id && createsCycle(id, parentId)) return 'A department can’t sit under itself or one of its sub-departments.'
  return null
}

export async function createDepartment(user: User, input: DepartmentInput): Promise<DepartmentRow> {
  await guardFull(user)
  const err = validateName(input.name) ?? validateParent(null, input.parentId)
  if (err) return fail(err, 422)
  if (input.costCenter && input.costCenter.length > 40) return fail('Keep the cost center under 40 characters.', 422)
  const now = new Date().toISOString()
  const d: Department = {
    id: `d-${input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36).slice(-4)}`,
    name: input.name.trim(),
    headId: null,
    parentId: input.parentId ?? null,
    goals: [],
    costCenter: (input.costCenter ?? '').trim(),
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
  }
  departments.push(d)
  recordAudit(user, { action: 'create', entity: 'department', entityId: d.id, summary: `Created department “${d.name}”${d.parentId ? ` under ${userless(d.parentId)}` : ''}` })
  if (input.headId) {
    try {
      await assignHead(user, d, input.headId, true)
    } catch (e) {
      // The department exists; report the head problem without undoing creation.
      return Promise.reject(e)
    }
  }
  return delay(toRow(d))
}

const userless = (deptId: string) => departments.find((x) => x.id === deptId)?.name ?? deptId

/** Makes `headId` head of `d`. The head must be a member; `moveIn` moves them in first. */
async function assignHead(user: User, d: Department, headId: string | null, moveIn: boolean): Promise<void> {
  if (headId === d.headId) return
  if (headId === null) {
    const before = userName(d.headId)
    d.headId = null
    recordAudit(user, { action: 'update', entity: 'department', entityId: d.id, summary: `Removed ${before ?? 'the head'} as head of “${d.name}”`, changes: [{ field: 'head', from: before ?? '—', to: '—' }] })
    return
  }
  const head = users.find((u) => u.id === headId)
  if (!head) return fail('Pick the head from the people list.', 422)
  if (head.active === false) return fail(`${head.name} is deactivated and can’t head a department.`, 422)
  if (head.departmentId !== d.id) {
    if (!moveIn) return fail(`${head.name} isn’t a member of ${d.name}. Move them in first, or confirm moving them as part of this change.`, 409)
    const from = departments.find((x) => x.id === head.departmentId)
    if (from && from.headId === head.id) {
      return fail(`${head.name} heads ${from.name}. Pick a new head for ${from.name} first.`, 422)
    }
    recordAudit(user, {
      action: 'update',
      entity: 'department-member',
      entityId: head.id,
      summary: `Moved ${head.name} from ${from?.name ?? '—'} to ${d.name}`,
      changes: [{ field: 'department', from: from?.name ?? '—', to: d.name }],
    })
    head.departmentId = d.id
  }
  const before = userName(d.headId)
  d.headId = headId
  d.updatedAt = new Date().toISOString()
  recordAudit(user, {
    action: 'update',
    entity: 'department',
    entityId: d.id,
    summary: `Head of “${d.name}”: ${before ?? '—'} → ${head.name}`,
    changes: [{ field: 'head', from: before ?? '—', to: head.name }],
  })
}

export async function updateDepartment(user: User, id: string, input: DepartmentUpdateInput): Promise<DepartmentRow> {
  await guardFull(user)
  const d = departments.find((x) => x.id === id)
  if (!d) return fail('That department doesn’t exist.', 404)
  if (input.name !== undefined) {
    const e = validateName(input.name, id)
    if (e) return fail(e, 422)
  }
  if (input.parentId !== undefined) {
    const e = validateParent(id, input.parentId)
    if (e) return fail(e, 422)
  }
  if (input.costCenter !== undefined && input.costCenter.length > 40) return fail('Keep the cost center under 40 characters.', 422)
  if (input.headId !== undefined) await assignHead(user, d, input.headId, !!input.moveHeadIn)

  const before = { name: d.name, parent: d.parentId ? userless(d.parentId) : '—', costCenter: d.costCenter }
  if (input.name !== undefined) d.name = input.name.trim()
  if (input.parentId !== undefined) d.parentId = input.parentId
  if (input.costCenter !== undefined) d.costCenter = input.costCenter.trim()
  const after = { name: d.name, parent: d.parentId ? userless(d.parentId) : '—', costCenter: d.costCenter }
  const changes = diff(before, after)
  if (changes.length) {
    d.updatedAt = new Date().toISOString()
    recordAudit(user, { action: 'update', entity: 'department', entityId: d.id, summary: `Edited department “${d.name}”`, changes })
  }
  return delay(toRow(d))
}

/** Never deleted. Members and active sub-departments must be moved out first (409). */
export async function setDepartmentActive(user: User, id: string, active: boolean): Promise<DepartmentRow> {
  await guardFull(user)
  const d = departments.find((x) => x.id === id)
  if (!d) return fail('That department doesn’t exist.', 404)
  if (!active) {
    const members = membersOf(id).length
    const subs = departments.filter((x) => x.parentId === id && x.active).length
    if (members || subs) {
      const parts = [members && `${members} member${members === 1 ? '' : 's'}`, subs && `${subs} sub-department${subs === 1 ? '' : 's'}`].filter(Boolean)
      return fail(`Move ${parts.join(' and ')} out of ${d.name} before deactivating it.`, 409)
    }
  } else if (d.parentId && !departments.find((x) => x.id === d.parentId)?.active) {
    return fail('Reactivate the parent department first.', 422)
  }
  if (d.active !== active) {
    d.active = active
    if (!active) d.headId = null
    d.updatedAt = new Date().toISOString()
    recordAudit(user, { action: active ? 'reactivate' : 'deactivate', entity: 'department', entityId: d.id, summary: `${active ? 'Reactivated' : 'Deactivated'} department “${d.name}”` })
  }
  return delay(toRow(d))
}

/* ---------------- Writes: members ---------------- */

/** Moves people between departments (bulk). Same field Settings › Users & roles edits. Full scope. */
export async function moveMembers(user: User, input: MoveMembersInput): Promise<{ moved: number }> {
  await guardFull(user)
  const to = departments.find((d) => d.id === input.toDepartmentId)
  if (!to) return fail('Pick the department to move people to.', 422)
  if (!to.active) return fail(`${to.name} is inactive.`, 422)
  if (!Array.isArray(input.userIds) || input.userIds.length === 0) return fail('Pick at least one person to move.', 422)
  const people = input.userIds.map((uid) => users.find((u) => u.id === uid))
  if (people.some((p) => !p)) return fail('Some of those people don’t exist.', 422)
  for (const p of people as User[]) {
    const from = departments.find((d) => d.id === p.departmentId)
    if (from && from.headId === p.id && from.id !== to.id) {
      return fail(`${p.name} heads ${from.name}. Pick a new head for ${from.name} before moving them.`, 422)
    }
  }
  if (input.managerId) {
    const m = users.find((u) => u.id === input.managerId)
    if (!m || m.active === false) return fail('Pick an active manager.', 422)
    if (input.userIds.includes(input.managerId)) return fail('Someone can’t be their own manager.', 422)
  }
  let moved = 0
  for (const p of people as User[]) {
    const from = departments.find((d) => d.id === p.departmentId)
    if (p.departmentId === to.id && input.managerId === undefined) continue
    const changes = [{ field: 'department', from: from?.name ?? '—', to: to.name }]
    if (input.managerId !== undefined && input.managerId !== p.managerId) {
      changes.push({ field: 'manager', from: userName(p.managerId) ?? '—', to: userName(input.managerId) ?? '—' })
      p.managerId = input.managerId
    }
    p.departmentId = to.id
    moved++
    recordAudit(user, {
      action: 'update',
      entity: 'department-member',
      entityId: p.id,
      summary: `Moved ${p.name} from ${from?.name ?? '—'} to ${to.name}`,
      changes,
    })
  }
  return delay({ moved })
}

/** Sets a member's direct manager. Full scope, or a head within the departments they manage. */
export async function setMemberManager(user: User, deptId: string, userId: string, managerId: string | null): Promise<DepartmentMember> {
  const { dept, access } = await guardVisible(user, deptId)
  if (!(access.scope === 'full' || access.managed.has(deptId))) return fail('You can only manage members of your own team.', 403)
  const member = users.find((u) => u.id === userId && u.departmentId === deptId)
  if (!member) return fail('That person isn’t a member of this department.', 404)
  if (managerId) {
    const m = users.find((u) => u.id === managerId)
    if (!m || m.active === false) return fail('Pick an active manager.', 422)
    if (managerId === userId) return fail('Someone can’t be their own manager.', 422)
    // No reporting loops.
    let cur: string | null = managerId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (cur === userId) return fail('That would create a reporting loop.', 422)
      seen.add(cur)
      cur = users.find((u) => u.id === cur)?.managerId ?? null
    }
  }
  if (member.managerId !== managerId) {
    recordAudit(user, {
      action: 'update',
      entity: 'department-member',
      entityId: member.id,
      summary: `Changed ${member.name}’s direct manager`,
      changes: [{ field: 'manager', from: userName(member.managerId) ?? '—', to: userName(managerId) ?? '—' }],
    })
    member.managerId = managerId
  }
  return delay(memberView(member, dept))
}

/* ---------------- Writes: goals ---------------- */

async function guardGoals(user: User, deptId: string): Promise<Department> {
  const { dept, access } = await guardVisible(user, deptId)
  if (!(access.scope === 'full' || access.managed.has(deptId))) return fail('Only the department head or an admin can edit goals.', 403)
  return dept
}

function validateGoal(input: Partial<GoalInput>, partial: boolean): string | null {
  if (!partial || input.title !== undefined) {
    const t = String(input.title ?? '').trim()
    if (!t) return 'Goal title is required.'
    if (t.length > 160) return 'Keep the goal under 160 characters.'
  }
  if (input.ownerId && !users.some((u) => u.id === input.ownerId && u.active !== false)) return 'Pick an active owner.'
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return 'Due date must be yyyy-MM-dd.'
  if (input.status !== undefined && input.status !== 'Open' && input.status !== 'Done') return 'Status must be Open or Done.'
  return null
}

export async function addGoal(user: User, deptId: string, input: GoalInput): Promise<DepartmentGoal> {
  const d = await guardGoals(user, deptId)
  const e = validateGoal(input, false)
  if (e) return fail(e, 422)
  const g: DepartmentGoal = {
    id: `g-${Date.now().toString(36)}`,
    title: input.title.trim(),
    ownerId: input.ownerId ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status ?? 'Open',
    createdAt: new Date().toISOString(),
  }
  d.goals.push(g)
  recordAudit(user, { action: 'create', entity: 'department-goal', entityId: g.id, summary: `Added goal “${g.title}” to ${d.name}` })
  return delay(g)
}

export async function updateGoal(user: User, deptId: string, goalId: string, input: Partial<GoalInput>): Promise<DepartmentGoal> {
  const d = await guardGoals(user, deptId)
  const g = d.goals.find((x) => x.id === goalId)
  if (!g) return fail('That goal doesn’t exist.', 404)
  const e = validateGoal(input, true)
  if (e) return fail(e, 422)
  const before = { ...g, owner: userName(g.ownerId) ?? '—' }
  if (input.title !== undefined) g.title = input.title.trim()
  if (input.ownerId !== undefined) g.ownerId = input.ownerId
  if (input.dueDate !== undefined) g.dueDate = input.dueDate
  if (input.status !== undefined) g.status = input.status
  const changes = diff(
    { title: before.title, owner: before.owner, dueDate: before.dueDate, status: before.status },
    { title: g.title, owner: userName(g.ownerId) ?? '—', dueDate: g.dueDate, status: g.status },
  )
  if (changes.length) recordAudit(user, { action: 'update', entity: 'department-goal', entityId: g.id, summary: `Edited goal “${g.title}” in ${d.name}`, changes })
  return delay(g)
}

export async function deleteGoal(user: User, deptId: string, goalId: string): Promise<{ id: string }> {
  const d = await guardGoals(user, deptId)
  const i = d.goals.findIndex((x) => x.id === goalId)
  if (i < 0) return fail('That goal doesn’t exist.', 404)
  const [g] = d.goals.splice(i, 1)
  recordAudit(user, { action: 'delete', entity: 'department-goal', entityId: g.id, summary: `Removed goal “${g.title}” from ${d.name}` })
  return delay({ id: g.id })
}
