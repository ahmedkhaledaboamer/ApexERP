import { http } from '@/shared/lib/axios'
import type { JourneyDetail, JourneyItemInput, JourneyKind, JourneyOptions, JourneyRow, MyJourneyTask, StartJourneyInput, TemplateInput, TemplateView } from './types'
import {
  hrJourneyDetailMapper,
  hrJourneyItemInputMapper,
  hrJourneyOptionsMapper,
  hrJourneyPlainMapper,
  hrJourneyRowMapper,
  hrJourneyStartMapper,
  hrJourneyTemplateInputMapper,
  hrJourneyTemplateMapper,
  hrMyJourneyTaskMapper,
} from '@/shared/api/hrJourneyMappers'

/** HR › Onboarding & offboarding (docs/API.md › HR › Onboarding & offboarding). */

const enc = encodeURIComponent

export interface JourneyFilters {
  kind?: JourneyKind | null
  status?: string | null
  employeeId?: string | null
}

export async function getJourneys(f: JourneyFilters = {}): Promise<JourneyRow[]> {
  const params: Record<string, string> = {}
  if (f.kind) params.kind = f.kind
  if (f.status) params.status = f.status
  if (f.employeeId) params.employee_id = f.employeeId
  return hrJourneyRowMapper.fromApiList((await http.get<unknown>('/hr/journeys', { params })).data)
}
export async function getJourney(id: string): Promise<JourneyDetail> {
  return hrJourneyDetailMapper.fromApi((await http.get<unknown>(`/hr/journeys/${enc(id)}`)).data)
}
export async function startJourney(input: StartJourneyInput): Promise<JourneyDetail> {
  return hrJourneyDetailMapper.fromApi((await http.post<unknown>('/hr/journeys', hrJourneyStartMapper.toApi(input))).data)
}
export async function getMyJourneyTasks(): Promise<MyJourneyTask[]> {
  return hrMyJourneyTaskMapper.fromApiList((await http.get<unknown>('/hr/journeys/my-tasks')).data)
}
export async function getJourneyOptions(): Promise<JourneyOptions> {
  return hrJourneyOptionsMapper.fromApi((await http.get<unknown>('/hr/journeys/options')).data)
}
export async function addJourneyItem(id: string, input: JourneyItemInput): Promise<JourneyDetail> {
  return hrJourneyDetailMapper.fromApi((await http.post<unknown>(`/hr/journeys/${enc(id)}/items`, hrJourneyItemInputMapper.toApi(input))).data)
}
export async function updateJourneyItem(id: string, itemId: string, input: JourneyItemInput): Promise<JourneyDetail> {
  return hrJourneyDetailMapper.fromApi((await http.patch<unknown>(`/hr/journeys/${enc(id)}/items/${enc(itemId)}`, hrJourneyItemInputMapper.toApi(input))).data)
}
export async function deleteJourneyItem(id: string, itemId: string): Promise<JourneyDetail> {
  return hrJourneyDetailMapper.fromApi((await http.delete<unknown>(`/hr/journeys/${enc(id)}/items/${enc(itemId)}`)).data)
}
/** Answers the journey detail, or the caller's task when the journey is outside their HR scope (assignee inbox). */
export async function setJourneyItemDone(id: string, itemId: string, done: boolean, note?: string): Promise<void> {
  const path = `/hr/journeys/${enc(id)}/items/${enc(itemId)}/${done ? 'complete' : 'reopen'}`
  await http.post<unknown>(path, done && note !== undefined ? hrJourneyPlainMapper.toApi({ note }) : undefined)
}
export async function activateJourney(id: string): Promise<JourneyDetail> {
  return hrJourneyDetailMapper.fromApi((await http.post<unknown>(`/hr/journeys/${enc(id)}/activate`)).data)
}
export async function cancelJourney(id: string): Promise<JourneyDetail> {
  return hrJourneyDetailMapper.fromApi((await http.post<unknown>(`/hr/journeys/${enc(id)}/cancel`)).data)
}

/* ---- templates ---- */

export async function getJourneyTemplates(): Promise<TemplateView[]> {
  return hrJourneyTemplateMapper.fromApiList((await http.get<unknown>('/hr/journeys/templates')).data)
}
export async function saveJourneyTemplate(input: Partial<TemplateInput>, id?: string): Promise<TemplateView> {
  const body = hrJourneyTemplateInputMapper.toApi(input as TemplateInput)
  const res = id ? await http.patch<unknown>(`/hr/journeys/templates/${enc(id)}`, body) : await http.post<unknown>('/hr/journeys/templates', body)
  return hrJourneyTemplateMapper.fromApi(res.data)
}
export async function deleteJourneyTemplate(id: string): Promise<void> {
  await http.delete(`/hr/journeys/templates/${enc(id)}`)
}
