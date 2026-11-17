import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/departments/api/departmentsApi'
import type { DepartmentInput, DepartmentUpdateInput, GoalInput, MoveMembersInput } from '@/modules/departments/types'

export const departmentKeys = {
  all: ['departments'] as const,
  list: (includeInactive: boolean) => ['departments', 'list', includeInactive] as const,
  orgChart: () => ['departments', 'org-chart'] as const,
  detail: (id: string) => ['departments', 'detail', id] as const,
}

export function useDepartmentsQuery(includeInactive = false) {
  return useQuery({ queryKey: departmentKeys.list(includeInactive), queryFn: () => api.getDepartments(includeInactive) })
}

export function useOrgChartQuery() {
  return useQuery({ queryKey: departmentKeys.orgChart(), queryFn: api.getOrgChart })
}

export function useDepartmentQuery(id: string) {
  return useQuery({ queryKey: departmentKeys.detail(id), queryFn: () => api.getDepartment(id), enabled: !!id })
}

/**
 * Department changes ripple: membership is the user's department (Settings › Users), and the
 * Team scope of leads, reports, targets and alerts follows it.
 */
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    for (const key of [['departments'], ['audit'], ['settings-users'], ['users'], ['leads'], ['reports'], ['targets'], ['alerts'], ['dashboard']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}

export function useCreateDepartment() {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: DepartmentInput) => api.createDepartment(input), onSuccess: done })
}

export function useUpdateDepartment() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DepartmentUpdateInput }) => api.updateDepartment(id, input),
    onSuccess: done,
  })
}

export function useSetDepartmentActive() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setDepartmentActive(id, active),
    onSuccess: done,
  })
}

export function useMoveMembers() {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: MoveMembersInput) => api.moveMembers(input), onSuccess: done })
}

export function useSetMemberManager(deptId: string) {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ userId, managerId }: { userId: string; managerId: string | null }) => api.setMemberManager(deptId, userId, managerId),
    onSuccess: done,
  })
}

export function useAddGoal(deptId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GoalInput) => api.addGoal(deptId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: departmentKeys.all })
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}

export function useUpdateGoal(deptId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: string; input: Partial<GoalInput> }) => api.updateGoal(deptId, goalId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: departmentKeys.all })
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}

export function useDeleteGoal(deptId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (goalId: string) => api.deleteGoal(deptId, goalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: departmentKeys.all })
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
