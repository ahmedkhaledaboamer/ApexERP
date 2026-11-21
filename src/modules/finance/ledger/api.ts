import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeLedgerMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type { AccountInput, ExchangeRateInput, FinanceSettingsInput, JournalFilters, ManualJournalInput, OpeningBalanceInput } from './types'

/** Accounts & finance › ledger core and setup (docs/API.md › Finance › Ledger & settings). snake_case on the wire via financeLedgerMappers. */

const enc = encodeURIComponent
const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v))
  const t = s.toString()
  return t ? `?${t}` : ''
}
const F = '/finance'

export const ledgerApi = {
  settings: async () => m.finSettingsMapper.fromApi((await http.get<unknown>(`${F}/settings`)).data),
  saveSettings: async (input: FinanceSettingsInput) => m.finSettingsMapper.fromApi((await http.patch<unknown>(`${F}/settings`, m.finSettingsInputMapper.toApi(input))).data),
  setLockDate: async (lockDate: string | null, reason: string) => m.finSettingsMapper.fromApi((await http.put<unknown>(`${F}/settings/lock-date`, { lock_date: lockDate, reason })).data),
  addRate: async (input: ExchangeRateInput) => m.finSettingsMapper.fromApi((await http.post<unknown>(`${F}/exchange-rates`, m.finRateInputMapper.toApi(input))).data),
  deleteRate: async (id: string) => m.finSettingsMapper.fromApi((await http.delete<unknown>(`${F}/exchange-rates/${enc(id)}`)).data),
  accounts: async (q: { asOf?: string; includeInactive?: boolean } = {}) =>
    m.finAccountMapper.fromApiList((await http.get<unknown>(`${F}/accounts${qs({ as_of: q.asOf, include_inactive: q.includeInactive === false ? 'false' : undefined })}`)).data),
  createAccount: async (input: AccountInput) => m.finAccountMapper.fromApi((await http.post<unknown>(`${F}/accounts`, m.finAccountInputMapper.toApi(input))).data),
  updateAccount: async (id: string, input: AccountInput) => m.finAccountMapper.fromApi((await http.patch<unknown>(`${F}/accounts/${enc(id)}`, m.finAccountInputMapper.toApi(input))).data),
  deleteAccount: async (id: string) => void (await http.delete(`${F}/accounts/${enc(id)}`)),
  importTemplate: async () => m.finAccountMapper.fromApiList((await http.post<unknown>(`${F}/accounts/import-template`)).data),
  ledger: async (id: string, q: { from?: string; to?: string } = {}) => m.finLedgerMapper.fromApi((await http.get<unknown>(`${F}/accounts/${enc(id)}/ledger${qs({ from: q.from, to: q.to })}`)).data),
  journal: async (f: JournalFilters = {}) =>
    m.finJournalRowMapper.fromApiList((await http.get<unknown>(`${F}/journal${qs({ from: f.from, to: f.to, source_type: f.sourceType, account_id: f.accountId, q: f.q })}`)).data),
  entry: async (id: string) => m.finJournalDetailMapper.fromApi((await http.get<unknown>(`${F}/journal/${enc(id)}`)).data),
  dimensions: async () => m.finDimensionsMapper.fromApi((await http.get<unknown>(`${F}/journal/dimensions`)).data),
  postManual: async (input: ManualJournalInput) => m.finJournalDetailMapper.fromApi((await http.post<unknown>(`${F}/journal`, m.finManualJournalInputMapper.toApi(input))).data),
  reverse: async (id: string, body: { date: string; memo: string }) => m.finJournalDetailMapper.fromApi((await http.post<unknown>(`${F}/journal/${enc(id)}/reverse`, body)).data),
  postOpening: async (input: OpeningBalanceInput) => m.finJournalDetailMapper.fromApi((await http.post<unknown>(`${F}/opening-balances`, m.finOpeningInputMapper.toApi(input))).data),
  trialBalance: async (asOf?: string) => m.finTrialBalanceMapper.fromApi((await http.get<unknown>(`${F}/reports/trial-balance${qs({ as_of: asOf })}`)).data),
  overview: async () => m.finOverviewMapper.fromApi((await http.get<unknown>(`${F}/overview`)).data),
}

/* ---------------- hooks ---------------- */

/** Every ledger query sits under ['finance', 'ledger', uid] so one invalidation refreshes all of them. */
function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | boolean | object | undefined)[]) => ['finance', 'ledger', uid, ...rest] as const
}

/** The caller's accounting scope: `full` edits; `view` (Sales Manager) reads. Hidden roles never reach these pages. */
export function useFinanceScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'accounting') : 'hidden'
  return { scope, isFull: scope === 'full', role: user?.role ?? null }
}

function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('accounting')
}

export function useInvalidateFinance() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['finance'] })
}

export function useFinanceSettings() {
  const key = useKey()
  return useQuery({ queryKey: key('settings'), queryFn: ledgerApi.settings, enabled: useOn(), retry: false })
}
export function useAccounts(asOf?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('accounts', asOf ?? ''), queryFn: () => ledgerApi.accounts({ asOf }), enabled: useOn(), retry: false })
}
export function useAccountLedger(id: string | null, range: { from?: string; to?: string }) {
  const key = useKey()
  return useQuery({ queryKey: key('ledger', id ?? '', range), queryFn: () => ledgerApi.ledger(id!, range), enabled: useOn(!!id), retry: false })
}
export function useJournal(f: JournalFilters) {
  const key = useKey()
  return useQuery({ queryKey: key('journal', f), queryFn: () => ledgerApi.journal(f), enabled: useOn(), retry: false })
}
export function useJournalEntry(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('entry', id ?? ''), queryFn: () => ledgerApi.entry(id!), enabled: useOn(!!id), retry: false })
}
export function useDimensions(enabled: boolean) {
  const key = useKey()
  return useQuery({ queryKey: key('dimensions'), queryFn: ledgerApi.dimensions, enabled: useOn(enabled), retry: false, staleTime: 60_000 })
}
export function useTrialBalance(asOf?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('trial-balance', asOf ?? ''), queryFn: () => ledgerApi.trialBalance(asOf), enabled: useOn(), retry: false })
}
export function useFinanceOverview() {
  const key = useKey()
  return useQuery({ queryKey: key('overview'), queryFn: ledgerApi.overview, enabled: useOn(), retry: false })
}

/** A mutation that refreshes every finance query on success. */
export function useFinanceMutation<A, R>(fn: (args: A) => Promise<R>) {
  const invalidate = useInvalidateFinance()
  return useMutation({ mutationFn: fn, onSuccess: invalidate })
}
