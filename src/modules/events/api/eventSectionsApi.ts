import { http } from '@/shared/lib/axios'
import type {
  AssignBoothLeadsResult,
  AttendeeDirectory,
  AttendeeExportRow,
  BoothLeads,
  EventAnalytics,
  EventAnalyticsQuery,
} from '@/modules/events/sectionsTypes'
import {
  assignBoothLeadsInputMapper,
  assignBoothLeadsResultMapper,
  attendeeDirectoryMapper,
  attendeeExportMapper,
  boothLeadsMapper,
  eventAnalyticsMapper,
} from '@/shared/api/eventSectionMappers'

/** Cross-event sections (docs/API.md › Events › Attendees directory, Booth leads, Event analytics). */

export async function getAttendeeDirectory(): Promise<AttendeeDirectory> {
  return attendeeDirectoryMapper.fromApi((await http.get<unknown>('/events/attendees')).data)
}

export async function exportAttendeeDirectory(): Promise<AttendeeExportRow[]> {
  return attendeeExportMapper.fromApiList((await http.get<unknown>('/events/attendees/export')).data)
}

export async function getBoothLeads(): Promise<BoothLeads> {
  return boothLeadsMapper.fromApi((await http.get<unknown>('/events/booth-leads')).data)
}

export async function assignBoothLeads(captureIds: string[], ownerId: string): Promise<AssignBoothLeadsResult> {
  const res = await http.post<unknown>('/events/booth-leads/assign', assignBoothLeadsInputMapper.toApi({ captureIds, ownerId }))
  return assignBoothLeadsResultMapper.fromApi(res.data)
}

export async function getEventAnalytics(q: EventAnalyticsQuery): Promise<EventAnalytics> {
  const params: Record<string, string> = { preset: q.preset, compare: q.compare ? 'true' : 'false' }
  if (q.preset === 'custom') {
    params.from = q.from ?? ''
    params.to = q.to ?? ''
  }
  return eventAnalyticsMapper.fromApi((await http.get<unknown>('/events/analytics', { params })).data)
}
