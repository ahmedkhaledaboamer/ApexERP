import { http, type HttpHandler } from 'msw'
import type { LetterDecisionInput, LetterRequestInput, LetterTypeInput, ProfileChangeInput } from '@/modules/hr/selfservice/types'
import * as ss from '@/shared/mocks/services/hrSelfService'
import * as lt from '@/shared/mocks/services/hrLetters'
import * as m from '@/shared/api/hrSelfServiceMappers'
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
 * HR › Self-service ("My HR" portal, profile change requests, HR inbox) and HR letters (docs/API.md › HR ›
 * Self-service, HR letters). Under /hr: plan module `hr` through the request policy. The portal endpoints work for
 * every user with an active employee record, whatever their `hr` scope (like clock-in and leave).
 */
export const hrSelfServiceHandlers: HttpHandler[] = [
  /* ---- portal ---- */
  http.get(`${API}/hr/me`, ({ request }) => respondAs(m.myHrMapper, () => ss.getMyHr(userFrom(request)))),
  http.get<Id>(`${API}/hr/me/payslips/:id`, ({ request, params }) => respondAs(m.myPayslipMapper, () => ss.getMyPayslip(userFrom(request), params.id))),

  /* ---- profile change requests ---- */
  http.get(`${API}/hr/profile-changes`, ({ request }) => respondAs(m.profileChangeMapper, () => ss.listProfileChanges(userFrom(request), { status: q(request).get('status') }))),
  http.post(`${API}/hr/profile-changes`, async ({ request }) => {
    const input = await body<ProfileChangeInput>(request, m.profileChangeInputMapper)
    return respondAs(m.profileChangeMapper, () => ss.submitProfileChange(userFrom(request), input))
  }),
  http.post<Id>(`${API}/hr/profile-changes/:id/approve`, async ({ request, params }) => {
    const input = await body<{ comment?: unknown }>(request, m.selfServicePlainMapper)
    return respondAs(m.profileChangeMapper, () => ss.approveProfileChange(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/profile-changes/:id/reject`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.selfServicePlainMapper)
    return respondAs(m.profileChangeMapper, () => ss.rejectProfileChange(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/profile-changes/:id/cancel`, ({ request, params }) => respondAs(m.profileChangeMapper, () => ss.cancelProfileChange(userFrom(request), params.id))),
  http.post<Id>(`${API}/hr/profile-changes/:id/reveal`, ({ request, params }) => respondAs(m.selfServicePlainMapper, () => ss.revealProfileChangeIban(userFrom(request), params.id))),

  /* ---- HR inbox ---- */
  http.get(`${API}/hr/self-service/inbox`, ({ request }) => respondAs(m.selfServiceInboxMapper, () => ss.getInbox(userFrom(request)))),

  /* ---- letters ---- */
  http.get(`${API}/hr/letters/types`, ({ request }) => respondAs(m.letterTypeMapper, () => lt.listLetterTypes(userFrom(request)))),
  http.patch<Id>(`${API}/hr/letters/types/:id`, async ({ request, params }) => {
    const input = await body<LetterTypeInput>(request, m.letterTypeInputMapper)
    return respondAs(m.letterTypeMapper, () => lt.updateLetterType(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/letters/types/:id/reset`, ({ request, params }) => respondAs(m.letterTypeMapper, () => lt.resetLetterType(userFrom(request), params.id))),
  http.get(`${API}/hr/letters/verify`, ({ request }) => respondAs(m.letterVerificationMapper, () => lt.verifyLetter(userFrom(request), q(request).get('code')))),
  http.get(`${API}/hr/letters/requests`, ({ request }) => {
    const s = q(request)
    return respondAs(m.letterRequestRowMapper, () => lt.listLetterRequests(userFrom(request), { status: s.get('status'), employeeId: s.get('employee_id') }))
  }),
  http.post(`${API}/hr/letters/requests`, async ({ request }) => {
    const input = await body<LetterRequestInput>(request, m.letterRequestInputMapper)
    return respondAs(m.letterRequestMapper, () => lt.createLetterRequest(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/letters/requests/:id`, ({ request, params }) => respondAs(m.letterRequestMapper, () => lt.getLetterRequest(userFrom(request), params.id))),
  http.post<Id>(`${API}/hr/letters/requests/:id/approve`, async ({ request, params }) => {
    const input = await body<LetterDecisionInput & { signatoryTitle?: string }>(request, m.selfServicePlainMapper)
    return respondAs(m.letterRequestMapper, () => lt.approveLetterRequest(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/letters/requests/:id/reject`, async ({ request, params }) => {
    const input = await body<LetterDecisionInput>(request, m.selfServicePlainMapper)
    return respondAs(m.letterRequestMapper, () => lt.rejectLetterRequest(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/letters/requests/:id/cancel`, ({ request, params }) => respondAs(m.letterRequestMapper, () => lt.cancelLetterRequest(userFrom(request), params.id))),
]
