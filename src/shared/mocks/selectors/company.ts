import type { User } from '@/shared/types'
import { teamIdsFor } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { scoped, tenantOf } from '@/shared/mocks/tenant'
import { DEFAULT_WEEKEND } from '@/modules/won/plan'
import { companyDay, type CompanyDay } from '@/shared/lib/companyDay'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { now } from '@/shared/mocks/clock'

/**
 * Company-level facts the operations mocks (tasks, projects, Won, reports) need. Values come from
 * the company record, never hard-coded, so every tenant gets its own currency, weekend and people.
 */

/** The company's users (active and inactive). */
export function companyUsers(companyId: string): User[] {
  return users.filter((u) => u.companyId === companyId)
}

/** A user of the given company, or undefined (another company's user is "unknown"). */
export function userInCompany(companyId: string, id: string | null | undefined): User | undefined {
  return id ? users.find((u) => u.id === id && u.companyId === companyId) : undefined
}

/** The company's weekend days (0 = Sunday). */
export function companyWeekend(companyId: string): readonly number[] {
  return companyById(companyId)?.regional.weekend ?? DEFAULT_WEEKEND
}

/**
 * Today / this week in the company's timezone and week start (regional settings), at the mock
 * clock's simulated time. Every task date rule on the server (overdue, due this week, reminders)
 * reads this, so the API agrees with the task screens and with Dev › advance clock.
 */
export function companyDayOf(companyId: string, at: Date = now()): CompanyDay {
  const r = companyById(companyId)?.regional
  return companyDay({ timezone: r?.timezone ?? DEFAULT_REGION.timezone, weekStartsOn: r?.weekStartsOn ?? DEFAULT_REGION.weekStartsOn }, at)
}

/** The company a user id belongs to (ids are globally unique). */
export function companyOfUser(id: string): string | undefined {
  return users.find((u) => u.id === id)?.companyId
}

/** Team ids (direct reports + headed departments) computed over the user's own company only. */
export function companyTeamIds(user: User): string[] {
  return teamIdsFor(user, companyUsers(tenantOf(user)), scoped(departments, user))
}
