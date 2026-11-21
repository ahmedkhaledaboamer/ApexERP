import { http, type HttpHandler } from 'msw'
import type { ReportQuery, ReportSettingsInput } from '@/modules/hr/reports/types'
import * as rep from '@/shared/mocks/services/hrReports'
import * as m from '@/shared/api/hrReportsMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/** `from`, `to`, `department_id` (company-local yyyy-MM-dd; the department in the caller's scope). */
function reportQuery(request: Request): ReportQuery {
  const s = new URL(request.url).searchParams
  return { from: s.get('from') ?? undefined, to: s.get('to') ?? undefined, departmentId: s.get('department_id') ?? undefined }
}

/**
 * HR › Reports (docs/API.md › HR › HR reports). Under /hr: plan module `hr` through the request policy.
 * Static report paths are registered before `/hr/reports/:report/export`.
 */
export const hrReportsHandlers: HttpHandler[] = [
  http.get(`${API}/hr/reports/options`, ({ request }) => respondAs(m.reportOptionsMapper, () => rep.reportOptions(userFrom(request)))),
  http.get(`${API}/hr/reports/overview`, ({ request }) => respondAs(m.overviewReportMapper, () => rep.overviewReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/headcount`, ({ request }) => respondAs(m.headcountReportMapper, () => rep.headcountReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/turnover`, ({ request }) => respondAs(m.turnoverReportMapper, () => rep.turnoverReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/nationalisation`, ({ request }) => respondAs(m.nationalisationReportMapper, () => rep.nationalisationReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/attendance`, ({ request }) => respondAs(m.attendanceReportMapper, () => rep.attendanceReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/leave`, ({ request }) => respondAs(m.leaveReportMapper, () => rep.leaveReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/compliance`, ({ request }) => respondAs(m.complianceReportMapper, () => rep.complianceReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/assets`, ({ request }) => respondAs(m.assetsReportMapper, () => rep.assetsReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/recruitment`, ({ request }) => respondAs(m.recruitmentReportMapper, () => rep.recruitmentReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/training`, ({ request }) => respondAs(m.trainingReportMapper, () => rep.trainingReport(userFrom(request), reportQuery(request)))),
  http.get(`${API}/hr/reports/payroll-cost`, ({ request }) => respondAs(m.payrollCostReportMapper, () => rep.payrollCostReport(userFrom(request), reportQuery(request)))),
  http.put(`${API}/hr/reports/settings`, async ({ request }) => {
    const input = await body<ReportSettingsInput>(request, m.reportSettingsInputMapper)
    return respondAs(m.reportSettingsMapper, () => rep.updateReportSettings(userFrom(request), input))
  }),
  http.get<{ report: string }>(`${API}/hr/reports/:report/export`, ({ request, params }) =>
    respondAs(m.reportExportMapper, () => rep.exportReport(userFrom(request), params.report, reportQuery(request))),
  ),
]
