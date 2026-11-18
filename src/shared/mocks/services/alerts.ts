import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns'
import type { User } from '@/shared/types'
import type { Alert, AlertSeverity, AlertType } from '@/modules/alerts/types'
import type { StoredNotification, Task } from '@/modules/tasks/types'
import { customerPath, leadPath, PATHS } from '@/app/paths'
import { inScope, scopeOf } from '@/shared/lib/permissions'
import { activities, customers } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { automationRulesFor, isClosedStatus, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { notifications } from '@/shared/mocks/data/tasks'
import { companyDayOf, companyTeamIds } from '@/shared/mocks/selectors/company'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { now as clockNow } from '@/shared/mocks/clock'
import { findInTenant, scoped, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { isOverdue, myTasks, overdueTasks, subjectOf } from '@/shared/mocks/selectors/tasks'
import { runTaskReminders } from '@/shared/mocks/services/taskReminders'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { visibleLeads } from '@/shared/mocks/services/leads'
import { statusLabelOf } from '@/shared/mocks/lookupChecks'

/**
 * GET /alerts — what the bell shows for the signed-in user.
 *
 * Computed live from Settings > Automation (never stored, so they can't be marked read):
 *   no-contact    New lead with no activity for ≥ noContactReminderDays (to the owner)
 *   stalled       Interested lead with no activity for ≥ stalledInterestedDays (to managers: team/full scope)
 *   follow-up     Follow-ups due today or overdue (owner); others' overdue ones (managers)
 *   renewal       Contracts renewing within renewalAlertDays (anyone who can see the customer)
 *   task-overdue  Open overdue tasks: my own, and — with a team/full tasks scope — every overdue task
 *                 in scope (the shared overdueTasks selector), except those I got a stored notice for
 * Lead and contract alerts are scoped like leads; task alerts read the unified task store, with the
 * company's calendar days (regional timezone; `now` = the mock clock).
 *
 * Task reminders are STORED (database alignment, part B): every call first runs the company's
 * reminder tick (services/taskReminders.ts), which stores the owner's task-due reminder N days
 * before the due date and the manager's task-overdue notice, each once per task
 * (tasks.reminder_sent_at / overdue_notified_at; re-armed when the due date changes).
 *
 * Stored (`notifications` in src/shared/mocks/data/tasks.ts, pushed by the Won flow, task writes and
 *   the reminder tick): won, assignment, mention, task-due, task-overdue, billing (subscription
 *   lifecycle, services/billing.ts), usage (plan usage warnings) addressed to the caller, with their
 *   `read` flag. PATCH /alerts/:id/read and POST /alerts/read-all mark them read.
 *
 * Tenancy: every source (leads, contracts, tasks, notifications, people) is read inside the
 * caller's company, and the rules are that company's Settings > Automation.
 */

const DAY = 86_400_000
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const taskLink = (base: string, id: string) => `${base}?task=${encodeURIComponent(id)}`

function lastActivityAt(leadId: string): string | null {
  let last: string | null = null
  for (const a of activities) if (a.leadId === leadId && (!last || a.at > last)) last = a.at
  return last
}

/** Lead journey and renewal alerts (sales scope). */
function salesAlerts(user: User, now: Date): Alert[] {
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') return []
  const manager = scope === 'team' || scope === 'full'
  const co = tenantOf(user)
  const rules = automationRulesFor(co)
  const today = startOfDay(now)
  const companyToday = companyDayOf(co, now).today
  const out: Alert[] = []

  for (const l of scoped(visibleLeads(user), user)) {
    const mine = l.ownerId === user.id
    const last = lastActivityAt(l.id)

    // (a) First contact: "if a day passes with no contact, the agent gets a reminder."
    if (mine && l.status === SYSTEM_STATUS.new && !last) {
      const since = now.getTime() - new Date(l.createdAt).getTime()
      if (since >= rules.noContactReminderDays * DAY) {
        const days = Math.floor(since / DAY)
        out.push({
          id: `no-contact:${l.id}`,
          type: 'no-contact',
          severity: days > rules.noContactReminderDays ? 'danger' : 'warning',
          title: `Contact ${l.company}`,
          body: `New lead with no contact for ${plural(days, 'day')}.`,
          leadId: l.id,
          link: leadPath(l.id),
          at: new Date(new Date(l.createdAt).getTime() + rules.noContactReminderDays * DAY).toISOString(),
        })
      }
    }

    // (b) Interested: "if 3 days pass with no activity, the sales manager is alerted."
    if (manager && l.status === SYSTEM_STATUS.interested) {
      const ref = [last, l.stageChangedAt].filter(Boolean).sort().at(-1) as string
      const idle = now.getTime() - new Date(ref).getTime()
      if (idle >= rules.stalledInterestedDays * DAY) {
        out.push({
          id: `stalled:${l.id}`,
          type: 'stalled',
          severity: 'warning',
          title: `${l.company} has gone quiet`,
          body: `${statusLabelOf(co, l.status)} with no activity for ${plural(Math.floor(idle / DAY), 'day')} · ${ownerName(l.ownerId)}`,
          leadId: l.id,
          link: leadPath(l.id),
          at: new Date(new Date(ref).getTime() + rules.stalledInterestedDays * DAY).toISOString(),
        })
      }
    }

    // (c) Follow-ups due today or overdue: company-local calendar dates against the company's today.
    if (l.nextFollowUpDate && !isClosedStatus(co, l.status)) {
      const late = daysBetweenIso(l.nextFollowUpDate, companyToday)
      if (late >= 0 && (mine || (manager && late > 0))) {
        out.push({
          id: `follow-up:${l.id}`,
          type: 'follow-up',
          severity: late > 0 ? 'danger' : 'warning',
          title: l.company,
          body:
            (late > 0 ? `Follow-up ${plural(late, 'day')} overdue` : 'Follow-up due today') +
            (mine ? '' : ` · ${ownerName(l.ownerId)}`) +
            (l.nextStep ? ` · ${l.nextStep}` : ''),
          leadId: l.id,
          link: leadPath(l.id),
          at: l.nextFollowUpDate,
        })
      }
    }
  }

  // (d) Renewals: "Alert 30 days before the renewal date."
  const team = companyTeamIds(user)
  for (const c of scoped(contracts, user)) {
    // Only live (active) contracts renew; cancelled, renewed or draft ones never alert.
    if (c.status !== 'active') continue
    const customer = findInTenant(customers, user, (x) => x.id === c.customerId)
    if (!customer || !inScope(scope, user, c.ownerId, team)) continue
    const days = differenceInCalendarDays(parseISO(c.renewalDate), today)
    if (days < 0 || days > rules.renewalAlertDays) continue
    out.push({
      id: `renewal:${c.id}`,
      type: 'renewal',
      severity: days <= 7 ? 'danger' : 'warning',
      title: `${customer.name} renews ${days === 0 ? 'today' : `in ${plural(days, 'day')}`}`,
      body: c.title,
      customerId: customer.id,
      link: customer ? customerPath(customer.id) : PATHS.contracts,
      at: new Date(parseISO(c.renewalDate).getTime() - rules.renewalAlertDays * DAY).toISOString(),
    })
  }

  return out
}

/**
 * Overdue tasks the user should see live (computed, clear once the task is done or rescheduled):
 * their own, and — with a team/full tasks scope — every overdue task in scope. The owner's
 * reminder and the manager's overdue notice are STORED (services/taskReminders.ts); a task the
 * user already has a stored overdue notice for isn't listed twice.
 */
function taskAlerts(user: User, now: Date): Alert[] {
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'hidden') return []
  // Days are the company's (regional timezone + week start), at `now` (the mock clock by default).
  const day = companyDayOf(tenantOf(user), now)
  const today = day.today
  const out: Alert[] = []
  const notified = new Set(storedFor(user).filter((n) => n.type === 'task-overdue' && n.taskId).map((n) => n.taskId as string))

  const overdue = new Map<string, Tenant<Task>>()
  for (const t of myTasks(user)) {
    if (t.ownerId === user.id && isOverdue(t, today)) overdue.set(t.id, t)
  }
  if (scope === 'team' || scope === 'full') {
    for (const t of overdueTasks(user, day)) overdue.set(t.id, t)
  }
  for (const id of notified) overdue.delete(id)

  for (const t of overdue.values()) {
    const due = parseISO(t.dueDate as string)
    const late = daysBetweenIso(t.dueDate as string, today)
    const mine = t.ownerId === user.id
    const subject = subjectOf(t, user)
    out.push({
      id: `task-overdue:${t.id}`,
      type: 'task-overdue',
      severity: 'danger',
      title: t.title,
      body: [mine ? null : ownerName(t.ownerId), `${plural(late, 'day')} overdue`, subject ?? null].filter(Boolean).join(' · '),
      taskId: t.id,
      link: taskLink(mine ? PATHS.myTasks : PATHS.taskList, t.id),
      // A task becomes overdue at the start of the day after its due date.
      at: new Date(due.getTime() + DAY).toISOString(),
    })
  }
  return out
}

const STORED_TYPE: Record<StoredNotification['type'], AlertType> = {
  won: 'won',
  assignment: 'assignment',
  mention: 'mention',
  'task-due': 'task',
  'task-overdue': 'task-overdue',
  billing: 'billing',
  usage: 'usage',
}
const STORED_SEVERITY: Record<StoredNotification['type'], AlertSeverity> = {
  won: 'info',
  assignment: 'info',
  mention: 'info',
  'task-due': 'warning',
  'task-overdue': 'danger',
  billing: 'warning',
  usage: 'warning',
}

function toAlert(n: StoredNotification): Alert {
  return {
    id: n.id,
    type: STORED_TYPE[n.type],
    severity: STORED_SEVERITY[n.type],
    title: n.title,
    body: n.body,
    link: n.link,
    at: n.at,
    stored: true,
    read: n.read,
    ...(n.taskId ? { taskId: n.taskId } : {}),
  }
}

/** The caller's stored notifications, in the caller's company only. */
const storedFor = (user: User) => scoped(notifications, user).filter((n) => n.userId === user.id)

/**
 * Runs the company's task reminder tick (stored, once per task), then: computed reminders plus the
 * caller's stored notifications, newest first.
 */
export function alertsFor(user: User, now: Date = clockNow()): Alert[] {
  runTaskReminders(tenantOf(user), now)
  return [...salesAlerts(user, now), ...taskAlerts(user, now), ...storedFor(user).map(toAlert)].sort((a, b) => b.at.localeCompare(a.at))
}

export async function getAlerts(user: User): Promise<Alert[]> {
  return delay(alertsFor(user))
}

/** PATCH /alerts/:id/read — stored notifications only; computed reminders clear when their cause does. */
export async function markAlertRead(user: User, id: string): Promise<Alert> {
  const n = findInTenant(notifications, user, (x) => x.id === id && x.userId === user.id)
  if (!n) {
    if (id.includes(':')) return fail('This reminder comes from the automation rules and clears once the task or lead is dealt with.', 422)
    return fail('That notification doesn’t exist.', 404)
  }
  n.read = true
  return delay(toAlert(n))
}

/** POST /alerts/read-all — marks every unread stored notification of the caller read. */
export async function markAllAlertsRead(user: User): Promise<{ updated: number }> {
  let updated = 0
  for (const n of storedFor(user)) {
    if (n.read) continue
    n.read = true
    updated++
  }
  return delay({ updated })
}
