import { http, type HttpHandler } from 'msw'
import * as pf from '@/shared/mocks/services/hrPerformance'
import * as m from '@/shared/api/hrPerformanceMappers'
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
const P = `${API}/hr/performance`

/**
 * HR › Performance (docs/API.md › HR › Performance). /hr/* is plan-gated centrally (userFrom →
 * 403 module_not_in_plan); roles: services/hrPerformanceCore.ts (own reviews for every employee, direct
 * managers, Department Heads read their team, HR full manages). Fixed paths come before the `:id` ones.
 */
export const hrPerformanceHandlers: HttpHandler[] = [
  http.get(`${P}/options`, ({ request }) => respondAs(m.perfOptionsMapper, () => pf.getOptions(userFrom(request)))),
  http.get(`${P}/my`, ({ request }) => respondAs(m.perfMyMapper, () => pf.getMyPerformance(userFrom(request)))),

  /* templates (HR full) */
  http.get(`${P}/templates`, ({ request }) => respondAs(m.perfTemplateMapper, () => pf.listTemplates(userFrom(request)))),
  http.post(`${P}/templates`, async ({ request }) => {
    const input = await body<Parameters<typeof pf.createTemplate>[1]>(request, m.perfTemplateInputMapper)
    return respondAs(m.perfTemplateMapper, () => pf.createTemplate(userFrom(request), input))
  }),
  http.patch<Id>(`${P}/templates/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.updateTemplate>[2]>(request, m.perfTemplateInputMapper)
    return respondAs(m.perfTemplateMapper, () => pf.updateTemplate(userFrom(request), params.id, input))
  }),

  /* cycles (HR full) */
  http.get(`${P}/cycles`, ({ request }) => respondAs(m.perfCycleMapper, () => pf.listCycles(userFrom(request)))),
  http.post(`${P}/cycles`, async ({ request }) => {
    const input = await body<Parameters<typeof pf.createCycle>[1]>(request, m.perfCycleInputMapper)
    return respondAs(m.perfCycleDetailMapper, () => pf.createCycle(userFrom(request), input))
  }),
  http.get<Id>(`${P}/cycles/:id`, ({ request, params }) => respondAs(m.perfCycleDetailMapper, () => pf.getCycle(userFrom(request), params.id))),
  http.patch<Id>(`${P}/cycles/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.updateCycle>[2]>(request, m.perfCycleInputMapper)
    return respondAs(m.perfCycleDetailMapper, () => pf.updateCycle(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/cycles/:id/launch`, ({ request, params }) => respondAs(m.perfCycleDetailMapper, () => pf.launchCycle(userFrom(request), params.id))),
  http.post<Id>(`${P}/cycles/:id/advance`, ({ request, params }) => respondAs(m.perfCycleDetailMapper, () => pf.advanceCycle(userFrom(request), params.id))),
  http.post<Id>(`${P}/cycles/:id/close`, ({ request, params }) => respondAs(m.perfCycleDetailMapper, () => pf.closeCycle(userFrom(request), params.id))),
  http.post<Id>(`${P}/cycles/:id/remind`, ({ request, params }) => respondAs(m.perfRemindMapper, () => pf.remindCycle(userFrom(request), params.id))),

  /* reviews */
  http.get(`${P}/reviews`, ({ request }) =>
    respondAs(m.perfReviewRowMapper, () => pf.listReviews(userFrom(request), { cycleId: q(request, 'cycle_id'), stage: q(request, 'stage') })),
  ),
  http.get<Id>(`${P}/reviews/:id`, ({ request, params }) => respondAs(m.perfReviewMapper, () => pf.getReview(userFrom(request), params.id))),
  http.put<Id>(`${P}/reviews/:id/self`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.saveSelf>[2]>(request, m.perfAssessmentInputMapper)
    return respondAs(m.perfReviewMapper, () => pf.saveSelf(userFrom(request), params.id, input))
  }),
  http.put<Id>(`${P}/reviews/:id/manager`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.saveManager>[2]>(request, m.perfManagerInputMapper)
    return respondAs(m.perfReviewMapper, () => pf.saveManager(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/reviews/:id/calibrate`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.calibrateReview>[2]>(request, m.perfCalibrateInputMapper)
    return respondAs(m.perfReviewMapper, () => pf.calibrateReview(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/reviews/:id/share`, ({ request, params }) => respondAs(m.perfReviewMapper, () => pf.shareOne(userFrom(request), params.id))),
  http.post<Id>(`${P}/reviews/:id/acknowledge`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.acknowledgeReview>[2]>(request, m.perfAckInputMapper)
    return respondAs(m.perfReviewMapper, () => pf.acknowledgeReview(userFrom(request), params.id, input))
  }),

  /* goals */
  http.post<Id>(`${P}/reviews/:id/goals`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.createGoal>[2]>(request, m.perfGoalInputMapper)
    return respondAs(m.perfReviewMapper, () => pf.createGoal(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${P}/reviews/:id/goals/approve`, ({ request, params }) => respondAs(m.perfReviewMapper, () => pf.approveGoals(userFrom(request), params.id))),
  http.patch<Id>(`${P}/goals/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof pf.updateGoal>[2]>(request, m.perfGoalInputMapper)
    return respondAs(m.perfReviewMapper, () => pf.updateGoal(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${P}/goals/:id`, ({ request, params }) => respondAs(m.perfReviewMapper, () => pf.deleteGoal(userFrom(request), params.id))),
]
