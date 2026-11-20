import { http, type HttpHandler } from 'msw'
import type { BudgetLineInput, CaptureInput, EventTemplateInput, FollowUpInput, SurveyInput, InviteInput, SessionInput, SpeakerInput, TicketTypeInput } from '@/modules/events/types'
import * as tpl from '@/shared/mocks/services/eventTemplates'
import * as agenda from '@/shared/mocks/services/eventAgenda'
import * as tickets from '@/shared/mocks/services/eventTickets'
import * as checkin from '@/shared/mocks/services/eventCheckIn'
import * as comms from '@/shared/mocks/services/eventComms'
import * as capture from '@/shared/mocks/services/eventCapture'
import * as followUp from '@/shared/mocks/services/eventFollowUp'
import * as survey from '@/shared/mocks/services/eventSurvey'
import * as budget from '@/shared/mocks/services/eventBudget'
import { bulkEmailMapper } from '@/shared/api/marketingMappers'
import { ApiError } from '@/shared/lib/apiError'
import { HttpResponse } from 'msw'
import { cancelRegistration } from '@/shared/mocks/services/events'
import { agendaMapper, applyTemplateMapper, checklistMapper, eventDeepMapper, eventTemplateInputMapper, eventTemplateMapper, sessionMapper, speakerMapper, ticketTypeMapper, cancelRegistrationMapper, checkInResultMapper, checkInSummaryMapper, publicTicketMapper, eventEmailLogMapper, captureMapper, captureResultMapper, leaderboardMapper, followUpResultMapper, publicSurveyMapper, surveyResultsMapper, budgetMapper } from '@/shared/api/eventMappers'
import { plainMapper } from '@/shared/api/mappers'
import { API, bodyAs, errorBody, respondAs, userFrom } from './utils'

type Id = { id: string }
type Ses = { id: string; sessionId: string }
type Spk = { id: string; speakerId: string }
type Tkt = { id: string; ticketTypeId: string }
type Att = { id: string; attendeeId: string }
type Line = { id: string; lineId: string }

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/** A text/calendar answer (.ics), or the usual JSON error envelope. */
async function ics(run: () => Promise<string>): Promise<Response> {
  try {
    return new HttpResponse(await run(), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="event.ics"' } })
  } catch (error) {
    if (error instanceof ApiError) return HttpResponse.json(errorBody(error), { status: error.status })
    throw error
  }
}

const clientOf = (request: Request) => request.headers.get('X-Client-Id')?.trim() || 'anonymous'

/**
 * Advanced Events features (docs/API.md › Events: templates & checklist, agenda, tickets & waitlist,
 * check-in, invitations & reminders, booth capture, follow-up, survey, budget). Company paths are under
 * /events or /event-templates (plan module `events` through the request policy).
 */
export const eventsAdvancedHandlers: HttpHandler[] = [
  /* ---- templates + checklist ---- */
  http.get(`${API}/event-templates`, ({ request }) => respondAs(eventTemplateMapper, () => tpl.listTemplates(userFrom(request)))),
  http.post(`${API}/event-templates`, async ({ request }) => {
    const input = await body<EventTemplateInput>(request, eventTemplateInputMapper)
    return respondAs(eventTemplateMapper, () => tpl.createTemplate(userFrom(request), input))
  }),
  http.get<Id>(`${API}/event-templates/:id`, ({ request, params }) => respondAs(eventTemplateMapper, () => tpl.getTemplate(userFrom(request), params.id))),
  http.patch<Id>(`${API}/event-templates/:id`, async ({ request, params }) => {
    const input = await body<Partial<EventTemplateInput>>(request, eventTemplateInputMapper)
    return respondAs(eventTemplateMapper, () => tpl.updateTemplate(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${API}/event-templates/:id`, ({ request, params }) => respondAs(plainMapper, () => tpl.deleteTemplate(userFrom(request), params.id))),
  http.get<Id>(`${API}/events/:id/checklist`, ({ request, params }) => respondAs(checklistMapper, () => tpl.getChecklist(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/apply-template`, async ({ request, params }) => {
    const input = await body<{ templateId?: unknown }>(request, plainMapper)
    return respondAs(applyTemplateMapper, () => tpl.applyTemplate(userFrom(request), params.id, input))
  }),

  /* ---- agenda & speakers ---- */
  http.get<Id>(`${API}/events/:id/agenda`, ({ request, params }) => respondAs(agendaMapper, () => agenda.getAgenda(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/sessions`, async ({ request, params }) => {
    const input = await body<SessionInput>(request, eventDeepMapper)
    return respondAs(sessionMapper, () => agenda.addSession(userFrom(request), params.id, input))
  }),
  http.patch<Ses>(`${API}/events/:id/sessions/:sessionId`, async ({ request, params }) => {
    const input = await body<Partial<SessionInput>>(request, eventDeepMapper)
    return respondAs(sessionMapper, () => agenda.updateSession(userFrom(request), params.id, params.sessionId, input))
  }),
  http.delete<Ses>(`${API}/events/:id/sessions/:sessionId`, ({ request, params }) => respondAs(plainMapper, () => agenda.removeSession(userFrom(request), params.id, params.sessionId))),
  http.post<Id>(`${API}/events/:id/speakers`, async ({ request, params }) => {
    const input = await body<SpeakerInput>(request, eventDeepMapper)
    return respondAs(speakerMapper, () => agenda.addSpeaker(userFrom(request), params.id, input))
  }),
  http.patch<Spk>(`${API}/events/:id/speakers/:speakerId`, async ({ request, params }) => {
    const input = await body<Partial<SpeakerInput>>(request, eventDeepMapper)
    return respondAs(speakerMapper, () => agenda.updateSpeaker(userFrom(request), params.id, params.speakerId, input))
  }),
  http.delete<Spk>(`${API}/events/:id/speakers/:speakerId`, ({ request, params }) => respondAs(plainMapper, () => agenda.removeSpeaker(userFrom(request), params.id, params.speakerId))),

  /* ---- tickets, capacity & waitlist ---- */
  http.get<Id>(`${API}/events/:id/ticket-types`, ({ request, params }) => respondAs(ticketTypeMapper, () => tickets.listTicketTypes(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/ticket-types`, async ({ request, params }) => {
    const input = await body<TicketTypeInput>(request, eventDeepMapper)
    return respondAs(ticketTypeMapper, () => tickets.createTicketType(userFrom(request), params.id, input))
  }),
  http.patch<Tkt>(`${API}/events/:id/ticket-types/:ticketTypeId`, async ({ request, params }) => {
    const input = await body<Partial<TicketTypeInput>>(request, eventDeepMapper)
    return respondAs(ticketTypeMapper, () => tickets.updateTicketType(userFrom(request), params.id, params.ticketTypeId, input))
  }),
  http.delete<Tkt>(`${API}/events/:id/ticket-types/:ticketTypeId`, ({ request, params }) => respondAs(plainMapper, () => tickets.deleteTicketType(userFrom(request), params.id, params.ticketTypeId))),
  http.post<Att>(`${API}/events/:id/attendees/:attendeeId/cancel`, ({ request, params }) => respondAs(cancelRegistrationMapper, () => cancelRegistration(userFrom(request), params.id, params.attendeeId))),

  /* ---- check-in by code, public ticket ---- */
  http.get<Id>(`${API}/events/:id/check-in`, ({ request, params }) => respondAs(checkInSummaryMapper, () => checkin.getCheckInSummary(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/check-in`, async ({ request, params }) => {
    const input = await body<{ code?: unknown; undo?: unknown }>(request, plainMapper)
    return respondAs(checkInResultMapper, () => checkin.checkInByCode(userFrom(request), params.id, input))
  }),
  http.get<{ code: string }>(`${API}/public/tickets/:code`, ({ request, params }) =>
    respondAs(publicTicketMapper, () => checkin.getPublicTicket(params.code, request.headers.get('X-Client-Id')?.trim() || 'anonymous')),
  ),

  /* ---- invitations, reminders (email log), calendar ---- */
  http.post<Id>(`${API}/events/:id/invite`, async ({ request, params }) => {
    const input = await body<InviteInput>(request, eventDeepMapper)
    return respondAs(bulkEmailMapper, () => comms.inviteAudience(userFrom(request), params.id, input))
  }),
  http.get<Id>(`${API}/events/:id/emails`, ({ request, params }) => respondAs(eventEmailLogMapper, () => comms.listEventEmails(userFrom(request), params.id))),
  http.get<{ token: string }>(`${API}/public/events/:token/calendar.ics`, ({ request, params }) => ics(() => comms.eventIcs(params.token, clientOf(request)))),
  http.get<{ code: string }>(`${API}/public/tickets/:code/calendar.ics`, ({ request, params }) => ics(() => comms.ticketIcs(params.code, clientOf(request)))),

  /* ---- booth capture + leaderboard ---- */
  http.get<Id>(`${API}/events/:id/captures`, ({ request, params }) => respondAs(captureMapper, () => capture.listCaptures(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/captures`, async ({ request, params }) => {
    const input = await body<CaptureInput>(request, eventDeepMapper)
    return respondAs(captureResultMapper, () => capture.createCapture(userFrom(request), params.id, input))
  }),
  http.get<Id>(`${API}/events/:id/leaderboard`, ({ request, params }) => respondAs(leaderboardMapper, () => capture.getLeaderboard(userFrom(request), params.id))),

  /* ---- after the event ---- */
  http.post<Id>(`${API}/events/:id/follow-up`, async ({ request, params }) => {
    const input = await body<FollowUpInput>(request, eventDeepMapper)
    return respondAs(followUpResultMapper, () => followUp.sendFollowUp(userFrom(request), params.id, input))
  }),

  /* ---- feedback survey ---- */
  http.get<Id>(`${API}/events/:id/survey`, ({ request, params }) => respondAs(surveyResultsMapper, () => survey.getSurveyResults(userFrom(request), params.id))),
  http.get<{ token: string }>(`${API}/public/surveys/:token`, ({ request, params }) => respondAs(publicSurveyMapper, () => survey.getPublicSurvey(params.token, clientOf(request)))),
  http.post<{ token: string }>(`${API}/public/surveys/:token`, async ({ request, params }) => {
    const input = await body<SurveyInput>(request, eventDeepMapper)
    return respondAs(plainMapper, () => survey.submitSurvey(params.token, input, clientOf(request)))
  }),

  /* ---- budget lines, campaign link ---- */
  http.get<Id>(`${API}/events/:id/budget`, ({ request, params }) => respondAs(budgetMapper, () => budget.getBudget(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/budget-lines`, async ({ request, params }) => {
    const input = await body<BudgetLineInput>(request, eventDeepMapper)
    return respondAs(budgetMapper, () => budget.addBudgetLine(userFrom(request), params.id, input))
  }),
  http.patch<Line>(`${API}/events/:id/budget-lines/:lineId`, async ({ request, params }) => {
    const input = await body<Partial<BudgetLineInput>>(request, eventDeepMapper)
    return respondAs(budgetMapper, () => budget.updateBudgetLine(userFrom(request), params.id, params.lineId, input))
  }),
  http.delete<Line>(`${API}/events/:id/budget-lines/:lineId`, ({ request, params }) => respondAs(budgetMapper, () => budget.removeBudgetLine(userFrom(request), params.id, params.lineId))),
  http.put<Id>(`${API}/events/:id/campaign`, async ({ request, params }) => {
    const input = await body<{ campaignId?: unknown }>(request, plainMapper)
    return respondAs(budgetMapper, () => budget.linkCampaign(userFrom(request), params.id, input))
  }),
]