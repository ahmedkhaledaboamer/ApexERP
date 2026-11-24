import type { User } from '@/shared/types'
import type { HubReport, ReportsHub } from '@/modules/reports/hub/types'
import { HUB_CATALOG, hubEntryVisible } from '@/modules/reports/hub/catalog'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { MAX_RECENT, reportsHubPrefs, type HubPrefsRecord } from '@/shared/mocks/data/reportsHub'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { companyModules } from './billing'

/**
 * Reports › Reports hub (docs/API.md › Reports › Reports hub). The catalog (modules/reports/hub/catalog.ts) filtered
 * to what the caller's role and the company's plan can open, plus per-user favourites and recently viewed. Reports
 * hidden (Employee) → 403. A report id outside the catalog, or one the caller can't open, answers 404 (same body).
 * Prefs are keyed by company + user: a user's favourites never show in another company or for another user.
 */

const FORBIDDEN = 'Reports aren’t part of your role.'

function visibleIds(user: User): Set<string> {
  if (scopeOf(user.role, 'reports') === 'hidden') throw new CodedApiError(FORBIDDEN, 403, 'forbidden')
  const modules = companyModules(tenantOf(user))
  return new Set(HUB_CATALOG.filter((e) => hubEntryVisible(e, user.role, modules)).map((e) => e.id))
}

function prefsOf(user: User, create: boolean): Tenant<HubPrefsRecord> | null {
  const co = tenantOf(user)
  let row = reportsHubPrefs.find((p) => p.companyId === co && p.userId === user.id) ?? null
  if (!row && create) {
    row = { companyId: co, userId: user.id, favourites: [], recent: [] }
    reportsHubPrefs.push(row)
  }
  return row
}

function hubOf(user: User, ids: Set<string>): ReportsHub {
  const prefs = prefsOf(user, false)
  const favourites = (prefs?.favourites ?? []).filter((id) => ids.has(id))
  const recent = (prefs?.recent ?? []).filter((r) => ids.has(r.reportId)).slice(0, MAX_RECENT)
  const salesReports = scopeOf(user.role, 'sales') !== 'hidden'
  const reports: HubReport[] = HUB_CATALOG.filter((e) => ids.has(e.id)).map((e) => ({
    id: e.id,
    area: e.area,
    title: e.title,
    description: e.description,
    path: e.path,
    schedule: e.schedule ?? null,
    favourite: favourites.includes(e.id),
    lastViewedAt: recent.find((r) => r.reportId === e.id)?.at ?? null,
  }))
  return { reports, favourites, recent, canSchedule: salesReports && reports.some((r) => r.schedule !== null) }
}

export function getReportsHub(user: User): ReportsHub {
  return hubOf(user, visibleIds(user))
}

function known(user: User, reportId: unknown): { ids: Set<string>; id: string } {
  const ids = visibleIds(user)
  if (typeof reportId !== 'string' || !ids.has(reportId)) throw new CodedApiError(NOT_FOUND, 404, 'not_found')
  return { ids, id: reportId }
}

export function addFavourite(user: User, reportId: string): ReportsHub {
  const { ids, id } = known(user, reportId)
  const prefs = prefsOf(user, true)!
  if (!prefs.favourites.includes(id)) prefs.favourites.push(id)
  return hubOf(user, ids)
}

export function removeFavourite(user: User, reportId: string): ReportsHub {
  const { ids, id } = known(user, reportId)
  const prefs = prefsOf(user, false)
  if (prefs) prefs.favourites = prefs.favourites.filter((x) => x !== id)
  return hubOf(user, ids)
}

export function recordView(user: User, input: { reportId?: unknown } | null): ReportsHub {
  const { ids, id } = known(user, input?.reportId)
  const prefs = prefsOf(user, true)!
  prefs.recent = [{ reportId: id, at: nowIso() }, ...prefs.recent.filter((r) => r.reportId !== id)].slice(0, MAX_RECENT)
  return hubOf(user, ids)
}
