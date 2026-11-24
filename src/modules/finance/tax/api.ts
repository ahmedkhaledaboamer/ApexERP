import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeTaxMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import type { FileVatReturnInput, PayVatReturnInput, ProvisionInput, TaxAdjustmentsInput, VatFrequency } from './types'

/** Accounts & finance › Tax (docs/API.md › Finance › VAT returns, Corporate tax & zakat). */

const enc = encodeURIComponent
const F = '/finance'

export const taxApi = {
  settings: async () => m.taxSettingsMapper.fromApi((await http.get<unknown>(`${F}/tax/settings`)).data),
  updateSettings: async (vatFrequency: VatFrequency) => m.taxSettingsMapper.fromApi((await http.patch<unknown>(`${F}/tax/settings`, { vat_frequency: vatFrequency })).data),
  returns: async () => m.vatReturnRowMapper.fromApiList((await http.get<unknown>(`${F}/vat-returns`)).data),
  vatReturn: async (id: string) => m.vatReturnMapper.fromApi((await http.get<unknown>(`${F}/vat-returns/${enc(id)}`)).data),
  boxItems: async (id: string, box: string) => m.vatBoxItemsMapper.fromApi((await http.get<unknown>(`${F}/vat-returns/${enc(id)}/boxes/${enc(box)}`)).data),
  file: async (id: string, input: FileVatReturnInput) => m.vatReturnMapper.fromApi((await http.post<unknown>(`${F}/vat-returns/${enc(id)}/file`, m.taxPlainMapper.toApi(input as unknown as Record<string, unknown>))).data),
  pay: async (id: string, input: PayVatReturnInput) => m.vatReturnMapper.fromApi((await http.post<unknown>(`${F}/vat-returns/${enc(id)}/pay`, m.taxPlainMapper.toApi(input as unknown as Record<string, unknown>))).data),
  corporateTax: async (year?: number) => m.corporateTaxMapper.fromApi((await http.get<unknown>(`${F}/tax/corporate-tax${year ? `?year=${year}` : ''}`)).data),
  zakat: async (year?: number) => m.zakatMapper.fromApi((await http.get<unknown>(`${F}/tax/zakat${year ? `?year=${year}` : ''}`)).data),
  adjustments: async (input: TaxAdjustmentsInput) => m.taxEstimateMapper.fromApi((await http.put<unknown>(`${F}/tax/adjustments`, m.taxPlainMapper.toApi(input as unknown as Record<string, unknown>))).data),
  provision: async (input: ProvisionInput) => m.provisionResultMapper.fromApi((await http.post<unknown>(`${F}/tax/provisions`, m.taxPlainMapper.toApi(input as unknown as Record<string, unknown>))).data),
}

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | object | undefined)[]) => ['finance', 'tax', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('accounting')
}

export function useTaxSettings() {
  const key = useKey()
  return useQuery({ queryKey: key('settings'), queryFn: taxApi.settings, enabled: useOn(), retry: false })
}
export function useVatReturns() {
  const key = useKey()
  return useQuery({ queryKey: key('returns'), queryFn: taxApi.returns, enabled: useOn(), retry: false })
}
export function useVatReturn(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('return', id ?? ''), queryFn: () => taxApi.vatReturn(id!), enabled: useOn(!!id), retry: false })
}
export function useVatBoxItems(id: string | null, box: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('box', id ?? '', box ?? ''), queryFn: () => taxApi.boxItems(id!, box!), enabled: useOn(!!id && !!box), retry: false })
}
export function useCorporateTax(year: number | undefined, enabled: boolean) {
  const key = useKey()
  return useQuery({ queryKey: key('ct', year ?? 0), queryFn: () => taxApi.corporateTax(year), enabled: useOn(enabled), retry: false })
}
export function useZakat(year: number | undefined, enabled: boolean) {
  const key = useKey()
  return useQuery({ queryKey: key('zakat', year ?? 0), queryFn: () => taxApi.zakat(year), enabled: useOn(enabled), retry: false })
}
export function useTaxMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance'] })
    },
  })
}
