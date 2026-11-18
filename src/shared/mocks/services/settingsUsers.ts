import type { Role, User } from '@/shared/types'
import type { Department, SettingsUserRow, UserInput, UserUpdateInput } from '@/modules/settings/users/types'
import { ApiError } from '@/shared/lib/apiError'
import { can } from '@/shared/lib/permissions'
import { ROLES } from '@/shared/lib/constants'
import { formatMobile, mobileError, normalizeMobile } from '@/shared/lib/phone'
import { leads, users } from '@/shared/mocks/db'
import { departments, departmentsOf } from '@/shared/mocks/data/departments'
import { statusOf } from '@/shared/mocks/data/lookups'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'
import { addMembership, companyById, syncMembership } from '@/shared/mocks/data/tenancy'
import { CodedApiError, getInTenant, scoped, tenantOf } from '@/shared/mocks/tenant'
import { assertCapacity, noteUsage } from '@/shared/mocks/services/billing'
import { EMAIL_IN_OTHER_COMPANY, userWithEmail } from '@/shared/mocks/data/identity'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Thrown when deactivation needs `{ confirm: true }`; the handler adds `openLeads` to the 409 body. */
export class ConfirmRequiredError extends ApiError {
  constructor(
    message: string,
    public openLeads: number,
  ) {
    super(message, 409)
  }
}

/** Leads still in play (open or parked as Cold): not won or lost. Statuses are the user's company's. */
function openLeadsOf(u: User): number {
  return leads.filter((l) => {
    if (l.ownerId !== u.id) return false
    const kind = statusOf(u.companyId, l.status)?.kind ?? 'open'
    return kind === 'open' || kind === 'parked'
  }).length
}

function toRow(u: User): SettingsUserRow {
  return {
    ...u,
    departmentName: departments.find((d) => d.id === u.departmentId)?.name ?? '—',
    managerName: u.managerId ? (users.find((m) => m.id === u.managerId)?.name ?? '') : '',
    directReports: users.filter((r) => r.managerId === u.id && r.active).length,
    openLeads: openLeadsOf(u),
  }
}

/** Readable snapshot for audit diffs (names instead of ids). */
function auditView(u: User) {
  return {
    name: u.name,
    email: u.email,
    mobile: u.mobile,
    role: u.role,
    title: u.title,
    departmentId: departments.find((d) => d.id === u.departmentId)?.name ?? u.departmentId,
    managerId: u.managerId ? (users.find((m) => m.id === u.managerId)?.name ?? u.managerId) : null,
    active: u.active,
  }
}

/** Active Company Admins of one company (the "last admin" rule is per company). */
function activeAdmins(companyId: string): User[] {
  return users.filter((u) => u.companyId === companyId && u.active && u.role === 'Company Admin')
}

/** People of the admin's company only. */
const companyUsers = (user: User): User[] => scoped(users, user)

async function requireView(user: User) {
  if (!can(user.role, 'settings', 'view')) await fail('Users & roles are for admins.', 403)
}
async function requireEdit(user: User) {
  if (!can(user.role, 'settings', 'edit')) await fail('Only a Company Admin can change users.', 403)
}

export async function getSettingsUsers(user: User): Promise<SettingsUserRow[]> {
  await requireView(user)
  return delay(companyUsers(user).map(toRow))
}

export async function getDepartments(user: User): Promise<Department[]> {
  return delay(departmentsOf(tenantOf(user)).map(({ companyId: _co, ...d }) => d))
}

/** Validates the fields present in `input` within the admin's company; returns the cleaned values or an error message. */
function clean(user: User, input: UserUpdateInput, target: User | null): Partial<User> | string {
  const out: Partial<User> = {}
  const people = companyUsers(user)
  const country = companyById(tenantOf(user))!.regional.country
  if (input.name !== undefined) {
    const name = String(input.name).trim().replace(/\s+/g, ' ')
    if (name.length < 2) return 'Enter the person’s full name.'
    if (name.length > 80) return 'Name is too long (80 characters max).'
    out.name = name
  }
  if (input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase()
    if (!EMAIL.test(email)) return 'That doesn’t look like an email address.'
    // One email = one company, platform-wide. Inside the company the message can name the clash;
    // outside it must not reveal which company holds the address.
    const owner = userWithEmail(email, target?.id)
    if (owner && people.some((u) => u.id === owner.id)) return `${email} already belongs to another user.`
    if (owner) throw new CodedApiError(EMAIL_IN_OTHER_COMPANY, 409, 'email_taken')
    out.email = email
  }
  if (input.mobile !== undefined) {
    const raw = String(input.mobile).trim()
    const normalized = normalizeMobile(raw, country)
    if (!normalized) return mobileError(country)
    out.mobile = formatMobile(normalized, country)
  }
  if (input.role !== undefined) {
    if (!ROLES.includes(input.role as Role)) return 'Pick one of the listed roles.'
    out.role = input.role
  }
  if (input.title !== undefined) {
    const title = String(input.title).trim()
    if (title.length > 80) return 'Job title is too long (80 characters max).'
    out.title = title
  }
  if (input.departmentId !== undefined) {
    const companyDepts = departmentsOf(tenantOf(user))
    const dept = companyDepts.find((d) => d.id === input.departmentId)
    if (!dept) return 'Pick a department.'
    if (!dept.active && dept.id !== target?.departmentId) return `${dept.name} is inactive; pick an active department.`
    // A head must be a member of the department they head (Departments module rule).
    if (target && target.departmentId !== dept.id) {
      const headed = companyDepts.find((d) => d.headId === target.id && d.active)
      if (headed) return `${target.name} heads ${headed.name}. Pick a new head for ${headed.name} first (Departments).`
    }
    out.departmentId = input.departmentId
  }
  if (input.managerId !== undefined) {
    const managerId = input.managerId || null
    if (managerId) {
      const manager = people.find((u) => u.id === managerId)
      if (!manager) return 'That manager doesn’t exist.'
      if (target && manager.id === target.id) return 'A person can’t be their own manager.'
      if (!manager.active) return `${manager.name} is deactivated; pick an active manager.`
      // Walk up from the new manager: reaching the target means a reporting cycle.
      if (target) {
        const seen = new Set<string>()
        let cur: User | undefined = manager
        while (cur?.managerId && !seen.has(cur.id)) {
          seen.add(cur.id)
          if (cur.managerId === target.id) return `${manager.name} already reports to ${target.name}, so this would create a loop.`
          cur = people.find((u) => u.id === cur!.managerId)
        }
      }
    }
    out.managerId = managerId
  }
  return out
}

export async function createUser(user: User, input: UserInput): Promise<SettingsUserRow> {
  await requireEdit(user)
  for (const k of ['name', 'email', 'mobile', 'role', 'departmentId'] as const) {
    if (!input?.[k]) return fail('Name, email, mobile, role and department are required.', 422)
  }
  const values = clean(user, { ...input, title: input.title ?? '', managerId: input.managerId ?? null }, null)
  if (typeof values === 'string') return fail(values, 422)
  assertCapacity(tenantOf(user), 'users')
  const next = Math.max(0, ...users.map((u) => Number(u.id.replace(/\D/g, '')) || 0)) + 1
  const created: User = {
    id: `u${next}`,
    companyId: tenantOf(user),
    name: values.name!,
    email: values.email!,
    mobile: values.mobile!,
    role: values.role!,
    title: values.title ?? '',
    departmentId: values.departmentId!,
    managerId: values.managerId ?? null,
    active: true,
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  }
  users.push(created)
  addMembership(created.id, created.companyId, created.role)
  noteUsage(created.companyId)
  recordAudit(user, {
    action: 'create',
    entity: 'user',
    entityId: created.id,
    summary: `Added user ${created.name} (${created.role})`,
    changes: diff({}, auditView(created)).filter((c) => c.to !== '—' && c.field !== 'active'),
  })
  return delay(toRow(created))
}

export async function updateUser(user: User, id: string, input: UserUpdateInput): Promise<SettingsUserRow> {
  await requireEdit(user)
  const target = getInTenant(users, user, id, 'User not found.')
  const values = clean(user, input ?? {}, target)
  if (typeof values === 'string') return fail(values, 422)
  if (values.role && values.role !== target.role) {
    if (target.id === user.id) return fail('You can’t change your own role. Ask another Company Admin.', 422)
    if (target.role === 'Company Admin' && target.active && activeAdmins(target.companyId).length <= 1) {
      return fail(`${target.name} is the last active Company Admin. Make someone else an admin first.`, 422)
    }
  }
  const before = auditView(target)
  Object.assign(target, values)
  // The membership is the source of truth for the role (handlers/utils userFrom).
  if (values.role) syncMembership(target.id, { role: values.role })
  const changes = diff(before, auditView(target))
  if (changes.length) {
    recordAudit(user, {
      action: 'update',
      entity: 'user',
      entityId: target.id,
      summary: `Updated ${target.name}: ${changes.map((c) => FIELD_LABEL[c.field] ?? c.field).join(', ')}`,
      changes,
    })
  }
  return delay(toRow(target))
}

const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  email: 'email',
  mobile: 'mobile',
  role: 'role',
  title: 'job title',
  departmentId: 'department',
  managerId: 'direct manager',
  active: 'status',
}

export async function deactivateUser(user: User, id: string, confirm: boolean): Promise<SettingsUserRow> {
  await requireEdit(user)
  const target = getInTenant(users, user, id, 'User not found.')
  if (!target.active) return fail(`${target.name} is already deactivated.`, 422)
  if (target.id === user.id) return fail('You can’t deactivate your own account.', 422)
  if (target.role === 'Company Admin' && activeAdmins(target.companyId).length <= 1) {
    return fail(`${target.name} is the last active Company Admin.`, 422)
  }
  const open = openLeadsOf(target)
  if (open > 0 && !confirm) {
    await delay(null)
    throw new ConfirmRequiredError(
      `${target.name} owns ${open} open lead${open === 1 ? '' : 's'}. They stay assigned; reassign them from Leads if needed.`,
      open,
    )
  }
  target.active = false
  syncMembership(target.id, { status: 'suspended' })
  recordAudit(user, {
    action: 'deactivate',
    entity: 'user',
    entityId: target.id,
    summary: `Deactivated ${target.name}${open ? ` (${open} open lead${open === 1 ? '' : 's'} stay assigned)` : ''}`,
    changes: [{ field: 'active', from: 'Active', to: 'Deactivated' }],
  })
  return delay(toRow(target))
}

export async function reactivateUser(user: User, id: string): Promise<SettingsUserRow> {
  await requireEdit(user)
  const target = getInTenant(users, user, id, 'User not found.')
  if (target.active) return fail(`${target.name} is already active.`, 422)
  assertCapacity(target.companyId, 'users')
  target.active = true
  syncMembership(target.id, { status: 'active' })
  recordAudit(user, {
    action: 'reactivate',
    entity: 'user',
    entityId: target.id,
    summary: `Reactivated ${target.name}`,
    changes: [{ field: 'active', from: 'Deactivated', to: 'Active' }],
  })
  return delay(toRow(target))
}
