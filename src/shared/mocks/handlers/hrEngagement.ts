import { http, type HttpHandler } from 'msw'
import * as eng from '@/shared/mocks/services/hrEngagement'
import * as fb from '@/shared/mocks/services/hrFeedback'
import * as m from '@/shared/api/hrEngagementMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }

/** Body or null for an empty / malformed body (the services answer 422). */
async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    const raw = (await request.clone().json()) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const q = (request: Request, key: string) => new URL(request.url).searchParams.get(key) ?? undefined
const E = `${API}/hr/engagement`
const F = `${API}/hr/feedback`

/**
 * HR › Engagement surveys and 360° feedback (docs/API.md › HR › Engagement surveys, 360° feedback). /hr/* is
 * plan-gated centrally (userFrom → 403 module_not_in_plan). Roles: services/hrEngagementCore.ts and
 * services/hrFeedback.ts (answering a survey and giving feedback work for every employee, whatever their `hr`
 * scope). Fixed paths come before the `:id` ones.
 */
export const hrEngagementHandlers: HttpHandler[] = [
  /* surveys */
  http.get(`${E}/options`, ({ request }) => respondAs(m.engOptionsMapper, () => eng.getOptions(userFrom(request)))),
  http.patch(`${E}/settings`, async ({ request }) => {
    const input = await body<Parameters<typeof eng.updateSettings>[1]>(request, m.engSettingsInputMapper)
    return respondAs(m.engSettingsMapper, () => eng.updateSettings(userFrom(request), input))
  }),
  http.get(`${E}/overview`, ({ request }) => respondAs(m.engOverviewMapper, () => eng.getOverview(userFrom(request)))),
  http.get(`${E}/my`, ({ request }) => respondAs(m.mySurveysMapper, () => eng.getMySurveys(userFrom(request)))),
  http.get<Id>(`${E}/my/:id`, ({ request, params }) => respondAs(m.mySurveyFormMapper, () => eng.getMySurvey(userFrom(request), params.id))),
  http.put<Id>(`${E}/my/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof eng.answerSurvey>[2]>(request, m.answerInputMapper)
    return respondAs(m.mySurveyFormMapper, () => eng.answerSurvey(userFrom(request), params.id, input))
  }),
  http.get(`${E}/surveys`, ({ request }) => respondAs(m.surveyMapper, () => eng.listSurveys(userFrom(request)))),
  http.post(`${E}/surveys`, async ({ request }) => {
    const input = await body<Parameters<typeof eng.createSurvey>[1]>(request, m.surveyInputMapper)
    return respondAs(m.surveyMapper, () => eng.createSurvey(userFrom(request), input))
  }),
  http.get<Id>(`${E}/surveys/:id`, ({ request, params }) => respondAs(m.surveyMapper, () => eng.getSurvey(userFrom(request), params.id))),
  http.patch<Id>(`${E}/surveys/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof eng.updateSurvey>[2]>(request, m.surveyInputMapper)
    return respondAs(m.surveyMapper, () => eng.updateSurvey(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${E}/surveys/:id/launch`, ({ request, params }) => respondAs(m.surveyMapper, () => eng.launchSurvey(userFrom(request), params.id))),
  http.post<Id>(`${E}/surveys/:id/close`, ({ request, params }) => respondAs(m.surveyMapper, () => eng.closeSurvey(userFrom(request), params.id))),
  http.get<Id>(`${E}/surveys/:id/results`, ({ request, params }) =>
    respondAs(m.surveyResultsMapper, () => eng.getResults(userFrom(request), params.id, { departmentId: q(request, 'department_id'), tenureBand: q(request, 'tenure_band') })),
  ),
  http.get<Id>(`${E}/surveys/:id/export`, ({ request, params }) => respondAs(m.surveyExportMapper, () => eng.exportResults(userFrom(request), params.id))),

  /* 360° feedback */
  http.get(`${F}/options`, ({ request }) => respondAs(m.fbOptionsMapper, () => fb.getOptions(userFrom(request)))),
  http.get(`${F}/my`, ({ request }) => respondAs(m.myFeedbackMapper, () => fb.getMyFeedback(userFrom(request)))),
  http.get(`${F}/rounds`, ({ request }) => respondAs(m.roundMapper, () => fb.listRounds(userFrom(request)))),
  http.post(`${F}/rounds`, async ({ request }) => {
    const input = await body<Parameters<typeof fb.createRound>[1]>(request, m.roundInputMapper)
    return respondAs(m.roundMapper, () => fb.createRound(userFrom(request), input))
  }),
  http.get<Id>(`${F}/rounds/:id`, ({ request, params }) => respondAs(m.roundMapper, () => fb.getRound(userFrom(request), params.id))),
  http.post<Id>(`${F}/rounds/:id/providers`, async ({ request, params }) => {
    const input = await body<Parameters<typeof fb.addProviders>[2]>(request, m.providersInputMapper)
    return respondAs(m.roundMapper, () => fb.addProviders(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/rounds/:id/nominations`, async ({ request, params }) => {
    const input = await body<Parameters<typeof fb.nominate>[2]>(request, m.nominateInputMapper)
    return respondAs(m.roundMapper, () => fb.nominate(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/rounds/:id/nominations/decide`, async ({ request, params }) => {
    const input = await body<Parameters<typeof fb.decideNominations>[2]>(request, m.decideInputMapper)
    return respondAs(m.roundMapper, () => fb.decideNominations(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/rounds/:id/close`, ({ request, params }) => respondAs(m.roundMapper, () => fb.closeRound(userFrom(request), params.id))),
  http.get<Id>(`${F}/rounds/:id/summary`, ({ request, params }) => respondAs(m.summaryMapper, () => fb.getSummary(userFrom(request), params.id))),
  http.get<Id>(`${F}/reviews/:id`, ({ request, params }) => respondAs(m.reviewFeedbackMapper, () => fb.getReviewFeedback(userFrom(request), params.id))),
  http.get<Id>(`${F}/invitations/:id`, ({ request, params }) => respondAs(m.invitationMapper, () => fb.getInvitation(userFrom(request), params.id))),
  http.put<Id>(`${F}/invitations/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof fb.answerInvitation>[2]>(request, m.invitationInputMapper)
    return respondAs(m.invitationMapper, () => fb.answerInvitation(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/invitations/:id/decline`, async ({ request, params }) => {
    const input = await body<Parameters<typeof fb.declineInvitation>[2]>(request, m.declineInputMapper)
    return respondAs(m.invitationMapper, () => fb.declineInvitation(userFrom(request), params.id, input))
  }),
]
