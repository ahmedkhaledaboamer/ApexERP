import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTargetDefaults, getTargets, resetTargets, saveTargetDefaults, updateTargets } from '@/modules/targets/api/targetsApi'
import { targetKeys } from '@/modules/targets/queryKeys'
import type { TargetValues } from '@/modules/targets/types'
import { dashboardKeys } from '@/modules/dashboard/queryKeys'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

function useUserOrThrow() {
  const user = useCurrentUser()
  if (!user) throw new Error('Target hooks need a signed-in user.')
  return user
}

/** Targets and computed actuals for every agent in the caller's scope, for one month (`yyyy-MM`). */
export function useTargetsQuery(month: string) {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: targetKeys.month(user.id, month),
    queryFn: () => getTargets(month),
    enabled: scopeOf(user.role, 'sales') !== 'hidden',
    // Keep the previous month on screen while the next one loads.
    placeholderData: keepPreviousData,
    // Actuals move as activities are logged elsewhere.
    staleTime: 0,
  })
}

/** Targets feed the dashboard and reports too, so every change refreshes them. */
function useInvalidateTargets() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: targetKeys.all })
    qc.invalidateQueries({ queryKey: dashboardKeys.all })
    qc.invalidateQueries({ queryKey: ['reports'] })
    qc.invalidateQueries({ queryKey: ['audit'] })
  }
}

export function useUpdateTargets(month: string) {
  const invalidate = useInvalidateTargets()
  return useMutation({
    mutationFn: ({ userId, values }: { userId: string; values: TargetValues }) => updateTargets(userId, month, { values }),
    onSuccess: invalidate,
  })
}

/** Drops an agent's targets for the month; the company defaults apply again. */
export function useResetTargets(month: string) {
  const invalidate = useInvalidateTargets()
  return useMutation({
    mutationFn: (userId: string) => resetTargets(userId, month),
    onSuccess: invalidate,
  })
}

/** Company default targets (Settings > Targets). */
export function useTargetDefaults() {
  return useQuery({ queryKey: targetKeys.defaults, queryFn: getTargetDefaults, staleTime: 60_000 })
}

export function useSaveTargetDefaults() {
  const qc = useQueryClient()
  const invalidate = useInvalidateTargets()
  return useMutation({
    mutationFn: (values: TargetValues) => saveTargetDefaults(values),
    onSuccess: (data) => {
      qc.setQueryData(targetKeys.defaults, data)
      invalidate()
    },
  })
}
