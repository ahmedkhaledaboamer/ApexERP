import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import * as m from '@/shared/api/hrEngagementMappers'
import type {
  AnswerInput,
  EngagementOptions,
  EngagementOverview,
  EngagementSettings,
  FeedbackOptions,
  FeedbackRound,
  FeedbackSummary,
  Invitation,
  InvitationInput,
  MyFeedback,
  MySurveyForm,
  MySurveys,
  ProviderInput,
  ReviewFeedback,
  RoundInput,
  Survey,
  SurveyExport,
  SurveyInput,
  SurveyResults,
  TenureBand,
} from './types'

/** HR › Engagement surveys and 360° feedback client (docs/API.md). Keys under ['hr', uid, 'engagement' | 'feedback', …]. */

const E = '/hr/engagement'
const F = '/hr/feedback'
const enc = encodeURIComponent

export type SurveySave = Partial<SurveyInput> & { subjectEmployeeId?: string | null }

export const engagementApi = {
  options: async (): Promise<EngagementOptions> => m.engOptionsMapper.fromApi((await http.get<unknown>(`${E}/options`)).data),
  saveSettings: async (input: Partial<EngagementSettings>): Promise<EngagementSettings> =>
    m.engSettingsMapper.fromApi((await http.patch<unknown>(`${E}/settings`, m.engSettingsInputMapper.toApi(input))).data),
  overview: async (): Promise<EngagementOverview> => m.engOverviewMapper.fromApi((await http.get<unknown>(`${E}/overview`)).data),
  surveys: async (): Promise<Survey[]> => m.surveyMapper.fromApiList((await http.get<unknown>(`${E}/surveys`)).data),
  saveSurvey: async (input: SurveySave, id?: string): Promise<Survey> => {
    const body = m.surveyInputMapper.toApi(input)
    const res = id ? await http.patch<unknown>(`${E}/surveys/${enc(id)}`, body) : await http.post<unknown>(`${E}/surveys`, body)
    return m.surveyMapper.fromApi(res.data)
  },
  action: async (id: string, action: 'launch' | 'close'): Promise<Survey> => m.surveyMapper.fromApi((await http.post<unknown>(`${E}/surveys/${enc(id)}/${action}`)).data),
  results: async (id: string, q: { departmentId?: string; tenureBand?: TenureBand } = {}): Promise<SurveyResults> => {
    const params = { ...(q.departmentId ? { department_id: q.departmentId } : {}), ...(q.tenureBand ? { tenure_band: q.tenureBand } : {}) }
    return m.surveyResultsMapper.fromApi((await http.get<unknown>(`${E}/surveys/${enc(id)}/results`, { params })).data)
  },
  exportRows: async (id: string): Promise<SurveyExport> => m.surveyExportMapper.fromApi((await http.get<unknown>(`${E}/surveys/${enc(id)}/export`)).data),
  my: async (): Promise<MySurveys> => m.mySurveysMapper.fromApi((await http.get<unknown>(`${E}/my`)).data),
  mySurvey: async (id: string): Promise<MySurveyForm> => m.mySurveyFormMapper.fromApi((await http.get<unknown>(`${E}/my/${enc(id)}`)).data),
  answer: async (id: string, input: AnswerInput): Promise<MySurveyForm> => m.mySurveyFormMapper.fromApi((await http.put<unknown>(`${E}/my/${enc(id)}`, m.answerInputMapper.toApi(input))).data),
}

export const feedbackApi = {
  options: async (): Promise<FeedbackOptions> => m.fbOptionsMapper.fromApi((await http.get<unknown>(`${F}/options`)).data),
  my: async (): Promise<MyFeedback> => m.myFeedbackMapper.fromApi((await http.get<unknown>(`${F}/my`)).data),
  rounds: async (): Promise<FeedbackRound[]> => m.roundMapper.fromApiList((await http.get<unknown>(`${F}/rounds`)).data),
  round: async (id: string): Promise<FeedbackRound> => m.roundMapper.fromApi((await http.get<unknown>(`${F}/rounds/${enc(id)}`)).data),
  createRound: async (input: Partial<RoundInput>): Promise<FeedbackRound> => m.roundMapper.fromApi((await http.post<unknown>(`${F}/rounds`, m.roundInputMapper.toApi(input as RoundInput))).data),
  addProviders: async (id: string, providers: ProviderInput[]): Promise<FeedbackRound> =>
    m.roundMapper.fromApi((await http.post<unknown>(`${F}/rounds/${enc(id)}/providers`, m.providersInputMapper.toApi({ providers }))).data),
  nominate: async (id: string, employeeIds: string[]): Promise<FeedbackRound> =>
    m.roundMapper.fromApi((await http.post<unknown>(`${F}/rounds/${enc(id)}/nominations`, m.nominateInputMapper.toApi({ employeeIds }))).data),
  decide: async (id: string, approveIds: string[], rejectIds: string[]): Promise<FeedbackRound> =>
    m.roundMapper.fromApi((await http.post<unknown>(`${F}/rounds/${enc(id)}/nominations/decide`, m.decideInputMapper.toApi({ approveIds, rejectIds }))).data),
  close: async (id: string): Promise<FeedbackRound> => m.roundMapper.fromApi((await http.post<unknown>(`${F}/rounds/${enc(id)}/close`)).data),
  summary: async (id: string): Promise<FeedbackSummary> => m.summaryMapper.fromApi((await http.get<unknown>(`${F}/rounds/${enc(id)}/summary`)).data),
  forReview: async (reviewId: string): Promise<ReviewFeedback> => m.reviewFeedbackMapper.fromApi((await http.get<unknown>(`${F}/reviews/${enc(reviewId)}`)).data),
  invitation: async (id: string): Promise<Invitation> => m.invitationMapper.fromApi((await http.get<unknown>(`${F}/invitations/${enc(id)}`)).data),
  answer: async (id: string, input: InvitationInput): Promise<Invitation> => m.invitationMapper.fromApi((await http.put<unknown>(`${F}/invitations/${enc(id)}`, m.invitationInputMapper.toApi(input))).data),
  decline: async (id: string, reason: string): Promise<Invitation> => m.invitationMapper.fromApi((await http.post<unknown>(`${F}/invitations/${enc(id)}/decline`, m.declineInputMapper.toApi({ reason }))).data),
}

/* ---------------- hooks ---------------- */

const useUid = () => useCurrentUser()?.id ?? 'anonymous'
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}
const ek = (uid: string, ...rest: (string | number)[]) => ['hr', uid, 'engagement', ...rest] as const
const fk = (uid: string, ...rest: (string | number)[]) => ['hr', uid, 'feedback', ...rest] as const

export const useEngOptions = () => {
  const uid = useUid()
  return useQuery({ queryKey: ek(uid, 'options'), queryFn: engagementApi.options, enabled: useOn(), retry: false })
}
export const useEngOverview = (enabled = true) => {
  const uid = useUid()
  return useQuery({ queryKey: ek(uid, 'overview'), queryFn: engagementApi.overview, enabled: useOn(enabled), retry: false })
}
export const useSurveys = (enabled = true) => {
  const uid = useUid()
  return useQuery({ queryKey: ek(uid, 'surveys'), queryFn: engagementApi.surveys, enabled: useOn(enabled), retry: false })
}
export const useSurveyResults = (id: string | null, q: { departmentId?: string; tenureBand?: TenureBand }) => {
  const uid = useUid()
  return useQuery({ queryKey: ek(uid, 'results', id ?? '', q.departmentId ?? '', q.tenureBand ?? ''), queryFn: () => engagementApi.results(id!, q), enabled: useOn(!!id), retry: false })
}
export const useMySurveys = () => {
  const uid = useUid()
  return useQuery({ queryKey: ek(uid, 'my'), queryFn: engagementApi.my, enabled: useOn() })
}
export const useMySurvey = (id: string | null) => {
  const uid = useUid()
  return useQuery({ queryKey: ek(uid, 'my', id ?? ''), queryFn: () => engagementApi.mySurvey(id!), enabled: useOn(!!id), retry: false })
}
export const useFeedbackOptions = (enabled = true) => {
  const uid = useUid()
  return useQuery({ queryKey: fk(uid, 'options'), queryFn: feedbackApi.options, enabled: useOn(enabled) })
}
export const useMyFeedback = () => {
  const uid = useUid()
  return useQuery({ queryKey: fk(uid, 'my'), queryFn: feedbackApi.my, enabled: useOn() })
}
export const useRounds = (enabled = true) => {
  const uid = useUid()
  return useQuery({ queryKey: fk(uid, 'rounds'), queryFn: feedbackApi.rounds, enabled: useOn(enabled) })
}
export const useRound = (id: string | null) => {
  const uid = useUid()
  return useQuery({ queryKey: fk(uid, 'round', id ?? ''), queryFn: () => feedbackApi.round(id!), enabled: useOn(!!id), retry: false })
}
export const useRoundSummary = (id: string | null) => {
  const uid = useUid()
  return useQuery({ queryKey: fk(uid, 'summary', id ?? ''), queryFn: () => feedbackApi.summary(id!), enabled: useOn(!!id), retry: false })
}
export const useReviewFeedback = (reviewId: string | null) => {
  const uid = useUid()
  return useQuery({ queryKey: fk(uid, 'review', reviewId ?? ''), queryFn: () => feedbackApi.forReview(reviewId!), enabled: useOn(!!reviewId), retry: false })
}
export const useInvitation = (id: string | null) => {
  const uid = useUid()
  return useQuery({ queryKey: fk(uid, 'invitation', id ?? ''), queryFn: () => feedbackApi.invitation(id!), enabled: useOn(!!id), retry: false })
}

/** Any write refreshes the HR tree (and the bell). */
export function useEngWrite<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
