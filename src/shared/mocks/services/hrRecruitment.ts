import type { User } from '@/shared/types'
import type {
  Application,
  ApplicationStage,
  Candidate,
  CandidateDetail,
  CandidateInput,
  CvInput,
  DuplicateCheck,
  Interview,
  InterviewCard,
  InterviewInput,
  Offer,
  OfferInput,
  OfferStatusInput,
  Opening,
  OpeningDetail,
  OpeningInput,
  OpeningStatus,
  OpeningStatusInput,
  RecruitmentOptions,
  Scorecard,
  ScorecardInput,
  StageInput,
} from '@/modules/hr/recruitmentTypes'
import {
  APPLICATION_STAGES,
  CANDIDATE_SOURCES,
  DEFAULT_CRITERIA,
  INTERVIEW_TYPES,
  OPENING_STATUS_LABEL,
  PIPELINE_STAGES,
  RECOMMENDATIONS,
} from '@/modules/hr/recruitmentTypes'
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from '@/modules/hr/types'
import { moveError, overallOf, scorecardAverage } from '@/modules/hr/lib/talent'
import { MOBILE_RULES, formatMobile, isMobile, mobileError } from '@/shared/lib/phone'
import { isRealIsoDate, zonedToUtc, HH_MM } from '@/shared/lib/zonedTime'
import type { CountryCode } from '@/modules/tenancy/types'
import { ApiError } from '@/shared/lib/apiError'
import { departments } from '@/shared/mocks/data/departments'
import { empIdForUser } from '@/shared/mocks/data/hrEmployees'
import {
  hrApplications,
  hrCandidates,
  hrInterviews,
  hrOffers,
  hrOpenings,
  nextId,
  type ApplicationRecord,
  type CandidateRecord,
  type InterviewRecord,
  type OfferRecord,
  type OpeningRecord,
} from '@/shared/mocks/data/hrTalent'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { nowIso } from '@/shared/mocks/clock'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity } from '@/shared/mocks/services/billing'
import {
  companyCountry,
  companyCurrency,
  companyTimezone,
  deptName,
  headedDepartmentIds,
  hireEmployee,
  hrPeople,
  isHrFull,
  nameOfUser,
  requireHr,
  requireHrFull,
} from './hrTalentAccess'

/**
 * HR › Recruitment (docs/API.md › HR › Recruitment). Every function takes the signed-in user; the
 * company comes from the session only. A record of another company — or one outside the caller's
 * scope — answers 404 exactly like a missing one.
 *
 * Who sees what:
 *   HR full             every opening, candidate, interview (all scorecards) and offer; does every write
 *   Department Head     openings of the departments they head (or where they are the hiring manager /
 *                       requester); candidates applying to those; may request openings (draft →
 *                       pending_approval, HR approves); interviews where they interview
 *   salary range/offers HR full + the opening's hiring manager only
 *   any HR role         interviews they are invited to (GET /my-interviews: the card, their own scorecard)
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const invalid = (message: string, field?: string) => new CodedApiError(message, 422, 'validation_failed', field ? { field } : {})
const notFound = () => new ApiError(NOT_FOUND, 404)
const ACTIVE_OPENING: OpeningStatus[] = ['open', 'on_hold']
const CV_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const MAX_CV_BYTES = 10 * 1024 * 1024

/* ---------------- Visibility ---------------- */

function visibleOpening(user: User, o: OpeningRecord): boolean {
  if (isHrFull(user)) return true
  if (requireHr(user) !== 'team') return false
  return o.hiringManagerId === user.id || o.requestedBy === user.id || headedDepartmentIds(user).includes(o.departmentId)
}

const salaryVisible = (user: User, o: OpeningRecord) => isHrFull(user) || o.hiringManagerId === user.id

function openingOr404(user: User, id: string): Tenant<OpeningRecord> {
  const co = tenantOf(user)
  const o = hrOpenings.find((x) => x.companyId === co && x.id === id)
  if (!o || !visibleOpening(user, o)) throw notFound()
  return o
}

const appsOf = (co: string, openingId: string) => hrApplications.filter((a) => a.companyId === co && a.openingId === openingId)
const hiredCountOf = (co: string, openingId: string) => appsOf(co, openingId).filter((a) => a.stage === 'hired').length

function candidateOf(co: string, id: string) {
  return hrCandidates.find((c) => c.companyId === co && c.id === id)
}

function visibleApplications(user: User): Tenant<ApplicationRecord>[] {
  const co = tenantOf(user)
  const open = new Set(hrOpenings.filter((o) => o.companyId === co && visibleOpening(user, o)).map((o) => o.id))
  return hrApplications.filter((a) => a.companyId === co && open.has(a.openingId))
}

function applicationOr404(user: User, id: string): Tenant<ApplicationRecord> {
  const a = visibleApplications(user).find((x) => x.id === id)
  if (!a) throw notFound()
  return a
}

/* ---------------- Views ---------------- */

function openingView(user: User, o: OpeningRecord & { companyId: string }): Opening {
  const co = o.companyId
  const apps = appsOf(co, o.id)
  const stageCounts = Object.fromEntries(APPLICATION_STAGES.map((s) => [s, apps.filter((a) => a.stage === s).length])) as Opening['stageCounts']
  const hired = stageCounts.hired
  const show = salaryVisible(user, o)
  return {
    id: o.id,
    title: o.title,
    departmentId: o.departmentId,
    departmentName: deptName(co, o.departmentId),
    hiringManagerId: o.hiringManagerId,
    hiringManagerName: nameOfUser(co, o.hiringManagerId),
    headcount: o.headcount,
    hiredCount: hired,
    remaining: Math.max(0, o.headcount - hired),
    employmentType: o.employmentType,
    location: o.location,
    salaryMin: show ? o.salaryMin : null,
    salaryMax: show ? o.salaryMax : null,
    salaryCurrency: show ? o.salaryCurrency : null,
    salaryVisible: show,
    description: o.description,
    requirements: o.requirements,
    status: o.status,
    requestedBy: o.requestedBy,
    requestedByName: nameOfUser(co, o.requestedBy),
    approvedBy: o.approvedBy,
    approvedAt: o.approvedAt,
    criteria: o.criteria.length ? [...o.criteria] : [...DEFAULT_CRITERIA],
    stageCounts,
    applicationCount: apps.length,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }
}

function scorecardView(co: string, s: InterviewRecord['scorecards'][number]): Scorecard {
  return { interviewerId: s.interviewerId, interviewerName: nameOfUser(co, s.interviewerId), scores: s.scores.map((x) => ({ ...x })), recommendation: s.recommendation, notes: s.notes, average: scorecardAverage(s.scores), submittedAt: s.submittedAt }
}

/** All scorecards: HR full and the hiring manager; anyone else sees their own only. */
function interviewView(user: User, i: Tenant<InterviewRecord>): Interview {
  const co = i.companyId
  const a = hrApplications.find((x) => x.companyId === co && x.id === i.applicationId)!
  const o = hrOpenings.find((x) => x.companyId === co && x.id === a.openingId)!
  const c = candidateOf(co, a.candidateId)!
  const all = isHrFull(user) || o.hiringManagerId === user.id
  const cards = i.scorecards.filter((s) => all || s.interviewerId === user.id)
  return {
    id: i.id,
    applicationId: a.id,
    candidateId: c.id,
    candidateName: c.fullName,
    openingId: o.id,
    openingTitle: o.title,
    scheduledAt: i.scheduledAt,
    durationMinutes: i.durationMinutes,
    type: i.type,
    location: i.location,
    interviewerIds: [...i.interviewerIds],
    interviewerNames: i.interviewerIds.map((id) => nameOfUser(co, id)),
    status: i.status,
    scorecards: cards.map((s) => scorecardView(co, s)),
    overallScore: all ? overallOf(i.scorecards.map((s) => scorecardAverage(s.scores))) : overallOf(cards.map((s) => scorecardAverage(s.scores))),
    criteria: o.criteria.length ? [...o.criteria] : [...DEFAULT_CRITERIA],
  }
}

function applicationScore(co: string, applicationId: string): number | null {
  return overallOf(hrInterviews.filter((i) => i.companyId === co && i.applicationId === applicationId).flatMap((i) => i.scorecards.map((s) => scorecardAverage(s.scores))))
}

function liveOffer(co: string, applicationId: string): Tenant<OfferRecord> | undefined {
  return hrOffers.filter((f) => f.companyId === co && f.applicationId === applicationId).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]
}

function applicationView(user: User, a: Tenant<ApplicationRecord>): Application {
  const co = a.companyId
  const c = candidateOf(co, a.candidateId)!
  const o = hrOpenings.find((x) => x.companyId === co && x.id === a.openingId)!
  const offer = liveOffer(co, a.id)
  return {
    id: a.id,
    candidateId: c.id,
    candidateName: c.fullName,
    candidateTitle: c.currentTitle,
    candidateCompany: c.currentCompany,
    candidateSource: c.source,
    openingId: o.id,
    openingTitle: o.title,
    stage: a.stage,
    rejectionReason: a.rejectionReason,
    overallScore: applicationScore(co, a.id),
    interviewCount: hrInterviews.filter((i) => i.companyId === co && i.applicationId === a.id).length,
    offerStatus: offer && salaryVisible(user, o) ? offer.status : null,
    employeeId: a.employeeId,
    stageChangedAt: a.stageChangedAt,
    createdAt: a.createdAt,
  }
}

function offerView(f: Tenant<OfferRecord>): Offer {
  const co = f.companyId
  const a = hrApplications.find((x) => x.companyId === co && x.id === f.applicationId)!
  const c = candidateOf(co, a.candidateId)!
  const o = hrOpenings.find((x) => x.companyId === co && x.id === a.openingId)!
  const today = companyDayOf(co).today
  return {
    id: f.id,
    applicationId: a.id,
    candidateName: c.fullName,
    openingTitle: o.title,
    salary: f.salary,
    currency: f.currency,
    startDate: f.startDate,
    expiryDate: f.expiryDate,
    status: f.status,
    expired: f.status === 'sent' && f.expiryDate < today,
    employeeId: f.employeeId,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

function candidateView(c: Tenant<CandidateRecord>, apps: Tenant<ApplicationRecord>[]): Candidate {
  const co = c.companyId
  return {
    id: c.id,
    fullName: c.fullName,
    email: c.email,
    mobile: c.mobile,
    currentCompany: c.currentCompany,
    currentTitle: c.currentTitle,
    source: c.source,
    cv: c.cv ? { ...c.cv } : null,
    notes: c.notes,
    tags: [...c.tags],
    applications: apps
      .filter((a) => a.candidateId === c.id)
      .map((a) => ({ id: a.id, openingId: a.openingId, openingTitle: hrOpenings.find((o) => o.companyId === co && o.id === a.openingId)?.title ?? '—', stage: a.stage, overallScore: applicationScore(co, a.id) })),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

/* ---------------- Options ---------------- */

export function recruitmentOptions(user: User): RecruitmentOptions {
  const scope = requireHr(user)
  const co = tenantOf(user)
  const headed = new Set(headedDepartmentIds(user))
  return {
    departments: departments.filter((d) => d.companyId === co && d.active && (scope === 'full' || headed.has(d.id))).map((d) => ({ id: d.id, name: d.name })),
    people: hrPeople(co).map((u) => ({ id: u.id, name: u.name, role: u.role, departmentId: u.departmentId || null })),
    currency: companyCurrency(co),
    manage: scope === 'full',
    defaultCriteria: [...DEFAULT_CRITERIA],
  }
}

/* ---------------- Openings ---------------- */

export function listOpenings(user: User): Opening[] {
  const scope = requireHr(user)
  if (scope === 'own') throw new ApiError('Job openings are for HR and department heads.', 403)
  const co = tenantOf(user)
  return hrOpenings.filter((o) => o.companyId === co && visibleOpening(user, o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => openingView(user, o))
}

export function getOpening(user: User, id: string): OpeningDetail {
  requireHr(user)
  const o = openingOr404(user, id)
  const co = o.companyId
  const full = isHrFull(user)
  const apps = appsOf(co, o.id)
  const appIds = new Set(apps.map((a) => a.id))
  return {
    ...openingView(user, o),
    applications: apps.map((a) => applicationView(user, a)),
    interviews: hrInterviews.filter((i) => i.companyId === co && appIds.has(i.applicationId)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).map((i) => interviewView(user, i)),
    offers: salaryVisible(user, o) ? hrOffers.filter((f) => f.companyId === co && appIds.has(f.applicationId)).map(offerView) : [],
    can: {
      edit: full ? o.status !== 'closed' : ['draft', 'pending_approval'].includes(o.status),
      approve: full && o.status === 'pending_approval',
      manageCandidates: full,
      moveStages: full,
      makeOffers: full,
    },
  }
}

function money(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw invalid(`${label} must be 0 or a positive amount.`, 'salary')
  return Math.round(n)
}

function validateOpening(user: User, raw: Partial<OpeningInput>, base: OpeningRecord | null): Omit<OpeningRecord, 'id' | 'status' | 'requestedBy' | 'approvedBy' | 'approvedAt' | 'createdAt' | 'updatedAt'> {
  const co = tenantOf(user)
  const pick = <K extends keyof OpeningInput>(k: K) => (raw[k] !== undefined ? raw[k] : base ? (base as unknown as OpeningInput)[k] : undefined)
  const title = str(pick('title'))
  if (title.length < 2 || title.length > 120) throw invalid('Enter a job title (2–120 characters).', 'title')
  const departmentId = str(pick('departmentId'))
  const dept = departments.find((d) => d.companyId === co && d.id === departmentId && d.active)
  if (!dept) throw invalid('Pick a department.', 'departmentId')
  if (!isHrFull(user) && !headedDepartmentIds(user).includes(dept.id)) throw invalid('You can only request openings for the departments you head.', 'departmentId')
  const hiringManagerId = str(pick('hiringManagerId')) || user.id
  if (!hrPeople(co).some((u) => u.id === hiringManagerId)) throw invalid('Pick a hiring manager from your company.', 'hiringManagerId')
  const headcount = Number(pick('headcount') ?? 1)
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 100) throw invalid('Headcount is a whole number from 1 to 100.', 'headcount')
  const employmentType = (str(pick('employmentType')) || 'full_time') as EmploymentType
  if (!(employmentType in EMPLOYMENT_TYPE_LABEL)) throw invalid('Pick an employment type.', 'employmentType')
  const salaryMin = money(pick('salaryMin'), 'Minimum salary')
  const salaryMax = money(pick('salaryMax'), 'Maximum salary')
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) throw invalid('The minimum salary is above the maximum.', 'salaryMax')
  const salaryCurrency = salaryMin !== null || salaryMax !== null ? (str(pick('salaryCurrency')) || companyCurrency(co)).toUpperCase() : null
  if (salaryCurrency && !/^[A-Z]{3}$/.test(salaryCurrency)) throw invalid('Use a 3-letter currency code.', 'salaryCurrency')
  const rawCriteria = pick('criteria')
  const criteria = Array.isArray(rawCriteria) ? [...new Set(rawCriteria.map(str).filter(Boolean))] : base?.criteria ?? [...DEFAULT_CRITERIA]
  if (criteria.length > 8 || criteria.some((c) => c.length > 40)) throw invalid('Use up to 8 scorecard criteria of 40 characters each.', 'criteria')
  return {
    title,
    departmentId: dept.id,
    hiringManagerId,
    headcount,
    employmentType,
    location: str(pick('location')).slice(0, 120),
    salaryMin,
    salaryMax,
    salaryCurrency,
    description: str(pick('description')).slice(0, 4000),
    requirements: str(pick('requirements')).slice(0, 4000),
    criteria: criteria.length ? criteria : [...DEFAULT_CRITERIA],
  }
}

export function createOpening(user: User, raw: Partial<OpeningInput> | null): Opening {
  const scope = requireHr(user)
  if (scope !== 'full' && scope !== 'team') throw new ApiError('Only HR and department heads can request openings.', 403)
  if (!raw) throw invalid('Send the opening details.')
  const fields = validateOpening(user, raw, null)
  const wanted = (raw.status ?? 'draft') as OpeningStatus
  const allowed: OpeningStatus[] = scope === 'full' ? ['draft', 'pending_approval', 'open'] : ['draft', 'pending_approval']
  if (!allowed.includes(wanted)) throw invalid(scope === 'full' ? 'A new opening starts as a draft or open.' : 'Department heads send openings to HR for approval.', 'status')
  const stamp = nowIso()
  const row: Tenant<OpeningRecord> = {
    companyId: tenantOf(user),
    id: nextId('opening', 'JOB'),
    ...fields,
    status: wanted,
    requestedBy: user.id,
    approvedBy: wanted === 'open' ? user.id : null,
    approvedAt: wanted === 'open' ? stamp : null,
    createdAt: stamp,
    updatedAt: stamp,
  }
  hrOpenings.push(row)
  return openingView(user, row)
}

export function updateOpening(user: User, id: string, raw: Partial<OpeningInput> | null): Opening {
  requireHr(user)
  const o = openingOr404(user, id)
  const full = isHrFull(user)
  if (full ? o.status === 'closed' : !['draft', 'pending_approval'].includes(o.status)) {
    throw new ApiError(full ? 'A closed opening can’t be edited.' : 'Only HR can change an opening once it is approved.', 403)
  }
  const fields = validateOpening(user, raw ?? {}, o)
  if (fields.headcount < hiredCountOf(o.companyId, o.id)) throw invalid('Headcount can’t be below the number already hired.', 'headcount')
  Object.assign(o, fields, { updatedAt: nowIso() })
  // Raising the headcount of a filled opening doesn't reopen it by itself; HR reopens it.
  return openingView(user, o)
}

/** Allowed opening status changes (HR full unless noted). */
const OPENING_FLOW: Record<OpeningStatus, OpeningStatus[]> = {
  draft: ['pending_approval', 'open', 'closed'],
  pending_approval: ['open', 'draft', 'closed'],
  open: ['on_hold', 'closed'],
  on_hold: ['open', 'closed'],
  filled: ['closed', 'open'],
  closed: [],
}

export function setOpeningStatus(user: User, id: string, raw: Partial<OpeningStatusInput> | null): Opening {
  requireHr(user)
  const o = openingOr404(user, id)
  const to = raw?.status as OpeningStatus
  if (!to || !(to in OPENING_STATUS_LABEL)) throw invalid('Pick a status.', 'status')
  if (!OPENING_FLOW[o.status].includes(to)) throw new CodedApiError(`An opening can’t go from ${OPENING_STATUS_LABEL[o.status]} to ${OPENING_STATUS_LABEL[to]}.`, 409, 'invalid_transition')
  const full = isHrFull(user)
  // A department head may only send their draft for approval or pull it back to draft.
  const teamOk = (o.status === 'draft' && to === 'pending_approval') || (o.status === 'pending_approval' && to === 'draft' && o.requestedBy === user.id)
  if (!full && !teamOk) throw new ApiError('Only HR can approve, hold or close openings.', 403)
  if (to === 'open' && o.status === 'filled' && hiredCountOf(o.companyId, o.id) >= o.headcount) {
    throw new CodedApiError('Every position is filled. Raise the headcount before reopening.', 409, 'opening_filled')
  }
  if (to === 'open' && (o.status === 'pending_approval' || o.status === 'draft')) {
    o.approvedBy = user.id
    o.approvedAt = nowIso()
  }
  o.status = to
  o.updatedAt = nowIso()
  return openingView(user, o)
}

/* ---------------- Candidates ---------------- */

/** International form or the company country's own rules → stored normalized. */
function normalizeMobile(raw: string, co: string): string {
  if (!raw) return ''
  const country = companyCountry(co).toUpperCase()
  const known = country in MOBILE_RULES ? (country as CountryCode) : null
  if (known && isMobile(raw, known)) return formatMobile(raw, known)
  const intl = raw.replace(/[\s().-]/g, '')
  const digits = intl.startsWith('+') ? intl.slice(1) : intl.startsWith('00') ? intl.slice(2) : null
  const ownDial = known ? MOBILE_RULES[known].dialCode : null
  if (digits !== null && /^\d{8,15}$/.test(digits) && !(ownDial && digits.startsWith(ownDial))) return `+${digits}`
  throw invalid(known ? `${mobileError(known)} For a number abroad, use the international form (+ country code).` : 'Use the international form: + then the country code and number.', 'mobile')
}

const digitsOf = (m: string) => m.replace(/\D/g, '')

function duplicatesOf(co: string, email: string, mobile: string, exclude?: string): DuplicateCheck['matches'] {
  const e = email.toLowerCase()
  const d = digitsOf(mobile)
  return hrCandidates
    .filter((c) => c.companyId === co && c.id !== exclude)
    .map((c) => {
      const on: ('email' | 'mobile')[] = []
      if (e && c.email.toLowerCase() === e) on.push('email')
      if (d.length >= 8 && digitsOf(c.mobile) === d) on.push('mobile')
      return { c, on }
    })
    .filter((x) => x.on.length > 0)
    .map(({ c, on }) => ({ id: c.id, fullName: c.fullName, email: c.email, mobile: c.mobile, matchedOn: on }))
}

export function checkDuplicates(user: User, emailRaw: string | null, mobileRaw: string | null, exclude?: string | null): DuplicateCheck {
  requireHrFull(user, 'Only HR can add candidates.')
  const co = tenantOf(user)
  let mobile = ''
  try {
    mobile = normalizeMobile(str(mobileRaw), co)
  } catch {
    mobile = str(mobileRaw)
  }
  return { matches: duplicatesOf(co, str(emailRaw), mobile, exclude ?? undefined) }
}

export function listCandidates(user: User): Candidate[] {
  const scope = requireHr(user)
  if (scope === 'own') throw new ApiError('Candidates are for HR and hiring departments.', 403)
  const co = tenantOf(user)
  const apps = visibleApplications(user)
  const ids = new Set(apps.map((a) => a.candidateId))
  return hrCandidates
    .filter((c) => c.companyId === co && (scope === 'full' || ids.has(c.id)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => candidateView(c, apps))
}

function candidateOr404(user: User, id: string): Tenant<CandidateRecord> {
  const scope = requireHr(user)
  const co = tenantOf(user)
  const c = candidateOf(co, id)
  if (!c || scope === 'own') throw notFound()
  if (scope !== 'full' && !visibleApplications(user).some((a) => a.candidateId === c.id)) throw notFound()
  return c
}

export function getCandidate(user: User, id: string): CandidateDetail {
  const c = candidateOr404(user, id)
  const co = c.companyId
  const apps = visibleApplications(user).filter((a) => a.candidateId === c.id)
  const appIds = new Set(apps.map((a) => a.id))
  const offers = hrOffers.filter((f) => f.companyId === co && appIds.has(f.applicationId)).filter((f) => {
    const a = apps.find((x) => x.id === f.applicationId)!
    return salaryVisible(user, hrOpenings.find((o) => o.companyId === co && o.id === a.openingId)!)
  })
  return {
    ...candidateView(c, apps),
    interviews: hrInterviews.filter((i) => i.companyId === co && appIds.has(i.applicationId)).map((i) => interviewView(user, i)),
    offers: offers.map(offerView),
  }
}

function validateCandidate(co: string, raw: Partial<CandidateInput>, base: CandidateRecord | null) {
  const pick = <K extends keyof CandidateInput>(k: K) => (raw[k] !== undefined ? raw[k] : base ? (base as unknown as CandidateInput)[k] : undefined)
  const fullName = str(pick('fullName'))
  if (fullName.length < 2 || fullName.length > 120) throw invalid('Enter the candidate’s full name.', 'fullName')
  const email = str(pick('email')).toLowerCase()
  if (email && (!EMAIL_RE.test(email) || email.length > 190)) throw invalid(`${email} isn’t a valid email address.`, 'email')
  const mobile = normalizeMobile(str(pick('mobile')), co)
  if (!email && !mobile) throw invalid('Enter an email or a mobile number.', 'email')
  const source = (str(pick('source')) || 'other') as CandidateInput['source']
  if (!CANDIDATE_SOURCES.includes(source)) throw invalid('Pick a source.', 'source')
  const rawTags = pick('tags')
  const tags = Array.isArray(rawTags) ? [...new Set(rawTags.map(str).filter(Boolean).map((t) => t.slice(0, 30)))].slice(0, 15) : base?.tags ?? []
  return {
    fullName,
    email,
    mobile,
    currentCompany: str(pick('currentCompany')).slice(0, 120),
    currentTitle: str(pick('currentTitle')).slice(0, 120),
    source,
    notes: str(pick('notes')).slice(0, 4000),
    tags,
  }
}

export function createCandidate(user: User, raw: Partial<CandidateInput> | null): Candidate {
  requireHrFull(user, 'Only HR can add candidates.')
  if (!raw) throw invalid('Send the candidate details.')
  const co = tenantOf(user)
  const fields = validateCandidate(co, raw, null)
  const dupes = duplicatesOf(co, fields.email, fields.mobile)
  if (dupes.length) {
    throw new CodedApiError(`${dupes[0].fullName} is already a candidate with this ${dupes[0].matchedOn.join(' and ')}.`, 409, 'duplicate_candidate', { candidateId: dupes[0].id, matchedOn: dupes[0].matchedOn })
  }
  const openingId = str(raw.openingId)
  const opening = openingId ? hrOpenings.find((o) => o.companyId === co && o.id === openingId) : null
  if (openingId && !opening) throw notFound()
  if (opening && opening.status !== 'open') throw new CodedApiError('Candidates can only apply to open openings.', 409, 'opening_not_open')
  const stamp = nowIso()
  const row: Tenant<CandidateRecord> = { companyId: co, id: nextId('candidate', 'CAN'), ...fields, cv: null, createdAt: stamp, updatedAt: stamp }
  hrCandidates.push(row)
  if (opening) hrApplications.push({ companyId: co, id: nextId('application', 'APP'), candidateId: row.id, openingId: opening.id, stage: 'applied', rejectionReason: null, employeeId: null, stageChangedAt: stamp, createdAt: stamp })
  return candidateView(row, visibleApplications(user))
}

export function updateCandidate(user: User, id: string, raw: Partial<CandidateInput> | null): Candidate {
  requireHrFull(user, 'Only HR can edit candidates.')
  const c = candidateOr404(user, id)
  const fields = validateCandidate(c.companyId, raw ?? {}, c)
  const dupes = duplicatesOf(c.companyId, fields.email, fields.mobile, c.id)
  if (dupes.length) throw new CodedApiError(`${dupes[0].fullName} already uses this ${dupes[0].matchedOn.join(' and ')}.`, 409, 'duplicate_candidate', { candidateId: dupes[0].id, matchedOn: dupes[0].matchedOn })
  Object.assign(c, fields, { updatedAt: nowIso() })
  return candidateView(c, visibleApplications(user))
}

/** Attaches (or replaces) the CV: metadata only, counted against the plan's storageMb. */
export function attachCv(user: User, id: string, raw: Partial<CvInput> | null): Candidate {
  requireHrFull(user, 'Only HR can attach CVs.')
  const c = candidateOr404(user, id)
  const name = str(raw?.name)
  const sizeBytes = Number(raw?.sizeBytes)
  const mimeType = str(raw?.mimeType).toLowerCase()
  if (!name || name.length > 200) throw invalid('Give the file a name.', 'name')
  if (!CV_TYPES.includes(mimeType)) throw invalid('Attach the CV as PDF or Word.', 'mimeType')
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_CV_BYTES) throw invalid('A CV can be up to 10 MB.', 'sizeBytes')
  const extra = sizeBytes - (c.cv?.sizeBytes ?? 0)
  if (extra > 0) assertCapacity(c.companyId, 'storageMb', extra / (1024 * 1024))
  c.cv = { name, sizeBytes, mimeType, uploadedAt: nowIso() }
  c.updatedAt = nowIso()
  return candidateView(c, visibleApplications(user))
}

/* ---------------- Applications ---------------- */

export function createApplication(user: User, raw: { candidateId?: string; openingId?: string } | null): Application {
  requireHrFull(user, 'Only HR can add candidates to openings.')
  const co = tenantOf(user)
  const c = candidateOf(co, str(raw?.candidateId))
  const o = hrOpenings.find((x) => x.companyId === co && x.id === str(raw?.openingId))
  if (!c || !o) throw notFound()
  if (o.status !== 'open') throw new CodedApiError('Candidates can only apply to open openings.', 409, 'opening_not_open')
  if (hrApplications.some((a) => a.companyId === co && a.candidateId === c.id && a.openingId === o.id)) {
    throw new CodedApiError(`${c.fullName} has already applied to ${o.title}.`, 409, 'duplicate_application')
  }
  const stamp = nowIso()
  const row: Tenant<ApplicationRecord> = { companyId: co, id: nextId('application', 'APP'), candidateId: c.id, openingId: o.id, stage: 'applied', rejectionReason: null, employeeId: null, stageChangedAt: stamp, createdAt: stamp }
  hrApplications.push(row)
  return applicationView(user, row)
}

export function moveApplication(user: User, id: string, raw: Partial<StageInput> | null): Application {
  requireHr(user)
  const a = applicationOr404(user, id)
  requireHrFull(user, 'Only HR moves candidates through the pipeline.')
  const to = raw?.stage as ApplicationStage
  if (!APPLICATION_STAGES.includes(to)) throw invalid('Pick a stage.', 'stage')
  const o = hrOpenings.find((x) => x.companyId === a.companyId && x.id === a.openingId)!
  const offer = liveOffer(a.companyId, a.id)
  const err = moveError(a.stage, to, { openingActive: ACTIVE_OPENING.includes(o.status), offerStatus: offer?.status ?? null, reason: raw?.reason })
  if (err) throw new CodedApiError(err, 409, 'invalid_stage_move')
  a.stage = to
  a.rejectionReason = to === 'rejected' ? str(raw?.reason).slice(0, 500) : null
  a.stageChangedAt = nowIso()
  return applicationView(user, a)
}

/* ---------------- Interviews ---------------- */

function validateInterview(co: string, raw: Partial<InterviewInput>, base: InterviewRecord | null) {
  const tz = companyTimezone(co)
  let scheduledAt = base?.scheduledAt ?? ''
  if (raw.date !== undefined || raw.time !== undefined || !base) {
    if (!isRealIsoDate(raw.date)) throw invalid('Pick the interview date.', 'date')
    if (!HH_MM.test(str(raw.time))) throw invalid('Pick the interview time (HH:mm).', 'time')
    scheduledAt = zonedToUtc(raw.date, str(raw.time), tz)
  }
  const durationMinutes = Number(raw.durationMinutes ?? base?.durationMinutes ?? 60)
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) throw invalid('Duration is 15 to 480 minutes.', 'durationMinutes')
  const type = (raw.type ?? base?.type ?? 'video') as InterviewInput['type']
  if (!INTERVIEW_TYPES.includes(type)) throw invalid('Pick an interview type.', 'type')
  const ids = raw.interviewerIds !== undefined ? (Array.isArray(raw.interviewerIds) ? [...new Set(raw.interviewerIds.map(str).filter(Boolean))] : null) : base?.interviewerIds ?? []
  if (!ids || !ids.length) throw invalid('Add at least one interviewer.', 'interviewerIds')
  const people = new Set(hrPeople(co).map((u) => u.id))
  if (ids.some((x) => !people.has(x))) throw invalid('Interviewers must be colleagues who can use HR.', 'interviewerIds')
  return { scheduledAt, durationMinutes, type, location: str(raw.location ?? base?.location).slice(0, 200), interviewerIds: ids }
}

export function scheduleInterview(user: User, applicationId: string, raw: Partial<InterviewInput> | null): Interview {
  requireHr(user)
  const a = applicationOr404(user, applicationId)
  requireHrFull(user, 'Only HR schedules interviews.')
  if (!PIPELINE_STAGES.includes(a.stage)) throw new CodedApiError('This candidate is no longer in the pipeline.', 409, 'application_closed')
  const fields = validateInterview(a.companyId, raw ?? {}, null)
  const row: Tenant<InterviewRecord> = { companyId: a.companyId, id: nextId('interview', 'INT'), applicationId: a.id, ...fields, status: 'scheduled', scorecards: [], createdAt: nowIso() }
  hrInterviews.push(row)
  if (a.stage === 'applied' || a.stage === 'screening') {
    a.stage = 'interview'
    a.stageChangedAt = nowIso()
  }
  return interviewView(user, row)
}

function interviewOr404(user: User, id: string): Tenant<InterviewRecord> {
  requireHr(user)
  const co = tenantOf(user)
  const i = hrInterviews.find((x) => x.companyId === co && x.id === id)
  if (!i) throw notFound()
  const visible = i.interviewerIds.includes(user.id) || visibleApplications(user).some((a) => a.id === i.applicationId)
  if (!visible) throw notFound()
  return i
}

export function updateInterview(user: User, id: string, raw: Partial<InterviewInput> | null): Interview {
  const i = interviewOr404(user, id)
  requireHrFull(user, 'Only HR reschedules interviews.')
  const fields = validateInterview(i.companyId, raw ?? {}, i)
  const status = raw?.status ?? i.status
  if (!['scheduled', 'completed', 'cancelled'].includes(status)) throw invalid('Pick a status.', 'status')
  Object.assign(i, fields, { status })
  // Interviewers taken off the panel lose their (unsent) slot; submitted scorecards stay.
  return interviewView(user, i)
}

/** PUT own scorecard: the caller must be on the interview panel. Re-submitting replaces it. */
export function submitScorecard(user: User, id: string, raw: Partial<ScorecardInput> | null): Interview {
  const i = interviewOr404(user, id)
  if (!i.interviewerIds.includes(user.id)) throw new ApiError('Only the interviewers on the panel can score this interview.', 403)
  if (i.status === 'cancelled') throw new CodedApiError('This interview was cancelled.', 409, 'interview_cancelled')
  const a = hrApplications.find((x) => x.companyId === i.companyId && x.id === i.applicationId)!
  const o = hrOpenings.find((x) => x.companyId === i.companyId && x.id === a.openingId)!
  const criteria = o.criteria.length ? o.criteria : DEFAULT_CRITERIA
  const scores = Array.isArray(raw?.scores) ? raw!.scores : []
  const out = criteria.map((criterion) => {
    const s = scores.find((x) => x && str(x.criterion) === criterion)
    const n = Number(s?.score)
    if (!Number.isInteger(n) || n < 1 || n > 5) throw invalid(`Rate “${criterion}” from 1 to 5.`, 'scores')
    return { criterion, score: n }
  })
  const recommendation = raw?.recommendation as ScorecardInput['recommendation']
  if (!RECOMMENDATIONS.includes(recommendation)) throw invalid('Pick a recommendation.', 'recommendation')
  const card = { interviewerId: user.id, scores: out, recommendation, notes: str(raw?.notes).slice(0, 4000), submittedAt: nowIso() }
  i.scorecards = [...i.scorecards.filter((s) => s.interviewerId !== user.id), card]
  if (i.interviewerIds.every((x) => i.scorecards.some((s) => s.interviewerId === x))) i.status = 'completed'
  return interviewView(user, i)
}

/** Interviews the caller sits on (any HR-visible role): the card and their own scorecard only. */
export function myInterviews(user: User): InterviewCard[] {
  requireHr(user)
  return interviewCardsOf(tenantOf(user), user)
}

/**
 * Interview cards of one interviewer (no scope check: the caller decides). Shared by GET /hr/recruitment/my-interviews
 * and the self-service portal (GET /hr/me). Only users whose role sees HR sit on panels, so it's empty for the others.
 */
export function interviewCardsOf(co: string, user: User): InterviewCard[] {
  return hrInterviews
    .filter((i) => i.companyId === co && i.interviewerIds.includes(user.id))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((i) => {
      const a = hrApplications.find((x) => x.companyId === co && x.id === i.applicationId)!
      const c = candidateOf(co, a.candidateId)!
      const o = hrOpenings.find((x) => x.companyId === co && x.id === a.openingId)!
      const mine = i.scorecards.find((s) => s.interviewerId === user.id)
      return {
        id: i.id,
        candidateName: c.fullName,
        candidateTitle: c.currentTitle,
        candidateCompany: c.currentCompany,
        openingTitle: o.title,
        scheduledAt: i.scheduledAt,
        durationMinutes: i.durationMinutes,
        type: i.type,
        location: i.location,
        status: i.status,
        criteria: o.criteria.length ? [...o.criteria] : [...DEFAULT_CRITERIA],
        myScorecard: mine ? scorecardView(co, mine) : null,
      }
    })
}

/* ---------------- Offers ---------------- */

function validateOffer(co: string, raw: Partial<OfferInput>, base: OfferRecord | null) {
  const salary = Number(raw.salary ?? base?.salary)
  if (!Number.isFinite(salary) || salary <= 0 || salary > 1e9) throw invalid('Enter the offered salary.', 'salary')
  const currency = (str(raw.currency) || base?.currency || companyCurrency(co)).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw invalid('Use a 3-letter currency code.', 'currency')
  const startDate = raw.startDate ?? base?.startDate
  if (!isRealIsoDate(startDate)) throw invalid('Pick the start date.', 'startDate')
  const expiryDate = raw.expiryDate ?? base?.expiryDate
  if (!isRealIsoDate(expiryDate)) throw invalid('Pick the date the offer expires.', 'expiryDate')
  if (expiryDate > startDate) throw invalid('The offer must expire on or before the start date.', 'expiryDate')
  return { salary: Math.round(salary), currency, startDate, expiryDate }
}

export function createOffer(user: User, applicationId: string, raw: Partial<OfferInput> | null): Offer {
  requireHr(user)
  const a = applicationOr404(user, applicationId)
  requireHrFull(user, 'Only HR makes offers.')
  if (!['interview', 'assessment', 'offer'].includes(a.stage)) throw new CodedApiError('Interview the candidate before making an offer.', 409, 'invalid_stage_move')
  const live = liveOffer(a.companyId, a.id)
  if (live && (live.status === 'draft' || live.status === 'sent')) throw new CodedApiError('This candidate already has an open offer.', 409, 'offer_exists')
  const fields = validateOffer(a.companyId, raw ?? {}, null)
  const stamp = nowIso()
  const row: Tenant<OfferRecord> = { companyId: a.companyId, id: nextId('offer', 'OFR'), applicationId: a.id, ...fields, status: 'draft', employeeId: null, createdAt: stamp, updatedAt: stamp }
  hrOffers.push(row)
  if (a.stage !== 'offer') {
    a.stage = 'offer'
    a.stageChangedAt = stamp
  }
  return offerView(row)
}

function offerOr404(user: User, id: string): Tenant<OfferRecord> {
  requireHr(user)
  const co = tenantOf(user)
  const f = hrOffers.find((x) => x.companyId === co && x.id === id)
  const a = f && visibleApplications(user).find((x) => x.id === f.applicationId)
  const o = a && hrOpenings.find((x) => x.companyId === co && x.id === a.openingId)
  if (!f || !o || !salaryVisible(user, o)) throw notFound()
  return f
}

export function updateOffer(user: User, id: string, raw: Partial<OfferInput> | null): Offer {
  const f = offerOr404(user, id)
  requireHrFull(user, 'Only HR edits offers.')
  if (f.status !== 'draft') throw new CodedApiError('Only a draft offer can be edited.', 409, 'offer_locked')
  Object.assign(f, validateOffer(f.companyId, raw ?? {}, f), { updatedAt: nowIso() })
  return offerView(f)
}

/**
 * draft → sent → accepted | declined. Accepting HIRES: creates the employee once (idempotent: an
 * accepted offer answers again without a second employee), marks the application hired, and fills the
 * opening when no position remains. Never creates a login.
 */
export function setOfferStatus(user: User, id: string, raw: Partial<OfferStatusInput> | null): Offer {
  const f = offerOr404(user, id)
  requireHrFull(user, 'Only HR records offer answers.')
  const to = raw?.status
  if (to !== 'sent' && to !== 'accepted' && to !== 'declined') throw invalid('Pick sent, accepted or declined.', 'status')
  if (f.status === to) return offerView(f)
  const co = f.companyId
  const a = hrApplications.find((x) => x.companyId === co && x.id === f.applicationId)!
  const o = hrOpenings.find((x) => x.companyId === co && x.id === a.openingId)!
  const flow: Record<string, string[]> = { draft: ['sent', 'declined'], sent: ['accepted', 'declined'], accepted: [], declined: [] }
  if (!flow[f.status].includes(to)) throw new CodedApiError(`A ${f.status} offer can’t be marked ${to}.`, 409, 'invalid_transition')
  const today = companyDayOf(co).today
  if (to === 'sent' && f.expiryDate < today) throw invalid('The expiry date has passed. Edit the offer first.', 'expiryDate')
  if (to === 'accepted') {
    if (f.expiryDate < today) throw new CodedApiError('This offer expired before it was accepted.', 409, 'offer_expired')
    if (a.stage !== 'offer') throw new CodedApiError('The candidate is no longer at the offer stage.', 409, 'invalid_stage_move')
    if (hiredCountOf(co, o.id) >= o.headcount) throw new CodedApiError('Every position of this opening is already filled.', 409, 'opening_filled')
    const c = candidateOf(co, a.candidateId)!
    // Idempotent: a hire already recorded for this application is reused.
    const employeeId =
      a.employeeId ??
      hireEmployee(
        co,
        {
          fullName: c.fullName,
          email: c.email,
          mobile: c.mobile,
          jobTitle: o.title,
          departmentId: o.departmentId,
          managerId: empIdForUser(o.hiringManagerId),
          hireDate: f.startDate,
          employmentType: o.employmentType,
        },
        user,
      ).id
    a.employeeId = employeeId
    a.stage = 'hired'
    a.stageChangedAt = nowIso()
    f.employeeId = employeeId
    if (hiredCountOf(co, o.id) >= o.headcount && ACTIVE_OPENING.includes(o.status)) {
      o.status = 'filled'
      o.updatedAt = nowIso()
    }
  }
  f.status = to
  f.updatedAt = nowIso()
  return offerView(f)
}
