import { http, type HttpHandler } from 'msw'
import * as t from '@/shared/mocks/services/financeTax'
import * as b from '@/shared/mocks/services/financeBudgets'
import * as f from '@/shared/mocks/services/financeForecast'
import * as tm from '@/shared/api/financeTaxMappers'
import * as bm from '@/shared/api/financeBudgetsMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }
async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const F = `${API}/finance`
const q = (request: Request) => new URL(request.url).searchParams

/** Accounts & finance › Tax: VAT returns, corporate tax / zakat (docs/API.md › Finance › VAT returns, Corporate tax & zakat). Plan module `accounting`. */
export const financeTaxHandlers: HttpHandler[] = [
  http.get(`${F}/tax/settings`, ({ request }) => respondAs(tm.taxSettingsMapper, () => t.getTaxSettings(userFrom(request)))),
  http.patch(`${F}/tax/settings`, async ({ request }) => {
    const input = await body<{ vatFrequency?: unknown }>(request, tm.taxPlainMapper)
    return respondAs(tm.taxSettingsMapper, () => t.updateTaxSettings(userFrom(request), input))
  }),
  http.get(`${F}/vat-returns`, ({ request }) => respondAs(tm.vatReturnRowMapper, () => t.listVatReturns(userFrom(request)))),
  http.get<Id>(`${F}/vat-returns/:id`, ({ request, params }) => respondAs(tm.vatReturnMapper, () => t.getVatReturn(userFrom(request), params.id))),
  http.get<Id & { box: string }>(`${F}/vat-returns/:id/boxes/:box`, ({ request, params }) => respondAs(tm.vatBoxItemsMapper, () => t.getVatBoxItems(userFrom(request), params.id, params.box))),
  http.post<Id>(`${F}/vat-returns/:id/file`, async ({ request, params }) => {
    const input = await body<Parameters<typeof t.fileVatReturn>[2]>(request, tm.taxPlainMapper)
    return respondAs(tm.vatReturnMapper, () => t.fileVatReturn(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/vat-returns/:id/pay`, async ({ request, params }) => {
    const input = await body<Parameters<typeof t.payVatReturn>[2]>(request, tm.taxPlainMapper)
    return respondAs(tm.vatReturnMapper, () => t.payVatReturn(userFrom(request), params.id, input))
  }),
  http.get(`${F}/tax/corporate-tax`, ({ request }) => respondAs(tm.corporateTaxMapper, () => t.getCorporateTax(userFrom(request), q(request).get('year')))),
  http.get(`${F}/tax/zakat`, ({ request }) => respondAs(tm.zakatMapper, () => t.getZakat(userFrom(request), q(request).get('year')))),
  http.put(`${F}/tax/adjustments`, async ({ request }) => {
    const input = await body<Parameters<typeof t.putTaxAdjustments>[1]>(request, tm.taxPlainMapper)
    return respondAs(tm.taxEstimateMapper, () => t.putTaxAdjustments(userFrom(request), input))
  }),
  http.post(`${F}/tax/provisions`, async ({ request }) => {
    const input = await body<Parameters<typeof t.postTaxProvision>[1]>(request, tm.taxPlainMapper)
    return respondAs(tm.provisionResultMapper, () => t.postTaxProvision(userFrom(request), input))
  }),
]

/** Accounts & finance › Budgets and Cash-flow forecast (docs/API.md › Finance › Budgets, Cash-flow forecast). Plan module `accounting`. */
export const financeBudgetsHandlers: HttpHandler[] = [
  http.get(`${F}/budgets`, ({ request }) => respondAs(bm.budgetRowMapper, () => b.listBudgets(userFrom(request)))),
  http.post(`${F}/budgets`, async ({ request }) => {
    const input = await body<Parameters<typeof b.createBudget>[1]>(request, bm.planningPlainMapper)
    return respondAs(bm.budgetMapper, () => b.createBudget(userFrom(request), input))
  }),
  http.get<Id>(`${F}/budgets/:id`, ({ request, params }) => respondAs(bm.budgetMapper, () => b.getBudget(userFrom(request), params.id))),
  http.delete<Id>(`${F}/budgets/:id`, ({ request, params }) => respondAs(bm.planningPlainMapper, () => b.deleteBudget(userFrom(request), params.id))),
  http.put<Id>(`${F}/budgets/:id/lines`, async ({ request, params }) => {
    const input = await body<{ lines?: unknown }>(request, bm.planningPlainMapper)
    return respondAs(bm.budgetMapper, () => b.putBudgetLines(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/budgets/:id/copy-actuals`, async ({ request, params }) => {
    const input = await body<Parameters<typeof b.copyBudgetActuals>[2]>(request, bm.planningPlainMapper)
    return respondAs(bm.budgetMapper, () => b.copyBudgetActuals(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/budgets/:id/approve`, ({ request, params }) => respondAs(bm.budgetMapper, () => b.approveBudget(userFrom(request), params.id))),
  http.post<Id>(`${F}/budgets/:id/reopen`, ({ request, params }) => respondAs(bm.budgetMapper, () => b.reopenBudget(userFrom(request), params.id))),
  http.get<Id>(`${F}/budgets/:id/vs-actual`, ({ request, params }) =>
    respondAs(bm.budgetVsActualMapper, () => b.getBudgetVsActual(userFrom(request), params.id, { departmentId: q(request).get('department_id'), month: q(request).get('month') })),
  ),
  http.get(`${F}/forecast`, ({ request }) => respondAs(bm.cashForecastMapper, () => f.getCashForecast(userFrom(request)))),
  http.put(`${F}/forecast/settings`, async ({ request }) => {
    const input = await body<Parameters<typeof f.putForecastSettings>[1]>(request, bm.planningPlainMapper)
    return respondAs(bm.cashForecastMapper, () => f.putForecastSettings(userFrom(request), input))
  }),
  http.post(`${F}/forecast/lines`, async ({ request }) => {
    const input = await body<Parameters<typeof f.addForecastLine>[1]>(request, bm.planningPlainMapper)
    return respondAs(bm.cashForecastMapper, () => f.addForecastLine(userFrom(request), input))
  }),
  http.delete<Id>(`${F}/forecast/lines/:id`, ({ request, params }) => respondAs(bm.cashForecastMapper, () => f.deleteForecastLine(userFrom(request), params.id))),
]
