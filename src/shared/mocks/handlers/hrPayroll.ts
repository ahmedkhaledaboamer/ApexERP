import { http, type HttpHandler } from 'msw'
import type { AdjustmentInput, LoanInput, PayrollProfileInput, PaySettingsInput, SettlementInput } from '@/modules/hr/payroll/types'
import * as pay from '@/shared/mocks/services/hrPayroll'
import {
  bankFileMapper,
  payAdjustmentInputMapper,
  payAdjustmentMapper,
  payLoanInputMapper,
  payLoanMapper,
  payPlainMapper,
  payrollProfileInputMapper,
  payrollProfileMapper,
  payrollRunDetailMapper,
  payrollRunRowMapper,
  payrollSummaryMapper,
  paySettingsInputMapper,
  paySettingsMapper,
  payslipMapper,
  payslipRowMapper,
  settlementInputMapper,
  settlementMapper,
} from '@/shared/api/hrPayrollMappers'
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
const P = `${API}/hr/payroll`

/**
 * HR › Salary Management (docs/API.md › HR › Salary management). Plan module `hr` (the `/hr` path gate);
 * everything is HR full except the payslips (own for team / own). Static paths before `:id`.
 */
export const hrPayrollHandlers: HttpHandler[] = [
  /* ---- settings ---- */
  http.get(`${P}/settings`, ({ request }) => respondAs(paySettingsMapper, () => pay.getPaySettings(userFrom(request)))),
  http.patch(`${P}/settings`, async ({ request }) => {
    const input = await body<PaySettingsInput>(request, paySettingsInputMapper)
    return respondAs(paySettingsMapper, () => pay.updatePaySettings(userFrom(request), input))
  }),

  /* ---- payroll profiles (keyed by employee id) ---- */
  http.get(`${P}/profiles`, ({ request }) => respondAs(payrollProfileMapper, () => pay.listPayrollProfiles(userFrom(request)))),
  http.patch<Id>(`${P}/profiles/:id`, async ({ request, params }) => {
    const input = await body<PayrollProfileInput>(request, payrollProfileInputMapper)
    return respondAs(payrollProfileMapper, () => pay.updatePayrollProfile(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/profiles/:id/reveal`, ({ request, params }) => respondAs(payPlainMapper, () => pay.revealPersonId(userFrom(request), params.id))),

  /* ---- adjustments ---- */
  http.get(`${P}/adjustments`, ({ request }) => {
    const q = query(request)
    return respondAs(payAdjustmentMapper, () => pay.listAdjustments(userFrom(request), { month: q.get('month'), employeeId: q.get('employee_id') }))
  }),
  http.post(`${P}/adjustments`, async ({ request }) => {
    const input = await body<AdjustmentInput>(request, payAdjustmentInputMapper)
    return respondAs(payAdjustmentMapper, () => pay.createAdjustment(userFrom(request), input))
  }),
  http.patch<Id>(`${P}/adjustments/:id`, async ({ request, params }) => {
    const input = await body<AdjustmentInput>(request, payAdjustmentInputMapper)
    return respondAs(payAdjustmentMapper, () => pay.updateAdjustment(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${P}/adjustments/:id`, ({ request, params }) => respondAs(payPlainMapper, () => pay.deleteAdjustment(userFrom(request), params.id))),

  /* ---- loans and advances ---- */
  http.get(`${P}/loans`, ({ request }) => {
    const q = query(request)
    return respondAs(payLoanMapper, () => pay.listLoans(userFrom(request), { employeeId: q.get('employee_id'), status: q.get('status') }))
  }),
  http.post(`${P}/loans`, async ({ request }) => {
    const input = await body<LoanInput>(request, payLoanInputMapper)
    return respondAs(payLoanMapper, () => pay.createLoan(userFrom(request), input))
  }),
  http.patch<Id>(`${P}/loans/:id`, async ({ request, params }) => {
    const input = await body<LoanInput>(request, payLoanInputMapper)
    return respondAs(payLoanMapper, () => pay.updateLoan(userFrom(request), params.id, input))
  }),

  /* ---- runs ---- */
  http.get(`${P}/runs`, ({ request }) => respondAs(payrollRunRowMapper, () => pay.listRuns(userFrom(request)))),
  http.post(`${P}/runs`, async ({ request }) => {
    const input = await body<{ month?: unknown; notes?: unknown }>(request, payPlainMapper)
    return respondAs(payrollRunDetailMapper, () => pay.createRun(userFrom(request), input))
  }),
  http.get<Id>(`${P}/runs/:id`, ({ request, params }) => respondAs(payrollRunDetailMapper, () => pay.getRun(userFrom(request), params.id))),
  http.delete<Id>(`${P}/runs/:id`, ({ request, params }) => respondAs(payPlainMapper, () => pay.deleteRun(userFrom(request), params.id))),
  http.post<Id>(`${P}/runs/:id/calculate`, ({ request, params }) => respondAs(payrollRunDetailMapper, () => pay.calculateRun(userFrom(request), params.id))),
  http.post<Id>(`${P}/runs/:id/acknowledge`, async ({ request, params }) => {
    const input = await body<{ warnings?: unknown; all?: unknown }>(request, payPlainMapper)
    return respondAs(payrollRunDetailMapper, () => pay.acknowledgeWarnings(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/runs/:id/approve`, ({ request, params }) => respondAs(payrollRunDetailMapper, () => pay.approveRun(userFrom(request), params.id))),
  http.post<Id>(`${P}/runs/:id/reopen`, ({ request, params }) => respondAs(payrollRunDetailMapper, () => pay.reopenRun(userFrom(request), params.id))),
  http.post<Id>(`${P}/runs/:id/pay`, ({ request, params }) => respondAs(payrollRunDetailMapper, () => pay.payRun(userFrom(request), params.id))),
  http.post<Id>(`${P}/runs/:id/bank-file`, async ({ request, params }) => {
    const input = await body<{ format?: unknown }>(request, payPlainMapper)
    return respondAs(bankFileMapper, () => pay.exportBankFile(userFrom(request), params.id, input))
  }),

  /* ---- payslips ---- */
  http.get(`${P}/payslips`, ({ request }) => {
    const q = query(request)
    return respondAs(payslipRowMapper, () => pay.listPayslips(userFrom(request), { employeeId: q.get('employee_id'), month: q.get('month') }))
  }),
  http.get<Id>(`${P}/payslips/:id`, ({ request, params }) => respondAs(payslipMapper, () => pay.getPayslip(userFrom(request), params.id))),

  /* ---- summary ---- */
  http.get(`${P}/summary`, ({ request }) => respondAs(payrollSummaryMapper, () => pay.getSummary(userFrom(request), { months: query(request).get('months') }))),

  /* ---- final settlements ---- */
  http.get(`${P}/settlements`, ({ request }) => respondAs(settlementMapper, () => pay.listSettlements(userFrom(request)))),
  http.post(`${P}/settlements/preview`, async ({ request }) => {
    const input = await body<SettlementInput>(request, settlementInputMapper)
    return respondAs(settlementMapper, () => pay.previewSettlement(userFrom(request), input))
  }),
  http.post(`${P}/settlements`, async ({ request }) => {
    const input = await body<SettlementInput>(request, settlementInputMapper)
    return respondAs(settlementMapper, () => pay.createSettlement(userFrom(request), input))
  }),
  http.get<Id>(`${P}/settlements/:id`, ({ request, params }) => respondAs(settlementMapper, () => pay.getSettlement(userFrom(request), params.id))),
  http.patch<Id>(`${P}/settlements/:id`, async ({ request, params }) => {
    const input = await body<SettlementInput>(request, settlementInputMapper)
    return respondAs(settlementMapper, () => pay.updateSettlement(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${P}/settlements/:id`, ({ request, params }) => respondAs(payPlainMapper, () => pay.deleteSettlement(userFrom(request), params.id))),
  http.post<Id>(`${P}/settlements/:id/pay`, ({ request, params }) => respondAs(settlementMapper, () => pay.paySettlement(userFrom(request), params.id))),
]
