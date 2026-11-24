import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Reports › Reports hub preferences, one row per user and company (docs/API.md › Reports › Reports hub;
 * DB-ALIGNMENT R-H1): favourite report ids (catalog ids, not company records) and the recently viewed list.
 */
export interface HubPrefsRecord {
  userId: string
  favourites: string[]
  recent: { reportId: string; at: string }[]
}

export const reportsHubPrefs = registerArray<Tenant<HubPrefsRecord>>('reports.hubPrefs', [])

export const MAX_RECENT = 8
