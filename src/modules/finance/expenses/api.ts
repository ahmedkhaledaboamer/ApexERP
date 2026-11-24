import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeExpensesMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type {
  CashCountInput,
  ClaimInput,
  ClaimsQuery,
  DuplicateCheckInput,
  ExpenseCategoryInput,
  ExpenseInput,
  ExpensePolicyInput,
  PettyExpenseInput,
  PettyFundInput,
  PettyTopUpInput,
  ReimburseInput,
  ReplenishInput,
} from './types'

/** Accounts & finance › Expenses, expense claims, petty cash (docs/API.md › Finance › Expenses). */

const enc = encodeURIComponent
const qs = (params: Record<string, string | undefined | null>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v)
  const t = s.toString()
  return t ? `?${t}` : ''
}
const F = '/finance'

export interface ExpenseFilter {
  status?: string
  categoryId?: string
  q?: string
  from?: string
  to?: string
}

export const expensesApi = {
  categories: async (includeInactive = false) => m.expenseCategoryMapper.fromApiList((await http.get<unknown>(`${F}/expense-categories${qs({ include_inactive: includeInactive ? 'true' : null })}`)).data),
  createCategory: async (input: ExpenseCategoryInput) => m.expenseCategoryMapper.fromApi((await http.post<unknown>(`${F}/expense-categories`, m.expenseCategoryInputMapper.toApi(input))).data),
  updateCategory: async ({ id, input }: { id: string; input: ExpenseCategoryInput }) => m.expenseCategoryMapper.fromApi((await http.patch<unknown>(`${F}/expense-categories/${enc(id)}`, m.expenseCategoryInputMapper.toApi(input))).data),
  policy: async () => m.expensePolicyMapper.fromApi((await http.get<unknown>(`${F}/expense-policy`)).data),
  savePolicy: async (input: ExpensePolicyInput) => m.expensePolicyMapper.fromApi((await http.patch<unknown>(`${F}/expense-policy`, m.expensePolicyInputMapper.toApi(input))).data),

  expenses: async (f: ExpenseFilter = {}) => m.expenseMapper.fromApiList((await http.get<unknown>(`${F}/expenses${qs({ status: f.status, category_id: f.categoryId, q: f.q, from: f.from, to: f.to })}`)).data),
  expense: async (id: string) => m.expenseMapper.fromApi((await http.get<unknown>(`${F}/expenses/${enc(id)}`)).data),
  meta: async () => m.expensesMetaMapper.fromApi((await http.get<unknown>(`${F}/expenses/meta`)).data),
  checkDuplicate: async (input: DuplicateCheckInput) =>
    m.expensesPlainMapper.fromApi((await http.post<unknown>(`${F}/expenses/check-duplicate`, m.duplicateCheckMapper.toApi(input))).data) as { duplicates: { id: string; number: string; date: string; payeeName: string; amount: number; currency: string }[] },
  createExpense: async (input: ExpenseInput) => m.expenseMapper.fromApi((await http.post<unknown>(`${F}/expenses`, m.expenseInputMapper.toApi(input))).data),
  updateExpense: async ({ id, input }: { id: string; input: ExpenseInput }) => m.expenseMapper.fromApi((await http.patch<unknown>(`${F}/expenses/${enc(id)}`, m.expenseInputMapper.toApi(input))).data),
  expenseAction: async ({ id, action, reason }: { id: string; action: 'approve' | 'reject' | 'void'; reason?: string }) =>
    m.expenseMapper.fromApi((await http.post<unknown>(`${F}/expenses/${enc(id)}/${action}`, reason ? { reason } : {})).data),

  claims: async (q: ClaimsQuery = {}) => m.claimMapper.fromApiList((await http.get<unknown>(`${F}/expense-claims${qs({ view: q.view, status: q.status, employee_id: q.employeeId })}`)).data),
  claim: async (id: string) => m.claimMapper.fromApi((await http.get<unknown>(`${F}/expense-claims/${enc(id)}`)).data),
  claimsMeta: async () => m.claimsMetaMapper.fromApi((await http.get<unknown>(`${F}/expense-claims/meta`)).data),
  createClaim: async (input: ClaimInput) => m.claimMapper.fromApi((await http.post<unknown>(`${F}/expense-claims`, m.claimInputMapper.toApi(input))).data),
  updateClaim: async ({ id, input }: { id: string; input: ClaimInput }) => m.claimMapper.fromApi((await http.patch<unknown>(`${F}/expense-claims/${enc(id)}`, m.claimInputMapper.toApi(input))).data),
  deleteClaim: async (id: string) => (await http.delete<unknown>(`${F}/expense-claims/${enc(id)}`)).data,
  claimAction: async ({ id, action, reason }: { id: string; action: 'submit' | 'approve' | 'reject'; reason?: string }) =>
    m.claimMapper.fromApi((await http.post<unknown>(`${F}/expense-claims/${enc(id)}/${action}`, reason ? { reason } : {})).data),
  reimburse: async ({ id, input }: { id: string; input: ReimburseInput }) => m.claimMapper.fromApi((await http.post<unknown>(`${F}/expense-claims/${enc(id)}/reimburse`, m.reimburseInputMapper.toApi(input))).data),

  pettyMeta: async () => m.pettyMetaMapper.fromApi((await http.get<unknown>(`${F}/petty-cash/meta`)).data),
  funds: async () => m.pettyFundMapper.fromApiList((await http.get<unknown>(`${F}/petty-cash/funds`)).data),
  fund: async (id: string) => m.pettyFundDetailMapper.fromApi((await http.get<unknown>(`${F}/petty-cash/funds/${enc(id)}`)).data),
  createFund: async (input: PettyFundInput) => m.pettyFundDetailMapper.fromApi((await http.post<unknown>(`${F}/petty-cash/funds`, m.pettyFundInputMapper.toApi(input))).data),
  updateFund: async ({ id, input }: { id: string; input: PettyFundInput }) => m.pettyFundDetailMapper.fromApi((await http.patch<unknown>(`${F}/petty-cash/funds/${enc(id)}`, m.pettyFundInputMapper.toApi(input))).data),
  topUp: async ({ id, input }: { id: string; input: PettyTopUpInput }) => m.pettyFundDetailMapper.fromApi((await http.post<unknown>(`${F}/petty-cash/funds/${enc(id)}/top-up`, m.pettyTopUpInputMapper.toApi(input))).data),
  recordPetty: async ({ id, input }: { id: string; input: PettyExpenseInput }) => m.pettyFundDetailMapper.fromApi((await http.post<unknown>(`${F}/petty-cash/funds/${enc(id)}/expenses`, m.pettyExpenseInputMapper.toApi(input))).data),
  replenish: async ({ id, input }: { id: string; input: ReplenishInput }) => m.pettyFundDetailMapper.fromApi((await http.post<unknown>(`${F}/petty-cash/funds/${enc(id)}/replenish`, m.replenishInputMapper.toApi(input))).data),
  count: async ({ id, input }: { id: string; input: CashCountInput }) => m.pettyFundDetailMapper.fromApi((await http.post<unknown>(`${F}/petty-cash/funds/${enc(id)}/count`, m.cashCountInputMapper.toApi(input))).data),
}

/* ---------------- hooks ---------------- */

/** The caller's accounting scope: full records / approves / reimburses; view reads company expenses; hidden: claims only. */
export function useExpenseScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'accounting') : 'hidden'
  return { scope, canWrite: scope === 'full', canReadCompany: scope !== 'hidden' }
}

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | object | undefined)[]) => ['finance', 'expenses', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements() // always called: hook order must not depend on `enabled`
  return enabled && ent.hasModule('accounting')
}

export function useExpensesMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      // Expenses post to the ledger and payroll: refresh finance, HR payroll and the bell.
      void qc.invalidateQueries({ queryKey: ['finance'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}

export function useExpenses(f: ExpenseFilter, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('list', f), queryFn: () => expensesApi.expenses(f), enabled: useOn(enabled), retry: false })
}
export function useExpense(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('expense', id ?? ''), queryFn: () => expensesApi.expense(id!), enabled: useOn(!!id), retry: false })
}
export function useExpensesMeta(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('meta'), queryFn: expensesApi.meta, enabled: useOn(enabled), retry: false, staleTime: 60_000 })
}
export function useCategories(includeInactive = false, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('categories', String(includeInactive)), queryFn: () => expensesApi.categories(includeInactive), enabled: useOn(enabled), retry: false })
}
export function usePolicy(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('policy'), queryFn: expensesApi.policy, enabled: useOn(enabled), retry: false })
}
export function useClaims(q: ClaimsQuery, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('claims', q), queryFn: () => expensesApi.claims(q), enabled: useOn(enabled), retry: false })
}
export function useClaim(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('claim', id ?? ''), queryFn: () => expensesApi.claim(id!), enabled: useOn(!!id), retry: false })
}
export function useClaimsMeta(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('claims-meta'), queryFn: expensesApi.claimsMeta, enabled: useOn(enabled), retry: false, staleTime: 60_000 })
}
export function useFunds(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('funds'), queryFn: expensesApi.funds, enabled: useOn(enabled), retry: false })
}
export function useFund(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('fund', id ?? ''), queryFn: () => expensesApi.fund(id!), enabled: useOn(!!id), retry: false })
}
export function usePettyMeta(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('petty-meta'), queryFn: expensesApi.pettyMeta, enabled: useOn(enabled), retry: false, staleTime: 60_000 })
}
