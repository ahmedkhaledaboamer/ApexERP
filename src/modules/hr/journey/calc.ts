import type { EmploymentType } from '@/modules/hr/types'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import { DEFAULT_PROBATION_DAYS, type DueAnchor, type ItemStatus, type JourneyKind, type JourneyProgress } from './types'

/**
 * Pure rules of HR › Onboarding & offboarding (shared by the mock API and the screens; unit-tested in
 * services/hrJourney.test.ts). Dates are company-local `yyyy-MM-dd` (the company's calendar day, never UTC).
 */

export interface MatchableTemplate {
  id: string
  kind: JourneyKind
  active: boolean
  departmentId: string | null
  employmentType: EmploymentType | null
  updatedAt: string
}

/**
 * The best template for an employee: active, same kind, and every targeting field either empty or equal to the
 * employee's. More specific wins (department match 2, employment type match 1); ties go to the most recently
 * updated, then the smallest id (deterministic).
 */
export function matchTemplate<T extends MatchableTemplate>(templates: readonly T[], kind: JourneyKind, employee: { departmentId: string | null; employmentType: EmploymentType }): T | null {
  let best: { t: T; score: number } | null = null
  for (const t of templates) {
    if (!t.active || t.kind !== kind) continue
    if (t.departmentId && t.departmentId !== employee.departmentId) continue
    if (t.employmentType && t.employmentType !== employee.employmentType) continue
    const score = (t.departmentId ? 2 : 0) + (t.employmentType ? 1 : 0)
    if (!best || score > best.score || (score === best.score && (t.updatedAt > best.t.updatedAt || (t.updatedAt === best.t.updatedAt && t.id < best.t.id)))) best = { t, score }
  }
  return best?.t ?? null
}

/**
 * Due date of an item: anchor date + offset days. `start` = hire date (onboarding) / exit date (offboarding; the
 * hire date stands in while no exit date is set). `probation_end` = the contract's probation end, or hire date +
 * DEFAULT_PROBATION_DAYS when there is none (a probation review at offset −10 lands on day 80).
 */
export function dueDateFor(anchor: DueAnchor, offsetDays: number, ctx: { kind: JourneyKind; hireDate: string; exitDate: string | null; probationEndDate: string | null }): string {
  const offset = Math.trunc(offsetDays) || 0
  if (anchor === 'probation_end') return addDaysIso(ctx.probationEndDate ?? addDaysIso(ctx.hireDate, DEFAULT_PROBATION_DAYS), offset)
  const base = ctx.kind === 'offboarding' ? ctx.exitDate ?? ctx.hireDate : ctx.hireDate
  return addDaysIso(base, offset)
}

/** Days from `today` to the due date (negative = overdue). */
export function daysLeft(dueDate: string, today: string): number {
  return daysBetweenIso(today, dueDate)
}

/** Overdue = still open and the due date is before the company's today. */
export function isOverdue(item: { status: ItemStatus; dueDate: string }, today: string): boolean {
  return item.status === 'open' && item.dueDate < today
}

export function progressOf(items: readonly { status: ItemStatus; required: boolean }[]): JourneyProgress {
  const counted = items.filter((i) => i.status !== 'skipped')
  const done = counted.filter((i) => i.status === 'done').length
  const req = counted.filter((i) => i.required)
  const requiredDone = req.filter((i) => i.status === 'done').length
  return { done, total: counted.length, requiredDone, requiredTotal: req.length, pct: counted.length ? Math.round((done / counted.length) * 100) : 100 }
}
