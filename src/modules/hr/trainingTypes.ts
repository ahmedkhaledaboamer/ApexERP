/**
 * HR › Training (docs/API.md › HR › Training). Courses, their sessions, enrollments of employees,
 * certificates issued on completion (expiry = issue date + the course's validity), the mandatory
 * training matrix and the training budget. Dates are company calendar days (yyyy-MM-dd).
 */

export type CourseCategory = 'safety' | 'compliance' | 'technical' | 'soft_skills' | 'leadership' | 'onboarding' | 'other'
export const COURSE_CATEGORIES: CourseCategory[] = ['safety', 'compliance', 'technical', 'soft_skills', 'leadership', 'onboarding', 'other']
export const COURSE_CATEGORY_LABEL: Record<CourseCategory, string> = {
  safety: 'Health & safety',
  compliance: 'Compliance',
  technical: 'Technical',
  soft_skills: 'Soft skills',
  leadership: 'Leadership',
  onboarding: 'Onboarding',
  other: 'Other',
}

export type CourseProvider = 'internal' | 'external'
export const COURSE_PROVIDER_LABEL: Record<CourseProvider, string> = { internal: 'Internal', external: 'External' }

export interface Course {
  id: string
  title: string
  category: CourseCategory
  provider: CourseProvider
  /** External provider / internal owner name. */
  providerName: string
  durationHours: number
  /** Cost per participant. */
  cost: number
  currency: string
  mandatory: boolean
  /** Certificate validity in months (null = no certificate expiry; 0 = no certificate). */
  validityMonths: number | null
  description: string
  active: boolean
  sessionCount: number
  completedCount: number
  createdAt: string
  updatedAt: string
}

export interface CourseInput {
  title: string
  category: CourseCategory
  provider: CourseProvider
  providerName: string
  durationHours: number
  cost: number
  currency: string
  mandatory: boolean
  validityMonths: number | null
  description: string
  active: boolean
}

export type SessionStatus = 'scheduled' | 'completed' | 'cancelled'
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' }

export interface TrainingSession {
  id: string
  courseId: string
  courseTitle: string
  /** Company calendar days. */
  startDate: string
  endDate: string
  location: string
  onlineLink: string
  trainer: string
  capacity: number
  /** Extra session cost (venue, trainer fee), on top of the per-participant course cost. */
  extraCost: number
  status: SessionStatus
  enrolledCount: number
  createdAt: string
}

export interface SessionInput {
  startDate: string
  endDate: string
  location: string
  onlineLink: string
  trainer: string
  capacity: number
  extraCost: number
  status?: SessionStatus
}

export type EnrollmentStatus = 'invited' | 'enrolled' | 'attended' | 'no_show' | 'completed' | 'failed'
export const ENROLLMENT_STATUSES: EnrollmentStatus[] = ['invited', 'enrolled', 'attended', 'no_show', 'completed', 'failed']
export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  invited: 'Invited',
  enrolled: 'Enrolled',
  attended: 'Attended',
  no_show: 'No-show',
  completed: 'Completed',
  failed: 'Failed',
}

export interface Enrollment {
  id: string
  sessionId: string
  courseId: string
  courseTitle: string
  employeeId: string
  employeeName: string
  departmentId: string | null
  status: EnrollmentStatus
  /** 0–100. */
  score: number | null
  /** 1–5. */
  feedbackRating: number | null
  feedback: string
  sessionStart: string
  sessionEnd: string
  certificateId: string | null
  updatedAt: string
}

export interface EnrollInput {
  employeeIds: string[]
  status?: 'invited' | 'enrolled'
}

export interface EnrollmentInput {
  status?: EnrollmentStatus
  score?: number | null
  feedbackRating?: number | null
  feedback?: string
}

export type CertificateState = 'valid' | 'expiring' | 'expired'
export const CERTIFICATE_STATE_LABEL: Record<CertificateState, string> = { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired' }
/** Alert window before a certificate's expiry (days). */
export const CERTIFICATE_ALERT_DAYS = 30

export interface Certificate {
  id: string
  number: string
  courseId: string
  courseTitle: string
  employeeId: string
  employeeName: string
  enrollmentId: string | null
  issueDate: string
  /** issueDate + the course's validity months; null when the course has no expiry. */
  expiryDate: string | null
  fileUrl: string
  state: CertificateState
  /** Days until expiry (company calendar), null without expiry. */
  daysLeft: number | null
}

export interface CertificateInput {
  issueDate?: string
  expiryDate?: string | null
  fileUrl?: string
}

export type MatrixCell = 'compliant' | 'expiring' | 'expired' | 'missing' | 'overdue'
export interface TrainingMatrix {
  courses: { id: string; title: string; validityMonths: number | null }[]
  rows: { employeeId: string; employeeName: string; departmentId: string | null; cells: Record<string, MatrixCell>; compliancePct: number }[]
  /** Share of (employee × mandatory course) cells that are compliant or expiring (still valid). */
  compliancePct: number
  overdueCount: number
}

export interface TrainingBudget {
  year: number
  currency: string
  rows: { departmentId: string | null; departmentName: string; participants: number; courseCost: number; sessionCost: number; total: number }[]
  total: number
}

export interface MyTraining {
  employeeId: string | null
  enrollments: Enrollment[]
  certificates: Certificate[]
  /** Mandatory courses and the caller's state for each. */
  mandatory: { courseId: string; title: string; state: MatrixCell }[]
}

export interface CourseDetail extends Course {
  sessions: TrainingSession[]
  enrollments: Enrollment[]
}

export interface TrainingOptions {
  employees: { id: string; name: string; departmentId: string | null }[]
  departments: { id: string; name: string }[]
  currency: string
  manage: boolean
}
