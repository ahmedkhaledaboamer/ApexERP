import type { User } from '@/shared/types'
import type { PublicSurvey, SurveyInput, SurveyResults } from '@/modules/events/types'
import { firstNameOf } from '@/modules/settings/templates/context'
import { companyById } from '@/shared/mocks/data/tenancy'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { eventAttendees, events, registrationHits, type AttendeeRecord, type EventRecord } from '@/shared/mocks/data/events'
import { eventSurveyResponses } from '@/shared/mocks/data/eventExtras'
import { eventsEnabledIn } from '@/shared/mocks/selectors/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { hitRateLimit } from '@/shared/mocks/services/rateLimit'
import { isReadOnly } from '@/shared/mocks/services/billing'
import { eventFor, seated } from '@/shared/mocks/services/events'

/**
 * Feedback survey (docs/API.md › Events › Feedback survey). Every attendee with a seat has an
 * unguessable survey token (link `/s/:token`, also the `{{event.survey_url}}` variable of follow-up
 * emails). It opens once the event is over (completed, or its end has passed; not cancelled) and takes
 * ONE answer per attendee: rating 1–5, NPS 0–10, an optional comment. Results: averages, the NPS score
 * (% promoters 9–10 − % detractors 0–6) and the comments.
 */

export const SURVEY_LIMIT = 10
export const SURVEY_WINDOW_MINUTES = 10

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
let seq = 0

/** NPS from scores 0–10: % promoters − % detractors, rounded; null without scores. */
export function npsOf(scores: number[]): { nps: number | null; promoters: number; passives: number; detractors: number } {
  const promoters = scores.filter((s) => s >= 9).length
  const detractors = scores.filter((s) => s <= 6).length
  const passives = scores.length - promoters - detractors
  return { nps: scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null, promoters, passives, detractors }
}

/** The attendee and event behind a survey token: the same 404 for unknown tokens, waitlist / cancelled seats, module off, deleted / suspended workspaces. */
function bySurveyToken(token: string): { a: Tenant<AttendeeRecord>; e: Tenant<EventRecord> } {
  const a = token ? eventAttendees.find((x) => x.surveyToken === token) : undefined
  const e = a ? events.find((x) => x.id === a.eventId && x.companyId === a.companyId) : undefined
  const sub = e ? subscriptionOf(e.companyId) : undefined
  if (!a || !e || a.status !== 'registered' || !eventsEnabledIn(e.companyId) || !sub || sub.status === 'deleted' || companyById(e.companyId)?.status === 'suspended') {
    throw new CodedApiError('This survey link isn’t valid.', 404, 'survey_not_found')
  }
  return { a, e }
}

function closedReasonOf(e: Tenant<EventRecord>): string | null {
  if (e.status === 'cancelled') return 'This event was cancelled.'
  const ended = e.status === 'completed' || Date.parse(e.endsAt ?? e.startsAt) <= nowMs()
  if (!ended) return 'The survey opens after the event.'
  const sub = subscriptionOf(e.companyId)
  if (sub && isReadOnly(sub.status)) return 'This survey is closed.'
  return null
}

const answered = (a: Tenant<AttendeeRecord>) => eventSurveyResponses.some((r) => r.attendeeId === a.id && r.companyId === a.companyId)

/** GET /public/surveys/:token */
export async function getPublicSurvey(token: string, clientKey = 'anonymous'): Promise<PublicSurvey> {
  await delay(null)
  hitRateLimit(registrationHits, [`survey:${clientKey || 'anonymous'}`], { limit: SURVEY_LIMIT * 3, windowMs: SURVEY_WINDOW_MINUTES * 60_000, what: 'survey' })
  const { a, e } = bySurveyToken(token)
  const c = companyById(e.companyId)
  const submitted = answered(a)
  const reason = closedReasonOf(e)
  return { eventName: e.name, organizerName: c?.branding.displayName ?? c?.name ?? '', attendeeFirstName: firstNameOf(a.name), open: !reason && !submitted, submitted, closedReason: reason }
}

/** POST /public/surveys/:token { rating, nps, comment? } — once per attendee (409 `already_submitted`). */
export async function submitSurvey(token: string, input: Partial<SurveyInput> | null, clientKey = 'anonymous'): Promise<{ submitted: true; message: string }> {
  await delay(null)
  hitRateLimit(registrationHits, [`survey-post:${clientKey || 'anonymous'}`], { limit: SURVEY_LIMIT, windowMs: SURVEY_WINDOW_MINUTES * 60_000, what: 'survey' })
  const { a, e } = bySurveyToken(token)
  const reason = closedReasonOf(e)
  if (reason) throw new CodedApiError(reason, 409, 'survey_closed')
  if (answered(a)) throw new CodedApiError('You’ve already answered this survey. Thank you!', 409, 'already_submitted')
  const rating = Number(input?.rating)
  const nps = Number(input?.nps)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new CodedApiError('Rate the event from 1 to 5.', 422, 'invalid_survey')
  if (!Number.isInteger(nps) || nps < 0 || nps > 10) throw new CodedApiError('Pick how likely you are to recommend us, from 0 to 10.', 422, 'invalid_survey')
  const comment = str(input?.comment)
  if (comment.length > 2000) throw new CodedApiError('Keep the comment under 2,000 characters.', 422, 'invalid_survey')
  eventSurveyResponses.push({ companyId: e.companyId, id: `ESR-${nowMs().toString(36)}${(++seq).toString(36)}`, eventId: e.id, attendeeId: a.id, rating, nps, comment, submittedAt: nowIso() })
  return { submitted: true, message: 'Thank you for your feedback!' }
}

export function resultsOf(e: Tenant<EventRecord>): SurveyResults {
  const rows = eventSurveyResponses.filter((r) => r.eventId === e.id && r.companyId === e.companyId)
  const invited = seated(e).length
  const n = npsOf(rows.map((r) => r.nps))
  return {
    responses: rows.length,
    invited,
    responseRate: invited ? Math.round((rows.length / invited) * 1000) / 10 : null,
    averageRating: rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null,
    ...n,
    comments: rows
      .filter((r) => r.comment)
      .sort((x, y) => y.submittedAt.localeCompare(x.submittedAt))
      .map((r) => ({
        attendeeName: eventAttendees.find((a) => a.id === r.attendeeId && a.companyId === e.companyId)?.name ?? '',
        rating: r.rating,
        nps: r.nps,
        comment: r.comment,
        submittedAt: r.submittedAt,
      })),
  }
}

/** GET /events/:id/survey — results (anyone who sees the event). */
export async function getSurveyResults(user: User, id: string): Promise<SurveyResults> {
  const e = await eventFor(user, id)
  return delay(resultsOf(e))
}
