import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeCommissionsMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import type { CommissionPlanInput } from './types'

/** Accounts & finance › Sales commissions (docs/API.md › Finance › Commissions). */

const enc = encodeURIComponent
const F = '/finance'

export const commissionsApi = {
  plans: async () => m.commissionPlanMapper.fromApiList((await http.get<unknown>(`${F}/commission-plans`)).data),
  createPlan: async (input: CommissionPlanInput) => m.commissionPlanMapper.fromApi((await http.post<unknown>(`${F}/commission-plans`, m.commissionPlanInputMapper.toApi(input))).data),
  updatePlan: async (id: string, input: CommissionPlanInput) => m.commissionPlanMapper.fromApi((await http.patch<unknown>(`${F}/commission-plans/${enc(id)}`, m.commissionPlanInputMapper.toApi(input))).data),
  statements: async (month?: string) => m.commissionStatementMapper.fromApiList((await http.get<unknown>(`${F}/commission-statements${month ? `?month=${enc(month)}` : ''}`)).data),
  statement: async (id: string) => m.commissionStatementMapper.fromApi((await http.get<unknown>(`${F}/commission-statements/${enc(id)}`)).data),
  generate: async (month: string) => m.commissionStatementMapper.fromApiList((await http.post<unknown>(`${F}/commission-statements/generate`, { month })).data),
  approve: async (id: string) => m.commissionStatementMapper.fromApi((await http.post<unknown>(`${F}/commission-statements/${enc(id)}/approve`)).data),
  reject: async (id: string, reason: string) => m.commissionStatementMapper.fromApi((await http.post<unknown>(`${F}/commission-statements/${enc(id)}/reject`, { reason })).data),
  mine: async () => m.myCommissionsMapper.fromApi((await http.get<unknown>(`${F}/commissions/mine`)).data),
}

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | object | undefined)[]) => ['finance', 'commissions', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('accounting')
}

export function usePlans(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('plans'), queryFn: commissionsApi.plans, enabled: useOn(enabled), retry: false })
}
export function useStatements(month?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('statements', month ?? ''), queryFn: () => commissionsApi.statements(month), enabled: useOn(), retry: false })
}
export function useStatement(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('statement', id ?? ''), queryFn: () => commissionsApi.statement(id!), enabled: useOn(!!id), retry: false })
}
export function useMyCommissions() {
  const key = useKey()
  return useQuery({ queryKey: key('mine'), queryFn: commissionsApi.mine, enabled: useOn(), retry: false })
}
export function useCommissionsMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
