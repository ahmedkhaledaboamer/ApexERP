import { useMemo } from 'react'
import type { User } from '@/shared/types'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useDepartmentsQuery } from '@/modules/departments/hooks/useDepartments'
import { can, scopeOf, teamIdsFor, type DepartmentLink } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/**
 * People the signed-in user may assign CRM records to: everyone who sells (full scope),
 * their team (team scope: direct reports plus members of the departments they head and their
 * sub-departments), or only themselves (own scope). Mirrors the server rules.
 */
export function useOwnerOptions(): { options: User[]; canReassign: boolean; loading: boolean } {
  const user = useCurrentUser()
  const users = useUsersQuery()
  const departments = useDepartmentsQuery(true)
  const team = !!user && scopeOf(user.role, 'sales') === 'team'
  return useMemo(() => {
    if (!user) return { options: [], canReassign: false, loading: false }
    const scope = scopeOf(user.role, 'sales')
    const all = users.data ?? []
    const sellers = all.filter((u) => can(u.role, 'sales', 'edit'))
    // The departments API is scoped: a team-scope viewer gets the departments they head (and below).
    const links: DepartmentLink[] = (departments.data ?? []).map((d) => ({ id: d.id, headId: d.headId, parentId: d.parentId, active: d.active }))
    const teamIds = scope === 'team' ? new Set(teamIdsFor(user, all, links)) : null
    const options =
      scope === 'full' ? sellers : teamIds ? sellers.filter((u) => teamIds.has(u.id)) : all.filter((u) => u.id === user.id)
    return {
      options,
      canReassign: scope === 'full' || scope === 'team',
      loading: users.isPending || (team && departments.isPending),
    }
  }, [user, users.data, users.isPending, departments.data, departments.isPending, team])
}
