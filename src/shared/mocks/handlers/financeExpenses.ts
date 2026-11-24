import { http, type HttpHandler } from 'msw'
import type {
  CashCountInput,
  ClaimInput,
  ClaimStatus,
  ClaimView,
  DuplicateCheckInput,
  ExpenseCategoryInput,
  ExpenseInput,
  ExpensePolicyInput,
  PettyExpenseInput,
  PettyFundInput,
  PettyTopUpInput,
  ReimburseInput,
  ReplenishInput,
} from '@/modules/finance/expenses/types'
import * as exp from '@/shared/mocks/services/financeExpenses'
import * as claims from '@/shared/mocks/services/financeExpensesClaims'
import * as petty from '@/shared/mocks/services/financeExpensesPetty'
import '@/shared/mocks/data/financeExpensesSeed'
import * as m from '@/shared/api/financeExpensesMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const query = (request: Request) => new URL(request.url).searchParams
const E = `${API}/finance/expenses`
const C = `${API}/finance/expense-claims`
const P = `${API}/finance/petty-cash`

/**
 * Accounts & finance › Expenses, expense categories / policy, employee expense claims and petty cash (docs/API.md ›
 * Finance › Expenses / Expense claims / Petty cash). Plan module `accounting` (the /finance path gate). Company
 * expenses: accounting full writes, view reads, hidden 403. Claims: every role (own claims; approvers their step).
 * Petty cash: accounting full, or the fund's custodian. Static paths before `:id`.
 */
export const financeExpensesHandlers: HttpHandler[] = [
  /* ---- categories & policy ---- */
  http.get(`${API}/finance/expense-categories`, ({ request }) => respondAs(m.expenseCategoryMapper, () => exp.listCategories(userFrom(request), { includeInactive: query(request).get('include_inactive') }))),
  http.post(`${API}/finance/expense-categories`, async ({ request }) => {
    const input = await body<ExpenseCategoryInput>(request, m.expenseCategoryInputMapper)
    return respondAs(m.expenseCategoryMapper, () => exp.createCategory(userFrom(request), input))
  }),
  http.patch<Id>(`${API}/finance/expense-categories/:id`, async ({ request, params }) => {
    const input = await body<ExpenseCategoryInput>(request, m.expenseCategoryInputMapper)
    return respondAs(m.expenseCategoryMapper, () => exp.updateCategory(userFrom(request), params.id, input))
  }),
  http.get(`${API}/finance/expense-policy`, ({ request }) => respondAs(m.expensePolicyMapper, () => exp.getPolicy(userFrom(request)))),
  http.patch(`${API}/finance/expense-policy`, async ({ request }) => {
    const input = await body<ExpensePolicyInput>(request, m.expensePolicyInputMapper)
    return respondAs(m.expensePolicyMapper, () => exp.updatePolicy(userFrom(request), input))
  }),

  /* ---- company expenses ---- */
  http.get(E, ({ request }) => {
    const q = query(request)
    return respondAs(m.expenseMapper, () =>
      exp.listExpenses(userFrom(request), { status: q.get('status'), categoryId: q.get('category_id'), vendorId: q.get('vendor_id'), paymentMethod: q.get('payment_method'), from: q.get('from'), to: q.get('to'), q: q.get('q') }),
    )
  }),
  http.post(E, async ({ request }) => {
    const input = await body<ExpenseInput>(request, m.expenseInputMapper)
    return respondAs(m.expenseMapper, () => exp.createExpense(userFrom(request), input))
  }),
  http.get(`${E}/meta`, ({ request }) => respondAs(m.expensesMetaMapper, () => exp.expensesMeta(userFrom(request)))),
  http.post(`${E}/check-duplicate`, async ({ request }) => {
    const input = await body<DuplicateCheckInput>(request, m.duplicateCheckMapper)
    return respondAs(m.expensesPlainMapper, () => exp.checkDuplicate(userFrom(request), input))
  }),
  http.get<Id>(`${E}/:id`, ({ request, params }) => respondAs(m.expenseMapper, () => exp.getExpense(userFrom(request), params.id))),
  http.patch<Id>(`${E}/:id`, async ({ request, params }) => {
    const input = await body<ExpenseInput>(request, m.expenseInputMapper)
    return respondAs(m.expenseMapper, () => exp.updateExpense(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${E}/:id/approve`, ({ request, params }) => respondAs(m.expenseMapper, () => exp.approveExpense(userFrom(request), params.id))),
  http.post<Id>(`${E}/:id/reject`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.expensesPlainMapper)
    return respondAs(m.expenseMapper, () => exp.rejectExpense(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${E}/:id/void`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.expensesPlainMapper)
    return respondAs(m.expenseMapper, () => exp.voidExpense(userFrom(request), params.id, input))
  }),

  /* ---- employee expense claims ---- */
  http.get(C, ({ request }) => {
    const q = query(request)
    return respondAs(m.claimMapper, () => claims.listClaims(userFrom(request), { view: (q.get('view') ?? undefined) as ClaimView | undefined, status: (q.get('status') ?? '') as ClaimStatus | '', employeeId: q.get('employee_id') ?? undefined }))
  }),
  http.post(C, async ({ request }) => {
    const input = await body<ClaimInput>(request, m.claimInputMapper)
    return respondAs(m.claimMapper, () => claims.createClaim(userFrom(request), input))
  }),
  http.get(`${C}/meta`, ({ request }) => respondAs(m.claimsMetaMapper, () => claims.claimsMeta(userFrom(request)))),
  http.get<Id>(`${C}/:id`, ({ request, params }) => respondAs(m.claimMapper, () => claims.getClaim(userFrom(request), params.id))),
  http.patch<Id>(`${C}/:id`, async ({ request, params }) => {
    const input = await body<ClaimInput>(request, m.claimInputMapper)
    return respondAs(m.claimMapper, () => claims.updateClaim(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${C}/:id`, ({ request, params }) => respondAs(m.expensesPlainMapper, () => claims.deleteClaim(userFrom(request), params.id))),
  http.post<Id>(`${C}/:id/submit`, ({ request, params }) => respondAs(m.claimMapper, () => claims.submitClaim(userFrom(request), params.id))),
  http.post<Id>(`${C}/:id/approve`, ({ request, params }) => respondAs(m.claimMapper, () => claims.approveClaim(userFrom(request), params.id))),
  http.post<Id>(`${C}/:id/reject`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.expensesPlainMapper)
    return respondAs(m.claimMapper, () => claims.rejectClaim(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${C}/:id/reimburse`, async ({ request, params }) => {
    const input = await body<ReimburseInput>(request, m.reimburseInputMapper)
    return respondAs(m.claimMapper, () => claims.reimburseClaim(userFrom(request), params.id, input))
  }),

  /* ---- petty cash ---- */
  http.get(`${P}/meta`, ({ request }) => respondAs(m.pettyMetaMapper, () => petty.pettyMeta(userFrom(request)))),
  http.get(`${P}/funds`, ({ request }) => respondAs(m.pettyFundMapper, () => petty.listFunds(userFrom(request)))),
  http.post(`${P}/funds`, async ({ request }) => {
    const input = await body<PettyFundInput>(request, m.pettyFundInputMapper)
    return respondAs(m.pettyFundDetailMapper, () => petty.createFund(userFrom(request), input))
  }),
  http.get<Id>(`${P}/funds/:id`, ({ request, params }) => respondAs(m.pettyFundDetailMapper, () => petty.getFund(userFrom(request), params.id))),
  http.patch<Id>(`${P}/funds/:id`, async ({ request, params }) => {
    const input = await body<PettyFundInput>(request, m.pettyFundInputMapper)
    return respondAs(m.pettyFundDetailMapper, () => petty.updateFund(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/funds/:id/top-up`, async ({ request, params }) => {
    const input = await body<PettyTopUpInput>(request, m.pettyTopUpInputMapper)
    return respondAs(m.pettyFundDetailMapper, () => petty.topUpFund(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/funds/:id/expenses`, async ({ request, params }) => {
    const input = await body<PettyExpenseInput>(request, m.pettyExpenseInputMapper)
    return respondAs(m.pettyFundDetailMapper, () => petty.recordPettyExpense(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/funds/:id/replenish`, async ({ request, params }) => {
    const input = await body<ReplenishInput>(request, m.replenishInputMapper)
    return respondAs(m.pettyFundDetailMapper, () => petty.replenishFund(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/funds/:id/count`, async ({ request, params }) => {
    const input = await body<CashCountInput>(request, m.cashCountInputMapper)
    return respondAs(m.pettyFundDetailMapper, () => petty.countFund(userFrom(request), params.id, input))
  }),
]
