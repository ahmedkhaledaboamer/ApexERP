import type { User } from '@/shared/types'
import type { FollowUpInput, FollowUpResult } from '@/modules/events/types'
import type { AudienceRules } from '@/modules/marketing/growth/types'
import { EMPTY_RULES } from '@/modules/marketing/growth/types'
import { checklistDueDate } from '@/modules/events/lib/checklistPlan'
import { leads, users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { audiences } from '@/shared/mocks/data/marketingGrowth'
import { bulkEmails } from '@/shared/mocks/data/marketing'
import { nextTaskId, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { eventAttendees, type EventRecord } from '@/shared/mocks/data/events'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { nowIso } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import type { Tenant } from '@/shared/mocks/tenant'
import { createAudience } from '@/shared/mocks/services/audiences'
import { createBulkEmail } from '@/shared/mocks/services/marketing'
import { eventFor, log, onEventCompleted } from '@/shared/mocks/services/events'

/**
 * Post-event automation (docs/API.md › Events › After the event).
 *  - When an event becomes `completed`, every lead registered / captured at it (attendees with a seat;
 *    the waitlist and cancellations are left out) gets ONE follow-up task for the lead's owner (else the
 *    event owner), due `follow_up_days` after the completion day (company calendar; a weekend moves to
 *    the next working day). Once only: `events.follow_up_tasks_at`, and per lead the task's template id
 *    `event-follow-up:<event id>` (re-completing never duplicates).
 *  - "Send follow-up" composes two Marketing bulk email drafts — checked-in attendees vs no-shows
 *    (registered, never checked in) — targeting two dynamic audiences with the event rules
 *    (`event_presence: attended | no_show`), so they're reusable in Marketing › Audiences too.
 */

export const followUpKey = (eventId: string) => `event-follow-up:${eventId}`

/** Leads from the event that get a follow-up (attendees with a seat, captures included). */
function leadIdsOf(e: Tenant<EventRecord>): string[] {
  return [...new Set(eventAttendees.filter((a) => a.eventId === e.id && a.companyId === e.companyId && a.status === 'registered' && a.leadId).map((a) => a.leadId!))]
}

export function createFollowUpTasks(e: Tenant<EventRecord>, actor: User | null): number {
  if (e.followUpTasksAt) return 0
  const co = e.companyId
  const company = companyById(co)
  const due = checklistDueDate(companyDayOf(co).today, e.followUpDays, company?.regional.weekend ?? [0, 6])
  const now = nowIso()
  const perOwner = new Map<string, number>()
  let created = 0
  for (const leadId of leadIdsOf(e)) {
    const lead = leads.find((l) => l.id === leadId && l.companyId === co)
    if (!lead) continue
    if (tasks.some((t) => t.companyId === co && t.templateTaskId === followUpKey(e.id) && t.link?.type === 'lead' && t.link.id === leadId)) continue
    const leadOwner = users.find((u) => u.id === lead.ownerId && u.companyId === co && u.active !== false)
    const ownerId = leadOwner?.id ?? e.ownerId ?? actor?.id
    if (!ownerId) continue
    const id = nextTaskId()
    tasks.push({
      companyId: co,
      id,
      title: `Follow up with ${lead.contactName || lead.company} after ${e.name}`,
      description: `Post-event follow-up (${e.name}).`,
      ownerId,
      followerIds: [],
      priority: 'high',
      dueDate: due,
      status: 'todo',
      link: { type: 'lead', id: leadId },
      projectId: null,
      parentTaskId: null,
      estimatedHours: 0,
      templateTaskId: followUpKey(e.id),
      dayOffset: e.followUpDays,
      sortOrder: 0,
      blockedAt: null,
      blockedReason: null,
      reminderSentAt: null,
      overdueNotifiedAt: null,
      attachments: [],
      comments: [],
      history: [{ id: `${id}-h0`, kind: 'created', userId: actor?.id ?? e.ownerId ?? ownerId, at: now, summary: `Created when ${e.name} was completed` }],
      createdBy: actor?.id ?? e.ownerId ?? ownerId,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    })
    perOwner.set(ownerId, (perOwner.get(ownerId) ?? 0) + 1)
    created++
  }
  for (const [userId, n] of perOwner) {
    pushNotification({ companyId: co, userId, type: 'assignment', title: `${n} follow-up${n === 1 ? '' : 's'} from ${e.name}`, body: `Due ${due}`, link: '/tasks/my' })
  }
  e.followUpTasksAt = now
  log(e, actor, `Event completed: ${created} follow-up task${created === 1 ? '' : 's'} created`)
  return created
}

onEventCompleted((e, actor) => {
  createFollowUpTasks(e, actor)
})

/* ---------------- Send follow-up (two bulk emails) ---------------- */

export const ATTENDED_SUBJECT = 'Thank you for coming to {{event.name}}'
export const ATTENDED_BODY =
  'Hi {{lead.firstName}},\n\nThank you for joining us at {{event.name}}. We’d love your feedback (2 minutes): {{event.survey_url}}\n\nI’ll be in touch about next steps.\n\n{{agent.name}}\n{{company.name}}'
export const NO_SHOW_SUBJECT = 'Sorry we missed you at {{event.name}}'
export const NO_SHOW_BODY =
  'Hi {{lead.firstName}},\n\nWe missed you at {{event.name}}. Happy to walk you through what we showed: just reply to this email.\n\n{{agent.name}}\n{{company.name}}'

async function audienceFor(user: User, e: Tenant<EventRecord>, presence: 'attended' | 'no_show'): Promise<string> {
  const name = `${e.name} · ${presence === 'attended' ? 'attended' : 'no-shows'}`
  const existing = audiences.find((a) => a.companyId === e.companyId && a.name === name)
  if (existing) return existing.id
  const rules: AudienceRules = { ...EMPTY_RULES, eventIds: [e.id], eventPresence: presence }
  const created = await createAudience(user, {
    name,
    description: presence === 'attended' ? `Checked in at ${e.name}.` : `Registered for ${e.name} but never checked in.`,
    rules,
    kind: 'dynamic',
  } as Parameters<typeof createAudience>[1])
  return created.id
}

/** POST /events/:id/follow-up { attended_template_id?, no_show_template_id? } — completed events; Marketing edit right. */
export async function sendFollowUp(user: User, id: string, input: FollowUpInput | null): Promise<FollowUpResult> {
  const e = await eventFor(user, id)
  if (e.status !== 'completed') return fail('Complete the event first: the follow-up goes to attendees and no-shows.', 409)
  const attendedAudienceId = await audienceFor(user, e, 'attended')
  const noShowAudienceId = await audienceFor(user, e, 'no_show')
  const v = input ?? {}
  const compose = async (presence: 'attended' | 'no_show', audienceId: string, templateId: string | null | undefined) => {
    const b = await createBulkEmail(user, {
      name: `${presence === 'attended' ? 'Thank you' : 'Sorry we missed you'} · ${e.name}`,
      campaignId: e.campaignId,
      ...(templateId ? { templateId } : presence === 'attended' ? { subject: ATTENDED_SUBJECT, body: ATTENDED_BODY } : { subject: NO_SHOW_SUBJECT, body: NO_SHOW_BODY }),
      audience: { audienceId },
    })
    bulkEmails.find((x) => x.id === b.id && x.companyId === e.companyId)!.eventId = e.id
    return { ...b, eventId: e.id }
  }
  const attended = await compose('attended', attendedAudienceId, v.attendedTemplateId)
  const noShow = await compose('no_show', noShowAudienceId, v.noShowTemplateId)
  log(e, user, 'Composed the follow-up emails (attendees and no-shows)')
  return delay({ attended, noShow, attendedAudienceId, noShowAudienceId })
}
