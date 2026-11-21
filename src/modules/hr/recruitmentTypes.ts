import type { EmploymentType } from '@/modules/hr/types'

/**
 * HR › Recruitment (docs/API.md › HR › Recruitment). Job openings (requisitions), candidates, their
 * applications to openings (the pipeline), interviews with per-interviewer scorecards, and offers.
 * Accepting an offer hires the candidate: an employee is created through the Employees section's
 * createEmployee (never a login). Field names are the UI's camelCase; the wire is snake_case.
 */

/* ---------------- Openings (job requisitions) ---------------- */

export type OpeningStatus = 'draft' | 'pending_approval' | 'open' | 'on_hold' | 'filled' | 'closed'
export const OPENING_STATUSES: OpeningStatus[] = ['draft', 'pending_approval', 'open', 'on_hold', 'filled', 'closed']
export const OPENING_STATUS_LABEL: Record<OpeningStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  closed: 'Closed',
}

export interface Opening {
  id: string
  title: string
  departmentId: string
  departmentName: string
  /** The hiring manager (a user id). */
  hiringManagerId: string
  hiringManagerName: string
  headcount: number
  /** Hired applications so far. */
  hiredCount: number
  /** headcount − hiredCount (never below 0). */
  remaining: number
  employmentType: EmploymentType
  location: string
  /**
   * Salary range: served to HR full roles and the opening's hiring manager only; null for everyone
   * else (with `salaryVisible: false`).
   */
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryVisible: boolean
  description: string
  requirements: string
  status: OpeningStatus
  /** Who asked for the opening (a department head's request needs HR approval). */
  requestedBy: string
  requestedByName: string
  approvedBy: string | null
  approvedAt: string | null
  /** Scorecard criteria interviewers rate 1–5 (defaults when empty). */
  criteria: string[]
  /** Active applications per stage, plus the totals. */
  stageCounts: Record<ApplicationStage, number>
  applicationCount: number
  createdAt: string
  updatedAt: string
}

export interface OpeningInput {
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
  criteria: string[]
  /** Create only: `draft` (default) or, for HR full, `open`; a department head may send `pending_approval`. */
  status?: OpeningStatus
}

export interface OpeningStatusInput {
  status: OpeningStatus
  note?: string
}

/* ---------------- Candidates ---------------- */

export type CandidateSource = 'referral' | 'linkedin' | 'job_board' | 'website' | 'agency' | 'other'
export const CANDIDATE_SOURCES: CandidateSource[] = ['referral', 'linkedin', 'job_board', 'website', 'agency', 'other']
export const CANDIDATE_SOURCE_LABEL: Record<CandidateSource, string> = {
  referral: 'Referral',
  linkedin: 'LinkedIn',
  job_board: 'Job board',
  website: 'Website',
  agency: 'Agency',
  other: 'Other',
}

/** CV attachment metadata (the file itself lives in storage; counted against the plan's storageMb). */
export interface CvFile {
  name: string
  sizeBytes: number
  mimeType: string
  uploadedAt: string
}

export interface Candidate {
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
  /** Applications the caller may see (HR full: all; department head: their openings). */
  applications: ApplicationSummary[]
  createdAt: string
  updatedAt: string
}

export interface CandidateInput {
  fullName: string
  email: string
  mobile: string
  currentCompany: string
  currentTitle: string
  source: CandidateSource
  notes: string
  tags: string[]
  /** Create only: apply to this opening right away. */
  openingId?: string | null
}

export interface CvInput {
  name: string
  sizeBytes: number
  mimeType: string
}

export interface DuplicateCheck {
  /** Candidates of the caller's company with the same email or mobile (empty when none). */
  matches: { id: string; fullName: string; email: string; mobile: string; matchedOn: ('email' | 'mobile')[] }[]
}

/* ---------------- Applications (pipeline) ---------------- */

export type ApplicationStage = 'applied' | 'screening' | 'interview' | 'assessment' | 'offer' | 'hired' | 'rejected' | 'withdrawn'
/** Active pipeline stages, in order (the Kanban columns). */
export const PIPELINE_STAGES: ApplicationStage[] = ['applied', 'screening', 'interview', 'assessment', 'offer']
export const CLOSED_STAGES: ApplicationStage[] = ['hired', 'rejected', 'withdrawn']
export const APPLICATION_STAGES: ApplicationStage[] = [...PIPELINE_STAGES, ...CLOSED_STAGES]
export const STAGE_LABEL: Record<ApplicationStage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  assessment: 'Assessment',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export interface ApplicationSummary {
  id: string
  openingId: string
  openingTitle: string
  stage: ApplicationStage
  overallScore: number | null
}

export interface Application {
  id: string
  candidateId: string
  candidateName: string
  candidateTitle: string
  candidateCompany: string
  candidateSource: CandidateSource
  openingId: string
  openingTitle: string
  stage: ApplicationStage
  rejectionReason: string | null
  /** Average of every submitted scorecard of this application (1–5, one decimal), null before any. */
  overallScore: number | null
  interviewCount: number
  /** Latest offer status, if any. */
  offerStatus: OfferStatus | null
  /** Set once hired: the employee created from this application. */
  employeeId: string | null
  stageChangedAt: string
  createdAt: string
}

export interface StageInput {
  stage: ApplicationStage
  /** Required when rejecting. */
  reason?: string
}

/* ---------------- Interviews & scorecards ---------------- */

export type InterviewType = 'phone' | 'video' | 'onsite'
export const INTERVIEW_TYPES: InterviewType[] = ['phone', 'video', 'onsite']
export const INTERVIEW_TYPE_LABEL: Record<InterviewType, string> = { phone: 'Phone', video: 'Video', onsite: 'On-site' }

export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled'
export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' }

export type Recommendation = 'strong_yes' | 'yes' | 'no' | 'strong_no'
export const RECOMMENDATIONS: Recommendation[] = ['strong_yes', 'yes', 'no', 'strong_no']
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = { strong_yes: 'Strong yes', yes: 'Yes', no: 'No', strong_no: 'Strong no' }

export interface CriterionScore {
  criterion: string
  /** 1–5. */
  score: number
}

export interface Scorecard {
  interviewerId: string
  interviewerName: string
  scores: CriterionScore[]
  recommendation: Recommendation
  notes: string
  /** Average of the criteria scores (one decimal). */
  average: number
  submittedAt: string
}

export interface Interview {
  id: string
  applicationId: string
  candidateId: string
  candidateName: string
  openingId: string
  openingTitle: string
  /** UTC instant; shown and entered in the company's timezone. */
  scheduledAt: string
  durationMinutes: number
  type: InterviewType
  location: string
  interviewerIds: string[]
  interviewerNames: string[]
  status: InterviewStatus
  /** HR full and the hiring manager see every scorecard; an interviewer sees their own only. */
  scorecards: Scorecard[]
  /** Average of the submitted scorecards' averages (null before any). */
  overallScore: number | null
  /** The criteria to rate (the opening's). */
  criteria: string[]
}

export interface InterviewInput {
  /** Company-local date and time (the server converts with the company timezone). */
  date: string
  time: string
  durationMinutes: number
  type: InterviewType
  location: string
  interviewerIds: string[]
  status?: InterviewStatus
}

export interface ScorecardInput {
  scores: CriterionScore[]
  recommendation: Recommendation
  notes: string
}

/** An interviewer's view of one interview (GET /hr/recruitment/my-interviews): the card, no contact data. */
export interface InterviewCard {
  id: string
  candidateName: string
  candidateTitle: string
  candidateCompany: string
  openingTitle: string
  scheduledAt: string
  durationMinutes: number
  type: InterviewType
  location: string
  status: InterviewStatus
  criteria: string[]
  myScorecard: Scorecard | null
}

/* ---------------- Offers ---------------- */

export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'declined'
export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' }

export interface Offer {
  id: string
  applicationId: string
  candidateName: string
  openingTitle: string
  salary: number
  currency: string
  startDate: string
  expiryDate: string
  status: OfferStatus
  /** Sent and past its expiry date (company calendar): can no longer be accepted. */
  expired: boolean
  employeeId: string | null
  createdAt: string
  updatedAt: string
}

export interface OfferInput {
  salary: number
  currency: string
  startDate: string
  expiryDate: string
}

export interface OfferStatusInput {
  status: Exclude<OfferStatus, 'draft'>
}

/** Opening detail: the opening, its applications (pipeline), interviews and offers the caller may see. */
export interface OpeningDetail extends Opening {
  applications: Application[]
  interviews: Interview[]
  offers: Offer[]
  /** What the caller may do on this opening. */
  can: { edit: boolean; approve: boolean; manageCandidates: boolean; moveStages: boolean; makeOffers: boolean }
}

export interface CandidateDetail extends Candidate {
  interviews: Interview[]
  offers: Offer[]
}

/** Pickers for the recruitment forms (caller's company only). */
export interface RecruitmentOptions {
  departments: { id: string; name: string }[]
  /** Users who can be hiring managers / interviewers (HR visible roles), with their employee id. */
  people: { id: string; name: string; role: string; departmentId: string | null }[]
  currency: string
  /** True for HR full roles (manage everything). */
  manage: boolean
  defaultCriteria: string[]
}

export const DEFAULT_CRITERIA = ['Skills', 'Experience', 'Communication', 'Culture fit']
