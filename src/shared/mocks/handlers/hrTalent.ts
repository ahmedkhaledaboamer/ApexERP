import { http, type HttpHandler } from 'msw'
import * as rec from '@/shared/mocks/services/hrRecruitment'
import * as trn from '@/shared/mocks/services/hrTraining'
import * as m from '@/shared/api/hrTalentMappers'
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
const q = (request: Request, key: string) => new URL(request.url).searchParams.get(key)

/**
 * HR › Recruitment and Training (docs/API.md › HR › Recruitment, Training). /hr/* is plan-gated
 * centrally (userFrom → enforceRequestPolicy → 403 module_not_in_plan); roles follow the `hr` column.
 * Fixed paths (options, check, my-interviews, matrix, budget, my) come before the `:id` ones.
 */
export const hrTalentHandlers: HttpHandler[] = [
  /* ---- recruitment ---- */
  http.get(`${API}/hr/recruitment/options`, ({ request }) => respondAs(m.recruitmentOptionsMapper, () => rec.recruitmentOptions(userFrom(request)))),
  http.get(`${API}/hr/recruitment/openings`, ({ request }) => respondAs(m.openingMapper, () => rec.listOpenings(userFrom(request)))),
  http.post(`${API}/hr/recruitment/openings`, async ({ request }) => {
    const input = await body<Parameters<typeof rec.createOpening>[1]>(request, m.openingInputMapper)
    return respondAs(m.openingMapper, () => rec.createOpening(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/recruitment/openings/:id`, ({ request, params }) => respondAs(m.openingDetailMapper, () => rec.getOpening(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/recruitment/openings/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.updateOpening>[2]>(request, m.openingInputMapper)
    return respondAs(m.openingMapper, () => rec.updateOpening(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/recruitment/openings/:id/status`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.setOpeningStatus>[2]>(request, m.openingStatusInputMapper)
    return respondAs(m.openingMapper, () => rec.setOpeningStatus(userFrom(request), params.id, input))
  }),

  http.get(`${API}/hr/recruitment/candidates`, ({ request }) => respondAs(m.candidateMapper, () => rec.listCandidates(userFrom(request)))),
  http.post(`${API}/hr/recruitment/candidates`, async ({ request }) => {
    const input = await body<Parameters<typeof rec.createCandidate>[1]>(request, m.candidateInputMapper)
    return respondAs(m.candidateMapper, () => rec.createCandidate(userFrom(request), input))
  }),
  http.get(`${API}/hr/recruitment/candidates/check`, ({ request }) =>
    respondAs(m.duplicateCheckMapper, () => rec.checkDuplicates(userFrom(request), q(request, 'email'), q(request, 'mobile'), q(request, 'exclude'))),
  ),
  http.get<Id>(`${API}/hr/recruitment/candidates/:id`, ({ request, params }) => respondAs(m.candidateDetailMapper, () => rec.getCandidate(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/recruitment/candidates/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.updateCandidate>[2]>(request, m.candidateInputMapper)
    return respondAs(m.candidateMapper, () => rec.updateCandidate(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/recruitment/candidates/:id/cv`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.attachCv>[2]>(request, m.cvInputMapper)
    return respondAs(m.candidateMapper, () => rec.attachCv(userFrom(request), params.id, input))
  }),

  http.post(`${API}/hr/recruitment/applications`, async ({ request }) => {
    const input = await body<Parameters<typeof rec.createApplication>[1]>(request, m.applicationInputMapper)
    return respondAs(m.applicationMapper, () => rec.createApplication(userFrom(request), input))
  }),
  http.post<Id>(`${API}/hr/recruitment/applications/:id/stage`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.moveApplication>[2]>(request, m.stageInputMapper)
    return respondAs(m.applicationMapper, () => rec.moveApplication(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/recruitment/applications/:id/interviews`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.scheduleInterview>[2]>(request, m.interviewInputMapper)
    return respondAs(m.interviewMapper, () => rec.scheduleInterview(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/recruitment/applications/:id/offers`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.createOffer>[2]>(request, m.offerInputMapper)
    return respondAs(m.offerMapper, () => rec.createOffer(userFrom(request), params.id, input))
  }),

  http.get(`${API}/hr/recruitment/my-interviews`, ({ request }) => respondAs(m.interviewCardMapper, () => rec.myInterviews(userFrom(request)))),
  http.patch<Id>(`${API}/hr/recruitment/interviews/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.updateInterview>[2]>(request, m.interviewInputMapper)
    return respondAs(m.interviewMapper, () => rec.updateInterview(userFrom(request), params.id, input))
  }),
  http.put<Id>(`${API}/hr/recruitment/interviews/:id/scorecard`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.submitScorecard>[2]>(request, m.scorecardInputMapper)
    return respondAs(m.interviewMapper, () => rec.submitScorecard(userFrom(request), params.id, input))
  }),

  http.patch<Id>(`${API}/hr/recruitment/offers/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.updateOffer>[2]>(request, m.offerInputMapper)
    return respondAs(m.offerMapper, () => rec.updateOffer(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/recruitment/offers/:id/status`, async ({ request, params }) => {
    const input = await body<Parameters<typeof rec.setOfferStatus>[2]>(request, m.offerStatusInputMapper)
    return respondAs(m.offerMapper, () => rec.setOfferStatus(userFrom(request), params.id, input))
  }),

  /* ---- training ---- */
  http.get(`${API}/hr/training/options`, ({ request }) => respondAs(m.trainingOptionsMapper, () => trn.trainingOptions(userFrom(request)))),
  http.get(`${API}/hr/training/matrix`, ({ request }) => respondAs(m.trainingMatrixMapper, () => trn.trainingMatrix(userFrom(request)))),
  http.get(`${API}/hr/training/budget`, ({ request }) => respondAs(m.trainingBudgetMapper, () => trn.trainingBudget(userFrom(request), q(request, 'year')))),
  http.get(`${API}/hr/training/my`, ({ request }) => respondAs(m.myTrainingMapper, () => trn.myTraining(userFrom(request)))),
  http.get(`${API}/hr/training/courses`, ({ request }) => respondAs(m.courseMapper, () => trn.listCourses(userFrom(request)))),
  http.post(`${API}/hr/training/courses`, async ({ request }) => {
    const input = await body<Parameters<typeof trn.createCourse>[1]>(request, m.courseInputMapper)
    return respondAs(m.courseMapper, () => trn.createCourse(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/training/courses/:id`, ({ request, params }) => respondAs(m.courseDetailMapper, () => trn.getCourse(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/training/courses/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof trn.updateCourse>[2]>(request, m.courseInputMapper)
    return respondAs(m.courseMapper, () => trn.updateCourse(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/training/courses/:id/sessions`, async ({ request, params }) => {
    const input = await body<Parameters<typeof trn.createSession>[2]>(request, m.sessionInputMapper)
    return respondAs(m.sessionMapper, () => trn.createSession(userFrom(request), params.id, input))
  }),
  http.patch<Id>(`${API}/hr/training/sessions/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof trn.updateSession>[2]>(request, m.sessionInputMapper)
    return respondAs(m.sessionMapper, () => trn.updateSession(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/training/sessions/:id/enrollments`, async ({ request, params }) => {
    const input = await body<Parameters<typeof trn.enroll>[2]>(request, m.enrollInputMapper)
    return respondAs(m.enrollmentMapper, () => trn.enroll(userFrom(request), params.id, input))
  }),
  http.patch<Id>(`${API}/hr/training/enrollments/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof trn.updateEnrollment>[2]>(request, m.enrollmentInputMapper)
    return respondAs(m.enrollmentMapper, () => trn.updateEnrollment(userFrom(request), params.id, input))
  }),
  http.get(`${API}/hr/training/certificates`, ({ request }) => respondAs(m.certificateMapper, () => trn.listCertificates(userFrom(request)))),
  http.patch<Id>(`${API}/hr/training/certificates/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof trn.updateCertificate>[2]>(request, m.certificateInputMapper)
    return respondAs(m.certificateMapper, () => trn.updateCertificate(userFrom(request), params.id, input))
  }),
]
