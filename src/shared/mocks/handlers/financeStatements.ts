import { http, type HttpHandler } from 'msw'
import type { YearEndCloseInput } from '@/modules/finance/statements/types'
import * as st from '@/shared/mocks/services/financeStatements'
import * as m from '@/shared/api/financeStatementsMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

const F = `${API}/finance`

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/** Every statement query parameter (snake_case on the wire). */
function q(request: Request): st.StatementQuery {
  const s = new URL(request.url).searchParams
  return {
    period: s.get('period'),
    date: s.get('date'),
    from: s.get('from'),
    to: s.get('to'),
    compare: s.get('compare'),
    view: s.get('view'),
    asOf: s.get('as_of'),
    compareTo: s.get('compare_to'),
    accountId: s.get('account_id'),
    accountFrom: s.get('account_from'),
    accountTo: s.get('account_to'),
    excludeClosing: s.get('exclude_closing'),
    departmentId: s.get('department_id'),
    projectId: s.get('project_id'),
    eventId: s.get('event_id'),
    customerId: s.get('customer_id'),
  }
}

/**
 * Accounts & finance › Financial statements and year-end close (docs/API.md › Finance › Financial statements,
 * Year-end close). Plan module `accounting` (the `/finance` path gate); accounting full and view read; closing:
 * Company Admin / Accountant; re-open: Company Admin.
 */
export const financeStatementsHandlers: HttpHandler[] = [
  http.get(`${F}/statements/meta`, ({ request }) => respondAs(m.finStatementsMetaMapper, () => st.getStatementsMeta(userFrom(request)))),
  http.get(`${F}/statements/profit-and-loss`, ({ request }) => respondAs(m.finPnlMapper, () => st.getProfitAndLoss(userFrom(request), q(request)))),
  http.get(`${F}/statements/balance-sheet`, ({ request }) => respondAs(m.finBalanceSheetMapper, () => st.getBalanceSheet(userFrom(request), q(request)))),
  http.get(`${F}/statements/cash-flow`, ({ request }) => respondAs(m.finCashFlowMapper, () => st.getCashFlow(userFrom(request), q(request)))),
  http.get(`${F}/statements/general-ledger`, ({ request }) => respondAs(m.finGeneralLedgerMapper, () => st.getGeneralLedger(userFrom(request), q(request)))),
  http.get(`${F}/statements/trial-balance`, ({ request }) => respondAs(m.finTbCompareMapper, () => st.getTrialBalanceComparative(userFrom(request), q(request)))),

  http.get(`${F}/year-end`, ({ request }) => respondAs(m.finYearEndMapper, () => st.getYearEnd(userFrom(request)))),
  http.get(`${F}/year-end/preview`, ({ request }) =>
    respondAs(m.finYearEndPreviewMapper, () => st.previewYearEnd(userFrom(request), { fiscalYearEnd: new URL(request.url).searchParams.get('fiscal_year_end') })),
  ),
  http.post(`${F}/year-end/close`, async ({ request }) => {
    const input = await body<YearEndCloseInput>(request, m.finYearEndCloseInputMapper)
    return respondAs(m.finYearEndResultMapper, () => st.closeYear(userFrom(request), input))
  }),
  http.post<{ id: string }>(`${F}/year-end/closes/:id/reopen`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.finYearEndPlainMapper)
    return respondAs(m.finYearEndResultMapper, () => st.reopenYear(userFrom(request), params.id, input))
  }),
]
