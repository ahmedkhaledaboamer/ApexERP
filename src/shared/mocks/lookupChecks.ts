import type { ListOption, StatusOption } from '@/modules/settings/types'
import { automationRulesFor, lookupsFor } from '@/shared/mocks/data/lookups'

/**
 * Server-side checks and labels over the live lookup store (Settings > Fixed lists).
 * Lists are per company: every helper takes the company id first (`tenantOf(user)`, or the
 * record's `companyId`), so one company's keys never validate or label another's records.
 * Every create / update / import validates status, source, industry, sub-industry and loss
 * reason against the ACTIVE items; unchanged values on existing records are let through so a
 * deactivated value never blocks an unrelated edit.
 */

const byOrder = <T extends ListOption>(list: T[]) => [...list].sort((a, b) => a.order - b.order)
const isActiveIn = (list: ListOption[], key: string | null | undefined) => !!key && list.some((i) => i.key === key && i.active)
const labelIn = (list: ListOption[], key: string | null | undefined) => (key && list.find((i) => i.key === key)?.label) || key || ''

export const isActiveStatus = (companyId: string, key: string | null | undefined) => isActiveIn(lookupsFor(companyId).statuses, key)
export const isActiveSource = (companyId: string, key: string | null | undefined) => isActiveIn(lookupsFor(companyId).sources, key)
export const isActiveIndustry = (companyId: string, key: string | null | undefined) => isActiveIn(lookupsFor(companyId).industries, key)
/**
 * A loss reason is an active list key, optionally followed by " — free-text details". Items hidden
 * from pickers (the system "Imported - no reason recorded") are rejected here: only the import
 * path may set them (see isImportOnlyLossReason).
 */
export const isActiveLossReason = (companyId: string, value: string | null | undefined) =>
  !!value &&
  lookupsFor(companyId).lossReasons.some((r) => r.active && !r.hiddenFromPickers && (value === r.key || value.startsWith(`${r.key} — `)))

/** The import path may also set protected system loss reasons that pickers hide. */
export const isImportOnlyLossReason = (companyId: string, key: string) =>
  lookupsFor(companyId).lossReasons.some((r) => r.key === key && r.system && r.hiddenFromPickers)

export function isActiveSubIndustry(companyId: string, industry: string, sub: string | null | undefined): boolean {
  const ind = lookupsFor(companyId).industries.find((i) => i.key === industry)
  return !!ind && isActiveIn(ind.subIndustries, sub)
}

export const statusLabelOf = (companyId: string, key: string) => labelIn(lookupsFor(companyId).statuses, key)
export const sourceLabelOf = (companyId: string, key: string) => labelIn(lookupsFor(companyId).sources, key)
export const industryLabelOf = (companyId: string, key: string) => labelIn(lookupsFor(companyId).industries, key)
export function subIndustryLabelOf(companyId: string, industry: string, key: string): string {
  return labelIn(lookupsFor(companyId).industries.find((i) => i.key === industry)?.subIndustries ?? [], key)
}

/** All statuses in configured order (inactive ones included, for reports over old records). */
export const orderedStatuses = (companyId: string): StatusOption[] => byOrder(lookupsFor(companyId).statuses)
export const orderedSources = (companyId: string): ListOption[] => byOrder(lookupsFor(companyId).sources)
export const orderedIndustries = (companyId: string) => byOrder(lookupsFor(companyId).industries)

/** Where leads go after too many unanswered attempts: the first active `cold` status, else the first active `parked` one. */
export function coldStatusKey(companyId: string): string | undefined {
  const list = byOrder(lookupsFor(companyId).statuses).filter((s) => s.active)
  return (list.find((s) => s.type === 'cold') ?? list.find((s) => s.type === 'parked'))?.key
}

/**
 * Lost / Not interested leads closed at least `lostReopenDays` ago may be reopened. Uses the
 * lead's own company's statuses and automation rules.
 */
export function isReopenEligible(companyId: string, lead: { status: string; stageChangedAt: string }, now = Date.now()): boolean {
  const s = lookupsFor(companyId).statuses.find((x) => x.key === lead.status)
  if (s?.type !== 'lost') return false
  return now - new Date(lead.stageChangedAt).getTime() >= automationRulesFor(companyId).lostReopenDays * 86_400_000
}

export const DAY_MS = 86_400_000
