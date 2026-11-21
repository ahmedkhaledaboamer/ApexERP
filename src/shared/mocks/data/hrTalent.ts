import type { EmploymentType } from '@/modules/hr/types'
import type {
  ApplicationStage,
  CandidateSource,
  CriterionScore,
  CvFile,
  InterviewStatus,
  InterviewType,
  OfferStatus,
  OpeningStatus,
  Recommendation,
} from '@/modules/hr/recruitmentTypes'
import { DEFAULT_CRITERIA } from '@/modules/hr/recruitmentTypes'
import type { CourseCategory, CourseProvider, EnrollmentStatus, SessionStatus } from '@/modules/hr/trainingTypes'
import { certificateExpiry } from '@/modules/hr/lib/talent'
import type { Tenant } from '@/shared/mocks/tenant'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { empIdForUser, hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'

/**
 * HR recruitment and training stores (server rows; the services compute the views). Synthetic seed,
 * different per company: Apex hires engineers and sales staff and trains on fire safety + data
 * protection; Crest hires warehouse and fleet staff and trains on forklift safety + labour law.
 * The seeded "already hired" application of each company points at an existing employee (EMP-<userId>)
 * whose hire date is the offer's start date, so it is consistent with the hire path.
 */

/* ---------------- Records ---------------- */

export interface OpeningRecord {
  id: string
  title: string
  departmentId: string
  hiringManagerId: string
  headcount: number
  employmentType: EmploymentType
  location: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  description: string
  requirements: string
  status: OpeningStatus
  requestedBy: string
  approvedBy: string | null
  approvedAt: string | null
  criteria: string[]
  createdAt: string
  updatedAt: string
}

export interface CandidateRecord {
  id: string
  fullName: string
  email: string
  mobile: string
  currentCompany: string
  currentTitle: string
  source: CandidateSource
  cv: CvFile | null
  notes: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface ApplicationRecord {
  id: string
  candidateId: string
  openingId: string
  stage: ApplicationStage
  rejectionReason: string | null
  employeeId: string | null
  stageChangedAt: string
  createdAt: string
}

export interface ScorecardRecord {
  interviewerId: string
  scores: CriterionScore[]
  recommendation: Recommendation
  notes: string
  submittedAt: string
}

export interface InterviewRecord {
  id: string
  applicationId: string
  scheduledAt: string
  durationMinutes: number
  type: InterviewType
  location: string
  interviewerIds: string[]
  status: InterviewStatus
  scorecards: ScorecardRecord[]
  createdAt: string
}

export interface OfferRecord {
  id: string
  applicationId: string
  salary: number
  currency: string
  startDate: string
  expiryDate: string
  status: OfferStatus
  employeeId: string | null
  createdAt: string
  updatedAt: string
}

export interface CourseRecord {
  id: string
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
  createdAt: string
  updatedAt: string
}

export interface SessionRecord {
  id: string
  courseId: string
  startDate: string
  endDate: string
  location: string
  onlineLink: string
  trainer: string
  capacity: number
  extraCost: number
  status: SessionStatus
  createdAt: string
}

export interface EnrollmentRecord {
  id: string
  sessionId: string
  employeeId: string
  status: EnrollmentStatus
  score: number | null
  feedbackRating: number | null
  feedback: string
  updatedAt: string
}

export interface CertificateRecord {
  id: string
  number: string
  courseId: string
  employeeId: string
  enrollmentId: string | null
  issueDate: string
  expiryDate: string | null
  fileUrl: string
  /** Expiry alert sent (once) for this expiry date; cleared when the dates change (re-armed). */
  expiryNotifiedAt: string | null
  createdAt: string
}

/* ---------------- Seed helpers ---------------- */

const DAY = 86_400_000
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
const at = (n: number, hour = 6) => {
  const d = new Date(Date.now() + n * DAY)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}
const created = (n: number) => new Date(Date.now() - n * DAY).toISOString()
const card = (criteria: string[], scores: number[]) => criteria.map((criterion, i) => ({ criterion, score: scores[i % scores.length] }))
const hireDateOf = (userId: string) => hrEmployees.find((e) => e.id === empIdForUser(userId))?.hireDate ?? day(-30)
const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id
const userEmail = (id: string) => users.find((u) => u.id === id)?.email ?? ''
const userMobile = (id: string) => users.find((u) => u.id === id)?.mobile ?? ''

/** Ids: one global sequence per kind (ids are unique across companies). */
export const talentSeq = registerObject('hrTalent.seq', { opening: 1000, candidate: 1000, application: 1000, interview: 1000, offer: 1000, course: 1000, session: 1000, enrollment: 1000, certificate: 1000 })
export const nextId = (kind: keyof typeof talentSeq, prefix: string) => `${prefix}-${++talentSeq[kind]}`

const C = DEFAULT_CRITERIA

/* ---------------- Recruitment seed ---------------- */

type Seed = {
  openings: Tenant<OpeningRecord>[]
  candidates: Tenant<CandidateRecord>[]
  applications: Tenant<ApplicationRecord>[]
  interviews: Tenant<InterviewRecord>[]
  offers: Tenant<OfferRecord>[]
}

function opening(companyId: string, o: Partial<OpeningRecord> & Pick<OpeningRecord, 'id' | 'title' | 'departmentId' | 'hiringManagerId' | 'status'>, age: number): Tenant<OpeningRecord> {
  return {
    companyId,
    headcount: 1,
    employmentType: 'full_time',
    location: '',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    description: '',
    requirements: '',
    requestedBy: o.hiringManagerId,
    approvedBy: null,
    approvedAt: null,
    criteria: [...C],
    createdAt: created(age),
    updatedAt: created(Math.max(0, age - 3)),
    ...o,
  }
}

function cand(companyId: string, id: string, fullName: string, email: string, mobile: string, currentCompany: string, currentTitle: string, source: CandidateSource, age: number, extra: Partial<CandidateRecord> = {}): Tenant<CandidateRecord> {
  return { companyId, id, fullName, email, mobile, currentCompany, currentTitle, source, cv: null, notes: '', tags: [], createdAt: created(age), updatedAt: created(age), ...extra }
}

function app(companyId: string, id: string, candidateId: string, openingId: string, stage: ApplicationStage, age: number, extra: Partial<ApplicationRecord> = {}): Tenant<ApplicationRecord> {
  return { companyId, id, candidateId, openingId, stage, rejectionReason: null, employeeId: null, stageChangedAt: created(Math.max(0, age - 4)), createdAt: created(age), ...extra }
}

const cv = (name: string, kb: number, age: number): CvFile => ({ name, sizeBytes: kb * 1024, mimeType: 'application/pdf', uploadedAt: created(age) })

function apexRecruitment(): Seed {
  const co = APEX_ID
  const hiredUser = 'u17'
  const hireDate = hireDateOf(hiredUser)
  const openings = [
    opening(co, { id: 'JOB-101', title: 'Senior Frontend Engineer', departmentId: 'd-delivery', hiringManagerId: 'u10', status: 'open', headcount: 2, location: 'Dubai (hybrid)', salaryMin: 22000, salaryMax: 28000, salaryCurrency: 'AED', description: 'Build the client portals we deliver for enterprise customers.', requirements: '5+ years React and TypeScript; design systems; accessibility.', requestedBy: 'u10', approvedBy: 'u9', approvedAt: created(40) }, 42),
    opening(co, { id: 'JOB-102', title: 'Account Executive, Public Sector', departmentId: 'd-sales', hiringManagerId: 'u3', status: 'open', location: 'Abu Dhabi', salaryMin: 15000, salaryMax: 19000, salaryCurrency: 'AED', description: 'Own government and semi-government accounts.', requirements: 'Tender experience in the UAE; Arabic and English.', requestedBy: 'u9' }, 25),
    opening(co, { id: 'JOB-103', title: 'UI Designer', departmentId: 'd-delivery', hiringManagerId: 'u10', status: 'filled', location: 'Dubai', salaryMin: 14000, salaryMax: 17000, salaryCurrency: 'AED', description: 'Design product screens with the delivery team.', requirements: 'Portfolio of web apps; Figma.', approvedBy: 'u9', approvedAt: created(120) }, 125),
    opening(co, { id: 'JOB-104', title: 'QA Automation Engineer', departmentId: 'd-delivery', hiringManagerId: 'u10', status: 'pending_approval', location: 'Dubai', salaryMin: 13000, salaryMax: 16000, salaryCurrency: 'AED', description: 'Grow our automated test coverage.', requirements: 'Playwright or Cypress; CI pipelines.' }, 4),
    opening(co, { id: 'JOB-105', title: 'HR Coordinator', departmentId: 'd-hr', hiringManagerId: 'u9', status: 'draft', location: 'Dubai', employmentType: 'full_time', requestedBy: 'u9' }, 2),
  ]
  const candidates = [
    cand(co, 'CAN-101', 'Tamer Abdelaziz', 'tamer.abdelaziz@mailbox.test', '+971 50 410 2231', 'Gulf Digital Works', 'Frontend Lead', 'linkedin', 30, { cv: cv('Tamer-Abdelaziz-CV.pdf', 420, 30), tags: ['react', 'lead'] }),
    cand(co, 'CAN-102', 'Ritika Menon', 'ritika.menon@mailbox.test', '+971 55 302 7714', 'Souq Labs', 'Senior Engineer', 'referral', 28, { cv: cv('Ritika-Menon-Resume.pdf', 380, 28), notes: 'Referred by Yusuf.' }),
    cand(co, 'CAN-103', 'Khalid Barakat', 'khalid.barakat@mailbox.test', '+971 52 118 9042', 'Freelance', 'Frontend Developer', 'job_board', 26),
    cand(co, 'CAN-104', 'Elena Petrova', 'elena.petrova@mailbox.test', '+44 7700 900123', 'Northwind UK', 'Staff Engineer', 'agency', 20, { cv: cv('Elena-Petrova-CV.pdf', 510, 20), tags: ['relocation'] }),
    cand(co, 'CAN-105', 'Samir Haddadin', 'samir.haddadin@mailbox.test', '+971 56 771 3320', 'Desert Apps', 'Web Developer', 'website', 15),
    cand(co, 'CAN-106', 'Joanna Cruz', 'joanna.cruz@mailbox.test', '+971 54 660 1180', 'Metro Telecom', 'Key Account Manager', 'linkedin', 18, { cv: cv('Joanna-Cruz.pdf', 290, 18) }),
    cand(co, 'CAN-107', 'Bilal Chaudhry', 'bilal.chaudhry@mailbox.test', '+971 50 993 4471', 'Emirates Systems', 'Sales Executive', 'referral', 12),
    cand(co, 'CAN-108', 'Grace Wanjiru', 'grace.wanjiru@mailbox.test', '+971 58 220 3049', 'Pixel Studio', 'Junior Developer', 'job_board', 10),
    cand(co, 'CAN-109', userName(hiredUser), userEmail(hiredUser), userMobile(hiredUser), 'Atelier Blue', 'Product Designer', 'linkedin', 120, { cv: cv('Portfolio-and-CV.pdf', 2048, 120), tags: ['hired'] }),
  ]
  const applications = [
    app(co, 'APP-101', 'CAN-101', 'JOB-101', 'offer', 30),
    app(co, 'APP-102', 'CAN-102', 'JOB-101', 'interview', 28),
    app(co, 'APP-103', 'CAN-103', 'JOB-101', 'screening', 26),
    app(co, 'APP-104', 'CAN-104', 'JOB-101', 'assessment', 20),
    app(co, 'APP-105', 'CAN-105', 'JOB-101', 'applied', 15),
    app(co, 'APP-106', 'CAN-108', 'JOB-101', 'rejected', 10, { rejectionReason: 'Not enough senior experience yet.' }),
    app(co, 'APP-107', 'CAN-106', 'JOB-102', 'interview', 18),
    app(co, 'APP-108', 'CAN-107', 'JOB-102', 'applied', 12),
    app(co, 'APP-109', 'CAN-109', 'JOB-103', 'hired', 120, { employeeId: empIdForUser(hiredUser), stageChangedAt: created(100) }),
    app(co, 'APP-110', 'CAN-105', 'JOB-102', 'withdrawn', 14),
  ]
  const interviews: Tenant<InterviewRecord>[] = [
    { companyId: co, id: 'INT-101', applicationId: 'APP-101', scheduledAt: at(-12), durationMinutes: 60, type: 'video', location: 'Teams', interviewerIds: ['u10', 'u14'], status: 'completed', createdAt: created(16), scorecards: [
      { interviewerId: 'u10', scores: card(C, [5, 4, 4, 5]), recommendation: 'strong_yes', notes: 'Strong on architecture.', submittedAt: created(12) },
      { interviewerId: 'u14', scores: card(C, [4, 4, 4, 4]), recommendation: 'yes', notes: 'Solid pairing session.', submittedAt: created(12) },
    ] },
    { companyId: co, id: 'INT-102', applicationId: 'APP-104', scheduledAt: at(-5), durationMinutes: 45, type: 'onsite', location: 'Dubai office, room 2', interviewerIds: ['u10', 'u11'], status: 'completed', createdAt: created(8), scorecards: [
      { interviewerId: 'u10', scores: card(C, [4, 5, 3, 4]), recommendation: 'yes', notes: 'Great depth; relocation needed.', submittedAt: created(5) },
    ] },
    { companyId: co, id: 'INT-103', applicationId: 'APP-102', scheduledAt: at(3, 7), durationMinutes: 60, type: 'video', location: 'Teams', interviewerIds: ['u10', 'u11'], status: 'scheduled', createdAt: created(2), scorecards: [] },
    { companyId: co, id: 'INT-104', applicationId: 'APP-107', scheduledAt: at(2, 9), durationMinutes: 45, type: 'phone', location: '', interviewerIds: ['u3', 'u9'], status: 'scheduled', createdAt: created(3), scorecards: [] },
    { companyId: co, id: 'INT-105', applicationId: 'APP-109', scheduledAt: at(-110), durationMinutes: 60, type: 'onsite', location: 'Dubai office', interviewerIds: ['u10'], status: 'completed', createdAt: created(112), scorecards: [
      { interviewerId: 'u10', scores: card(C, [5, 4, 5, 5]), recommendation: 'strong_yes', notes: 'Excellent portfolio.', submittedAt: created(110) },
    ] },
  ]
  const offers: Tenant<OfferRecord>[] = [
    { companyId: co, id: 'OFR-101', applicationId: 'APP-101', salary: 26500, currency: 'AED', startDate: day(30), expiryDate: day(7), status: 'sent', employeeId: null, createdAt: created(3), updatedAt: created(2) },
    { companyId: co, id: 'OFR-102', applicationId: 'APP-109', salary: 15500, currency: 'AED', startDate: hireDate, expiryDate: hireDate, status: 'accepted', employeeId: empIdForUser(hiredUser), createdAt: created(105), updatedAt: created(100) },
  ]
  return { openings, candidates, applications, interviews, offers }
}

function crestRecruitment(): Seed {
  const co = CREST_ID
  const hiredUser = 'u107'
  const hireDate = hireDateOf(hiredUser)
  const openings = [
    opening(co, { id: 'JOB-201', title: 'Warehouse Supervisor', departmentId: 'c2-ops', hiringManagerId: 'u106', status: 'open', headcount: 2, location: 'Riyadh, Second Industrial City', salaryMin: 9000, salaryMax: 12000, salaryCurrency: 'SAR', description: 'Run shifts at the Riyadh contract-warehousing site.', requirements: 'WMS experience; forklift certificate a plus.', requestedBy: 'u106', approvedBy: 'u102', approvedAt: created(20) }, 22),
    opening(co, { id: 'JOB-202', title: 'Fleet Dispatcher', departmentId: 'c2-ops', hiringManagerId: 'u106', status: 'on_hold', location: 'Dammam', salaryMin: 7000, salaryMax: 8500, salaryCurrency: 'SAR', description: 'Plan daily routes for the eastern fleet.', requirements: 'Dispatching software; night shifts.' }, 35),
    opening(co, { id: 'JOB-203', title: 'Operations Coordinator', departmentId: 'c2-ops', hiringManagerId: 'u106', status: 'filled', location: 'Riyadh', salaryMin: 8000, salaryMax: 10000, salaryCurrency: 'SAR', approvedBy: 'u102', approvedAt: created(95) }, 100),
    opening(co, { id: 'JOB-204', title: 'Key Account Manager, Retail', departmentId: 'c2-sales', hiringManagerId: 'u103', status: 'open', location: 'Jeddah', salaryMin: 14000, salaryMax: 18000, salaryCurrency: 'SAR', description: 'Grow retail distribution accounts.', requirements: '3PL sales experience in KSA.', requestedBy: 'u102' }, 9),
  ]
  const candidates = [
    cand(co, 'CAN-201', 'Abdulrahman Al Otaibi', 'abdulrahman.otaibi@mailbox.test', '+966 55 310 4471', 'Najd Storage Co', 'Shift Lead', 'referral', 19, { cv: cv('Abdulrahman-CV.pdf', 350, 19) }),
    cand(co, 'CAN-202', 'Mohammed Siraj', 'mohammed.siraj@mailbox.test', '+966 50 228 9103', 'Red Sea Freight', 'Warehouse Supervisor', 'job_board', 17),
    cand(co, 'CAN-203', 'Yasir Al Qarni', 'yasir.qarni@mailbox.test', '+966 54 771 2290', 'Al Waha Logistics', 'Inventory Controller', 'website', 13, { tags: ['wms'] }),
    cand(co, 'CAN-204', 'Ravi Kumar', 'ravi.kumar@mailbox.test', '+966 56 402 3318', 'Peninsula 3PL', 'Dispatcher', 'agency', 30),
    cand(co, 'CAN-205', 'Lama Al Harthi', 'lama.harthi@mailbox.test', '+966 53 118 6620', 'Tamimi Retail', 'Account Manager', 'linkedin', 8, { cv: cv('Lama-Harthi-CV.pdf', 300, 8) }),
    cand(co, 'CAN-206', userName(hiredUser), userEmail(hiredUser), userMobile(hiredUser), 'Saudi Post', 'Coordinator', 'referral', 100, { tags: ['hired'] }),
  ]
  const applications = [
    app(co, 'APP-201', 'CAN-201', 'JOB-201', 'assessment', 19),
    app(co, 'APP-202', 'CAN-202', 'JOB-201', 'interview', 17),
    app(co, 'APP-203', 'CAN-203', 'JOB-201', 'screening', 13),
    app(co, 'APP-204', 'CAN-204', 'JOB-202', 'applied', 30),
    app(co, 'APP-205', 'CAN-205', 'JOB-204', 'interview', 8),
    app(co, 'APP-206', 'CAN-206', 'JOB-203', 'hired', 100, { employeeId: empIdForUser(hiredUser), stageChangedAt: created(90) }),
    app(co, 'APP-207', 'CAN-203', 'JOB-204', 'rejected', 7, { rejectionReason: 'No retail account experience.' }),
  ]
  const interviews: Tenant<InterviewRecord>[] = [
    { companyId: co, id: 'INT-201', applicationId: 'APP-201', scheduledAt: at(-6, 8), durationMinutes: 45, type: 'onsite', location: 'Riyadh site office', interviewerIds: ['u106', 'u107'], status: 'completed', createdAt: created(9), scorecards: [
      { interviewerId: 'u106', scores: card(C, [4, 4, 5, 4]), recommendation: 'yes', notes: 'Knows shift planning well.', submittedAt: created(6) },
      { interviewerId: 'u107', scores: card(C, [3, 4, 4, 4]), recommendation: 'yes', notes: 'Good with the team.', submittedAt: created(6) },
    ] },
    { companyId: co, id: 'INT-202', applicationId: 'APP-202', scheduledAt: at(4, 8), durationMinutes: 45, type: 'phone', location: '', interviewerIds: ['u106'], status: 'scheduled', createdAt: created(1), scorecards: [] },
    { companyId: co, id: 'INT-203', applicationId: 'APP-205', scheduledAt: at(1, 10), durationMinutes: 60, type: 'video', location: 'Google Meet', interviewerIds: ['u103', 'u102'], status: 'scheduled', createdAt: created(2), scorecards: [] },
  ]
  const offers: Tenant<OfferRecord>[] = [
    { companyId: co, id: 'OFR-201', applicationId: 'APP-206', salary: 9000, currency: 'SAR', startDate: hireDate, expiryDate: hireDate, status: 'accepted', employeeId: empIdForUser(hiredUser), createdAt: created(95), updatedAt: created(90) },
  ]
  return { openings, candidates, applications, interviews, offers }
}

const A = apexRecruitment()
const B = crestRecruitment()

export const hrOpenings = registerArray<Tenant<OpeningRecord>>('hrOpenings', [...A.openings, ...B.openings])
export const hrCandidates = registerArray<Tenant<CandidateRecord>>('hrCandidates', [...A.candidates, ...B.candidates])
export const hrApplications = registerArray<Tenant<ApplicationRecord>>('hrApplications', [...A.applications, ...B.applications])
export const hrInterviews = registerArray<Tenant<InterviewRecord>>('hrInterviews', [...A.interviews, ...B.interviews])
export const hrOffers = registerArray<Tenant<OfferRecord>>('hrOffers', [...A.offers, ...B.offers])

/* ---------------- Training seed ---------------- */

function course(companyId: string, id: string, title: string, category: CourseCategory, provider: CourseProvider, providerName: string, durationHours: number, cost: number, currency: string, mandatory: boolean, validityMonths: number | null, description: string): Tenant<CourseRecord> {
  return { companyId, id, title, category, provider, providerName, durationHours, cost, currency, mandatory, validityMonths, description, active: true, createdAt: created(200), updatedAt: created(30) }
}

function session(companyId: string, id: string, courseId: string, start: number, days: number, location: string, trainer: string, capacity: number, extraCost: number, status: SessionStatus, onlineLink = ''): Tenant<SessionRecord> {
  return { companyId, id, courseId, startDate: day(start), endDate: day(start + days - 1), location, onlineLink, trainer, capacity, extraCost, status, createdAt: created(Math.max(1, -start + 20)) }
}

type TrainingSeed = { courses: Tenant<CourseRecord>[]; sessions: Tenant<SessionRecord>[]; enrollments: Tenant<EnrollmentRecord>[]; certificates: Tenant<CertificateRecord>[] }

/** Enrollments of a past session: completed (with certificates when the course issues them) unless listed otherwise. */
function training(companyId: string, prefix: string, courses: Tenant<CourseRecord>[], sessions: Tenant<SessionRecord>[], plan: { session: string; users: string[]; status?: EnrollmentStatus; issueDay?: number }[]): TrainingSeed {
  const enrollments: Tenant<EnrollmentRecord>[] = []
  const certificates: Tenant<CertificateRecord>[] = []
  let e = 0
  let c = 0
  for (const p of plan) {
    const s = sessions.find((x) => x.id === p.session)!
    const co = courses.find((x) => x.id === s.courseId)!
    for (const u of p.users) {
      const id = `ENR-${prefix}${++e}`
      const status = p.status ?? 'completed'
      enrollments.push({ companyId, id, sessionId: s.id, employeeId: empIdForUser(u), status, score: status === 'completed' ? 70 + ((e * 7) % 30) : null, feedbackRating: status === 'completed' ? 3 + (e % 3) : null, feedback: '', updatedAt: created(5) })
      if (status === 'completed' && co.validityMonths !== 0) {
        const issueDate = p.issueDay !== undefined ? day(p.issueDay) : s.endDate
        certificates.push({ companyId, id: `CRT-${prefix}${++c}`, number: `${prefix === 'A' ? 'APX' : 'CRS'}-${issueDate.slice(0, 4)}-${String(c).padStart(4, '0')}`, courseId: co.id, employeeId: empIdForUser(u), enrollmentId: id, issueDate, expiryDate: certificateExpiry(issueDate, co.validityMonths), fileUrl: '', expiryNotifiedAt: null, createdAt: created(5) })
      }
    }
  }
  return { courses, sessions, enrollments, certificates }
}

function apexTraining(): TrainingSeed {
  const co = APEX_ID
  const courses = [
    course(co, 'CRS-101', 'Fire safety & evacuation', 'safety', 'internal', 'Facilities team', 3, 150, 'AED', true, 12, 'Fire wardens, evacuation routes and extinguisher use. Required yearly for everyone.'),
    course(co, 'CRS-102', 'Data protection essentials', 'compliance', 'external', 'Gulf Compliance Academy', 2, 300, 'AED', true, 24, 'Handling personal data under UAE PDPL; incident reporting.'),
    course(co, 'CRS-103', 'React performance workshop', 'technical', 'external', 'Frontend Masters Live', 16, 2400, 'AED', false, null, 'Profiling, memoization and bundle budgets.'),
    course(co, 'CRS-104', 'Leading high-performing teams', 'leadership', 'external', 'INSEAD Executive Ed.', 12, 3500, 'AED', false, 0, 'For people managers.'),
  ]
  const sessions = [
    session(co, 'SES-101', 'CRS-101', -345, 1, 'Dubai office, training room', 'Facilities team', 20, 0, 'completed'),
    session(co, 'SES-102', 'CRS-101', -60, 1, 'Dubai office, training room', 'Facilities team', 20, 0, 'completed'),
    session(co, 'SES-103', 'CRS-102', -90, 1, 'Online', 'Gulf Compliance Academy', 30, 500, 'completed', 'https://meet.example.org/pdpl'),
    session(co, 'SES-104', 'CRS-102', 14, 1, 'Online', 'Gulf Compliance Academy', 30, 500, 'scheduled', 'https://meet.example.org/pdpl-2'),
    session(co, 'SES-105', 'CRS-103', -30, 2, 'Dubai Internet City', 'Frontend Masters Live', 8, 1200, 'completed'),
    session(co, 'SES-106', 'CRS-104', 21, 2, 'INSEAD Abu Dhabi', 'INSEAD faculty', 6, 0, 'scheduled'),
  ]
  return training(co, 'A', courses, sessions, [
    // Issued ~11 months ago: expires within the 30-day alert window.
    { session: 'SES-101', users: ['u14'], issueDay: -345 },
    { session: 'SES-102', users: ['u1', 'u2', 'u9', 'u10', 'u11', 'u15', 'u3'] },
    { session: 'SES-103', users: ['u1', 'u2', 'u8', 'u9', 'u11'] },
    { session: 'SES-104', users: ['u14', 'u15', 'u16'], status: 'enrolled' },
    { session: 'SES-104', users: ['u17'], status: 'invited' },
    { session: 'SES-105', users: ['u14', 'u16'] },
    { session: 'SES-105', users: ['u15'], status: 'no_show' },
    { session: 'SES-106', users: ['u10', 'u3'], status: 'enrolled' },
  ])
}

function crestTraining(): TrainingSeed {
  const co = CREST_ID
  const courses = [
    course(co, 'CRS-201', 'Forklift operation & warehouse safety', 'safety', 'external', 'Saudi Safety Institute', 8, 650, 'SAR', true, 12, 'Licensed forklift handling, racking safety, PPE.'),
    course(co, 'CRS-202', 'Saudi labour law & GOSI basics', 'compliance', 'internal', 'HR', 2, 0, 'SAR', true, 36, 'Working hours, overtime, end of service, GOSI.'),
    course(co, 'CRS-203', 'Excel for logistics planners', 'technical', 'external', 'Riyadh Skills Hub', 6, 450, 'SAR', false, null, 'Pivot tables and route planning sheets.'),
  ]
  const sessions = [
    session(co, 'SES-201', 'CRS-201', -350, 1, 'Riyadh site', 'Saudi Safety Institute', 12, 1500, 'completed'),
    session(co, 'SES-202', 'CRS-202', -40, 1, 'Riyadh HQ', 'Noura Al Qahtani', 25, 0, 'completed'),
    session(co, 'SES-203', 'CRS-201', 10, 1, 'Riyadh site', 'Saudi Safety Institute', 12, 1500, 'scheduled'),
    session(co, 'SES-204', 'CRS-203', -15, 1, 'Online', 'Riyadh Skills Hub', 15, 0, 'completed', 'https://meet.example.org/excel'),
  ]
  return training(co, 'B', courses, sessions, [
    { session: 'SES-201', users: ['u106', 'u107'], issueDay: -350 },
    { session: 'SES-202', users: ['u101', 'u102', 'u106', 'u107'] },
    { session: 'SES-203', users: ['u105'], status: 'enrolled' },
    { session: 'SES-204', users: ['u107', 'u104'] },
  ])
}

const TA = apexTraining()
const TB = crestTraining()

export const hrCourses = registerArray<Tenant<CourseRecord>>('hrCourses', [...TA.courses, ...TB.courses])
export const hrSessions = registerArray<Tenant<SessionRecord>>('hrSessions', [...TA.sessions, ...TB.sessions])
export const hrEnrollments = registerArray<Tenant<EnrollmentRecord>>('hrEnrollments', [...TA.enrollments, ...TB.enrollments])
export const hrCertificates = registerArray<Tenant<CertificateRecord>>('hrCertificates', [...TA.certificates, ...TB.certificates])

/** Bytes of recruitment files (candidate CVs) a company stores: counted against the plan's storageMb. */
export function talentStorageBytes(companyId: string): number {
  let bytes = 0
  for (const c of hrCandidates) if (c.companyId === companyId && c.cv) bytes += c.cv.sizeBytes
  return bytes
}
