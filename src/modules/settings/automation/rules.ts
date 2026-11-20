import { z } from 'zod'
import type { AutomationRules } from '@/modules/settings/types'
import { plural } from '@/modules/settings/lists/shared'

/** Mirrors RULE_LIMITS on the server (PUT /settings/automation): [min, max], whole numbers. */
export const RULE_LIMITS: Record<keyof AutomationRules, [number, number]> = {
  noContactReminderDays: [1, 30],
  noResponseFollowUpDays: [1, 30],
  attemptsBeforeCold: [1, 20],
  stalledInterestedDays: [1, 60],
  lostReopenDays: [7, 730],
  renewalAlertDays: [1, 180],
  taskReminderDaysBefore: [0, 30],
  eventReminderHours: [0, 336],
  eventFollowUpDays: [0, 60],
}

const rule = (key: keyof AutomationRules) => {
  const [min, max] = RULE_LIMITS[key]
  return z
    .number({ invalid_type_error: 'Enter a number.', required_error: 'Enter a number.' })
    .int('Whole numbers only.')
    .min(min, `Use ${min} or more.`)
    .max(max, `Use ${max} or less.`)
}

export const automationSchema = z.object({
  noContactReminderDays: rule('noContactReminderDays'),
  noResponseFollowUpDays: rule('noResponseFollowUpDays'),
  attemptsBeforeCold: rule('attemptsBeforeCold'),
  stalledInterestedDays: rule('stalledInterestedDays'),
  lostReopenDays: rule('lostReopenDays'),
  renewalAlertDays: rule('renewalAlertDays'),
  taskReminderDaysBefore: rule('taskReminderDaysBefore'),
  eventReminderHours: rule('eventReminderHours'),
  eventFollowUpDays: rule('eventFollowUpDays'),
}) satisfies z.ZodType<AutomationRules>

/** Status labels come from the lookups so renamed statuses read correctly. */
export type LabelOf = (statusKey: string) => string

export interface RuleDef {
  key: keyof AutomationRules
  label: string
  /** Unit after the stepper, for a value. */
  unit: (n: number) => string
  /** What happens, in one line, with the current value. */
  explain: (n: number, status: LabelOf) => string
  step?: number
}

export interface RuleGroup {
  id: 'journey' | 'customers' | 'tasks' | 'events'
  title: string
  description: string
  rules: RuleDef[]
}

const days = (n: number) => (n === 1 ? 'day' : 'days')

export const RULE_GROUPS: RuleGroup[] = [
  {
    id: 'journey',
    title: 'Lead journey',
    description: 'Reminders and automatic moves while a lead is being worked.',
    rules: [
      {
        key: 'noContactReminderDays',
        label: 'No-contact reminder',
        unit: days,
        explain: (n, s) => `Remind the owner when a “${s('New')}” lead has had no contact for ${plural(n, 'day')}.`,
      },
      {
        key: 'noResponseFollowUpDays',
        label: `Follow-up gap after no response`,
        unit: days,
        explain: (n, s) => `When a lead moves to “${s('No response')}”, the next follow-up is set ${plural(n, 'day')} later.`,
      },
      {
        key: 'attemptsBeforeCold',
        label: 'Attempts before Cold',
        unit: (n) => (n === 1 ? 'attempt' : 'attempts'),
        explain: (n, s) => `After ${plural(n, 'attempt')} with no reply, the lead moves to “${s('Cold')}” and automatic follow-ups stop.`,
      },
      {
        key: 'stalledInterestedDays',
        label: 'Stalled Interested alert',
        unit: days,
        explain: (n, s) => `Alert the sales manager when an “${s('Interested')}” lead has had no activity for ${plural(n, 'day')}.`,
      },
      {
        key: 'lostReopenDays',
        label: 'Lost auto-reopen',
        unit: days,
        step: 5,
        explain: (n, s) => `“${s('Lost')}” and “${s('Not interested')}” leads come back to their owner for another try after ${plural(n, 'day')}.`,
      },
    ],
  },
  {
    id: 'customers',
    title: 'Customers',
    description: 'Keeping contracts from lapsing.',
    rules: [
      {
        key: 'renewalAlertDays',
        label: 'Renewal alert',
        unit: (n) => `${days(n)} before`,
        explain: (n) => `Alert the account owner ${plural(n, 'day')} before a contract’s renewal date.`,
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Nudges for task owners.',
    rules: [
      {
        key: 'taskReminderDaysBefore',
        label: 'Task reminder',
        unit: (n) => `${days(n)} before due`,
        explain: (n) => (n === 0 ? 'Remind the task owner on the due date.' : `Remind the task owner ${plural(n, 'day')} before the due date.`),
      },
    ],
  },
  {
    id: 'events',
    title: 'Events',
    description: 'Defaults for new events (each event can change them).',
    rules: [
      {
        key: 'eventReminderHours',
        label: 'Attendee reminder',
        unit: (n) => (n === 1 ? 'hour before' : 'hours before'),
        explain: (n) => (n === 0 ? 'No reminder email before events.' : `Email registered attendees ${plural(n, 'hour')} before the event starts (once each).`),
      },
      {
        key: 'eventFollowUpDays',
        label: 'Post-event follow-up',
        unit: (n) => `${days(n)} after`,
        explain: (n) => `When an event is completed, each lead from it gets a follow-up task for its owner, due ${plural(n, 'day')} later.`,
      },
    ],
  },
]
