import { companyById } from '@/shared/mocks/data/tenancy'
import { hrEngSurveys, hrFbProviders, hrFbRounds } from '@/shared/mocks/data/hrEngagement'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { ADMIN, adminToken, api, userToken, type Co } from './harness'
import { withHr } from './hrTalentEndpoints'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR › Engagement surveys and 360° feedback (handlers/hrEngagement.ts), spread into
 * ENDPOINTS (endpoints.ts). Crest's plan has no HR: every sample turns it on for Crest with a platform module override
 * first. Samples name the company's own seed rows (the open engagement survey, the closed eNPS waves, the 360° round
 * in this year's cycle) or build what they need through the API, as the company admin (HR full), the reviewed
 * employee (Apex EMP-u14, Crest EMP-u105), their manager (u10 / u103: a Sales Manager with `hr` hidden) or a
 * colleague asked for feedback (u17 / u106, pending).
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`

const hr = (f: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  withHr(co)
  return f(co)
}
const day = (co: Co, n = 0) => addDaysIso(todayIsoIn(companyById(co)!.regional.timezone), n)

export const FB_SUBJECT_USER: Record<Co, string> = { co_apex: 'u14', co_crest: 'u105' }
export const FB_MANAGER: Record<Co, string> = { co_apex: 'u10', co_crest: 'u103' }
/** A colleague asked in the seeded round who hasn't answered yet. */
export const FB_PENDING_USER: Record<Co, string> = { co_apex: 'u17', co_crest: 'u106' }
/** A colleague not asked in the seeded round. */
export const FB_OTHER_EMP: Record<Co, string> = { co_apex: 'EMP-u4', co_crest: 'EMP-u102' }

export function openEngagement(co: Co) {
  const s = hrEngSurveys.find((x) => x.companyId === co && x.kind === 'engagement' && x.status === 'open')
  if (!s) throw new Error(`Isolation table: no open engagement survey in ${co}`)
  return s
}
export function closedEnps(co: Co) {
  const s = hrEngSurveys.filter((x) => x.companyId === co && x.kind === 'enps' && x.status === 'closed').at(-1)
  if (!s) throw new Error(`Isolation table: no closed eNPS wave in ${co}`)
  return s
}
export function seededRound(co: Co) {
  const r = hrFbRounds.find((x) => x.companyId === co && x.reviewId)
  if (!r) throw new Error(`Isolation table: no 360° round in ${co}`)
  return r
}
export function pendingInvitation(co: Co) {
  const p = hrFbProviders.find((x) => x.companyId === co && x.roundId === seededRound(co).id && x.employeeId === `EMP-${FB_PENDING_USER[co]}`)
  if (!p) throw new Error(`Isolation table: no pending invitation in ${co}`)
  return p
}

/** Valid answers to every question of a survey. */
export function answersFor(questions: { id: string; type: string; options: { id: string }[] }[]) {
  return questions.map((q) => ({
    question_id: q.id,
    value: q.type === 'nps' ? 8 : q.type === 'likert' ? 4 : null,
    choice_ids: q.type === 'single' || q.type === 'multi' ? [q.options[0].id] : [],
    text: q.type === 'text' ? 'Isolation answer' : '',
  }))
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(token, method, path, { body })
  if (r.status !== 200) throw new Error(`Isolation table: ${method} ${path} answered ${r.status}: ${r.text}`)
  return r.body
}

const draftBody = (co: Co) => ({ name: `Isolation pulse ${uniq()}`, template_key: 'enps_pulse', opens_on: day(co), closes_on: day(co, 7), recurrence: 'none' })
const draft = async (co: Co): Promise<string> => (await call(adminToken(co), 'POST', '/hr/engagement/surveys', draftBody(co))).id

const M = 'hr'

export const HR_ENGAGEMENT_ENDPOINTS: Endpoint[] = [
  /* surveys */
  { method: 'GET', path: '/hr/engagement/options', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'PATCH', path: '/hr/engagement/settings', kind: 'company-write', module: M, sample: hr(() => ({ body: { feedback_names_visible_to_hr: false, exit_survey_auto: true } })) },
  { method: 'GET', path: '/hr/engagement/overview', kind: 'company-export', module: M, sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/engagement/my', kind: 'company-list', module: M, sample: hr((co) => ({ as: ADMIN[co] })) },
  { method: 'GET', path: '/hr/engagement/my/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: openEngagement(co).id }, as: ADMIN[co] })) },
  {
    method: 'PUT', path: '/hr/engagement/my/:id', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: openEngagement(co).id }, as: ADMIN[co], body: { answers: answersFor(openEngagement(co).questions), language: 'en' } })),
  },
  { method: 'GET', path: '/hr/engagement/surveys', kind: 'company-list', module: M, sample: hr(() => ({})) },
  { method: 'POST', path: '/hr/engagement/surveys', kind: 'company-write', module: M, sample: hr((co) => ({ body: draftBody(co) })) },
  { method: 'GET', path: '/hr/engagement/surveys/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: openEngagement(co).id } })) },
  { method: 'PATCH', path: '/hr/engagement/surveys/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: openEngagement(co).id }, body: { name: `Engagement (renamed ${uniq()})` } })) },
  { method: 'POST', path: '/hr/engagement/surveys/:id/launch', kind: 'company-item', module: M, sample: hr(async (co) => ({ params: { id: await draft(co) } })) },
  { method: 'POST', path: '/hr/engagement/surveys/:id/close', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: openEngagement(co).id } })) },
  { method: 'GET', path: '/hr/engagement/surveys/:id/results', kind: 'company-export', module: M, sample: hr((co) => ({ params: { id: closedEnps(co).id } })) },
  { method: 'GET', path: '/hr/engagement/surveys/:id/export', kind: 'company-export', module: M, sample: hr((co) => ({ params: { id: closedEnps(co).id } })) },
  /* 360° feedback */
  { method: 'GET', path: '/hr/feedback/options', kind: 'company-list', module: M, sample: hr((co) => ({ as: FB_SUBJECT_USER[co] })) },
  { method: 'GET', path: '/hr/feedback/my', kind: 'company-list', module: M, sample: hr((co) => ({ as: FB_PENDING_USER[co] })) },
  { method: 'GET', path: '/hr/feedback/rounds', kind: 'company-list', module: M, sample: hr((co) => ({ as: FB_MANAGER[co] })) },
  {
    method: 'POST', path: '/hr/feedback/rounds', kind: 'company-write', module: M,
    sample: hr((co) => ({ body: { subject_employee_id: `EMP-${FB_PENDING_USER[co]}`, deadline: day(co, 14), allow_nominations: false, providers: [{ employee_id: FB_OTHER_EMP[co], relationship: 'cross_functional' }] } })),
  },
  { method: 'GET', path: '/hr/feedback/rounds/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: seededRound(co).id }, as: FB_MANAGER[co] })) },
  {
    method: 'POST', path: '/hr/feedback/rounds/:id/providers', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: seededRound(co).id }, as: FB_MANAGER[co], body: { providers: [{ employee_id: FB_OTHER_EMP[co], relationship: 'cross_functional' }] } })),
  },
  {
    method: 'POST', path: '/hr/feedback/rounds/:id/nominations', kind: 'company-item', module: M,
    sample: hr((co) => ({ params: { id: seededRound(co).id }, as: FB_SUBJECT_USER[co], body: { employee_ids: [FB_OTHER_EMP[co]] } })),
  },
  {
    method: 'POST', path: '/hr/feedback/rounds/:id/nominations/decide', kind: 'company-item', module: M,
    sample: hr(async (co) => {
      const r = seededRound(co)
      const after = await call(userToken(FB_SUBJECT_USER[co]), 'POST', `/hr/feedback/rounds/${r.id}/nominations`, { employee_ids: [FB_OTHER_EMP[co]] })
      void after
      const nominated = hrFbProviders.find((p) => p.companyId === co && p.roundId === r.id && p.status === 'nominated')!
      return { params: { id: r.id }, as: FB_MANAGER[co], body: { approve_ids: [nominated.id], reject_ids: [] } }
    }),
  },
  { method: 'POST', path: '/hr/feedback/rounds/:id/close', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: seededRound(co).id }, as: FB_MANAGER[co] })) },
  { method: 'GET', path: '/hr/feedback/rounds/:id/summary', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: seededRound(co).id }, as: FB_MANAGER[co] })) },
  { method: 'GET', path: '/hr/feedback/reviews/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: seededRound(co).reviewId! }, as: FB_MANAGER[co] })) },
  { method: 'GET', path: '/hr/feedback/invitations/:id', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: pendingInvitation(co).id }, as: FB_PENDING_USER[co] })) },
  {
    method: 'PUT', path: '/hr/feedback/invitations/:id', kind: 'company-item', module: M,
    sample: hr((co) => ({
      params: { id: pendingInvitation(co).id },
      as: FB_PENDING_USER[co],
      body: { ratings: seededRound(co).competencies.map((c) => ({ competency_id: c.id, rating: 4 })), strengths: 'Isolation strengths', improvements: 'Isolation improvements', submit: true },
    })),
  },
  { method: 'POST', path: '/hr/feedback/invitations/:id/decline', kind: 'company-item', module: M, sample: hr((co) => ({ params: { id: pendingInvitation(co).id }, as: FB_PENDING_USER[co], body: { reason: 'On leave during the period' } })) },
]
