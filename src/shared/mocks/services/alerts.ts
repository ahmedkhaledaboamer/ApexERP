import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns'
import type { Lead, User } from '@/shared/types'
import type { Alert } from '@/modules/alerts/types'
import { customerPath, leadPath, PATHS } from '@/app/paths'
import { inScope, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { departments } from '@/shared/mocks/data/departments'
import { activities, customers, tasks, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { automationRules, isClosedStatus, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { delay, ownerName } from '@/shared/mocks/server'
import { visibleLeads } from '@/shared/mocks/services/leads'
import { statusLabelOf } from '@/shared/mocks/lookupChecks'

/**
 * GET /alerts — reminders the automation rules raise for the signed-in user, read live from
 * Settings > Automation:
 *   no-contact  New lead with no activity for ≥ noContactReminderDays (to the owner)
 *   stalled     Interested lead with no activity for ≥ stalledInterestedDays (to managers: team/full scope)
 *   follow-up   Follow-ups due today or overdue (owner); others' overdue ones (managers)
 *   renewal     Contracts renewing within renewalAlertDays (anyone who can see the customer)
 *   task        Lead tasks due within taskReminderDaysBefore days or overdue (owner); others' overdue tasks (managers)
 * Scoped like leads: you only get alerts for records you can see.
 */

const DAY = 86_400_000
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function lastActivityAt(leadId: string): string | null {
  let last: string | null = null
  for (const a of activities) if (a.leadId === leadId && (!last || a.at > last)) last = a.at
  return last
}

export function alertsFor(user: User, now = new Date()): Alert[] {
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') return []
  const manager = scope === 'team' || scope === 'full'
  const rules = automationRules
  const today = startOfDay(now)
  const leads = visibleLeads(user)
  const out: Alert[] = []

  for (const l of leads) {
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
          body: `${statusLabelOf(l.status)} with no activity for ${plural(Math.floor(idle / DAY), 'day')} · ${ownerName(l.ownerId)}`,
          leadId: l.id,
          link: leadPath(l.id),
          at: new Date(new Date(ref).getTime() + rules.stalledInterestedDays * DAY).toISOString(),
        })
      }
    }

    // (c) Follow-ups due today or overdue.
    if (l.nextFollowUpDate && !isClosedStatus(l.status)) {
      const due = parseISO(l.nextFollowUpDate)
      const late = differenceInCalendarDays(today, due)
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

  // (e) Tasks: "the owner is reminded one day before the due date."
  const byId = new Map<string, Lead>(leads.map((l) => [l.id, l]))
  for (const t of tasks) {
    const lead = byId.get(t.leadId)
    if (!lead || t.status === 'Done') continue
    const left = differenceInCalendarDays(parseISO(t.dueDate), today)
    const mine = t.ownerId === user.id
    if ((mine && left <= rules.taskReminderDaysBefore) || (manager && !mine && left < 0)) {
      out.push({
        id: `task:${t.id}`,
        type: 'task',
        severity: left < 0 ? 'danger' : left === 0 ? 'warning' : 'info',
        title: t.title,
        body:
          `${lead.company} · ` +
          (left < 0 ? `${plural(-left, 'day')} overdue` : left === 0 ? 'Due today' : `Due in ${plural(left, 'day')}`) +
          (mine ? '' : ` · ${ownerName(t.ownerId)}`),
        leadId: lead.id,
        link: leadPath(lead.id),
        at: new Date(parseISO(t.dueDate).getTime() - rules.taskReminderDaysBefore * DAY).toISOString(),
      })
    }
  }

  // (d) Renewals: "Alert 30 days before the renewal date."
  const team = teamIdsFor(user, users, departments)
  for (const c of contracts) {
    if (c.status === 'Cancelled') continue
    const customer = customers.find((x) => x.id === c.customerId)
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

  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export async function getAlerts(user: User): Promise<Alert[]> {
  return delay(alertsFor(user))
}
