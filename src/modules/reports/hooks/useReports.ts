import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { reportKeys } from '@/modules/reports/queryKeys'
import { createSchedule, deleteSchedule, getSalesReport, getSchedules, runCustomReport } from '@/modules/reports/api/reportsApi'
import type { CustomReportInput, ReportSchedule, SalesReportQuery, ScheduleInput } from '@/modules/reports/types'
import { useCurrentUser } from '@/store/hooks'

function useUserId(): string {
  const user = useCurrentUser()
  if (!user) throw new Error('Report hooks need a signed-in user.')
  return user.id
}

export function useSalesReport(q: SalesReportQuery) {
  const userId = useUserId()
  return useQuery({
    queryKey: reportKeys.sales(userId, q),
    queryFn: () => getSalesReport(q),
    // Keep the old figures on screen while a new range loads.
    placeholderData: keepPreviousData,
  })
}

export function useCustomReport(input: CustomReportInput | null) {
  const userId = useUserId()
  return useQuery({
    queryKey: input ? reportKeys.custom(userId, input) : ['reports', 'custom', userId, 'idle'],
    queryFn: () => runCustomReport(input as CustomReportInput),
    enabled: !!input,
    placeholderData: keepPreviousData,
  })
}

export function useSchedules(enabled = true) {
  const userId = useUserId()
  return useQuery({ queryKey: reportKeys.schedules(userId), queryFn: getSchedules, enabled })
}

export function useCreateSchedule() {
  const userId = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ScheduleInput) => createSchedule(input),
    onSuccess: (created) => {
      qc.setQueryData<ReportSchedule[]>(reportKeys.schedules(userId), (old) =>
        [...(old ?? []), created].sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt)),
      )
    },
  })
}

export function useDeleteSchedule() {
  const userId = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: ({ id }) => {
      qc.setQueryData<ReportSchedule[]>(reportKeys.schedules(userId), (old) => (old ?? []).filter((s) => s.id !== id))
    },
  })
}
