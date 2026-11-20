import { users } from '@/shared/mocks/db'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { brandAssets, contentItems, designRequests } from '@/shared/mocks/data/marketingCreative'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { now as clockNow } from '@/shared/mocks/clock'
import { ASSET_EXPIRY_DAYS, CONTENT_REMINDER_HOURS, DESIGN_REMINDER_DAYS } from '@/modules/marketing/creative/types'

/**
 * Marketing creative reminders as STORED notifications, each sent ONCE (the task reminders pattern,
 * services/taskReminders.ts):
 *
 *   content due       to the owner, CONTENT_REMINDER_HOURS (24) before publish_at of a SCHEDULED item;
 *                     marks content_items.reminder_sent_at
 *   content overdue   to the owner, once publish_at has passed and the item is still SCHEDULED (not
 *                     published); marks content_items.overdue_notified_at
 *   design due        to the assignee and the requester, from DESIGN_REMINDER_DAYS (1) before the due
 *                     date (company calendar day) while open; marks design_requests.reminder_sent_at
 *   design overdue    to the assignee and the requester, from the day after the due date while open;
 *                     marks design_requests.overdue_notified_at
 *   rights expiring   to the asset's creator, ASSET_EXPIRY_DAYS (30) before usage_rights_expires_at;
 *                     marks brand_assets.expiry_notified_at
 *
 * Instants (publish_at) compare at the mock clock; days (due dates, expiry) are the company's calendar
 * (regional timezone). Changing publish_at / due_date / the expiry date clears the marks (re-armed).
 * Runs lazily per company: GET /alerts and the creative list endpoints call it for the caller's company.
 */

const HOUR = 3_600_000
const OPEN_DESIGN = new Set(['requested', 'in_progress', 'in_review', 'changes_requested', 'approved'])
const active = (companyId: string, id: string | null | undefined) =>
  id ? users.find((u) => u.id === id && u.companyId === companyId && u.active !== false) : undefined
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export const contentLink = (id: string) => `/marketing/content?item=${encodeURIComponent(id)}`
export const designLink = (id: string) => `/marketing/design-requests?request=${encodeURIComponent(id)}`
export const assetLink = (id: string) => `/marketing/assets?asset=${encodeURIComponent(id)}`

export interface CreativeTick {
  contentDue: number
  contentOverdue: number
  designDue: number
  designOverdue: number
  assetExpiry: number
}

export function runCreativeReminders(companyId: string, at: Date = clockNow()): CreativeTick {
  const out: CreativeTick = { contentDue: 0, contentOverdue: 0, designDue: 0, designOverdue: 0, assetExpiry: 0 }
  const nowMs = at.getTime()
  const stamp = at.toISOString()
  const today = companyDayOf(companyId, at).today

  for (const c of contentItems) {
    if (c.companyId !== companyId || c.status !== 'scheduled' || !c.publishAt) continue
    const when = Date.parse(c.publishAt)
    const owner = active(companyId, c.ownerId)
    if (!c.reminderSentAt && when > nowMs && when - nowMs <= CONTENT_REMINDER_HOURS * HOUR) {
      if (owner) {
        const hours = Math.max(1, Math.round((when - nowMs) / HOUR))
        pushNotification({ companyId, userId: owner.id, type: 'marketing-due', title: c.title, body: `Publishes in ${plural(hours, 'hour')}`, link: contentLink(c.id), at: stamp })
        out.contentDue++
      }
      c.reminderSentAt = stamp
    }
    if (!c.overdueNotifiedAt && when <= nowMs) {
      if (owner) {
        pushNotification({ companyId, userId: owner.id, type: 'marketing-overdue', title: c.title, body: 'Scheduled time passed and it isn’t marked published', link: contentLink(c.id), at: stamp })
        out.contentOverdue++
      }
      // A late item never gets the "publishes soon" reminder afterwards.
      c.reminderSentAt ??= stamp
      c.overdueNotifiedAt = stamp
    }
  }

  for (const r of designRequests) {
    if (r.companyId !== companyId || !r.dueDate || !OPEN_DESIGN.has(r.status)) continue
    const left = daysBetweenIso(today, r.dueDate)
    const people = [...new Set([r.assigneeId, r.requesterId])].map((id) => active(companyId, id)).filter((u) => !!u)
    if (!r.reminderSentAt && left >= 0 && left <= DESIGN_REMINDER_DAYS) {
      for (const u of people) {
        pushNotification({ companyId, userId: u.id, type: 'marketing-due', title: r.title, body: `Design request due ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${plural(left, 'day')}`}`, link: designLink(r.id), at: stamp })
        out.designDue++
      }
      r.reminderSentAt = stamp
    }
    if (!r.overdueNotifiedAt && left < 0) {
      for (const u of people) {
        pushNotification({ companyId, userId: u.id, type: 'marketing-overdue', title: r.title, body: `Design request ${plural(-left, 'day')} overdue`, link: designLink(r.id), at: stamp })
        out.designOverdue++
      }
      r.reminderSentAt ??= stamp
      r.overdueNotifiedAt = stamp
    }
  }

  for (const a of brandAssets) {
    if (a.companyId !== companyId || a.status !== 'active' || !a.usageRightsExpiresAt || a.expiryNotifiedAt) continue
    const left = daysBetweenIso(today, a.usageRightsExpiresAt)
    if (left > ASSET_EXPIRY_DAYS) continue
    const creator = active(companyId, a.createdBy)
    if (creator) {
      pushNotification({
        companyId,
        userId: creator.id,
        type: 'marketing',
        title: a.name,
        body: left < 0 ? 'Usage rights have expired' : left === 0 ? 'Usage rights expire today' : `Usage rights expire in ${plural(left, 'day')}`,
        link: assetLink(a.id),
        at: stamp,
      })
      out.assetExpiry++
    }
    a.expiryNotifiedAt = stamp
  }
  return out
}
