import type { Lead, User } from '@/shared/types'
import type { AttendeeSource } from '@/modules/events/types'
import { ATTENDEE_SOURCE_LABEL } from '@/modules/events/types'
import { ANALYTICS_PRESETS, type AnalyticsPreset } from '@/modules/marketing/analyticsTypes'
import type {
  AssignBoothLeadsResult,
  AttendeeDirectory,
  AttendeeExportRow,
  AttendeePerson,
  BoothLead,
  BoothLeads,
  EventAnalytics,
  EventAnalyticsKpis,
  EventAnalyticsRow,
  EventTrendPoint,
  EventTypeSummary,
  FollowUpState,
  PersonRegistration,
} from '@/modules/events/sectionsTypes'
import { DEFAULT_AUTOMATION_RULES } from '@/modules/settings/types'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { ApiError } from '@/shared/lib/apiError'
import { can, scopeOf } from '@/shared/lib/permissions'
import { SYSTEM_STATUS } from '@/shared/lib/systemStatus'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import { isRealIsoDate, zonedParts } from '@/shared/lib/zonedTime'
import { activities, leads, users } from '@/shared/mocks/db'
import { automationRulesFor, isLostStatus, isWonStatus } from '@/shared/mocks/data/lookups'
import { eventAttendees, eventTicketTypes, events, type EventRecord } from '@/shared/mocks/data/events'
import { eventCaptures, eventSurveyResponses, type EventCaptureRecord } from '@/shared/mocks/data/eventExtras'
import { captureFollowUpNotices } from '@/shared/mocks/data/eventSections'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { canSeeEvent, eventsEnabledIn, eventsVisibleTo } from '@/shared/mocks/selectors/events'
import { now as clockNow } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertModule } from '@/shared/mocks/services/billing'
import { updateLead, visibleLeads } from '@/shared/mocks/services/leads'
import { currencyOf, localOf, statsOf, tzOf } from '@/shared/mocks/services/events'
import { npsOf, resultsOf } from '@/shared/mocks/services/eventSurvey'
import { presetRange, previousRange, MAX_ANALYTICS_DAYS } from '@/shared/mocks/services/marketingAnalytics'

/**
 * Cross-event sections of the Events area (docs/API.md › Events › Attendees directory / Booth leads /
 * Event analytics). Every row comes from an event the caller can see (selectors/events.ts canSeeEvent:
 * marketing full / view → every event; everyone else → the events they're on). Lead details (status,
 * owner, value) are served only when the caller's Sales scope reaches the lead, like the per-event tabs.
 */

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const pct1 = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null)

/** The lead ids the viewer's Sales scope reaches (computed once per request). */
function reachableLeads(user: User): Set<string> {
  if (scopeOf(user.role, 'sales') === 'hidden') return new Set()
  return new Set(visibleLeads(user).map((l) => l.id))
}

const leadOf = (companyId: string, id: string | null) => (id ? leads.find((l) => l.id === id && l.companyId === companyId) : undefined)
const userName = (companyId: string, id: string | null | undefined) => (id ? (users.find((u) => u.id === id && u.companyId === companyId)?.name ?? ownerName(id)) : '')

/* ------------------------------------------------------------------------------------------
 * Attendees directory — GET /events/attendees (+ /export, marketing full)
 * ---------------------------------------------------------------------------------------- */

/** The person key: the email (case-insensitive), else the lead, else the registration itself. */
export const personKeyOf = (a: { email: string; leadId: string | null; id: string }) =>
  a.email ? `email:${a.email.trim().toLowerCase()}` : a.leadId ? `lead:${a.leadId}` : `attendee:${a.id}`

/** Pure de-duplication + aggregation (exported for the tests). */
export function buildDirectory(user: User, visible: Tenant<EventRecord>[], today: string): AttendeePerson[] {
  const co = user.companyId
  const reach = reachableLeads(user)
  const byId = new Map(visible.map((e) => [e.id, e]))
  const groups = new Map<string, Tenant<(typeof eventAttendees)[number]>[]>()
  for (const a of eventAttendees) {
    if (a.companyId !== co || !byId.has(a.eventId)) continue
    const key = personKeyOf(a)
    const list = groups.get(key)
    if (list) list.push(a)
    else groups.set(key, [a])
  }
  const people: AttendeePerson[] = []
  for (const regs of groups.values()) {
    // The served key never carries the email (exports blank it for Do Not Contact people): the person's first registration id.
    const key = `P-${[...regs].sort((x, y) => x.registeredAt.localeCompare(y.registeredAt) || x.id.localeCompare(y.id))[0].id}`
    const rows = regs
      .map((a) => ({ a, e: byId.get(a.eventId)! }))
      .sort((x, y) => y.e.startsAt.localeCompare(x.e.startsAt) || y.a.registeredAt.localeCompare(x.a.registeredAt))
    const latest = rows[0].a
    const live = rows.filter((r) => r.a.status !== 'cancelled')
    const seatedPast = rows.filter((r) => r.a.status === 'registered' && r.e.status !== 'cancelled' && localOf(r.e).startDate <= today)
    const attendedEvents = new Set(rows.filter((r) => r.a.checkedInAt && r.a.status === 'registered').map((r) => r.e.id))
    const last = live[0] ?? rows[0]
    const leadId = rows.find((r) => r.a.leadId)?.a.leadId ?? null
    const lead = leadOf(co, leadId)
    const canOpen = !!lead && reach.has(lead.id)
    const registrations: PersonRegistration[] = rows.map(({ a, e }) => {
      const survey = eventSurveyResponses.find((s) => s.companyId === co && s.attendeeId === a.id && s.eventId === e.id)
      return {
        attendeeId: a.id,
        eventId: e.id,
        eventName: e.name,
        eventType: e.type,
        eventStatus: e.status,
        eventDate: localOf(e).startDate,
        status: a.status,
        ticketTypeName: a.ticketTypeId ? (eventTicketTypes.find((t) => t.id === a.ticketTypeId && t.companyId === co)?.name ?? '') : '',
        source: a.source,
        registeredAt: a.registeredAt,
        checkedInAt: a.checkedInAt,
        survey: survey ? { rating: survey.rating, nps: survey.nps, comment: survey.comment } : null,
        captures: eventCaptures
          .filter((c) => c.companyId === co && c.attendeeId === a.id && c.eventId === e.id)
          .sort((x, y) => y.capturedAt.localeCompare(x.capturedAt))
          .map((c) => ({ id: c.id, rating: c.rating, notes: c.notes, capturedByName: userName(co, c.capturedBy), capturedAt: c.capturedAt })),
      }
    })
    people.push({
      key,
      name: latest.name,
      companyName: rows.find((r) => r.a.companyName)?.a.companyName ?? '',
      email: rows.find((r) => r.a.email)?.a.email ?? '',
      mobile: rows.find((r) => r.a.mobile)?.a.mobile ?? '',
      title: rows.find((r) => r.a.title)?.a.title ?? '',
      doNotContact: !!lead?.doNotContact,
      eventsRegistered: new Set(live.map((r) => r.e.id)).size,
      eventsAttended: attendedEvents.size,
      checkedInRate: seatedPast.length ? Math.round((seatedPast.filter((r) => r.a.checkedInAt).length / seatedPast.length) * 100) : null,
      lastEventId: last.e.id,
      lastEventName: last.e.name,
      lastEventDate: localOf(last.e).startDate,
      ticketTypes: [...new Set(registrations.map((r) => r.ticketTypeName).filter(Boolean))],
      sources: [...new Set(rows.map((r) => r.a.source))] as AttendeeSource[],
      leadId,
      leadStatus: canOpen ? lead.status : null,
      leadOwnerId: canOpen ? lead.ownerId : null,
      leadOwnerName: canOpen ? userName(co, lead.ownerId) : null,
      canOpenLead: canOpen,
      registrations,
    })
  }
  return people.sort((a, b) => (b.lastEventDate ?? '').localeCompare(a.lastEventDate ?? '') || a.name.localeCompare(b.name))
}

/** Export rights: marketing `full` (Company Admin, Management, Marketing Manager). */
export const canExportAttendees = (user: User) => scopeOf(user.role, 'marketing') === 'full'

export async function getAttendeeDirectory(user: User): Promise<AttendeeDirectory> {
  assertModule(tenantOf(user), 'events')
  const visible = eventsVisibleTo(user)
  const today = companyDayOf(user.companyId).today
  return delay({
    people: buildDirectory(user, visible, today),
    events: [...visible]
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .map((e) => ({ id: e.id, name: e.name, type: e.type, status: e.status, startDate: localOf(e).startDate })),
    canExport: canExportAttendees(user),
  })
}

/** GET /events/attendees/export — marketing full; Do Not Contact people keep their row without email / mobile. */
export async function exportAttendeeDirectory(user: User): Promise<AttendeeExportRow[]> {
  assertModule(tenantOf(user), 'events')
  if (!canExportAttendees(user)) return fail('Only marketing managers can export the attendee directory.', 403)
  const people = buildDirectory(user, eventsVisibleTo(user), companyDayOf(user.companyId).today)
  return delay(
    people.map((p) => ({
      key: p.key,
      name: p.name,
      companyName: p.companyName,
      title: p.title,
      email: p.doNotContact ? '' : p.email,
      mobile: p.doNotContact ? '' : p.mobile,
      doNotContact: p.doNotContact,
      eventsRegistered: p.eventsRegistered,
      eventsAttended: p.eventsAttended,
      checkedInRate: p.checkedInRate,
      lastEventName: p.lastEventName,
      lastEventDate: p.lastEventDate,
      ticketTypes: p.ticketTypes.join(', '),
      leadStatus: p.leadStatus ?? '',
      leadOwnerName: p.leadOwnerName ?? '',
      sources: p.sources.map((s) => ATTENDEE_SOURCE_LABEL[s]).join(', '),
    })),
  )
}

/* ------------------------------------------------------------------------------------------
 * Booth leads — GET /events/booth-leads, POST /events/booth-leads/assign
 * ---------------------------------------------------------------------------------------- */

const OUTREACH = new Set(['call', 'email', 'whatsapp', 'visit'])
/** Open statuses that mean a meeting happened or is booked (built-in keys). */
const MEETING_STATUSES = new Set<string>([SYSTEM_STATUS.meeting, SYSTEM_STATUS.proposal])

export function followUpDaysOf(companyId: string): number {
  return Math.max(0, automationRulesFor(companyId).eventFollowUpDays ?? DEFAULT_AUTOMATION_RULES.eventFollowUpDays)
}

/**
 * The follow-up state of a capture, from its lead AFTER the capture: won / lost (status type), meeting
 * (a meeting activity, or a Meeting / Proposal status), contacted (a call, email, WhatsApp or visit
 * activity), else untouched. The capture's own "Booth capture" meeting activity doesn't count.
 */
export function followUpStateOf(c: Pick<Tenant<EventCaptureRecord>, 'id' | 'companyId' | 'leadId' | 'capturedAt'>): FollowUpState {
  const lead = leadOf(c.companyId, c.leadId)
  if (!lead) return 'no_lead'
  if (isWonStatus(c.companyId, lead.status)) return 'won'
  if (isLostStatus(c.companyId, lead.status)) return 'lost'
  const after = activities.filter((a) => a.companyId === c.companyId && a.leadId === lead.id && a.at > c.capturedAt && !a.id.startsWith('A-ECP-'))
  if (MEETING_STATUSES.has(lead.status) || after.some((a) => a.type === 'meeting')) return 'meeting'
  if (after.some((a) => OUTREACH.has(a.type))) return 'contacted'
  return 'untouched'
}

/** Due day (capture day + N, company calendar) and whether an untouched capture is past it. */
export function followUpDueOf(c: Pick<Tenant<EventCaptureRecord>, 'companyId' | 'capturedAt'>, today: string, days: number): { due: string; daysOverdue: number } {
  const due = addDaysIso(zonedParts(c.capturedAt, tzOf(c.companyId)).date, days)
  return { due, daysOverdue: Math.max(0, daysBetweenIso(due, today)) }
}

/**
 * Overdue booth follow-ups as STORED notifications, once per capture (like taskReminders.ts): an untouched
 * capture past `eventFollowUpDays` notifies its lead's owner (active, same company) and is marked in
 * `event_capture_follow_up_notices` (also when nobody could be told, so it's never re-checked). Runs
 * lazily for the caller's company on GET /alerts and GET /events/booth-leads.
 */
export function runBoothFollowUps(companyId: string, at: Date = clockNow()): number {
  if (!eventsEnabledIn(companyId)) return 0
  const today = companyDayOf(companyId, at).today
  const days = followUpDaysOf(companyId)
  const stamp = at.toISOString()
  let sent = 0
  for (const c of eventCaptures) {
    if (c.companyId !== companyId || !c.leadId) continue
    if (captureFollowUpNotices.some((n) => n.companyId === companyId && n.captureId === c.id)) continue
    const e = events.find((x) => x.id === c.eventId && x.companyId === companyId)
    if (!e || e.status === 'cancelled') continue
    if (followUpDueOf(c, today, days).daysOverdue <= 0 || followUpStateOf(c) !== 'untouched') continue
    const lead = leadOf(companyId, c.leadId)!
    const owner = users.find((u) => u.id === lead.ownerId && u.companyId === companyId && u.active !== false)
    if (owner) {
      const visitor = eventAttendees.find((a) => a.id === c.attendeeId && a.companyId === companyId)
      pushNotification({
        companyId,
        userId: owner.id,
        type: 'event-follow-up',
        title: `Follow up with ${visitor?.name || lead.contactName || lead.company}`,
        body: `Booth lead from ${e.name} · no contact ${days} day${days === 1 ? '' : 's'} after the capture`,
        link: `/leads/${encodeURIComponent(lead.id)}`,
        at: stamp,
      })
      sent++
    }
    captureFollowUpNotices.push({ companyId, captureId: c.id, notifiedAt: stamp, userId: owner?.id ?? null })
  }
  return sent
}

/** Bulk "Assign owner": a Sales scope that can hand leads to someone else (full or team). */
export const canAssignBoothLeads = (user: User) => can(user.role, 'sales', 'edit') && ['full', 'team'].includes(scopeOf(user.role, 'sales'))

function boothRow(c: Tenant<EventCaptureRecord>, e: Tenant<EventRecord>, reach: Set<string>, today: string, days: number): BoothLead {
  const co = c.companyId
  const visitor = eventAttendees.find((a) => a.id === c.attendeeId && a.companyId === co)
  const lead: Tenant<Lead> | undefined = leadOf(co, c.leadId)
  const canOpen = !!lead && reach.has(lead.id)
  const state = followUpStateOf(c)
  const { due, daysOverdue } = followUpDueOf(c, today, days)
  const overdue = state === 'untouched' && daysOverdue > 0
  return {
    id: c.id,
    eventId: e.id,
    eventName: e.name,
    eventType: e.type,
    capturedAt: c.capturedAt,
    capturedBy: c.capturedBy,
    capturedByName: userName(co, c.capturedBy),
    rating: c.rating,
    notes: c.notes,
    visitorName: visitor?.name ?? '',
    visitorCompany: visitor?.companyName ?? '',
    visitorEmail: visitor?.email ?? '',
    leadId: c.leadId,
    leadStatus: canOpen ? lead.status : null,
    leadOwnerId: canOpen ? lead.ownerId : null,
    leadOwnerName: canOpen ? userName(co, lead.ownerId) : null,
    leadValue: canOpen ? lead.value : null,
    canOpenLead: canOpen,
    state,
    followUpDue: due,
    overdue,
    daysOverdue: overdue ? daysOverdue : 0,
  }
}

export async function getBoothLeads(user: User): Promise<BoothLeads> {
  assertModule(tenantOf(user), 'events')
  const co = user.companyId
  runBoothFollowUps(co)
  const today = companyDayOf(co).today
  const days = followUpDaysOf(co)
  const reach = reachableLeads(user)
  const visible = new Map(eventsVisibleTo(user).map((e) => [e.id, e]))
  const rows = eventCaptures
    .filter((c) => c.companyId === co && visible.has(c.eventId))
    .map((c) => boothRow(c, visible.get(c.eventId)!, reach, today, days))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  return delay({ rows, followUpDays: days, today, canAssign: canAssignBoothLeads(user), currency: currencyOf(co) })
}

/**
 * POST /events/booth-leads/assign { capture_ids, owner_id } — each capture's lead goes through the
 * normal lead update (PATCH /leads/:id path: updateLead), so the caller's lead scope rules apply per lead.
 * Captures the caller can't see (another company's, another event's out of reach, unknown) are skipped
 * as `not_found`; captures without a lead as `no_lead`; a refused lead update with its message.
 */
export async function assignBoothLeads(user: User, input: { captureIds?: unknown; ownerId?: unknown } | null): Promise<AssignBoothLeadsResult> {
  assertModule(tenantOf(user), 'events')
  if (!canAssignBoothLeads(user)) return fail('Your role can’t reassign leads. Sales managers and admins can.', 403)
  const ids = Array.isArray(input?.captureIds) ? [...new Set(input.captureIds.filter((x): x is string => typeof x === 'string' && !!x))] : []
  if (!ids.length) return fail('Pick at least one booth lead.', 422)
  if (ids.length > 500) return fail('Assign at most 500 booth leads at a time.', 422)
  const ownerId = typeof input?.ownerId === 'string' ? input.ownerId : ''
  const owner = users.find((u) => u.id === ownerId && u.companyId === user.companyId)
  if (!owner) return fail('That owner doesn’t exist.', 422)
  if (!owner.active) return fail(`${owner.name} is deactivated and can’t own leads.`, 422)
  const out: AssignBoothLeadsResult = { updated: 0, skipped: [] }
  const doneLeads = new Set<string>()
  for (const id of ids) {
    const c = eventCaptures.find((x) => x.id === id && x.companyId === user.companyId)
    const e = c ? events.find((x) => x.id === c.eventId && x.companyId === user.companyId) : undefined
    if (!c || !e || !canSeeEvent(user, e)) {
      out.skipped.push({ captureId: id, reason: 'not_found' })
      continue
    }
    if (!c.leadId) {
      out.skipped.push({ captureId: id, reason: 'no_lead' })
      continue
    }
    if (doneLeads.has(c.leadId)) continue
    try {
      await updateLead(user, c.leadId, { ownerId: owner.id })
      doneLeads.add(c.leadId)
      out.updated++
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      out.skipped.push({ captureId: id, reason: err.message })
    }
  }
  return delay(out)
}

/* ------------------------------------------------------------------------------------------
 * Event analytics — GET /events/analytics?preset&from&to&compare
 * Access: Marketing view AND Reports full | marketing (like Marketing analytics). Those roles see every
 * event (marketing full / view), so the numbers are the company's.
 * ---------------------------------------------------------------------------------------- */

/** Held in [from, to]: not cancelled, started on / before today, start date (company calendar) in the range. */
export function eventsHeldIn(companyId: string, from: string, to: string, today: string): Tenant<EventRecord>[] {
  return events
    .filter((e) => e.companyId === companyId && e.status !== 'cancelled')
    .filter((e) => {
      const d = localOf(e).startDate
      return d >= from && d <= to && d <= today
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

export function analyticsRowOf(e: Tenant<EventRecord>): EventAnalyticsRow {
  const s = statsOf(e)
  const survey = resultsOf(e)
  const local = localOf(e)
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    status: e.status,
    startDate: local.startDate,
    endDate: local.endDate,
    attendees: s.attendees,
    checkedIn: s.checkedIn,
    checkInRate: pct1(s.checkedIn, s.attendees),
    leads: s.leads,
    leadsCreated: s.leadsCreated,
    leadsLinked: s.leadsLinked,
    costPerLead: s.costPerLead,
    costPerLeadBasis: s.costPerLeadBasis,
    dealsWon: s.dealsWon,
    wonValue: s.wonValue,
    actualCost: s.actualCost,
    budget: s.budget,
    roi: s.roi === null ? null : round1(s.roi * 100),
    nps: survey.nps,
    responses: survey.responses,
  }
}

/** The CPL cost of an event: the event stats rule (actual cost when known, else the budget). */
const cplCostOf = (r: EventAnalyticsRow) => r.actualCost ?? r.budget

export function kpisOf(rows: EventAnalyticsRow[]): EventAnalyticsKpis {
  const attendees = rows.reduce((s, r) => s + r.attendees, 0)
  const checkedIn = rows.reduce((s, r) => s + r.checkedIn, 0)
  const priced = rows.filter((r) => cplCostOf(r) !== null && r.leadsCreated > 0)
  const cplCost = priced.reduce((s, r) => s + (cplCostOf(r) ?? 0), 0)
  const cplLeads = priced.reduce((s, r) => s + r.leadsCreated, 0)
  const costed = rows.filter((r) => r.actualCost)
  const actual = costed.reduce((s, r) => s + (r.actualCost ?? 0), 0)
  const costedWon = costed.reduce((s, r) => s + r.wonValue, 0)
  const npsRows = rows.filter((r) => r.nps !== null)
  return {
    events: rows.length,
    attendees,
    checkedIn,
    checkInRate: pct1(checkedIn, attendees),
    leadsCreated: rows.reduce((s, r) => s + r.leadsCreated, 0),
    leadsLinked: rows.reduce((s, r) => s + r.leadsLinked, 0),
    dealsWon: rows.reduce((s, r) => s + r.dealsWon, 0),
    wonValue: rows.reduce((s, r) => s + r.wonValue, 0),
    actualCost: round2(rows.reduce((s, r) => s + (r.actualCost ?? 0), 0)),
    costPerLead: cplLeads > 0 ? round2(cplCost / cplLeads) : null,
    roi: actual > 0 ? round1(((costedWon - actual) / actual) * 100) : null,
    averageNps: npsRows.length ? Math.round(npsRows.reduce((s, r) => s + (r.nps ?? 0), 0) / npsRows.length) : null,
  }
}

function byTypeOf(rows: EventAnalyticsRow[]): EventTypeSummary[] {
  const types = [...new Set(rows.map((r) => r.type))]
  return types
    .map((type) => {
      const list = rows.filter((r) => r.type === type)
      const k = kpisOf(list)
      const priced = list.filter((r) => cplCostOf(r) !== null && r.leadsCreated > 0)
      return { type, events: list.length, leadsCreated: k.leadsCreated, cost: round2(priced.reduce((s, r) => s + (cplCostOf(r) ?? 0), 0)), costPerLead: k.costPerLead, wonValue: k.wonValue, roi: k.roi }
    })
    .sort((a, b) => b.events - a.events || a.type.localeCompare(b.type))
}

function trendOf(companyId: string, rows: EventAnalyticsRow[]): EventTrendPoint[] {
  const months = [...new Set(rows.map((r) => r.startDate.slice(0, 7)))].sort()
  return months.map((month) => {
    const list = rows.filter((r) => r.startDate.startsWith(month))
    const k = kpisOf(list)
    const scores = eventSurveyResponses.filter((s) => s.companyId === companyId && list.some((r) => r.id === s.eventId)).map((s) => s.nps)
    return { month, events: list.length, checkInRate: k.checkInRate, nps: npsOf(scores).nps }
  })
}

export function buildEventAnalytics(companyId: string, preset: AnalyticsPreset, from: string, to: string, compare: boolean, at: Date = clockNow()): EventAnalytics {
  const today = companyDayOf(companyId, at).today
  const rows = eventsHeldIn(companyId, from, to, today).map(analyticsRowOf)
  const prev = compare ? previousRange(from, to) : null
  return {
    preset,
    from,
    to,
    timezone: tzOf(companyId),
    currency: currencyOf(companyId),
    kpis: kpisOf(rows),
    previous: prev,
    previousKpis: prev ? kpisOf(eventsHeldIn(companyId, prev.from, prev.to, today).map(analyticsRowOf)) : null,
    rows: [...rows].sort((a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name)),
    byType: byTypeOf(rows),
    trend: trendOf(companyId, rows),
  }
}

export const canSeeEventAnalytics = (user: User) => can(user.role, 'marketing', 'view') && canSeeMarketingReportsRole(user.role)

export async function getEventAnalytics(user: User, q: { preset?: string; from?: string; to?: string; compare?: string }): Promise<EventAnalytics> {
  assertModule(tenantOf(user), 'events')
  if (!canSeeEventAnalytics(user)) return fail('Event analytics needs Marketing access and a Reports scope of all records or marketing.', 403)
  const co = user.companyId
  const preset = (q.preset || 'ytd') as AnalyticsPreset
  if (!ANALYTICS_PRESETS.includes(preset)) return fail('Pick a period: this_month, last_30_days, this_quarter, ytd or custom.', 400)
  let range: { from: string; to: string }
  if (preset === 'custom') {
    if (!isRealIsoDate(q.from) || !isRealIsoDate(q.to)) return fail('Pick a valid date range (from and to, YYYY-MM-DD).', 400)
    if (q.from > q.to) return fail('The start date must be on or before the end date.', 400)
    if (daysBetweenIso(q.from, q.to) + 1 > MAX_ANALYTICS_DAYS) return fail('Pick a range of two years or less.', 400)
    range = { from: q.from, to: q.to }
  } else {
    range = presetRange(preset, tzOf(co))
  }
  const compare = q.compare === undefined || q.compare === '' ? true : !['0', 'false', 'no'].includes(q.compare)
  return delay(buildEventAnalytics(co, preset, range.from, range.to, compare))
}
