import { defineMapper } from './mapping'
import type {
  Application,
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
  OpeningStatusInput,
  RecruitmentOptions,
  ScorecardInput,
  StageInput,
} from '@/modules/hr/recruitmentTypes'
import type {
  Certificate,
  CertificateInput,
  Course,
  CourseDetail,
  CourseInput,
  EnrollInput,
  Enrollment,
  EnrollmentInput,
  MyTraining,
  SessionInput,
  TrainingBudget,
  TrainingMatrix,
  TrainingOptions,
  TrainingSession,
} from '@/modules/hr/trainingTypes'

/**
 * Wire names of HR recruitment and training (docs/API.md › HR › Recruitment, Training): plain
 * snake_case at any depth (hiring_manager_id, salary_min, stage_counts, interviewer_ids,
 * duration_minutes, validity_months, expiry_date, compliance_pct…). The training matrix's `cells` are
 * keyed by course id and stay untouched.
 */
const deep = <T>(opaque: string[] = []) => defineMapper<T>({ deep: true, opaque })

export const openingMapper = deep<Opening>()
export const openingDetailMapper = deep<OpeningDetail>()
export const openingInputMapper = deep<OpeningInput>()
export const openingStatusInputMapper = deep<OpeningStatusInput>()
export const candidateMapper = deep<Candidate>()
export const candidateDetailMapper = deep<CandidateDetail>()
export const candidateInputMapper = deep<CandidateInput>()
export const cvInputMapper = deep<CvInput>()
export const duplicateCheckMapper = deep<DuplicateCheck>()
export const applicationMapper = deep<Application>()
export const stageInputMapper = deep<StageInput>()
export const interviewMapper = deep<Interview>()
export const interviewInputMapper = deep<InterviewInput>()
export const interviewCardMapper = deep<InterviewCard>()
export const scorecardInputMapper = deep<ScorecardInput>()
export const offerMapper = deep<Offer>()
export const offerInputMapper = deep<OfferInput>()
export const offerStatusInputMapper = deep<OfferStatusInput>()
export const recruitmentOptionsMapper = deep<RecruitmentOptions>()
export const applicationInputMapper = deep<{ candidateId: string; openingId: string }>()

export const courseMapper = deep<Course>()
export const courseDetailMapper = deep<CourseDetail>()
export const courseInputMapper = deep<CourseInput>()
export const sessionMapper = deep<TrainingSession>()
export const sessionInputMapper = deep<SessionInput>()
export const enrollInputMapper = deep<EnrollInput>()
export const enrollmentMapper = deep<Enrollment>()
export const enrollmentInputMapper = deep<EnrollmentInput>()
export const certificateMapper = deep<Certificate>()
export const certificateInputMapper = deep<CertificateInput>()
export const trainingMatrixMapper = deep<TrainingMatrix>(['cells'])
export const trainingBudgetMapper = deep<TrainingBudget>()
export const myTrainingMapper = deep<MyTraining>()
export const trainingOptionsMapper = deep<TrainingOptions>()
