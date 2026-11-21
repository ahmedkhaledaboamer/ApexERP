import { moduleOverrides } from '@/shared/mocks/data/platform'
import { companyById } from '@/shared/mocks/data/tenancy'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import { hrPerfCycles, hrPerfGoals, hrPerfReviews, hrPerfTemplates } from '@/shared/mocks/data/hrPerformance'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { APEX, adminToken, api, userToken, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR › Performance (handlers/hrPerformance.ts), spread into ENDPOINTS (endpoints.ts).
 * Crest's plan has no HR: every sample turns it on for Crest with a platform module override first. Samples
 * name the company's own seed rows (this year's annual cycle in self-review) or build a review through the
 * API up to the step they need (calibration / shared), as the company admin (HR full) and the reviewee's
 * direct manager (Apex: EMP-u10 ← u2; Crest: EMP-u106 ← u102).
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`

function withHr(co: Co): void {
  if (co === APEX) return
  if (moduleOverrides.some((o) => o.companyId === co && o.module === 'hr' && o.enabled)) return
  moduleOverrides.push({ companyId: co, module: 'hr', enabled: true, reason: 'Isolation: HR enabled', by: 'p1', at: new Date().toISOString() })
}
const hr = (f: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  withHr(co)
  return f(co)
}

const day = (co: Co, n = 0) => addDaysIso(todayIsoIn(companyById(co)!.regional.timezone), n)
/** The reviewee and their direct manager (a user) used by the samples. */
const REVIEWEE: Record<Co, string> = { co_apex: 'EMP-u10', co_crest: 'EMP-u106' }
const MANAGER: Record<Co, string> = { co_apex: 'u2', co_crest: 'u102' }
const MANAGEE_USER: Record<Co, string> = { co_apex: 'u10', co_crest: 'u106' }

function curCycle(co: Co) {
  const c = hrPerfCycles.find((x) => x.companyId === co && x.type === 'annual' && x.phase === 'self_review')
  if (!c) throw new Error(`Isolation table: no annual cycle in self-review in ${co}`)
  return c
}
function reviewOf(co: Co, employeeId: string) {
  const r = hrPerfReviews.find((x) => x.companyId === co && x.cycleId === curCycle(co).id && x.employeeId === employeeId)
  if (!r) throw new Error(`Isolation table: no review of ${employeeId} in ${co}`)
  return r
}
const managedReview = (co: Co) => reviewOf(co, REVIEWEE[co])
/** A review of this year's cycle whose employee (with a login) hasn't submitted the self-review. */
function openSelfReview(co: Co): { id: string; as: string } {
  for (const r of hrPerfReviews) {
    if (r.companyId !== co || r.cycleId !== curCycle(co).id || r.self.submittedAt) continue
    const e = employeeById(co, r.employeeId)
    if (e?.userId) return { id: r.id, as: e.userId }
  }
  throw new Error(`Isolation table: no open self-review in ${co}`)
}
const firstTemplate = (co: Co) => hrPerfTemplates.find((t) => t.companyId === co)!
const checkinTemplate = (co: Co) => hrPerfTemplates.find((t) => t.companyId === co && !t.goalsEnabled && t.selfReview && !t.forProbation)!

async function call(token: string, method: string, path: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(token, method, path, { body })
  if (r.status !== 200) throw new Error(`Isolation table: ${method} ${path} answered ${r.status}: ${r.text}`)
  return r.body
}

const cycleBody = (co: Co, extra: Record<string, unknown> = {}) => ({
  name: `Isolation cycle ${uniq()}`,
  type: 'ad_hoc',
  template_id: checkinTemplate(co).id,
  period_start: day(co, -90),
  period_end: day(co, 0),
  employee_ids: [REVIEWEE[co]],
  deadlines: { self_review: day(co, 5), manager_review: day(co, 10), calibration: day(co, 15) },
  ...extra,
})

/** A fresh one-person cycle walked up to `upTo` through the API; returns the review id. */
async function pipeline(co: Co, upTo: 'draft' | 'calibration' | 'shared'): Promise<{ cycleId: string; reviewId: string }> {
  const admin = adminToken(co)
  const created = await call(admin, 'POST', '/hr/performance/cycles', cycleBody(co))
  const cycleId = created.id as string
  if (upTo === 'draft') return { cycleId, reviewId: '' }
  const launched = await call(admin, 'POST', `/hr/performance/cycles/${cycleId}/launch`)
  const reviewId = launched.reviews[0].id as string
  await call(admin, 'POST', `/hr/performance/cycles/${cycleId}/advance`)
  const questions = checkinTemplate(co).sections.flatMap((s) => s.questions)
  await call(userToken(MANAGER[co]), 'PUT', `/hr/performance/reviews/${reviewId}/manager`, {
    answers: questions.map((q) => ({ question_id: q.id, rating: 4, comment: '' })),
    summary: 'Isolation',
    submit: true,
  })
  await call(admin, 'POST', `/hr/performance/cycles/${cycleId}/advance`)
  if (upTo === 'shared') await call(admin, 'POST', `/hr/performance/reviews/${reviewId}/share`)
  return { cycleId, reviewId }
}

const M = 'hr'

export const HR_PERFORMANCE_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/hr/performance/options', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/performance/my', kind: 'company-list', module: M, sample: hr((co) => ({ as: MANAGEE_USER[co] })) },
  /* templates */
  { method: 'GET', path: '/hr/performance/templates', kind: 'company-list', module: M, sample: hr(() => ({})) },
  {
    method: 'POST', path: '/hr/performance/templates', kind: 'company-write', module: M,
    sample: hr(() => ({ body: { name: `Iso template ${uniq()}`, goals_enabled: true, goals_weight: 30, sections: [{ title: 'Craft', questions: [{ text: 'Quality of work' }] }] } })),
  },
  { method: 'PATCH', path: '/hr/performance/templates/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: firstTemplate(co).id }, body: { description: 'Isolation description' } })) },
  /* cycles */
  { method: 'GET', path: '/hr/performance/cycles', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'POST', path: '/hr/performance/cycles', kind: 'company-write', module: M, sample: hr((co) => ({ body: cycleBody(co) })) },
  { method: 'GET', path: '/hr/performance/cycles/:id', kind: 'company-export', module: M, sample: hr((co) => ({ params: { id: curCycle(co).id } })) },
  { method: 'PATCH', path: '/hr/performance/cycles/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: curCycle(co).id }, body: { name: `Annual review (renamed ${uniq()})` } })) },
  { method: 'POST', path: '/hr/performance/cycles/:id/launch', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: (await pipeline(co, 'draft')).cycleId } })) },
  { method: 'POST', path: '/hr/performance/cycles/:id/advance', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: curCycle(co).id } })) },
  { method: 'POST', path: '/hr/performance/cycles/:id/close', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: curCycle(co).id } })) },
  { method: 'POST', path: '/hr/performance/cycles/:id/remind', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: curCycle(co).id } })) },
  /* reviews */
  { method: 'GET', path: '/hr/performance/reviews', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/performance/reviews/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: managedReview(co).id } })) },
  {
    method: 'PUT', path: '/hr/performance/reviews/:id/self', kind: 'company-item', module: M,
    sample: hr((co) => {
      const r = openSelfReview(co)
      return { params: { id: r.id }, as: r.as, body: { summary: 'Isolation draft', submit: false } }
    }),
  },
  {
    method: 'PUT', path: '/hr/performance/reviews/:id/manager', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: managedReview(co).id }, as: MANAGER[co], body: { summary: 'Isolation draft', recommended_course_ids: [], submit: false } })),
  },
  {
    method: 'POST', path: '/hr/performance/reviews/:id/calibrate', kind: 'company-item', module: M,
    sample: hr(async (co) => ({ params: { id: (await pipeline(co, 'calibration')).reviewId }, body: { rating: 3, note: 'Isolation calibration' } })),
  },
  { method: 'POST', path: '/hr/performance/reviews/:id/share', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: (await pipeline(co, 'calibration')).reviewId } })) },
  {
    method: 'POST', path: '/hr/performance/reviews/:id/acknowledge', kind: 'company-item', module: M,
    sample: hr(async (co) => ({ params: { id: (await pipeline(co, 'shared')).reviewId }, as: MANAGEE_USER[co], body: { comment: 'Thanks' } })),
  },
  /* goals */
  {
    method: 'POST', path: '/hr/performance/reviews/:id/goals', kind: 'company-item', module: M,
    sample: hr(async (co) => {
      const r = managedReview(co)
      const last = hrPerfGoals.filter((g) => g.companyId === co && g.reviewId === r.id).at(-1)!
      await call(userToken(MANAGER[co]), 'DELETE', `/hr/performance/goals/${last.id}`)
      return { params: { id: r.id }, as: MANAGER[co], body: { title: 'Isolation goal', weight: last.weight, target: 'Done' } }
    }),
  },
  { method: 'POST', path: '/hr/performance/reviews/:id/goals/approve', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: managedReview(co).id }, as: MANAGER[co] })) },
  {
    method: 'PATCH', path: '/hr/performance/goals/:id', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: hrPerfGoals.find((g) => g.companyId === co && g.reviewId === managedReview(co).id)!.id }, as: MANAGER[co], body: { progress: 55 } })),
  },
  {
    method: 'DELETE', path: '/hr/performance/goals/:id', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: hrPerfGoals.filter((g) => g.companyId === co && g.reviewId === managedReview(co).id).at(-1)!.id }, as: MANAGER[co] })),
  },
]
