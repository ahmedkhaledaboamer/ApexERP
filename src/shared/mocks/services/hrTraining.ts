import type { User } from '@/shared/types'
import type {
  Certificate,
  CertificateInput,
  Course,
  CourseDetail,
  CourseInput,
  EnrollInput,
  Enrollment,
  EnrollmentInput,
  EnrollmentStatus,
  MatrixCell,
  MyTraining,
  SessionInput,
  TrainingBudget,
  TrainingMatrix,
  TrainingOptions,
  TrainingSession,
} from '@/modules/hr/trainingTypes'
import { COURSE_CATEGORIES, ENROLLMENT_STATUSES } from '@/modules/hr/trainingTypes'
import { certificateExpiry, certificateState, compliancePct, isOverdue, matrixCell } from '@/modules/hr/lib/talent'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { ApiError } from '@/shared/lib/apiError'
import { departments } from '@/shared/mocks/data/departments'
import { employeeForUser, employeesOf } from '@/shared/mocks/data/hrEmployees'
import {
  hrCertificates,
  hrCourses,
  hrEnrollments,
  hrSessions,
  nextId,
  talentSeq,
  type CertificateRecord,
  type CourseRecord,
  type EnrollmentRecord,
  type SessionRecord,
} from '@/shared/mocks/data/hrTalent'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { nowIso } from '@/shared/mocks/clock'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { runTrainingReminders } from './trainingReminders'
import { companyCurrency, deptName, isHrFull, requireHr, requireHrFull, visibleEmployeeIds } from './hrTalentAccess'

/**
 * HR › Training (docs/API.md › HR › Training). Courses and sessions are the company catalogue (every HR
 * role reads them; HR full manages). Enrollments, certificates and the matrix are filtered to the
 * employees the caller may see: all (HR full), their team (Department Head), themselves (Employee).
 * Completing an enrollment issues a certificate (expiry = issue date + the course's validity months);
 * expiry alerts are stored notifications sent once (services/trainingReminders.ts).
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const invalid = (message: string, field?: string) => new CodedApiError(message, 422, 'validation_failed', field ? { field } : {})
const notFound = () => new ApiError(NOT_FOUND, 404)
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i
const SEATED: EnrollmentStatus[] = ['invited', 'enrolled', 'attended', 'completed', 'failed']

const todayOf = (co: string) => companyDayOf(co).today
const employeeOf = (co: string, id: string) => employeesOf(co).find((e) => e.id === id)
const courseOf = (co: string, id: string) => hrCourses.find((c) => c.companyId === co && c.id === id)
const sessionOf = (co: string, id: string) => hrSessions.find((s) => s.companyId === co && s.id === id)

/* ---------------- Views ---------------- */

function courseView(c: Tenant<CourseRecord>): Course {
  const co = c.companyId
  const sessions = hrSessions.filter((s) => s.companyId === co && s.courseId === c.id)
  const ids = new Set(sessions.map((s) => s.id))
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    provider: c.provider,
    providerName: c.providerName,
    durationHours: c.durationHours,
    cost: c.cost,
    currency: c.currency,
    mandatory: c.mandatory,
    validityMonths: c.validityMonths,
    description: c.description,
    active: c.active,
    sessionCount: sessions.length,
    completedCount: hrEnrollments.filter((e) => e.companyId === co && ids.has(e.sessionId) && e.status === 'completed').length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

function sessionView(s: Tenant<SessionRecord>): TrainingSession {
  const co = s.companyId
  return {
    id: s.id,
    courseId: s.courseId,
    courseTitle: courseOf(co, s.courseId)?.title ?? '—',
    startDate: s.startDate,
    endDate: s.endDate,
    location: s.location,
    onlineLink: s.onlineLink,
    trainer: s.trainer,
    capacity: s.capacity,
    extraCost: s.extraCost,
    status: s.status,
    enrolledCount: hrEnrollments.filter((e) => e.companyId === co && e.sessionId === s.id && SEATED.includes(e.status)).length,
    createdAt: s.createdAt,
  }
}

function enrollmentView(e: Tenant<EnrollmentRecord>): Enrollment {
  const co = e.companyId
  const s = sessionOf(co, e.sessionId)!
  const emp = employeeOf(co, e.employeeId)
  return {
    id: e.id,
    sessionId: s.id,
    courseId: s.courseId,
    courseTitle: courseOf(co, s.courseId)?.title ?? '—',
    employeeId: e.employeeId,
    employeeName: emp?.fullName ?? '—',
    departmentId: emp?.departmentId ?? null,
    status: e.status,
    score: e.score,
    feedbackRating: e.feedbackRating,
    feedback: e.feedback,
    sessionStart: s.startDate,
    sessionEnd: s.endDate,
    certificateId: hrCertificates.find((c) => c.companyId === co && c.enrollmentId === e.id)?.id ?? null,
    updatedAt: e.updatedAt,
  }
}

function certificateView(c: Tenant<CertificateRecord>, today: string): Certificate {
  const co = c.companyId
  const { state, daysLeft } = certificateState(today, c.expiryDate)
  return {
    id: c.id,
    number: c.number,
    courseId: c.courseId,
    courseTitle: courseOf(co, c.courseId)?.title ?? '—',
    employeeId: c.employeeId,
    employeeName: employeeOf(co, c.employeeId)?.fullName ?? '—',
    enrollmentId: c.enrollmentId,
    issueDate: c.issueDate,
    expiryDate: c.expiryDate,
    fileUrl: c.fileUrl,
    state,
    daysLeft,
  }
}

/* ---------------- Options ---------------- */

export function trainingOptions(user: User): TrainingOptions {
  requireHr(user)
  const co = tenantOf(user)
  const ids = visibleEmployeeIds(user)
  return {
    employees: employeesOf(co).filter((e) => ids.has(e.id) && e.status !== 'terminated').map((e) => ({ id: e.id, name: e.fullName, departmentId: e.departmentId })),
    departments: departments.filter((d) => d.companyId === co && d.active).map((d) => ({ id: d.id, name: d.name })),
    currency: companyCurrency(co),
    manage: isHrFull(user),
  }
}

/* ---------------- Courses ---------------- */

export function listCourses(user: User): Course[] {
  requireHr(user)
  const co = tenantOf(user)
  runTrainingReminders(co)
  return hrCourses.filter((c) => c.companyId === co).sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || a.title.localeCompare(b.title)).map(courseView)
}

function courseOr404(user: User, id: string): Tenant<CourseRecord> {
  requireHr(user)
  const c = courseOf(tenantOf(user), id)
  if (!c) throw notFound()
  return c
}

export function getCourse(user: User, id: string): CourseDetail {
  const c = courseOr404(user, id)
  const co = c.companyId
  const sessions = hrSessions.filter((s) => s.companyId === co && s.courseId === c.id).sort((a, b) => b.startDate.localeCompare(a.startDate))
  const ids = new Set(sessions.map((s) => s.id))
  const visible = visibleEmployeeIds(user)
  return {
    ...courseView(c),
    sessions: sessions.map(sessionView),
    enrollments: hrEnrollments.filter((e) => e.companyId === co && ids.has(e.sessionId) && visible.has(e.employeeId)).map(enrollmentView),
  }
}

function validateCourse(co: string, raw: Partial<CourseInput>, base: CourseRecord | null): Omit<CourseRecord, 'id' | 'createdAt' | 'updatedAt'> {
  const pick = <K extends keyof CourseInput>(k: K) => (raw[k] !== undefined ? raw[k] : base ? (base as unknown as CourseInput)[k] : undefined)
  const title = str(pick('title'))
  if (title.length < 2 || title.length > 150) throw invalid('Enter the course title.', 'title')
  const category = (str(pick('category')) || 'other') as CourseInput['category']
  if (!COURSE_CATEGORIES.includes(category)) throw invalid('Pick a category.', 'category')
  const provider = (str(pick('provider')) || 'internal') as CourseInput['provider']
  if (provider !== 'internal' && provider !== 'external') throw invalid('Pick internal or external.', 'provider')
  const durationHours = Number(pick('durationHours') ?? 1)
  if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 1000) throw invalid('Duration is a positive number of hours.', 'durationHours')
  const cost = Number(pick('cost') ?? 0)
  if (!Number.isFinite(cost) || cost < 0 || cost > 1e8) throw invalid('Cost is 0 or a positive amount.', 'cost')
  const currency = (str(pick('currency')) || companyCurrency(co)).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw invalid('Use a 3-letter currency code.', 'currency')
  const v = pick('validityMonths')
  const validityMonths = v === null || v === undefined || (v as unknown) === '' ? null : Number(v)
  if (validityMonths !== null && (!Number.isInteger(validityMonths) || validityMonths < 0 || validityMonths > 120)) throw invalid('Validity is 0 to 120 whole months (empty = never expires).', 'validityMonths')
  return {
    title,
    category,
    provider,
    providerName: str(pick('providerName')).slice(0, 150),
    durationHours: Math.round(durationHours * 10) / 10,
    cost: Math.round(cost * 100) / 100,
    currency,
    mandatory: pick('mandatory') === true,
    validityMonths,
    description: str(pick('description')).slice(0, 4000),
    active: pick('active') !== false,
  }
}

export function createCourse(user: User, raw: Partial<CourseInput> | null): Course {
  requireHrFull(user, 'Only HR manages the training catalogue.')
  if (!raw) throw invalid('Send the course details.')
  const co = tenantOf(user)
  const stamp = nowIso()
  const row: Tenant<CourseRecord> = { companyId: co, id: nextId('course', 'CRS'), ...validateCourse(co, raw, null), createdAt: stamp, updatedAt: stamp }
  hrCourses.push(row)
  return courseView(row)
}

export function updateCourse(user: User, id: string, raw: Partial<CourseInput> | null): Course {
  const c = courseOr404(user, id)
  requireHrFull(user, 'Only HR manages the training catalogue.')
  Object.assign(c, validateCourse(c.companyId, raw ?? {}, c), { updatedAt: nowIso() })
  return courseView(c)
}

/* ---------------- Sessions ---------------- */

function validateSession(raw: Partial<SessionInput>, base: SessionRecord | null) {
  const startDate = raw.startDate ?? base?.startDate
  const endDate = raw.endDate ?? base?.endDate ?? startDate
  if (!isRealIsoDate(startDate)) throw invalid('Pick the start date.', 'startDate')
  if (!isRealIsoDate(endDate) || endDate < startDate) throw invalid('The end date can’t be before the start date.', 'endDate')
  const onlineLink = str(raw.onlineLink ?? base?.onlineLink)
  if (onlineLink && !URL_RE.test(onlineLink)) throw invalid('Use a full link (https://…).', 'onlineLink')
  const location = str(raw.location ?? base?.location).slice(0, 200)
  if (!location && !onlineLink) throw invalid('Give a location or an online link.', 'location')
  const capacity = Number(raw.capacity ?? base?.capacity ?? 20)
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw invalid('Capacity is 1 to 1000 seats.', 'capacity')
  const extraCost = Number(raw.extraCost ?? base?.extraCost ?? 0)
  if (!Number.isFinite(extraCost) || extraCost < 0 || extraCost > 1e8) throw invalid('Session cost is 0 or a positive amount.', 'extraCost')
  const status = raw.status ?? base?.status ?? 'scheduled'
  if (!['scheduled', 'completed', 'cancelled'].includes(status)) throw invalid('Pick a status.', 'status')
  return { startDate, endDate, location, onlineLink, trainer: str(raw.trainer ?? base?.trainer).slice(0, 150), capacity, extraCost: Math.round(extraCost * 100) / 100, status }
}

export function createSession(user: User, courseId: string, raw: Partial<SessionInput> | null): TrainingSession {
  const c = courseOr404(user, courseId)
  requireHrFull(user, 'Only HR schedules training sessions.')
  const row: Tenant<SessionRecord> = { companyId: c.companyId, id: nextId('session', 'SES'), courseId: c.id, ...validateSession(raw ?? {}, null), createdAt: nowIso() }
  hrSessions.push(row)
  return sessionView(row)
}

function sessionOr404(user: User, id: string): Tenant<SessionRecord> {
  requireHr(user)
  const s = sessionOf(tenantOf(user), id)
  if (!s) throw notFound()
  return s
}

export function updateSession(user: User, id: string, raw: Partial<SessionInput> | null): TrainingSession {
  const s = sessionOr404(user, id)
  requireHrFull(user, 'Only HR schedules training sessions.')
  const fields = validateSession(raw ?? {}, s)
  const seated = hrEnrollments.filter((e) => e.companyId === s.companyId && e.sessionId === s.id && SEATED.includes(e.status)).length
  if (fields.capacity < seated) throw invalid(`${seated} people are already enrolled.`, 'capacity')
  Object.assign(s, fields)
  return sessionView(s)
}

/* ---------------- Enrollments ---------------- */

export function enroll(user: User, sessionId: string, raw: Partial<EnrollInput> | null): Enrollment[] {
  const s = sessionOr404(user, sessionId)
  requireHrFull(user, 'Only HR enrolls employees.')
  const co = s.companyId
  if (s.status === 'cancelled') throw new CodedApiError('This session was cancelled.', 409, 'session_cancelled')
  const ids = Array.isArray(raw?.employeeIds) ? [...new Set(raw!.employeeIds.map(str).filter(Boolean))] : []
  if (!ids.length) throw invalid('Pick at least one employee.', 'employeeIds')
  const status = raw?.status ?? 'enrolled'
  if (status !== 'invited' && status !== 'enrolled') throw invalid('New participants are invited or enrolled.', 'status')
  for (const id of ids) {
    const e = employeeOf(co, id)
    if (!e) throw notFound()
    if (e.status === 'terminated') throw invalid(`${e.fullName} has left the company.`, 'employeeIds')
  }
  const fresh = ids.filter((id) => !hrEnrollments.some((x) => x.companyId === co && x.sessionId === s.id && x.employeeId === id))
  if (!fresh.length) throw new CodedApiError('Everyone picked is already on this session.', 409, 'already_enrolled')
  const seated = hrEnrollments.filter((e) => e.companyId === co && e.sessionId === s.id && SEATED.includes(e.status)).length
  if (seated + fresh.length > s.capacity) throw new CodedApiError(`Only ${Math.max(0, s.capacity - seated)} seats are left.`, 409, 'session_full')
  const stamp = nowIso()
  const rows = fresh.map((employeeId) => ({ companyId: co, id: nextId('enrollment', 'ENR'), sessionId: s.id, employeeId, status, score: null, feedbackRating: null, feedback: '', updatedAt: stamp }) as Tenant<EnrollmentRecord>)
  hrEnrollments.push(...rows)
  return rows.map(enrollmentView)
}

function issueCertificate(e: Tenant<EnrollmentRecord>, course: CourseRecord, issueDate: string): void {
  if (course.validityMonths === 0) return
  if (hrCertificates.some((c) => c.companyId === e.companyId && c.enrollmentId === e.id)) return
  const n = ++talentSeq.certificate
  const prefix = employeesOf(e.companyId)[0]?.employeeNo.split('-')[0] ?? 'CRT'
  hrCertificates.push({
    companyId: e.companyId,
    id: `CRT-${n}`,
    number: `${prefix}-${issueDate.slice(0, 4)}-${String(n).padStart(4, '0')}`,
    courseId: course.id,
    employeeId: e.employeeId,
    enrollmentId: e.id,
    issueDate,
    expiryDate: certificateExpiry(issueDate, course.validityMonths),
    fileUrl: '',
    expiryNotifiedAt: null,
    createdAt: nowIso(),
  })
}

/**
 * HR full: status, score (0–100), feedback. Completed issues the certificate once (issue date = the
 * company's today); moving away from completed withdraws it. The employee may rate their own
 * enrollment (feedback rating 1–5 + feedback) once they attended.
 */
export function updateEnrollment(user: User, id: string, raw: Partial<EnrollmentInput> | null): Enrollment {
  requireHr(user)
  const co = tenantOf(user)
  const e = hrEnrollments.find((x) => x.companyId === co && x.id === id)
  if (!e || !visibleEmployeeIds(user).has(e.employeeId)) throw notFound()
  const input = raw ?? {}
  const full = isHrFull(user)
  const self = employeeForUser(co, user.id)?.id === e.employeeId
  if (!full) {
    if (!self) throw new ApiError('Only HR records training results.', 403)
    if (input.status !== undefined || input.score !== undefined) throw new ApiError('Only HR records attendance and scores.', 403)
    if (!['attended', 'completed', 'failed'].includes(e.status)) throw new CodedApiError('You can rate a training once you attended it.', 409, 'not_attended')
  }
  const status = input.status ?? e.status
  if (!ENROLLMENT_STATUSES.includes(status)) throw invalid('Pick a status.', 'status')
  let score = e.score
  if (input.score !== undefined) {
    score = input.score === null ? null : Number(input.score)
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw invalid('Score is 0 to 100.', 'score')
  }
  let rating = e.feedbackRating
  if (input.feedbackRating !== undefined) {
    rating = input.feedbackRating === null ? null : Number(input.feedbackRating)
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw invalid('Rating is a whole number from 1 to 5.', 'feedbackRating')
  }
  const s = sessionOf(co, e.sessionId)!
  if (status !== e.status && ['attended', 'completed', 'failed', 'no_show'].includes(status) && s.startDate > todayOf(co)) {
    throw new CodedApiError('This session hasn’t started yet.', 409, 'session_not_started')
  }
  e.status = status
  e.score = score
  e.feedbackRating = rating
  if (input.feedback !== undefined) e.feedback = str(input.feedback).slice(0, 2000)
  e.updatedAt = nowIso()
  const course = courseOf(co, s.courseId)!
  if (status === 'completed') issueCertificate(e, course, todayOf(co))
  else {
    const i = hrCertificates.findIndex((c) => c.companyId === co && c.enrollmentId === e.id)
    if (i >= 0) hrCertificates.splice(i, 1)
  }
  return enrollmentView(e)
}

/* ---------------- Certificates ---------------- */

export function listCertificates(user: User): Certificate[] {
  requireHr(user)
  const co = tenantOf(user)
  runTrainingReminders(co)
  const visible = visibleEmployeeIds(user)
  const today = todayOf(co)
  return hrCertificates
    .filter((c) => c.companyId === co && visible.has(c.employeeId))
    .map((c) => certificateView(c, today))
    .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'))
}

/** HR full: correct the dates or attach the file. A date change re-arms the expiry alert. */
export function updateCertificate(user: User, id: string, raw: Partial<CertificateInput> | null): Certificate {
  requireHr(user)
  const co = tenantOf(user)
  const c = hrCertificates.find((x) => x.companyId === co && x.id === id)
  if (!c || !visibleEmployeeIds(user).has(c.employeeId)) throw notFound()
  requireHrFull(user, 'Only HR edits certificates.')
  const input = raw ?? {}
  const issueDate = input.issueDate ?? c.issueDate
  if (!isRealIsoDate(issueDate)) throw invalid('Pick the issue date.', 'issueDate')
  const course = courseOf(co, c.courseId)
  let expiryDate = input.expiryDate !== undefined ? input.expiryDate : input.issueDate !== undefined ? certificateExpiry(issueDate, course?.validityMonths ?? null) : c.expiryDate
  if (expiryDate === '') expiryDate = null
  if (expiryDate !== null && (!isRealIsoDate(expiryDate) || expiryDate <= issueDate)) throw invalid('The expiry date must be after the issue date.', 'expiryDate')
  const fileUrl = input.fileUrl !== undefined ? str(input.fileUrl) : c.fileUrl
  if (fileUrl && !URL_RE.test(fileUrl)) throw invalid('Use a full link (https://…).', 'fileUrl')
  if (issueDate !== c.issueDate || expiryDate !== c.expiryDate) c.expiryNotifiedAt = null
  c.issueDate = issueDate
  c.expiryDate = expiryDate
  c.fileUrl = fileUrl
  return certificateView(c, todayOf(co))
}

/* ---------------- Matrix, budget, my training ---------------- */

/** The newest certificate (or certificate-less completion) of an employee for a course. */
function bestOf(co: string, employeeId: string, course: CourseRecord): { expiryDate: string | null } | null {
  const certs = hrCertificates.filter((c) => c.companyId === co && c.employeeId === employeeId && c.courseId === course.id).sort((a, b) => b.issueDate.localeCompare(a.issueDate))
  if (certs.length) return { expiryDate: certs[0].expiryDate }
  if (course.validityMonths === 0) {
    const sessions = new Set(hrSessions.filter((s) => s.companyId === co && s.courseId === course.id).map((s) => s.id))
    if (hrEnrollments.some((e) => e.companyId === co && e.employeeId === employeeId && sessions.has(e.sessionId) && e.status === 'completed')) return { expiryDate: null }
  }
  return null
}

export function cellFor(co: string, today: string, employee: { id: string; hireDate: string }, course: CourseRecord): MatrixCell {
  return matrixCell(today, employee.hireDate, bestOf(co, employee.id, course))
}

export function trainingMatrix(user: User): TrainingMatrix {
  requireHr(user)
  const co = tenantOf(user)
  const today = todayOf(co)
  const visible = visibleEmployeeIds(user)
  const courses = hrCourses.filter((c) => c.companyId === co && c.mandatory && c.active)
  const rows = employeesOf(co)
    .filter((e) => visible.has(e.id) && e.status !== 'terminated')
    .map((e) => {
      const cells = Object.fromEntries(courses.map((c) => [c.id, cellFor(co, today, e, c)])) as Record<string, MatrixCell>
      return { employeeId: e.id, employeeName: e.fullName, departmentId: e.departmentId, cells, compliancePct: compliancePct(Object.values(cells)) }
    })
  const all = rows.flatMap((r) => Object.values(r.cells))
  return {
    courses: courses.map((c) => ({ id: c.id, title: c.title, validityMonths: c.validityMonths })),
    rows,
    compliancePct: compliancePct(all),
    overdueCount: all.filter(isOverdue).length,
  }
}

/**
 * Spend per department for a year (sessions starting that year): the course cost per seated participant
 * (no-shows still cost a seat) plus the session's extra cost split evenly over its participants.
 * HR full only. Amounts are in each course's currency; the company currency is assumed throughout.
 */
export function trainingBudget(user: User, yearRaw: string | null): TrainingBudget {
  requireHrFull(user, 'Only HR sees the training budget.')
  const co = tenantOf(user)
  const year = Number(yearRaw) || Number(todayOf(co).slice(0, 4))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw invalid('Pick a year.', 'year')
  const byDept = new Map<string, { participants: number; courseCost: number; sessionCost: number }>()
  const add = (dept: string, k: 'courseCost' | 'sessionCost', amount: number, people = 0) => {
    const row = byDept.get(dept) ?? { participants: 0, courseCost: 0, sessionCost: 0 }
    row[k] += amount
    row.participants += people
    byDept.set(dept, row)
  }
  for (const s of hrSessions) {
    if (s.companyId !== co || s.status === 'cancelled' || Number(s.startDate.slice(0, 4)) !== year) continue
    const course = courseOf(co, s.courseId)
    if (!course) continue
    const seats = hrEnrollments.filter((e) => e.companyId === co && e.sessionId === s.id && e.status !== 'invited')
    for (const e of seats) {
      const dept = employeeOf(co, e.employeeId)?.departmentId ?? ''
      add(dept, 'courseCost', course.cost, 1)
      add(dept, 'sessionCost', seats.length ? s.extraCost / seats.length : 0)
    }
    if (!seats.length && s.extraCost) add('', 'sessionCost', s.extraCost)
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const rows = [...byDept.entries()]
    .map(([d, v]) => ({ departmentId: d || null, departmentName: d ? deptName(co, d) : 'No department', participants: v.participants, courseCost: r2(v.courseCost), sessionCost: r2(v.sessionCost), total: r2(v.courseCost + v.sessionCost) }))
    .sort((a, b) => b.total - a.total)
  return { year, currency: companyCurrency(co), rows, total: r2(rows.reduce((s, r) => s + r.total, 0)) }
}

export function myTraining(user: User): MyTraining {
  requireHr(user)
  const co = tenantOf(user)
  return trainingOfEmployee(co, employeeForUser(co, user.id))
}

/**
 * One employee's enrollments, certificates and mandatory course states (no scope check: the caller decides).
 * Shared by GET /hr/training/my and the self-service portal (GET /hr/me, any role with an employee record).
 */
export function trainingOfEmployee(co: string, me: { id: string; hireDate: string } | undefined): MyTraining {
  runTrainingReminders(co)
  if (!me) return { employeeId: null, enrollments: [], certificates: [], mandatory: [] }
  const today = todayOf(co)
  return {
    employeeId: me.id,
    enrollments: hrEnrollments.filter((e) => e.companyId === co && e.employeeId === me.id).map(enrollmentView).sort((a, b) => b.sessionStart.localeCompare(a.sessionStart)),
    certificates: hrCertificates.filter((c) => c.companyId === co && c.employeeId === me.id).map((c) => certificateView(c, today)),
    mandatory: hrCourses.filter((c) => c.companyId === co && c.mandatory && c.active).map((c) => ({ courseId: c.id, title: c.title, state: cellFor(co, today, me, c) })),
  }
}
