import { useQuery } from '@tanstack/react-query'
import { getAuditLog, type AuditFilter } from '@/modules/settings/api/settingsApi'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

export const auditKeys = {
  all: ['audit'] as const,
  list: (filter: AuditFilter) => ['audit', 'list', filter] as const,
}

/** Audit entries, newest first. Date range is filtered on the server; facets run in the table. */
export function useAuditLogQuery(filter: AuditFilter) {
  const user = useCurrentUser()
  return useQuery({
    queryKey: auditKeys.list(filter),
    queryFn: () => getAuditLog(filter),
    enabled: !!user && can(user.role, 'settings', 'view'),
    staleTime: 0,
    placeholderData: (prev) => prev,
  })
}
