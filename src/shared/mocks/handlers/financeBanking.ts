import { http, type HttpHandler } from 'msw'
import * as bank from '@/shared/mocks/services/financeBanking'
import * as pay from '@/shared/mocks/services/financePayrollGl'
import * as m from '@/shared/api/financeBankingMappers'
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
const F = `${API}/finance`

/**
 * Accounts & finance › Banking (bank accounts, transfers, statements, reconciliation, rules) and Payroll posting
 * (docs/API.md › Finance). Plan module `accounting`; accounting full writes, view reads. Static paths before `:id`.
 */
export const financeBankingHandlers: HttpHandler[] = [
  /* ---- bank accounts ---- */
  http.get(`${F}/bank-accounts`, ({ request }) => respondAs(m.bankAccountMapper, () => bank.listBankAccounts(userFrom(request), { includeInactive: query(request).get('include_inactive') }))),
  http.get(`${F}/bank-accounts/ledger-options`, ({ request }) => respondAs(m.bankPlainMapper, () => bank.ledgerOptions(userFrom(request)))),
  http.post(`${F}/bank-accounts`, async ({ request }) => {
    const input = await body<Parameters<typeof bank.createBankAccount>[1]>(request, m.bankAccountInputMapper)
    return respondAs(m.bankAccountMapper, () => bank.createBankAccount(userFrom(request), input))
  }),
  http.get<Id>(`${F}/bank-accounts/:id`, ({ request, params }) => respondAs(m.bankAccountMapper, () => bank.getBankAccount(userFrom(request), params.id))),
  http.patch<Id>(`${F}/bank-accounts/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof bank.updateBankAccount>[2]>(request, m.bankAccountInputMapper)
    return respondAs(m.bankAccountMapper, () => bank.updateBankAccount(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/bank-accounts/:id/reveal`, ({ request, params }) => respondAs(m.bankRevealMapper, () => bank.revealBankAccount(userFrom(request), params.id))),

  /* ---- statements ---- */
  http.get<Id>(`${F}/bank-accounts/:id/statements`, ({ request, params }) => respondAs(m.bankStatementMapper, () => bank.listStatements(userFrom(request), params.id))),
  http.post<Id>(`${F}/bank-accounts/:id/statements/preview`, async ({ request, params }) => {
    const input = await body<Parameters<typeof bank.previewStatement>[2]>(request, m.bankPlainMapper)
    return respondAs(m.statementPreviewMapper, () => bank.previewStatement(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/bank-accounts/:id/statements`, async ({ request, params }) => {
    const input = await body<Parameters<typeof bank.importStatement>[2]>(request, m.bankPlainMapper)
    return respondAs(m.bankStatementDetailMapper, () => bank.importStatement(userFrom(request), params.id, input))
  }),
  http.get<Id>(`${F}/bank-statements/:id`, ({ request, params }) => respondAs(m.bankStatementDetailMapper, () => bank.getStatement(userFrom(request), params.id))),
  http.delete<Id>(`${F}/bank-statements/:id`, ({ request, params }) => respondAs(m.bankPlainMapper, () => bank.deleteStatement(userFrom(request), params.id))),

  /* ---- reconciliation ---- */
  http.get<Id>(`${F}/bank-accounts/:id/reconcile`, ({ request, params }) => respondAs(m.reconcileWorkspaceMapper, () => bank.getReconcileWorkspace(userFrom(request), params.id, { to: query(request).get('to') }))),
  http.post<Id>(`${F}/bank-accounts/:id/matches`, async ({ request, params }) => {
    const input = await body<Parameters<typeof bank.createMatch>[2]>(request, m.matchInputMapper)
    return respondAs(m.reconcileWorkspaceMapper, () => bank.createMatch(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/bank-accounts/:id/auto-match`, ({ request, params }) => respondAs(m.reconcileWorkspaceMapper, () => bank.autoMatch(userFrom(request), params.id))),
  http.delete<Id>(`${F}/bank-matches/:id`, ({ request, params }) => respondAs(m.bankPlainMapper, () => bank.deleteMatch(userFrom(request), params.id))),
  http.post<Id>(`${F}/bank-statement-lines/:id/create-entry`, async ({ request, params }) => {
    const input = await body<Parameters<typeof bank.createEntryFromLine>[2]>(request, m.createFromLineInputMapper)
    return respondAs(m.reconcileWorkspaceMapper, () => bank.createEntryFromLine(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/bank-accounts/:id/reconciliations`, async ({ request, params }) => {
    const input = await body<Parameters<typeof bank.finishReconciliation>[2]>(request, m.finishReconInputMapper)
    return respondAs(m.reconciliationReportMapper, () => bank.finishReconciliation(userFrom(request), params.id, input))
  }),
  http.get(`${F}/bank-reconciliations`, ({ request }) => respondAs(m.reconciliationMapper, () => bank.listReconciliations(userFrom(request), { bankAccountId: query(request).get('bank_account_id') }))),
  http.get<Id>(`${F}/bank-reconciliations/:id`, ({ request, params }) => respondAs(m.reconciliationReportMapper, () => bank.getReconciliation(userFrom(request), params.id))),
  http.post<Id>(`${F}/bank-reconciliations/:id/undo`, ({ request, params }) => respondAs(m.reconciliationReportMapper, () => bank.undoReconciliation(userFrom(request), params.id))),

  /* ---- rules ---- */
  http.get(`${F}/bank-rules`, ({ request }) => respondAs(m.bankRuleMapper, () => bank.listRules(userFrom(request)))),
  http.post(`${F}/bank-rules`, async ({ request }) => {
    const input = await body<Parameters<typeof bank.createRule>[1]>(request, m.bankRuleInputMapper)
    return respondAs(m.bankRuleMapper, () => bank.createRule(userFrom(request), input))
  }),
  http.patch<Id>(`${F}/bank-rules/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof bank.updateRule>[2]>(request, m.bankRuleInputMapper)
    return respondAs(m.bankRuleMapper, () => bank.updateRule(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${F}/bank-rules/:id`, ({ request, params }) => respondAs(m.bankPlainMapper, () => bank.deleteRule(userFrom(request), params.id))),

  /* ---- transfers ---- */
  http.get(`${F}/bank-transfers`, ({ request }) => respondAs(m.bankTransferMapper, () => bank.listTransfers(userFrom(request), { bankAccountId: query(request).get('bank_account_id') }))),
  http.post(`${F}/bank-transfers`, async ({ request }) => {
    const input = await body<Parameters<typeof bank.createTransfer>[1]>(request, m.transferInputMapper)
    return respondAs(m.bankTransferMapper, () => bank.createTransfer(userFrom(request), input))
  }),
  http.post<Id>(`${F}/bank-transfers/:id/void`, ({ request, params }) => respondAs(m.bankTransferMapper, () => bank.voidTransfer(userFrom(request), params.id))),

  /* ---- payroll posting ---- */
  http.get(`${F}/payroll-postings`, ({ request }) => respondAs(m.payrollPostingMapper, () => pay.listPayrollPostings(userFrom(request)))),
  http.get<Id>(`${F}/payroll-postings/:id`, ({ request, params }) => respondAs(m.payrollPostingMapper, () => pay.getPayrollPosting(userFrom(request), params.id))),
  http.put<Id>(`${F}/payroll-postings/:id/paid-from`, async ({ request, params }) => {
    const input = await body<{ accountId?: unknown }>(request, m.bankPlainMapper)
    return respondAs(m.payrollPostingMapper, () => pay.setPayrollPaidFrom(userFrom(request), params.id, input))
  }),
]
