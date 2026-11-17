import type { ListOption, StatusOption } from '@/modules/settings/types'
import { automationRules, lookups, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'

/**
 * Server-side checks and labels over the live lookup store (Settings > Fixed lists).
 * Every create / update / import validates status, source, industry, sub-industry and loss
 * reason against the ACTIVE items; unchanged values on existing records are let through so a
 * deactivated value never blocks an unrelated edit.
 */

const byOrder = <T extends ListOption>(list: T[]) => [...list].sort((a, b) => a.order - b.order)
const isActiveIn = (list: ListOption[], key: string | null | undefined) => !!key && list.some((i) => i.key === key && i.active)
const labelIn = (list: ListOption[], key: string | null | undefined) => (key && list.find((i) => i.key === key)?.label) || key || ''

export const isActiveStatus = (key: string | null | undefined) => isActiveIn(lookups.statuses, key)
export const isActiveSource = (key: string | null | undefined) => isActiveIn(lookups.sources, key)
export const isActiveIndustry = (key: string | null | undefined) => isActiveIn(lookups.industries, key)
/**
 * A loss reason is an active list key, optionally followed by " — free-text details". Items hidden
 * from pickers (the system "Imported - no reason recorded") are rejected here: only the import
 * path may set them (see isImportOnlyLossReason).
 */
export const isActiveLossReason = (value: string | null | undefined) =>
  !!value &&
  lookups.lossReasons.some((r) => r.active && !r.hiddenFromPickers && (value === r.key || value.startsWith(`${r.key} — `)))

/** The import path may also set protected system loss reasons that pickers hide. */
export const isImportOnlyLossReason = (key: string) =>
  lookups.lossReasons.some((r) => r.key === key && r.system && r.hiddenFromPickers)

export function isActiveSubIndustry(industry: string, sub: string | null | undefined): boolean {
  const ind = lookups.industries.find((i) => i.key === industry)
  return !!ind && isActiveIn(ind.subIndustries, sub)
}

export const statusLabelOf = (key: string) => labelIn(lookups.statuses, key)
export const sourceLabelOf = (key: string) => labelIn(lookups.sources, key)
export const industryLabelOf = (key: string) => labelIn(lookups.industries, key)
export function subIndustryLabelOf(industry: string, key: string): string {
  return labelIn(lookups.industries.find((i) => i.key === industry)?.subIndustries ?? [], key)
}

/** All statuses in configured order (inactive ones included, for reports over old records). */
export const orderedStatuses = (): StatusOption[] => byOrder(lookups.statuses)
export const orderedSources = (): ListOption[] => byOrder(lookups.sources)
export const orderedIndustries = () => byOrder(lookups.industries)

/** Where leads go after too many unanswered attempts: Cold, or the first active parked status. */
export function coldStatusKey(): string | undefined {
  if (isActiveStatus(SYSTEM_STATUS.cold)) return SYSTEM_STATUS.cold
  return byOrder(lookups.statuses).find((s) => s.kind === 'parked' && s.active)?.key
}

/** Lost / Not interested leads closed at least `lostReopenDays` ago may be reopened. */
export function isReopenEligible(lead: { status: string; stageChangedAt: string }, now = Date.now()): boolean {
  const s = lookups.statuses.find((x) => x.key === lead.status)
  if (s?.kind !== 'lost') return false
  return now - new Date(lead.stageChangedAt).getTime() >= automationRules.lostReopenDays * 86_400_000
}

export const DAY_MS = 86_400_000
