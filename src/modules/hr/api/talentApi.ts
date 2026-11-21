import { http } from '@/shared/lib/axios'
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
import * as m from '@/shared/api/hrTalentMappers'

/** HR › Recruitment and Training (docs/API.md › HR › Recruitment, Training). */

const enc = encodeURIComponent
const R = '/hr/recruitment'
const T = '/hr/training'

/* ---- recruitment ---- */

export const getRecruitmentOptions = async (): Promise<RecruitmentOptions> => m.recruitmentOptionsMapper.fromApi((await http.get<unknown>(`${R}/options`)).data)
export const getOpenings = async (): Promise<Opening[]> => m.openingMapper.fromApiList((await http.get<unknown>(`${R}/openings`)).data)
export const getOpening = async (id: string): Promise<OpeningDetail> => m.openingDetailMapper.fromApi((await http.get<unknown>(`${R}/openings/${enc(id)}`)).data)
export async function saveOpening(input: Partial<OpeningInput>, id?: string): Promise<Opening> {
  const body = m.openingInputMapper.toApi(input as OpeningInput)
  const res = id ? await http.patch<unknown>(`${R}/openings/${enc(id)}`, body) : await http.post<unknown>(`${R}/openings`, body)
  return m.openingMapper.fromApi(res.data)
}
export const setOpeningStatus = async (id: string, input: OpeningStatusInput): Promise<Opening> =>
  m.openingMapper.fromApi((await http.post<unknown>(`${R}/openings/${enc(id)}/status`, m.openingStatusInputMapper.toApi(input))).data)

export const getCandidates = async (): Promise<Candidate[]> => m.candidateMapper.fromApiList((await http.get<unknown>(`${R}/candidates`)).data)
export const getCandidate = async (id: string): Promise<CandidateDetail> => m.candidateDetailMapper.fromApi((await http.get<unknown>(`${R}/candidates/${enc(id)}`)).data)
export async function saveCandidate(input: Partial<CandidateInput>, id?: string): Promise<Candidate> {
  const body = m.candidateInputMapper.toApi(input as CandidateInput)
  const res = id ? await http.patch<unknown>(`${R}/candidates/${enc(id)}`, body) : await http.post<unknown>(`${R}/candidates`, body)
  return m.candidateMapper.fromApi(res.data)
}
export async function checkDuplicates(email: string, mobile: string, exclude?: string): Promise<DuplicateCheck> {
  const params = new URLSearchParams()
  if (email) params.set('email', email)
  if (mobile) params.set('mobile', mobile)
  if (exclude) params.set('exclude', exclude)
  return m.duplicateCheckMapper.fromApi((await http.get<unknown>(`${R}/candidates/check?${params}`)).data)
}
export const attachCv = async (id: string, input: CvInput): Promise<Candidate> =>
  m.candidateMapper.fromApi((await http.post<unknown>(`${R}/candidates/${enc(id)}/cv`, m.cvInputMapper.toApi(input))).data)

export const createApplication = async (candidateId: string, openingId: string): Promise<Application> =>
  m.applicationMapper.fromApi((await http.post<unknown>(`${R}/applications`, m.applicationInputMapper.toApi({ candidateId, openingId }))).data)
export const moveApplication = async (id: string, input: StageInput): Promise<Application> =>
  m.applicationMapper.fromApi((await http.post<unknown>(`${R}/applications/${enc(id)}/stage`, m.stageInputMapper.toApi(input))).data)
export const scheduleInterview = async (applicationId: string, input: InterviewInput): Promise<Interview> =>
  m.interviewMapper.fromApi((await http.post<unknown>(`${R}/applications/${enc(applicationId)}/interviews`, m.interviewInputMapper.toApi(input))).data)
export const updateInterview = async (id: string, input: Partial<InterviewInput>): Promise<Interview> =>
  m.interviewMapper.fromApi((await http.patch<unknown>(`${R}/interviews/${enc(id)}`, m.interviewInputMapper.toApi(input as InterviewInput))).data)
export const submitScorecard = async (id: string, input: ScorecardInput): Promise<Interview> =>
  m.interviewMapper.fromApi((await http.put<unknown>(`${R}/interviews/${enc(id)}/scorecard`, m.scorecardInputMapper.toApi(input))).data)
export const getMyInterviews = async (): Promise<InterviewCard[]> => m.interviewCardMapper.fromApiList((await http.get<unknown>(`${R}/my-interviews`)).data)

export const createOffer = async (applicationId: string, input: OfferInput): Promise<Offer> =>
  m.offerMapper.fromApi((await http.post<unknown>(`${R}/applications/${enc(applicationId)}/offers`, m.offerInputMapper.toApi(input))).data)
export const updateOffer = async (id: string, input: Partial<OfferInput>): Promise<Offer> =>
  m.offerMapper.fromApi((await http.patch<unknown>(`${R}/offers/${enc(id)}`, m.offerInputMapper.toApi(input as OfferInput))).data)
export const setOfferStatus = async (id: string, input: OfferStatusInput): Promise<Offer> =>
  m.offerMapper.fromApi((await http.post<unknown>(`${R}/offers/${enc(id)}/status`, m.offerStatusInputMapper.toApi(input))).data)

/* ---- training ---- */

export const getTrainingOptions = async (): Promise<TrainingOptions> => m.trainingOptionsMapper.fromApi((await http.get<unknown>(`${T}/options`)).data)
export const getCourses = async (): Promise<Course[]> => m.courseMapper.fromApiList((await http.get<unknown>(`${T}/courses`)).data)
export const getCourse = async (id: string): Promise<CourseDetail> => m.courseDetailMapper.fromApi((await http.get<unknown>(`${T}/courses/${enc(id)}`)).data)
export async function saveCourse(input: Partial<CourseInput>, id?: string): Promise<Course> {
  const body = m.courseInputMapper.toApi(input as CourseInput)
  const res = id ? await http.patch<unknown>(`${T}/courses/${enc(id)}`, body) : await http.post<unknown>(`${T}/courses`, body)
  return m.courseMapper.fromApi(res.data)
}
export const createSession = async (courseId: string, input: SessionInput): Promise<TrainingSession> =>
  m.sessionMapper.fromApi((await http.post<unknown>(`${T}/courses/${enc(courseId)}/sessions`, m.sessionInputMapper.toApi(input))).data)
export const updateSession = async (id: string, input: Partial<SessionInput>): Promise<TrainingSession> =>
  m.sessionMapper.fromApi((await http.patch<unknown>(`${T}/sessions/${enc(id)}`, m.sessionInputMapper.toApi(input as SessionInput))).data)
export const enroll = async (sessionId: string, input: EnrollInput): Promise<Enrollment[]> =>
  m.enrollmentMapper.fromApiList((await http.post<unknown>(`${T}/sessions/${enc(sessionId)}/enrollments`, m.enrollInputMapper.toApi(input))).data)
export const updateEnrollment = async (id: string, input: EnrollmentInput): Promise<Enrollment> =>
  m.enrollmentMapper.fromApi((await http.patch<unknown>(`${T}/enrollments/${enc(id)}`, m.enrollmentInputMapper.toApi(input))).data)
export const getCertificates = async (): Promise<Certificate[]> => m.certificateMapper.fromApiList((await http.get<unknown>(`${T}/certificates`)).data)
export const updateCertificate = async (id: string, input: CertificateInput): Promise<Certificate> =>
  m.certificateMapper.fromApi((await http.patch<unknown>(`${T}/certificates/${enc(id)}`, m.certificateInputMapper.toApi(input))).data)
export const getMatrix = async (): Promise<TrainingMatrix> => m.trainingMatrixMapper.fromApi((await http.get<unknown>(`${T}/matrix`)).data)
export const getBudget = async (year: number): Promise<TrainingBudget> => m.trainingBudgetMapper.fromApi((await http.get<unknown>(`${T}/budget?year=${year}`)).data)
export const getMyTraining = async (): Promise<MyTraining> => m.myTrainingMapper.fromApi((await http.get<unknown>(`${T}/my`)).data)
