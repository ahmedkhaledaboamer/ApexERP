import { http, type HttpHandler } from 'msw'
import type { AcknowledgeInput, DisciplinaryInput, PolicyInput } from '@/modules/hr/compliance/types'
import * as svc from '@/shared/mocks/services/hrCompliance'
import * as m from '@/shared/api/hrComplianceMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const q = (request: Request) => new URL(request.url).searchParams
type Id = { id: string }

/**
 * HR › Discipline (warnings & disciplinary actions) and Policies (docs/API.md › HR › Discipline, Policies). Under /hr:
 * plan module `hr` through the request policy. Self-service parts (own records, acknowledging, own policies) work for
 * every user with an active employee record, whatever their `hr` scope. Static paths before `:id`.
 */
export const hrComplianceHandlers: HttpHandler[] = [
  /* ---- discipline ---- */
  http.get(`${API}/hr/discipline`, ({ request }) => {
    const s = q(request)
    return respondAs(m.disciplinaryRowMapper, () =>
      svc.listDiscipline(userFrom(request), { employeeId: s.get('employee_id'), status: s.get('status'), type: s.get('type'), mine: s.get('mine') === '1' || s.get('mine') === 'true' }),
    )
  }),
  http.post(`${API}/hr/discipline`, async ({ request }) => {
    const input = await body<Partial<DisciplinaryInput>>(request, m.disciplinaryInputMapper)
    return respondAs(m.disciplinaryMapper, () => svc.createDiscipline(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/discipline/:id`, ({ request, params }) => respondAs(m.disciplinaryMapper, () => svc.getDiscipline(userFrom(request), params.id))),
  http.get<Id>(`${API}/hr/discipline/:id/letter`, ({ request, params }) => {
    const s = q(request)
    return respondAs(m.warningLetterMapper, () => svc.getWarningLetter(userFrom(request), params.id, { language: s.get('language'), digits: s.get('digits') }))
  }),
  http.post<Id>(`${API}/hr/discipline/:id/attachments`, async ({ request, params }) => {
    const input = await body<{ attachments?: unknown }>(request, m.compliancePlainMapper)
    return respondAs(m.disciplinaryMapper, () => svc.addDisciplineAttachments(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/discipline/:id/withdraw`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.compliancePlainMapper)
    return respondAs(m.disciplinaryMapper, () => svc.withdrawDiscipline(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/discipline/:id/acknowledge`, async ({ request, params }) => {
    const input = await body<AcknowledgeInput>(request, m.acknowledgeInputMapper)
    return respondAs(m.disciplinaryMapper, () => svc.acknowledgeDiscipline(userFrom(request), params.id, input))
  }),

  /* ---- policies ---- */
  http.get(`${API}/hr/policies`, ({ request }) => respondAs(m.policyRowMapper, () => svc.listPolicies(userFrom(request)))),
  http.post(`${API}/hr/policies`, async ({ request }) => {
    const input = await body<PolicyInput>(request, m.policyInputMapper)
    return respondAs(m.policyMapper, () => svc.createPolicy(userFrom(request), input))
  }),
  http.get(`${API}/hr/policies/my`, ({ request }) => respondAs(m.myPolicyMapper, () => svc.myPolicies(userFrom(request)))),
  http.get<Id>(`${API}/hr/policies/:id`, ({ request, params }) => respondAs(m.policyMapper, () => svc.getPolicy(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/policies/:id`, async ({ request, params }) => {
    const input = await body<PolicyInput>(request, m.policyInputMapper)
    return respondAs(m.policyMapper, () => svc.updatePolicy(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/policies/:id/publish`, async ({ request, params }) => {
    const input = await body<{ changeNote?: unknown }>(request, m.compliancePlainMapper)
    return respondAs(m.policyMapper, () => svc.publishPolicy(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/policies/:id/archive`, ({ request, params }) => respondAs(m.policyMapper, () => svc.archivePolicy(userFrom(request), params.id))),
  http.get<Id>(`${API}/hr/policies/:id/status`, ({ request, params }) => respondAs(m.policyStatusMapper, () => svc.getPolicyStatus(userFrom(request), params.id))),
  http.get<Id>(`${API}/hr/policies/:id/export`, ({ request, params }) => respondAs(m.policyExportMapper, () => svc.exportPolicyStatus(userFrom(request), params.id))),
  http.post<Id>(`${API}/hr/policies/:id/acknowledge`, async ({ request, params }) => {
    const input = await body<{ version?: unknown }>(request, m.compliancePlainMapper)
    return respondAs(m.myPolicyMapper, () => svc.acknowledgePolicy(userFrom(request), params.id, input))
  }),
]
