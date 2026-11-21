import { useQuery } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeStatementsMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import { useFinanceMutation } from '@/modules/finance/ledger/api'
import type { CompareKind, PeriodKind, StatementDims, YearEndCloseInput } from './types'

/** Accounts & finance › Financial statements and year-end close (docs/API.md › Finance › Financial statements, Year-end close). */

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '' && v !== false) s.set(k, String(v))
  const t = s.toString()
  return t ? `?${t}` : ''
}
const F = '/finance'

export interface PeriodQuery {
  period: PeriodKind
  date?: string
  from?: string
  to?: string
}
export interface PnlQuery extends PeriodQuery {
  compare?: CompareKind[]
  view?: 'period' | 'monthly'
  dims?: StatementDims
}
export interface GlQuery {
  from?: string
  to?: string
  accountId?: string
  accountFrom?: string
  accountTo?: string
  excludeClosing?: boolean
  dims?: StatementDims
}

const dimParams = (d: StatementDims = {}) => ({ department_id: d.departmentId, project_id: d.projectId, event_id: d.eventId, customer_id: d.customerId })
const periodParams = (p: PeriodQuery) => (p.period === 'custom' ? { period: 'custom', from: p.from, to: p.to } : { period: p.period, date: p.date })

export const statementsApi = {
  meta: async () => m.finStatementsMetaMapper.fromApi((await http.get<unknown>(`${F}/statements/meta`)).data),
  pnl: async (q: PnlQuery) =>
    m.finPnlMapper.fromApi((await http.get<unknown>(`${F}/statements/profit-and-loss${qs({ ...periodParams(q), compare: q.compare?.join(','), view: q.view, ...dimParams(q.dims) })}`)).data),
  balanceSheet: async (asOf?: string, compareTo?: string) => m.finBalanceSheetMapper.fromApi((await http.get<unknown>(`${F}/statements/balance-sheet${qs({ as_of: asOf, compare_to: compareTo })}`)).data),
  cashFlow: async (q: PeriodQuery) => m.finCashFlowMapper.fromApi((await http.get<unknown>(`${F}/statements/cash-flow${qs(periodParams(q))}`)).data),
  generalLedger: async (q: GlQuery) =>
    m.finGeneralLedgerMapper.fromApi(
      (await http.get<unknown>(`${F}/statements/general-ledger${qs({ from: q.from, to: q.to, account_id: q.accountId, account_from: q.accountFrom, account_to: q.accountTo, exclude_closing: q.excludeClosing, ...dimParams(q.dims) })}`)).data,
    ),
  trialBalance: async (asOf?: string, compareTo?: string) => m.finTbCompareMapper.fromApi((await http.get<unknown>(`${F}/statements/trial-balance${qs({ as_of: asOf, compare_to: compareTo })}`)).data),
  yearEnd: async () => m.finYearEndMapper.fromApi((await http.get<unknown>(`${F}/year-end`)).data),
  preview: async (fiscalYearEnd?: string) => m.finYearEndPreviewMapper.fromApi((await http.get<unknown>(`${F}/year-end/preview${qs({ fiscal_year_end: fiscalYearEnd })}`)).data),
  close: async (input: YearEndCloseInput) => m.finYearEndResultMapper.fromApi((await http.post<unknown>(`${F}/year-end/close`, m.finYearEndCloseInputMapper.toApi(input))).data),
  reopen: async (id: string, reason: string) => m.finYearEndResultMapper.fromApi((await http.post<unknown>(`${F}/year-end/closes/${encodeURIComponent(id)}/reopen`, { reason })).data),
}

/* ---------------- hooks: every query under ['finance', 'statements', uid] (a finance mutation refreshes them) ---------------- */

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | boolean | object | undefined)[]) => ['finance', 'statements', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('accounting')
}

export function useStatementsMeta() {
  const key = useKey()
  return useQuery({ queryKey: key('meta'), queryFn: statementsApi.meta, enabled: useOn(), retry: false })
}
export function useProfitAndLoss(q: PnlQuery, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('pnl', q), queryFn: () => statementsApi.pnl(q), enabled: useOn(enabled), retry: false })
}
export function useBalanceSheet(asOf?: string, compareTo?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('bs', asOf ?? '', compareTo ?? ''), queryFn: () => statementsApi.balanceSheet(asOf, compareTo), enabled: useOn(), retry: false })
}
export function useCashFlow(q: PeriodQuery, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('cf', q), queryFn: () => statementsApi.cashFlow(q), enabled: useOn(enabled), retry: false })
}
export function useGeneralLedger(q: GlQuery, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('gl', q), queryFn: () => statementsApi.generalLedger(q), enabled: useOn(enabled), retry: false })
}
export function useTbCompare(asOf?: string, compareTo?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('tb', asOf ?? '', compareTo ?? ''), queryFn: () => statementsApi.trialBalance(asOf, compareTo), enabled: useOn(), retry: false })
}
export function useYearEnd() {
  const key = useKey()
  return useQuery({ queryKey: key('year-end'), queryFn: statementsApi.yearEnd, enabled: useOn(), retry: false })
}
export function useYearEndPreview(fiscalYearEnd: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('preview', fiscalYearEnd ?? ''), queryFn: () => statementsApi.preview(fiscalYearEnd ?? undefined), enabled: useOn(fiscalYearEnd !== null), retry: false })
}
export const useCloseYear = () => useFinanceMutation(statementsApi.close)
export const useReopenYear = () => useFinanceMutation((a: { id: string; reason: string }) => statementsApi.reopen(a.id, a.reason))
