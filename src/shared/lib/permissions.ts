import type { Action, ModuleKey, Role, Scope, User } from '@/shared/types'

/**
 * Permission matrix from the spec, section 3. Reports carry a report-family scope.
 * Tasks: Own for Sales Agent and Employee (and Accountant, HR), Team for Sales Manager, Department Head
 * and Marketing Manager (real department membership), Full for Company Admin and Management.
 * Departments (not in the spec table): Company Admin, Management and HR Manager full; heads and
 * managers "team" (the departments they head plus their sub-departments); everyone else "view"
 * = read-only access to their own department.
 */
export const PERMISSION_MATRIX: Record<Role, Record<ModuleKey, Scope>> = {
  'Company Admin': { sales: 'full', services: 'full', marketing: 'full', accounting: 'full', hr: 'full', reports: 'full', settings: 'full', departments: 'full', tasks: 'full' },
  Management: { sales: 'full', services: 'full', marketing: 'full', accounting: 'full', hr: 'full', reports: 'full', settings: 'view', departments: 'full', tasks: 'full' },
  'Sales Manager': { sales: 'full', services: 'full', marketing: 'view', accounting: 'view', hr: 'hidden', reports: 'team', settings: 'hidden', departments: 'team', tasks: 'team' },
  'Sales Agent': { sales: 'own', services: 'view', marketing: 'hidden', accounting: 'hidden', hr: 'hidden', reports: 'own', settings: 'hidden', departments: 'view', tasks: 'own' },
  'Marketing Manager': { sales: 'view', services: 'view', marketing: 'full', accounting: 'hidden', hr: 'hidden', reports: 'marketing', settings: 'hidden', departments: 'team', tasks: 'team' },
  Accountant: { sales: 'view', services: 'view', marketing: 'hidden', accounting: 'full', hr: 'hidden', reports: 'finance', settings: 'hidden', departments: 'view', tasks: 'own' },
  'HR Manager': { sales: 'hidden', services: 'hidden', marketing: 'hidden', accounting: 'hidden', hr: 'full', reports: 'hr', settings: 'hidden', departments: 'full', tasks: 'own' },
  'Department Head': { sales: 'team', services: 'view', marketing: 'hidden', accounting: 'hidden', hr: 'team', reports: 'team', settings: 'hidden', departments: 'team', tasks: 'team' },
  Employee: { sales: 'own', services: 'hidden', marketing: 'hidden', accounting: 'hidden', hr: 'own', reports: 'hidden', settings: 'hidden', departments: 'view', tasks: 'own' },
}

export const SCOPE_LABELS: Record<Scope, string> = {
  full: 'All records',
  team: 'My team',
  own: 'My records',
  view: 'Read only',
  hidden: 'No access',
  marketing: 'Marketing',
  finance: 'Finance',
  hr: 'HR',
}

export function scopeOf(role: Role, module: ModuleKey): Scope {
  return PERMISSION_MATRIX[role][module]
}

/** Can a role perform an action on a module at all, ignoring record ownership? */
export function can(role: Role, module: ModuleKey, action: Action): boolean {
  const scope = scopeOf(role, module)
  if (scope === 'hidden') return false
  if (action === 'view') return true
  return scope !== 'view'
}

/**
 * Settings > Company profile and the onboarding checklist follow the Settings column of the
 * matrix: whoever can view Settings (Company Admin, Management) reads them; only roles that can
 * edit Settings (Company Admin) change the profile. Everyone else gets 403.
 */
export function canViewCompanyProfile(role: Role): boolean {
  return can(role, 'settings', 'view')
}
export function canEditCompanyProfile(role: Role): boolean {
  return can(role, 'settings', 'edit')
}

/** The part of a department the team rule needs (Departments module). */
export interface DepartmentLink {
  id: string
  headId: string | null
  parentId: string | null
  active: boolean
}

/** A department plus all its (active) sub-departments, recursively. */
export function departmentSubtree(rootId: string, departments: DepartmentLink[]): string[] {
  const out = new Set<string>([rootId])
  let added = true
  while (added) {
    added = false
    for (const d of departments) {
      if (d.active && d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id)
        added = true
      }
    }
  }
  return [...out]
}

/**
 * "My team" (Team scope): me, everyone who reports to me, and every member of the departments
 * I head and their sub-departments. Without `departments` it falls back to direct reports only.
 */
export function teamIdsFor(user: User, users: User[], departments: DepartmentLink[] = []): string[] {
  const ids = new Set<string>([user.id, ...users.filter((u) => u.managerId === user.id).map((u) => u.id)])
  const headed = departments.filter((d) => d.active && d.headId === user.id)
  const deptIds = new Set(headed.flatMap((d) => departmentSubtree(d.id, departments)))
  for (const u of users) if (u.departmentId && deptIds.has(u.departmentId)) ids.add(u.id)
  return [...ids]
}

/** Is a record owned by `ownerId` visible to `user` under the given scope? */
export function inScope(scope: Scope, user: User, ownerId: string, teamIds: string[]): boolean {
  if (scope === 'hidden') return false
  if (scope === 'own') return ownerId === user.id
  if (scope === 'team') return teamIds.includes(ownerId)
  return true
}
