import { useQuery } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeBankingMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { useFinanceMutation } from '@/modules/finance/ledger/api'
import type {
  BankAccountInput,
  BankRuleInput,
  CreateFromLineInput,
  FinishReconciliationInput,
  MatchInput,
  StatementImportInput,
  TransferInput,
} from './types'

/** Accounts & finance › Banking and Payroll posting (docs/API.md › Finance › Bank accounts, Reconciliation, Payroll posting). */

const enc = encodeURIComponent
const F = '/finance'
const qs = (p: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v)
  const t = s.toString()
  return t ? `?${t}` : ''
}

export const bankingApi = {
  accounts: async (includeInactive = false) => m.bankAccountMapper.fromApiList((await http.get<unknown>(`${F}/bank-accounts${qs({ include_inactive: includeInactive ? 'true' : null })}`)).data),
  ledgerOptions: async () => m.bankPlainMapper.fromApiList((await http.get<unknown>(`${F}/bank-accounts/ledger-options`)).data) as unknown as { id: string; code: string; name: string; currency: string | null }[],
  createAccount: async (input: BankAccountInput) => m.bankAccountMapper.fromApi((await http.post<unknown>(`${F}/bank-accounts`, m.bankAccountInputMapper.toApi(input))).data),
  updateAccount: async (id: string, input: BankAccountInput) => m.bankAccountMapper.fromApi((await http.patch<unknown>(`${F}/bank-accounts/${enc(id)}`, m.bankAccountInputMapper.toApi(input))).data),
  reveal: async (id: string) => m.bankRevealMapper.fromApi((await http.post<unknown>(`${F}/bank-accounts/${enc(id)}/reveal`)).data),

  statements: async (id: string) => m.bankStatementMapper.fromApiList((await http.get<unknown>(`${F}/bank-accounts/${enc(id)}/statements`)).data),
  statement: async (id: string) => m.bankStatementDetailMapper.fromApi((await http.get<unknown>(`${F}/bank-statements/${enc(id)}`)).data),
  deleteStatement: async (id: string) => (await http.delete<unknown>(`${F}/bank-statements/${enc(id)}`)).data,
  preview: async (id: string, input: StatementImportInput) => m.statementPreviewMapper.fromApi((await http.post<unknown>(`${F}/bank-accounts/${enc(id)}/statements/preview`, m.statementImportInputMapper.toApi(input))).data),
  importStatement: async (id: string, input: StatementImportInput) => m.bankStatementDetailMapper.fromApi((await http.post<unknown>(`${F}/bank-accounts/${enc(id)}/statements`, m.statementImportInputMapper.toApi(input))).data),

  workspace: async (id: string, to?: string) => m.reconcileWorkspaceMapper.fromApi((await http.get<unknown>(`${F}/bank-accounts/${enc(id)}/reconcile${qs({ to })}`)).data),
  match: async (id: string, input: MatchInput) => m.reconcileWorkspaceMapper.fromApi((await http.post<unknown>(`${F}/bank-accounts/${enc(id)}/matches`, m.matchInputMapper.toApi(input))).data),
  autoMatch: async (id: string) => m.reconcileWorkspaceMapper.fromApi((await http.post<unknown>(`${F}/bank-accounts/${enc(id)}/auto-match`)).data),
  unmatch: async (matchId: string) => (await http.delete<unknown>(`${F}/bank-matches/${enc(matchId)}`)).data,
  createEntry: async (lineId: string, input: CreateFromLineInput) => m.reconcileWorkspaceMapper.fromApi((await http.post<unknown>(`${F}/bank-statement-lines/${enc(lineId)}/create-entry`, m.createFromLineInputMapper.toApi(input))).data),
  finish: async (id: string, input: FinishReconciliationInput) => m.reconciliationReportMapper.fromApi((await http.post<unknown>(`${F}/bank-accounts/${enc(id)}/reconciliations`, m.finishReconInputMapper.toApi(input))).data),
  reconciliations: async (bankAccountId?: string) => m.reconciliationMapper.fromApiList((await http.get<unknown>(`${F}/bank-reconciliations${qs({ bank_account_id: bankAccountId })}`)).data),
  reconciliation: async (id: string) => m.reconciliationReportMapper.fromApi((await http.get<unknown>(`${F}/bank-reconciliations/${enc(id)}`)).data),
  undo: async (id: string) => m.reconciliationReportMapper.fromApi((await http.post<unknown>(`${F}/bank-reconciliations/${enc(id)}/undo`)).data),

  rules: async () => m.bankRuleMapper.fromApiList((await http.get<unknown>(`${F}/bank-rules`)).data),
  createRule: async (input: BankRuleInput) => m.bankRuleMapper.fromApi((await http.post<unknown>(`${F}/bank-rules`, m.bankRuleInputMapper.toApi(input))).data),
  updateRule: async (id: string, input: BankRuleInput) => m.bankRuleMapper.fromApi((await http.patch<unknown>(`${F}/bank-rules/${enc(id)}`, m.bankRuleInputMapper.toApi(input))).data),
  deleteRule: async (id: string) => (await http.delete<unknown>(`${F}/bank-rules/${enc(id)}`)).data,

  transfers: async (bankAccountId?: string) => m.bankTransferMapper.fromApiList((await http.get<unknown>(`${F}/bank-transfers${qs({ bank_account_id: bankAccountId })}`)).data),
  createTransfer: async (input: TransferInput) => m.bankTransferMapper.fromApi((await http.post<unknown>(`${F}/bank-transfers`, m.transferInputMapper.toApi(input))).data),
  voidTransfer: async (id: string) => m.bankTransferMapper.fromApi((await http.post<unknown>(`${F}/bank-transfers/${enc(id)}/void`)).data),

  payrollPostings: async () => m.payrollPostingMapper.fromApiList((await http.get<unknown>(`${F}/payroll-postings`)).data),
  payrollPosting: async (runId: string) => m.payrollPostingMapper.fromApi((await http.get<unknown>(`${F}/payroll-postings/${enc(runId)}`)).data),
  setPaidFrom: async (runId: string, accountId: string) => m.payrollPostingMapper.fromApi((await http.put<unknown>(`${F}/payroll-postings/${enc(runId)}/paid-from`, { account_id: accountId })).data),
}

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | object | undefined)[]) => ['finance', 'banking', uid, ...rest] as const
}
/** Accounting not hidden and the plan has `accounting`. */
export function useBankingOn(enabled = true) {
  const ent = useEntitlements()
  const user = useCurrentUser()
  return enabled && !!user && scopeOf(user.role, 'accounting') !== 'hidden' && ent.hasModule('accounting')
}

export function useBankAccounts(includeInactive = false) {
  const key = useKey()
  return useQuery({ queryKey: key('accounts', includeInactive ? 'all' : 'active'), queryFn: () => bankingApi.accounts(includeInactive), enabled: useBankingOn(), retry: false })
}
export function useLedgerOptions(enabled: boolean) {
  const key = useKey()
  return useQuery({ queryKey: key('ledger-options'), queryFn: bankingApi.ledgerOptions, enabled: useBankingOn(enabled), retry: false })
}
export function useWorkspace(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('workspace', id ?? ''), queryFn: () => bankingApi.workspace(id!), enabled: useBankingOn(!!id), retry: false })
}
export function useStatements(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('statements', id ?? ''), queryFn: () => bankingApi.statements(id!), enabled: useBankingOn(!!id), retry: false })
}
export function useReconciliations(bankAccountId?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('reconciliations', bankAccountId ?? ''), queryFn: () => bankingApi.reconciliations(bankAccountId), enabled: useBankingOn(), retry: false })
}
export function useReconciliation(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('reconciliation', id ?? ''), queryFn: () => bankingApi.reconciliation(id!), enabled: useBankingOn(!!id), retry: false })
}
export function useRules() {
  const key = useKey()
  return useQuery({ queryKey: key('rules'), queryFn: bankingApi.rules, enabled: useBankingOn(), retry: false })
}
export function useTransfers() {
  const key = useKey()
  return useQuery({ queryKey: key('transfers'), queryFn: () => bankingApi.transfers(), enabled: useBankingOn(), retry: false })
}
export function usePayrollPostings(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('payroll'), queryFn: bankingApi.payrollPostings, enabled: useBankingOn(enabled), retry: false })
}
/** The run's postings (HR salary page): only for users who can see accounting. */
export function usePayrollPosting(runId: string | null, runStatus = '') {
  const key = useKey()
  // Keyed by the run's status too: approving / reopening / paying in HR refetches it.
  return useQuery({ queryKey: key('payroll', runId ?? '', runStatus), queryFn: () => bankingApi.payrollPosting(runId!), enabled: useBankingOn(!!runId), retry: false })
}

export const useBankingMutation = useFinanceMutation
