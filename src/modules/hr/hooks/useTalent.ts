import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/hr/api/talentApi'
import type { CandidateInput, CvInput, InterviewInput, OfferInput, OfferStatusInput, OpeningInput, OpeningStatusInput, ScorecardInput, StageInput } from '@/modules/hr/recruitmentTypes'
import type { CertificateInput, CourseInput, EnrollInput, EnrollmentInput, SessionInput } from '@/modules/hr/trainingTypes'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type { Scope } from '@/shared/types'

/**
 * HR recruitment and training queries. Keys live under ['hr', uid, 'talent', …]; every write refreshes
 * the whole ['hr'] tree (a hire changes Employees too).
 */
const key = (uid: string, ...rest: (string | number)[]) => ['hr', uid, 'talent', ...rest] as const

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

/** The caller's `hr` scope (full / team / own / hidden). */
export function useHrScope(): Scope {
  const user = useCurrentUser()
  return user ? scopeOf(user.role, 'hr') : 'hidden'
}

function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['hr'] })
}

function useWrite<A, R>(fn: (args: A) => Promise<R>) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: invalidate })
}

/* ---- recruitment ---- */

export const useRecruitmentOptions = () => useQuery({ queryKey: key(useUid(), 'options'), queryFn: api.getRecruitmentOptions, enabled: useOn(), retry: false })
export const useOpenings = (enabled = true) => useQuery({ queryKey: key(useUid(), 'openings'), queryFn: api.getOpenings, enabled: useOn(enabled), retry: false })
export const useOpening = (id: string | null) => useQuery({ queryKey: key(useUid(), 'opening', id ?? ''), queryFn: () => api.getOpening(id!), enabled: useOn(!!id), retry: false })
export const useCandidates = (enabled = true) => useQuery({ queryKey: key(useUid(), 'candidates'), queryFn: api.getCandidates, enabled: useOn(enabled), retry: false })
export const useCandidate = (id: string | null) => useQuery({ queryKey: key(useUid(), 'candidate', id ?? ''), queryFn: () => api.getCandidate(id!), enabled: useOn(!!id), retry: false })
export const useMyInterviews = () => useQuery({ queryKey: key(useUid(), 'my-interviews'), queryFn: api.getMyInterviews, enabled: useOn(), retry: false })

export const useSaveOpening = () => useWrite(({ id, input }: { id?: string; input: Partial<OpeningInput> }) => api.saveOpening(input, id))
export const useOpeningStatus = () => useWrite(({ id, input }: { id: string; input: OpeningStatusInput }) => api.setOpeningStatus(id, input))
export const useSaveCandidate = () => useWrite(({ id, input }: { id?: string; input: Partial<CandidateInput> }) => api.saveCandidate(input, id))
export const useAttachCv = () => useWrite(({ id, input }: { id: string; input: CvInput }) => api.attachCv(id, input))
export const useCreateApplication = () => useWrite(({ candidateId, openingId }: { candidateId: string; openingId: string }) => api.createApplication(candidateId, openingId))
export const useMoveApplication = () => useWrite(({ id, input }: { id: string; input: StageInput }) => api.moveApplication(id, input))
export const useScheduleInterview = () => useWrite(({ applicationId, input }: { applicationId: string; input: InterviewInput }) => api.scheduleInterview(applicationId, input))
export const useUpdateInterview = () => useWrite(({ id, input }: { id: string; input: Partial<InterviewInput> }) => api.updateInterview(id, input))
export const useSubmitScorecard = () => useWrite(({ id, input }: { id: string; input: ScorecardInput }) => api.submitScorecard(id, input))
export const useCreateOffer = () => useWrite(({ applicationId, input }: { applicationId: string; input: OfferInput }) => api.createOffer(applicationId, input))
export const useOfferStatus = () => useWrite(({ id, input }: { id: string; input: OfferStatusInput }) => api.setOfferStatus(id, input))

/* ---- training ---- */

export const useTrainingOptions = () => useQuery({ queryKey: key(useUid(), 'training-options'), queryFn: api.getTrainingOptions, enabled: useOn(), retry: false })
export const useCourses = () => useQuery({ queryKey: key(useUid(), 'courses'), queryFn: api.getCourses, enabled: useOn(), retry: false })
export const useCourse = (id: string | null) => useQuery({ queryKey: key(useUid(), 'course', id ?? ''), queryFn: () => api.getCourse(id!), enabled: useOn(!!id), retry: false })
export const useCertificates = (enabled = true) => useQuery({ queryKey: key(useUid(), 'certificates'), queryFn: api.getCertificates, enabled: useOn(enabled), retry: false })
export const useMatrix = (enabled = true) => useQuery({ queryKey: key(useUid(), 'matrix'), queryFn: api.getMatrix, enabled: useOn(enabled), retry: false })
export const useBudget = (year: number, enabled = true) => useQuery({ queryKey: key(useUid(), 'budget', year), queryFn: () => api.getBudget(year), enabled: useOn(enabled), retry: false })
export const useMyTraining = () => useQuery({ queryKey: key(useUid(), 'my-training'), queryFn: api.getMyTraining, enabled: useOn(), retry: false })

export const useSaveCourse = () => useWrite(({ id, input }: { id?: string; input: Partial<CourseInput> }) => api.saveCourse(input, id))
export const useCreateSession = () => useWrite(({ courseId, input }: { courseId: string; input: SessionInput }) => api.createSession(courseId, input))
export const useEnroll = () => useWrite(({ sessionId, input }: { sessionId: string; input: EnrollInput }) => api.enroll(sessionId, input))
export const useUpdateEnrollment = () => useWrite(({ id, input }: { id: string; input: EnrollmentInput }) => api.updateEnrollment(id, input))
export const useUpdateCertificate = () => useWrite(({ id, input }: { id: string; input: CertificateInput }) => api.updateCertificate(id, input))
