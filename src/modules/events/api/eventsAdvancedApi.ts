import { http } from '@/shared/lib/axios'
import { globalStorage } from '@/shared/lib/storage'
import type { ApplyTemplateResult, EventAgenda, EventChecklist, EventSession, EventSpeaker, EventTemplate, EventTemplateInput, SessionInput, SpeakerInput, TicketType, TicketTypeInput, CancelRegistrationResult, CheckInResult, CheckInSummary, PublicTicket, EventEmailLog, InviteInput, CaptureInput, CaptureResult, EventCapture, LeaderboardRow, FollowUpInput, FollowUpResult, PublicSurvey, SurveyInput, SurveyResults, BudgetLineInput, EventBudget } from '@/modules/events/types'
import type { BulkEmailDetail } from '@/modules/marketing/types'
import { bulkEmailMapper } from '@/shared/api/marketingMappers'
import { agendaMapper, applyTemplateMapper, checklistMapper, eventDeepMapper, eventTemplateInputMapper, eventTemplateMapper, sessionMapper, speakerMapper, ticketTypeMapper, cancelRegistrationMapper, checkInResultMapper, checkInSummaryMapper, publicTicketMapper, eventEmailLogMapper, captureMapper, captureResultMapper, leaderboardMapper, followUpResultMapper, publicSurveyMapper, surveyResultsMapper, budgetMapper } from '@/shared/api/eventMappers'

/** Advanced Events API (templates, agenda, tickets, check-in, captures, follow-up, survey, budget). */

const enc = encodeURIComponent

/* ---------------- Templates + checklist ---------------- */

export async function getTemplates(): Promise<EventTemplate[]> {
  return eventTemplateMapper.fromApiList((await http.get<unknown>('/event-templates')).data)
}

export async function createTemplate(input: EventTemplateInput): Promise<EventTemplate> {
  return eventTemplateMapper.fromApi((await http.post<unknown>('/event-templates', eventTemplateInputMapper.toApi(input))).data)
}

export async function updateTemplate(id: string, input: Partial<EventTemplateInput>): Promise<EventTemplate> {
  return eventTemplateMapper.fromApi((await http.patch<unknown>(`/event-templates/${enc(id)}`, eventTemplateInputMapper.toApi(input))).data)
}

export async function deleteTemplate(id: string): Promise<void> {
  await http.delete(`/event-templates/${enc(id)}`)
}

export async function getChecklist(id: string): Promise<EventChecklist> {
  return checklistMapper.fromApi((await http.get<unknown>(`/events/${enc(id)}/checklist`)).data)
}

export async function applyTemplate(id: string, templateId: string): Promise<ApplyTemplateResult> {
  return applyTemplateMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/apply-template`, { template_id: templateId })).data)
}

/* ---------------- Agenda & speakers ---------------- */

export async function getAgenda(id: string): Promise<EventAgenda> {
  return agendaMapper.fromApi((await http.get<unknown>(`/events/${enc(id)}/agenda`)).data)
}

export async function saveSession(id: string, input: Partial<SessionInput>, sessionId?: string): Promise<EventSession> {
  const body = eventDeepMapper.toApi(input as never)
  const res = sessionId ? await http.patch<unknown>(`/events/${enc(id)}/sessions/${enc(sessionId)}`, body) : await http.post<unknown>(`/events/${enc(id)}/sessions`, body)
  return sessionMapper.fromApi(res.data)
}

export async function removeSession(id: string, sessionId: string): Promise<void> {
  await http.delete(`/events/${enc(id)}/sessions/${enc(sessionId)}`)
}

export async function saveSpeaker(id: string, input: Partial<SpeakerInput>, speakerId?: string): Promise<EventSpeaker> {
  const body = eventDeepMapper.toApi(input as never)
  const res = speakerId ? await http.patch<unknown>(`/events/${enc(id)}/speakers/${enc(speakerId)}`, body) : await http.post<unknown>(`/events/${enc(id)}/speakers`, body)
  return speakerMapper.fromApi(res.data)
}

export async function removeSpeaker(id: string, speakerId: string): Promise<void> {
  await http.delete(`/events/${enc(id)}/speakers/${enc(speakerId)}`)
}
/* ---------------- Tickets & waitlist ---------------- */

export async function getTicketTypes(id: string): Promise<TicketType[]> {
  return ticketTypeMapper.fromApiList((await http.get<unknown>(`/events/${enc(id)}/ticket-types`)).data)
}

export async function saveTicketType(id: string, input: Partial<TicketTypeInput>, ticketTypeId?: string): Promise<TicketType> {
  const body = eventDeepMapper.toApi(input as never)
  const res = ticketTypeId ? await http.patch<unknown>(`/events/${enc(id)}/ticket-types/${enc(ticketTypeId)}`, body) : await http.post<unknown>(`/events/${enc(id)}/ticket-types`, body)
  return ticketTypeMapper.fromApi(res.data)
}

export async function deleteTicketType(id: string, ticketTypeId: string): Promise<void> {
  await http.delete(`/events/${enc(id)}/ticket-types/${enc(ticketTypeId)}`)
}

export async function cancelRegistration(id: string, attendeeId: string): Promise<CancelRegistrationResult> {
  return cancelRegistrationMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/attendees/${enc(attendeeId)}/cancel`)).data)
}
/* ---------------- Check-in & public ticket ---------------- */

export async function getCheckInSummary(id: string): Promise<CheckInSummary> {
  return checkInSummaryMapper.fromApi((await http.get<unknown>(`/events/${enc(id)}/check-in`)).data)
}

export async function checkInByCode(id: string, code: string, undo = false): Promise<CheckInResult> {
  return checkInResultMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/check-in`, { code, undo })).data)
}

/** The browser's random client id (shared with registration), for the public endpoints' rate limits. */
export function publicClientId(): string {
  let id = globalStorage.get('client-id')
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    globalStorage.set('client-id', id)
  }
  return id
}

export async function getPublicTicket(code: string): Promise<PublicTicket> {
  return publicTicketMapper.fromApi((await http.get<unknown>(`/public/tickets/${enc(code)}`, { headers: { 'X-Client-Id': publicClientId() } })).data)
}
/* ---------------- Invitations & email log ---------------- */

export async function inviteAudience(id: string, input: InviteInput): Promise<BulkEmailDetail> {
  return bulkEmailMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/invite`, eventDeepMapper.toApi(input as never))).data)
}

export async function getEventEmails(id: string): Promise<EventEmailLog[]> {
  return eventEmailLogMapper.fromApiList((await http.get<unknown>(`/events/${enc(id)}/emails`)).data)
}
/* ---------------- Booth capture + leaderboard ---------------- */

export async function getCaptures(id: string): Promise<EventCapture[]> {
  return captureMapper.fromApiList((await http.get<unknown>(`/events/${enc(id)}/captures`)).data)
}

export async function createCapture(id: string, input: CaptureInput): Promise<CaptureResult> {
  return captureResultMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/captures`, eventDeepMapper.toApi(input as never))).data)
}

export async function getLeaderboard(id: string): Promise<LeaderboardRow[]> {
  return leaderboardMapper.fromApiList((await http.get<unknown>(`/events/${enc(id)}/leaderboard`)).data)
}
/* ---------------- After the event ---------------- */

export async function sendFollowUp(id: string, input: FollowUpInput): Promise<FollowUpResult> {
  return followUpResultMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/follow-up`, eventDeepMapper.toApi(input as never))).data)
}
/* ---------------- Feedback survey ---------------- */

export async function getSurveyResults(id: string): Promise<SurveyResults> {
  return surveyResultsMapper.fromApi((await http.get<unknown>(`/events/${enc(id)}/survey`)).data)
}

export async function getPublicSurvey(token: string): Promise<PublicSurvey> {
  return publicSurveyMapper.fromApi((await http.get<unknown>(`/public/surveys/${enc(token)}`, { headers: { 'X-Client-Id': publicClientId() } })).data)
}

export async function submitSurvey(token: string, input: SurveyInput): Promise<{ submitted: true; message: string }> {
  return (await http.post<{ submitted: true; message: string }>(`/public/surveys/${enc(token)}`, input, { headers: { 'X-Client-Id': publicClientId() } })).data
}
/* ---------------- Budget & campaign ---------------- */

export async function getBudget(id: string): Promise<EventBudget> {
  return budgetMapper.fromApi((await http.get<unknown>(`/events/${enc(id)}/budget`)).data)
}

export async function saveBudgetLine(id: string, input: Partial<BudgetLineInput>, lineId?: string): Promise<EventBudget> {
  const body = eventDeepMapper.toApi(input as never)
  const res = lineId ? await http.patch<unknown>(`/events/${enc(id)}/budget-lines/${enc(lineId)}`, body) : await http.post<unknown>(`/events/${enc(id)}/budget-lines`, body)
  return budgetMapper.fromApi(res.data)
}

export async function removeBudgetLine(id: string, lineId: string): Promise<EventBudget> {
  return budgetMapper.fromApi((await http.delete<unknown>(`/events/${enc(id)}/budget-lines/${enc(lineId)}`)).data)
}

export async function linkCampaign(id: string, campaignId: string | null): Promise<EventBudget> {
  return budgetMapper.fromApi((await http.put<unknown>(`/events/${enc(id)}/campaign`, { campaign_id: campaignId })).data)
}