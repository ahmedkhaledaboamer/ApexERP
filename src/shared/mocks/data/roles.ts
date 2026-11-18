import type { ModuleKey, Role, Scope } from '@/shared/types'
import type { CompanyRoleDefinition } from '@/modules/signup/types'
import { PERMISSION_MATRIX } from '@/shared/lib/permissions'
import { perTenant } from '@/shared/mocks/tenant'

/**
 * Company roles, one set per company: the 9 default roles with a snapshot of the product
 * permission matrix taken when the company is created. Read-only for now (GET /settings/roles);
 * access checks still use PERMISSION_MATRIX, which these rows equal.
 */
export function defaultRoles(): CompanyRoleDefinition[] {
  return (Object.keys(PERMISSION_MATRIX) as Role[]).map((role) => ({
    id: role,
    name: role,
    system: true,
    permissions: { ...PERMISSION_MATRIX[role] } as Record<ModuleKey, Scope>,
  }))
}

const store = perTenant<CompanyRoleDefinition[]>(() => defaultRoles(), 'roles')

export function rolesFor(companyId: string): CompanyRoleDefinition[] {
  return store.get(companyId)
}
