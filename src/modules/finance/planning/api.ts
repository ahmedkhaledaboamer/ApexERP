import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeBudgetsMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import type { BudgetCreateInput, BudgetLineInput, CopyActualsInput, ForecastLineInput, ForecastSettingsInput } from './types'

/** Accounts & finance › Budgets and Cash-flow forecast (docs/API.md › Finance › Budgets, Cash-flow forecast). */

const enc = encodeURIComponent
const F = '/finance'
const plain = (x: object) => m.planningPlainMapper.toApi(x as Record<string, unknown>)

export const planningApi = {
  budgets: async () => m.budgetRowMapper.fromApiList((await http.get<unknown>(`${F}/budgets`)).data),
  budget: async (id: string) => m.budgetMapper.fromApi((await http.get<unknown>(`${F}/budgets/${enc(id)}`)).data),
  create: async (input: BudgetCreateInput) => m.budgetMapper.fromApi((await http.post<unknown>(`${F}/budgets`, plain(input))).data),
  remove: async (id: string) => (await http.delete<unknown>(`${F}/budgets/${enc(id)}`)).data,
  putLines: async (id: string, lines: BudgetLineInput[]) => m.budgetMapper.fromApi((await http.put<unknown>(`${F}/budgets/${enc(id)}/lines`, plain({ lines }))).data),
  copyActuals: async (id: string, input: CopyActualsInput) => m.budgetMapper.fromApi((await http.post<unknown>(`${F}/budgets/${enc(id)}/copy-actuals`, plain(input))).data),
  approve: async (id: string) => m.budgetMapper.fromApi((await http.post<unknown>(`${F}/budgets/${enc(id)}/approve`)).data),
  reopen: async (id: string) => m.budgetMapper.fromApi((await http.post<unknown>(`${F}/budgets/${enc(id)}/reopen`)).data),
  vsActual: async (id: string, departmentId?: string | null, month?: string | null) => {
    const p = new URLSearchParams()
    if (departmentId) p.set('department_id', departmentId)
    if (month) p.set('month', month)
    const s = p.toString()
    return m.budgetVsActualMapper.fromApi((await http.get<unknown>(`${F}/budgets/${enc(id)}/vs-actual${s ? `?${s}` : ''}`)).data)
  },
  forecast: async () => m.cashForecastMapper.fromApi((await http.get<unknown>(`${F}/forecast`)).data),
  forecastSettings: async (input: ForecastSettingsInput) => m.cashForecastMapper.fromApi((await http.put<unknown>(`${F}/forecast/settings`, plain(input))).data),
  addLine: async (input: ForecastLineInput) => m.cashForecastMapper.fromApi((await http.post<unknown>(`${F}/forecast/lines`, plain(input))).data),
  removeLine: async (id: string) => m.cashForecastMapper.fromApi((await http.delete<unknown>(`${F}/forecast/lines/${enc(id)}`)).data),
}

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | object | undefined | null)[]) => ['finance', 'planning', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('accounting')
}

export function useBudgets(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('budgets'), queryFn: planningApi.budgets, enabled: useOn(enabled), retry: false })
}
export function useBudget(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('budget', id ?? ''), queryFn: () => planningApi.budget(id!), enabled: useOn(!!id), retry: false })
}
export function useBudgetVsActual(id: string | null, departmentId: string | null, month: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('bva', id ?? '', departmentId ?? '', month ?? ''), queryFn: () => planningApi.vsActual(id!, departmentId, month), enabled: useOn(!!id), retry: false })
}
export function useForecast(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('forecast'), queryFn: planningApi.forecast, enabled: useOn(enabled), retry: false })
}
export function usePlanningMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
