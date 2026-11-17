import { addMonths, format, isValid, parse } from 'date-fns'
import { TARGET_KEYS, type TargetKey, type TargetValues } from '@/modules/targets/types'
import { EVENTS_ENABLED } from '@/shared/lib/features'

/** Helpers shared by the targets page and its components. */

export const MONTH_FORMAT = 'yyyy-MM'

export function currentMonth(): string {
  return format(new Date(), MONTH_FORMAT)
}

export function parseMonth(month: string | null): Date | null {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null
  const d = parse(month, MONTH_FORMAT, new Date())
  return isValid(d) ? d : null
}

export function shiftMonth(month: string, by: number): string {
  return format(addMonths(parse(month, MONTH_FORMAT, new Date()), by), MONTH_FORMAT)
}

export function monthLabel(month: string): string {
  return format(parse(month, MONTH_FORMAT, new Date()), 'MMMM yyyy')
}

/** A target of 0 means "no target": the kind is left out of completion and shows "No target". */
export function hasTarget(target: number): boolean {
  return target > 0
}

/** actual / target as a percentage. Only meaningful when `hasTarget(target)`; 0 otherwise. */
export function pctOf(actual: number, target: number): number {
  if (!hasTarget(target)) return 0
  return (actual / target) * 100
}

/**
 * Whether a kind is counted at all. Events attended isn't until the Events module is enabled
 * (EVENTS_ENABLED): it shows "n/a" and is left out of completion and pace even with a target.
 */
export function isTracked(kind: TargetKey): boolean {
  return kind !== 'events' || EVENTS_ENABLED
}

/** Kinds that count towards completion: tracked and with a target. */
export function countedKinds(values: TargetValues): TargetKey[] {
  return TARGET_KEYS.filter((k) => isTracked(k) && hasTarget(values[k]))
}

/**
 * Overall completion: the average across counted kinds (tracked, with a target), each capped at
 * 100%, so one high-volume kind (calls) can't hide a missed one (proposals).
 */
export function completion(values: TargetValues, actuals: TargetValues): number {
  const kinds = countedKinds(values)
  if (!kinds.length) return 0
  return (kinds.reduce((s, k) => s + Math.min(1, actuals[k] / values[k]), 0) / kinds.length) * 100
}

export type PaceTone = 'green' | 'brand' | 'amber' | 'red' | 'neutral'

/**
 * Colour for a completion %. During the month it's judged against where the agent should be
 * by today (`elapsed` share of the month), so mid-month progress isn't all amber.
 */
export function paceTone(pct: number, elapsed: number): PaceTone {
  if (elapsed <= 0) return 'neutral'
  if (pct >= 100) return 'green'
  const vsPace = pct / Math.min(1, elapsed)
  if (vsPace >= 100) return 'green'
  if (vsPace >= 70) return 'brand'
  if (vsPace >= 40) return 'amber'
  return 'red'
}

export const TONE_BAR: Record<PaceTone, string> = {
  green: 'bg-success-500',
  brand: 'bg-brand-500',
  amber: 'bg-warning-500',
  red: 'bg-danger-500',
  neutral: 'bg-line-strong',
}

export const TONE_TEXT: Record<PaceTone, string> = {
  green: 'text-success-600 dark:text-success-500',
  brand: 'text-brand-700 dark:text-brand-300',
  amber: 'text-warning-700 dark:text-warning-500',
  red: 'text-danger-600 dark:text-danger-500',
  neutral: 'text-muted',
}

export const TONE_HEX: Record<PaceTone, string> = {
  green: '#10b981',
  brand: '#7c3aed',
  amber: '#f59e0b',
  red: '#ef4444',
  neutral: '#a1a1ab',
}

export function sumValues(rows: TargetValues[]): TargetValues {
  const out = Object.fromEntries(TARGET_KEYS.map((k) => [k, 0])) as TargetValues
  for (const r of rows) for (const k of TARGET_KEYS) out[k] += r[k]
  return out
}

/**
 * Team totals: an agent's actual counts towards a kind only when that agent has a target for
 * it, so "no target" kinds never inflate (or dilute) the team's completion.
 */
export function totalsOf(rows: { values: TargetValues; actuals: TargetValues }[]): { values: TargetValues; actuals: TargetValues } {
  const values = sumValues([])
  const actuals = sumValues([])
  for (const r of rows) {
    for (const k of TARGET_KEYS) {
      if (!hasTarget(r.values[k])) continue
      values[k] += r.values[k]
      actuals[k] += r.actuals[k]
    }
  }
  return { values, actuals }
}
