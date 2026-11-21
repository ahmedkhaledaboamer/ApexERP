import { DEFAULT_CRITERIA } from '@/modules/hr/recruitmentTypes'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { empIdForUser } from '@/shared/mocks/data/hrEmployees'
import { hrApplications, hrCandidates, hrCertificates, hrCourses, hrEnrollments, hrInterviews, hrOffers, hrOpenings, hrSessions } from '@/shared/mocks/data/hrTalent'
import { APEX, ADMIN, adminToken, api, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR › Recruitment and Training (handlers/hrTalent.ts), spread into ENDPOINTS
 * (endpoints.ts). Crest's plan has no HR: every sample turns the module on for Crest with a platform
 * module override first (Apex's plan includes it). Samples name the company's own seed rows (as the
 * company admin, HR full) or create fresh ones through the API.
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const ownCount = <T extends { companyId: string }>(rows: readonly T[]) => (co: Co) => rows.filter((r) => r.companyId === co).length
function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}

/** HR on for the company (Crest through a platform module override). */
export function withHr(co: Co): void {
  if (co === APEX) return
  if (moduleOverrides.some((o) => o.companyId === co && o.module === 'hr' && o.enabled)) return
  moduleOverrides.push({ companyId: co, module: 'hr', enabled: true, reason: 'Isolation: HR enabled', by: 'p1', at: new Date().toISOString() })
}

/** Wraps a sample so HR is on for the company first. */
const hr = (f: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  withHr(co)
  return f(co)
}

async function created(co: Co, path: string, body: unknown): Promise<string> {
  const r = await api(adminToken(co), 'POST', path, { body })
  if (r.status !== 200) throw new Error(`Isolation table: POST ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body.id as string
}

const openOpening = (co: Co) => first(hrOpenings, co, 'open opening', (o) => o.status === 'open')
const screeningApp = (co: Co) => first(hrApplications, co, 'application in screening', (a) => a.stage === 'screening')
const assessmentApp = (co: Co) => first(hrApplications, co, 'application in assessment', (a) => a.stage === 'assessment' && !hrOffers.some((f) => f.applicationId === a.id))
const scheduledInterview = (co: Co) => first(hrInterviews, co, 'scheduled interview', (i) => i.status === 'scheduled')
const candidate = (co: Co) => first(hrCandidates, co, 'candidate')
const course = (co: Co) => first(hrCourses, co, 'mandatory course', (c) => c.mandatory)
const scheduledSession = (co: Co) => first(hrSessions, co, 'scheduled session', (s) => s.status === 'scheduled')
const enrollment = (co: Co) => first(hrEnrollments, co, 'enrollment')
const certificate = (co: Co) => first(hrCertificates, co, 'certificate')
const currency = (co: Co) => (co === APEX ? 'AED' : 'SAR')
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

async function draftOffer(co: Co): Promise<string> {
  return created(co, `/hr/recruitment/applications/${assessmentApp(co).id}/offers`, { salary: 12000, currency: currency(co), start_date: day(45), expiry_date: day(10) })
}

export const HR_TALENT_ENDPOINTS: Endpoint[] = [
  /* ---- recruitment ---- */
  { method: 'GET', path: '/hr/recruitment/options', kind: 'company-list', module: 'hr', sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/recruitment/openings', kind: 'company-list', module: 'hr', sample: hr(() => ({})), count: { of: len, expected: ownCount(hrOpenings) } },
  {
    method: 'POST', path: '/hr/recruitment/openings', kind: 'company-write', module: 'hr',
    sample: hr((co) => ({ body: { title: `Iso role ${uniq()}`, department_id: openOpening(co).departmentId, hiring_manager_id: ADMIN[co], headcount: 1, status: 'draft' } })),
  },
  { method: 'GET', path: '/hr/recruitment/openings/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: openOpening(co).id } })) },
  { method: 'PATCH', path: '/hr/recruitment/openings/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: openOpening(co).id }, body: { location: 'Remote' } })) },
  { method: 'POST', path: '/hr/recruitment/openings/:id/status', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: openOpening(co).id }, body: { status: 'on_hold' } })) },

  { method: 'GET', path: '/hr/recruitment/candidates', kind: 'company-list', module: 'hr', sample: hr(() => ({})), count: { of: len, expected: ownCount(hrCandidates) } },
  {
    method: 'POST', path: '/hr/recruitment/candidates', kind: 'company-write', module: 'hr',
    sample: hr((co) => ({ body: { full_name: 'Iso Candidate', email: `iso-${uniq()}@candidates.test`, source: 'website', opening_id: openOpening(co).id } })),
  },
  { method: 'GET', path: '/hr/recruitment/candidates/check', kind: 'company-search', module: 'hr', sample: hr((co) => ({ query: { email: candidate(co).email } })) },
  { method: 'GET', path: '/hr/recruitment/candidates/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: candidate(co).id } })) },
  { method: 'PATCH', path: '/hr/recruitment/candidates/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: candidate(co).id }, body: { notes: 'Isolation note' } })) },
  {
    method: 'POST', path: '/hr/recruitment/candidates/:id/cv', kind: 'company-item', module: 'hr',
    sample: hr((co) => ({ params: { id: candidate(co).id }, body: { name: 'iso-cv.pdf', size_bytes: 2048, mime_type: 'application/pdf' } })),
  },

  {
    method: 'POST', path: '/hr/recruitment/applications', kind: 'company-write', module: 'hr',
    sample: hr(async (co) => ({ body: { candidate_id: await created(co, '/hr/recruitment/candidates', { full_name: 'Iso Applicant', email: `iso-app-${uniq()}@candidates.test`, source: 'other' }), opening_id: openOpening(co).id } })),
  },
  { method: 'POST', path: '/hr/recruitment/applications/:id/stage', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: screeningApp(co).id }, body: { stage: 'assessment' } })) },
  {
    method: 'POST', path: '/hr/recruitment/applications/:id/interviews', kind: 'company-item', module: 'hr',
    sample: hr((co) => ({ params: { id: screeningApp(co).id }, body: { date: day(5), time: '10:00', duration_minutes: 60, type: 'video', location: 'Online', interviewer_ids: [ADMIN[co]] } })),
  },
  {
    method: 'POST', path: '/hr/recruitment/applications/:id/offers', kind: 'company-item', module: 'hr',
    sample: hr((co) => ({ params: { id: assessmentApp(co).id }, body: { salary: 12000, currency: currency(co), start_date: day(45), expiry_date: day(10) } })),
  },
  { method: 'GET', path: '/hr/recruitment/my-interviews', kind: 'company-list', module: 'hr', sample: hr((co) => ({ as: scheduledInterview(co).interviewerIds[0] })) },
  { method: 'PATCH', path: '/hr/recruitment/interviews/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: scheduledInterview(co).id }, body: { location: 'Room 3' } })) },
  {
    method: 'PUT', path: '/hr/recruitment/interviews/:id/scorecard', kind: 'company-item', module: 'hr',
    sample: hr((co) => {
      const i = scheduledInterview(co)
      return { params: { id: i.id }, as: i.interviewerIds[0], body: { scores: DEFAULT_CRITERIA.map((criterion) => ({ criterion, score: 4 })), recommendation: 'yes', notes: 'Isolation' } }
    }),
  },
  { method: 'PATCH', path: '/hr/recruitment/offers/:id', kind: 'company-item', module: 'hr', sample: hr(async (co) => ({ params: { id: await draftOffer(co) }, body: { salary: 12500 } })) },
  { method: 'POST', path: '/hr/recruitment/offers/:id/status', kind: 'company-item', module: 'hr', sample: hr(async (co) => ({ params: { id: await draftOffer(co) }, body: { status: 'sent' } })) },

  /* ---- training ---- */
  { method: 'GET', path: '/hr/training/options', kind: 'company-list', module: 'hr', sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/training/matrix', kind: 'company-export', module: 'hr', sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/training/budget', kind: 'company-export', module: 'hr', sample: hr(() => ({ query: { year: day(0).slice(0, 4) } })) },
  { method: 'GET', path: '/hr/training/my', kind: 'company-list', module: 'hr', sample: hr(() => ({})) },
  { method: 'GET', path: '/hr/training/courses', kind: 'company-list', module: 'hr', sample: hr(() => ({})), count: { of: len, expected: ownCount(hrCourses) } },
  {
    method: 'POST', path: '/hr/training/courses', kind: 'company-write', module: 'hr',
    sample: hr((co) => ({ body: { title: `Iso course ${uniq()}`, category: 'technical', provider: 'internal', duration_hours: 2, cost: 100, currency: currency(co), mandatory: false, validity_months: 12 } })),
  },
  { method: 'GET', path: '/hr/training/courses/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: course(co).id } })) },
  { method: 'PATCH', path: '/hr/training/courses/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: course(co).id }, body: { description: 'Isolation' } })) },
  {
    method: 'POST', path: '/hr/training/courses/:id/sessions', kind: 'company-item', module: 'hr',
    sample: hr((co) => ({ params: { id: course(co).id }, body: { start_date: day(20), end_date: day(20), location: 'Iso room', trainer: 'Iso', capacity: 10, extra_cost: 0 } })),
  },
  { method: 'PATCH', path: '/hr/training/sessions/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: scheduledSession(co).id }, body: { trainer: 'Iso trainer' } })) },
  {
    method: 'POST', path: '/hr/training/sessions/:id/enrollments', kind: 'company-item', module: 'hr',
    sample: hr((co) => ({ params: { id: scheduledSession(co).id }, body: { employee_ids: [empIdForUser(ADMIN[co])], status: 'enrolled' } })),
  },
  { method: 'PATCH', path: '/hr/training/enrollments/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: enrollment(co).id }, body: { feedback: 'Isolation' } })) },
  { method: 'GET', path: '/hr/training/certificates', kind: 'company-list', module: 'hr', sample: hr(() => ({})), count: { of: len, expected: ownCount(hrCertificates) } },
  { method: 'PATCH', path: '/hr/training/certificates/:id', kind: 'company-item', module: 'hr', sample: hr((co) => ({ params: { id: certificate(co).id }, body: { file_url: 'https://files.example.org/iso.pdf' } })) },
]
