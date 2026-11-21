import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/hrPayrollMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type { AdjustmentInput, BankFileFormat, LoanInput, PayrollProfileInput, PaySettingsInput, SettlementInput } from './types'

/** HR › Salary Management (docs/API.md › HR › Salary management). snake_case on the wire via hrPayrollMappers. */

const enc = encodeURIComponent
const qs = (params: Record<string, string | number | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v))
  const t = s.toString()
  return t ? `?${t}` : ''
}
const P = '/hr/payroll'

export const payrollApi = {
  settings: async () => m.paySettingsMapper.fromApi((await http.get<unknown>(`${P}/settings`)).data),
  saveSettings: async (input: PaySettingsInput) => m.paySettingsMapper.fromApi((await http.patch<unknown>(`${P}/settings`, m.paySettingsInputMapper.toApi(input))).data),
  profiles: async () => m.payrollProfileMapper.fromApiList((await http.get<unknown>(`${P}/profiles`)).data),
  saveProfile: async (employeeId: string, input: PayrollProfileInput) => m.payrollProfileMapper.fromApi((await http.patch<unknown>(`${P}/profiles/${enc(employeeId)}`, m.payrollProfileInputMapper.toApi(input))).data),
  revealPersonId: async (employeeId: string) => String(m.payPlainMapper.fromApi((await http.post<unknown>(`${P}/profiles/${enc(employeeId)}/reveal`)).data).personId ?? ''),
  adjustments: async (q: { month?: string; employeeId?: string } = {}) => m.payAdjustmentMapper.fromApiList((await http.get<unknown>(`${P}/adjustments${qs({ month: q.month, employee_id: q.employeeId })}`)).data),
  saveAdjustment: async (input: AdjustmentInput, id?: string) => {
    const body = m.payAdjustmentInputMapper.toApi(input)
    return m.payAdjustmentMapper.fromApi((id ? await http.patch<unknown>(`${P}/adjustments/${enc(id)}`, body) : await http.post<unknown>(`${P}/adjustments`, body)).data)
  },
  deleteAdjustment: async (id: string) => void (await http.delete(`${P}/adjustments/${enc(id)}`)),
  loans: async () => m.payLoanMapper.fromApiList((await http.get<unknown>(`${P}/loans`)).data),
  saveLoan: async (input: LoanInput, id?: string) => {
    const body = m.payLoanInputMapper.toApi(input)
    return m.payLoanMapper.fromApi((id ? await http.patch<unknown>(`${P}/loans/${enc(id)}`, body) : await http.post<unknown>(`${P}/loans`, body)).data)
  },
  runs: async () => m.payrollRunRowMapper.fromApiList((await http.get<unknown>(`${P}/runs`)).data),
  run: async (id: string) => m.payrollRunDetailMapper.fromApi((await http.get<unknown>(`${P}/runs/${enc(id)}`)).data),
  createRun: async (month: string) => m.payrollRunDetailMapper.fromApi((await http.post<unknown>(`${P}/runs`, { month })).data),
  deleteRun: async (id: string) => void (await http.delete(`${P}/runs/${enc(id)}`)),
  runAction: async (id: string, action: 'calculate' | 'approve' | 'reopen' | 'pay') => m.payrollRunDetailMapper.fromApi((await http.post<unknown>(`${P}/runs/${enc(id)}/${action}`)).data),
  acknowledge: async (id: string, body: { all?: boolean; warnings?: { employeeId: string; code: string }[] }) =>
    m.payrollRunDetailMapper.fromApi((await http.post<unknown>(`${P}/runs/${enc(id)}/acknowledge`, m.payPlainMapper.toApi(body))).data),
  bankFile: async (id: string, format: BankFileFormat) => m.bankFileMapper.fromApi((await http.post<unknown>(`${P}/runs/${enc(id)}/bank-file`, { format })).data),
  payslips: async (q: { month?: string } = {}) => m.payslipRowMapper.fromApiList((await http.get<unknown>(`${P}/payslips${qs({ month: q.month })}`)).data),
  payslip: async (id: string) => m.payslipMapper.fromApi((await http.get<unknown>(`${P}/payslips/${enc(id)}`)).data),
  summary: async (months = 12) => m.payrollSummaryMapper.fromApi((await http.get<unknown>(`${P}/summary${qs({ months })}`)).data),
  settlements: async () => m.settlementMapper.fromApiList((await http.get<unknown>(`${P}/settlements`)).data),
  previewSettlement: async (input: SettlementInput) => m.settlementMapper.fromApi((await http.post<unknown>(`${P}/settlements/preview`, m.settlementInputMapper.toApi(input))).data),
  createSettlement: async (input: SettlementInput) => m.settlementMapper.fromApi((await http.post<unknown>(`${P}/settlements`, m.settlementInputMapper.toApi(input))).data),
  updateSettlement: async (id: string, input: SettlementInput) => m.settlementMapper.fromApi((await http.patch<unknown>(`${P}/settlements/${enc(id)}`, m.settlementInputMapper.toApi(input))).data),
  deleteSettlement: async (id: string) => void (await http.delete(`${P}/settlements/${enc(id)}`)),
  paySettlement: async (id: string) => m.settlementMapper.fromApi((await http.post<unknown>(`${P}/settlements/${enc(id)}/pay`)).data),
}

/* ---------------- hooks ---------------- */

/** Every payroll query sits under ['hr', 'payroll', uid] so one invalidation refreshes all of them. */
function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | object | undefined)[]) => ['hr', 'payroll', uid, ...rest] as const
}

/** The caller's HR scope: `full` runs payroll; team / own see their own payslips; hidden never reaches the page. */
export function usePayrollScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'hr') : 'hidden'
  return { scope, isFull: scope === 'full' }
}

function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}

export function useInvalidatePayroll() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['hr'] })
    void qc.invalidateQueries({ queryKey: ['alerts'] })
  }
}

export function usePaySettings(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('settings'), queryFn: payrollApi.settings, enabled: useOn(enabled), retry: false })
}
export function usePayrollProfiles(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('profiles'), queryFn: payrollApi.profiles, enabled: useOn(enabled), retry: false })
}
export function useAdjustments(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('adjustments'), queryFn: () => payrollApi.adjustments(), enabled: useOn(enabled), retry: false })
}
export function useLoans(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('loans'), queryFn: payrollApi.loans, enabled: useOn(enabled), retry: false })
}
export function useRuns(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('runs'), queryFn: payrollApi.runs, enabled: useOn(enabled), retry: false })
}
export function useRun(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('run', id ?? ''), queryFn: () => payrollApi.run(id!), enabled: useOn(!!id), retry: false })
}
export function usePayslips(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('payslips'), queryFn: () => payrollApi.payslips(), enabled: useOn(enabled), retry: false })
}
export function usePayslip(id: string) {
  const key = useKey()
  return useQuery({ queryKey: key('payslip', id), queryFn: () => payrollApi.payslip(id), enabled: useOn(!!id), retry: false })
}
export function usePayrollSummary(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('summary'), queryFn: () => payrollApi.summary(12), enabled: useOn(enabled), retry: false })
}
export function useSettlements(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('settlements'), queryFn: payrollApi.settlements, enabled: useOn(enabled), retry: false })
}

/** A mutation that refreshes every HR query (and the bell) on success. */
export function usePayrollMutation<A, R>(fn: (args: A) => Promise<R>) {
  const invalidate = useInvalidatePayroll()
  return useMutation({ mutationFn: fn, onSuccess: invalidate })
}
