import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import * as m from '@/shared/api/hrPerformanceMappers'
import type {
  AcknowledgeInput,
  AssessmentInput,
  CalibrateInput,
  Cycle,
  CycleDetail,
  CycleInput,
  GoalInput,
  ManagerAssessmentInput,
  MyPerformance,
  PerformanceOptions,
  ReviewDetail,
  ReviewRow,
  ReviewTemplate,
  TemplateInput,
} from './types'

/** HR › Performance client (docs/API.md › HR › Performance). Keys under ['hr', uid, 'performance', …]. */

const P = '/hr/performance'
const enc = encodeURIComponent

export const getOptions = async (): Promise<PerformanceOptions> => m.perfOptionsMapper.fromApi((await http.get<unknown>(`${P}/options`)).data)
export const getMyPerformance = async (): Promise<MyPerformance> => m.perfMyMapper.fromApi((await http.get<unknown>(`${P}/my`)).data)
export const getTemplates = async (): Promise<ReviewTemplate[]> => m.perfTemplateMapper.fromApiList((await http.get<unknown>(`${P}/templates`)).data)
export async function saveTemplate(input: Partial<TemplateInput>, id?: string): Promise<ReviewTemplate> {
  const body = m.perfTemplateInputMapper.toApi(input)
  const res = id ? await http.patch<unknown>(`${P}/templates/${enc(id)}`, body) : await http.post<unknown>(`${P}/templates`, body)
  return m.perfTemplateMapper.fromApi(res.data)
}
export const getCycles = async (): Promise<Cycle[]> => m.perfCycleMapper.fromApiList((await http.get<unknown>(`${P}/cycles`)).data)
export const getCycle = async (id: string): Promise<CycleDetail> => m.perfCycleDetailMapper.fromApi((await http.get<unknown>(`${P}/cycles/${enc(id)}`)).data)
export async function saveCycle(input: Partial<CycleInput>, id?: string): Promise<CycleDetail> {
  const body = m.perfCycleInputMapper.toApi(input)
  const res = id ? await http.patch<unknown>(`${P}/cycles/${enc(id)}`, body) : await http.post<unknown>(`${P}/cycles`, body)
  return m.perfCycleDetailMapper.fromApi(res.data)
}
export const cycleAction = async (id: string, action: 'launch' | 'advance' | 'close'): Promise<CycleDetail> =>
  m.perfCycleDetailMapper.fromApi((await http.post<unknown>(`${P}/cycles/${enc(id)}/${action}`)).data)
export const remindCycle = async (id: string): Promise<{ sent: number }> => m.perfRemindMapper.fromApi((await http.post<unknown>(`${P}/cycles/${enc(id)}/remind`)).data)
export const getReviews = async (cycleId?: string): Promise<ReviewRow[]> =>
  m.perfReviewRowMapper.fromApiList((await http.get<unknown>(`${P}/reviews`, { params: cycleId ? { cycle_id: cycleId } : {} })).data)
export const getReview = async (id: string): Promise<ReviewDetail> => m.perfReviewMapper.fromApi((await http.get<unknown>(`${P}/reviews/${enc(id)}`)).data)
const review = async (p: Promise<{ data: unknown }>) => m.perfReviewMapper.fromApi((await p).data)
export const saveSelf = (id: string, input: Partial<AssessmentInput>) => review(http.put(`${P}/reviews/${enc(id)}/self`, m.perfAssessmentInputMapper.toApi(input)))
export const saveManager = (id: string, input: Partial<ManagerAssessmentInput>) => review(http.put(`${P}/reviews/${enc(id)}/manager`, m.perfManagerInputMapper.toApi(input)))
export const calibrate = (id: string, input: CalibrateInput) => review(http.post(`${P}/reviews/${enc(id)}/calibrate`, m.perfCalibrateInputMapper.toApi(input)))
export const share = (id: string) => review(http.post(`${P}/reviews/${enc(id)}/share`))
export const acknowledge = (id: string, input: AcknowledgeInput) => review(http.post(`${P}/reviews/${enc(id)}/acknowledge`, m.perfAckInputMapper.toApi(input)))
export const addGoal = (reviewId: string, input: Partial<GoalInput>) => review(http.post(`${P}/reviews/${enc(reviewId)}/goals`, m.perfGoalInputMapper.toApi(input)))
export const updateGoal = (id: string, input: Partial<GoalInput>) => review(http.patch(`${P}/goals/${enc(id)}`, m.perfGoalInputMapper.toApi(input)))
export const deleteGoal = (id: string) => review(http.delete(`${P}/goals/${enc(id)}`))
export const approveGoals = (reviewId: string) => review(http.post(`${P}/reviews/${enc(reviewId)}/goals/approve`))

/* ---------------- hooks ---------------- */

const useUid = () => useCurrentUser()?.id ?? 'anonymous'
const key = (uid: string, ...rest: (string | number)[]) => ['hr', uid, 'performance', ...rest] as const
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}

export const usePerfOptions = () => {
  const uid = useUid()
  return useQuery({ queryKey: key(uid, 'options'), queryFn: getOptions, enabled: useOn() })
}
export const useMyPerformance = () => {
  const uid = useUid()
  return useQuery({ queryKey: key(uid, 'my'), queryFn: getMyPerformance, enabled: useOn() })
}
export const useTemplates = (enabled = true) => {
  const uid = useUid()
  return useQuery({ queryKey: key(uid, 'templates'), queryFn: getTemplates, enabled: useOn(enabled) })
}
export const useCycles = (enabled = true) => {
  const uid = useUid()
  return useQuery({ queryKey: key(uid, 'cycles'), queryFn: getCycles, enabled: useOn(enabled) })
}
export const useCycle = (id: string | null) => {
  const uid = useUid()
  return useQuery({ queryKey: key(uid, 'cycle', id ?? ''), queryFn: () => getCycle(id!), enabled: useOn(!!id) })
}
export const useReviews = (enabled = true) => {
  const uid = useUid()
  return useQuery({ queryKey: key(uid, 'reviews'), queryFn: () => getReviews(), enabled: useOn(enabled) })
}
export const useReview = (id: string | null) => {
  const uid = useUid()
  return useQuery({ queryKey: key(uid, 'review', id ?? ''), queryFn: () => getReview(id!), enabled: useOn(!!id) })
}

/** Any write refreshes the whole performance tree (and the bell). */
export function usePerfWrite<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
