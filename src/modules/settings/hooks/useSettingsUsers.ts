import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createUser,
  deactivateUser,
  getDepartments,
  getSettingsUsers,
  reactivateUser,
  updateUser,
} from '@/modules/settings/api/usersApi'
import type { UserInput, UserUpdateInput } from '@/modules/settings/users/types'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

export const settingsUserKeys = {
  all: ['settings-users'] as const,
  list: (viewerId: string) => ['settings-users', 'list', viewerId] as const,
  departments: ['settings-users', 'departments'] as const,
}

export function useSettingsUsersQuery() {
  const user = useCurrentUser()
  return useQuery({
    queryKey: settingsUserKeys.list(user?.id ?? ''),
    queryFn: getSettingsUsers,
    enabled: !!user && can(user.role, 'settings', 'view'),
  })
}

export function useDepartmentsQuery() {
  return useQuery({ queryKey: settingsUserKeys.departments, queryFn: getDepartments, staleTime: 10 * 60_000 })
}

/**
 * After any user write: the list, the audit log, every other screen's user list (owner pickers),
 * and department membership (it is the user's department field). A department move also changes
 * who is in a head's Team scope, so team-scoped leads and reports refresh too.
 */
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    for (const queryKey of [settingsUserKeys.all, ['audit'], ['users'], ['departments'], ['leads'], ['reports'], ['onboarding']]) {
      void qc.invalidateQueries({ queryKey })
    }
  }
}

export function useCreateUser() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: UserInput) => createUser(input), onSuccess: invalidate })
}

export function useUpdateUser() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) => updateUser(id, input),
    onSuccess: invalidate,
  })
}

export function useDeactivateUser() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) => deactivateUser(id, confirm),
    onSuccess: (res) => {
      if (res.status === 'deactivated') invalidate()
    },
  })
}

export function useReactivateUser() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => reactivateUser(id), onSuccess: invalidate })
}
