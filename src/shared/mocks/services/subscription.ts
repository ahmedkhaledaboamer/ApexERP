import type { User } from '@/shared/types'
import type { CompanyRoleDefinition } from '@/modules/signup/types'
import { canViewCompanyProfile } from '@/shared/lib/permissions'
import { rolesFor } from '@/shared/mocks/data/roles'
import { delay, fail } from '@/shared/mocks/server'
import { tenantOf } from '@/shared/mocks/tenant'

/** GET /settings/roles: the company's roles and their permissions (read-only). Company Admin and Management. */
export async function getRoles(user: User): Promise<CompanyRoleDefinition[]> {
  if (!canViewCompanyProfile(user.role)) return fail('Only admins can see roles.', 403)
  return delay(rolesFor(tenantOf(user)))
}
