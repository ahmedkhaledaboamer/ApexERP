import {
  DEFAULT_AUTOMATION_RULES,
  type AutomationRules,
  type ListOption,
  type Lookups,
  type StatusOption,
} from '@/modules/settings/types'
import { SYSTEM_STATUS } from '@/shared/lib/systemStatus'
import { IMPORTED_LOSS_REASON } from '@/modules/leads/lossReason'

/**
 * Mutable lookup store for the mock API (Settings > Fixed lists). Keys of the original
 * statuses/sources/industries equal their labels so existing records keep working.
 */

const opt = (label: string, order: number): ListOption => ({ key: label, label, active: true, order })

const STATUS_SEED: Omit<StatusOption, 'order' | 'active'>[] = [
  { key: 'New', label: 'New', probability: 10, kind: 'open', requires: 'none', tone: 'blue', color: '#3b82f6', system: true },
  { key: 'Contacted', label: 'Contacted', probability: 20, kind: 'open', requires: 'none', tone: 'sky', color: '#0ea5e9', system: true },
  { key: 'No response', label: 'No response', probability: 10, kind: 'open', requires: 'none', tone: 'amber', color: '#f59e0b', system: true },
  { key: 'Call later', label: 'Call later', probability: 15, kind: 'open', requires: 'none', tone: 'amber', color: '#fbbf24', system: true },
  { key: 'Interested', label: 'Interested', probability: 40, kind: 'open', requires: 'next-step', tone: 'brand', color: '#8b5cf6', system: true },
  { key: 'Meeting', label: 'Meeting', probability: 50, kind: 'open', requires: 'next-step', tone: 'pink', color: '#ec4899', system: true },
  { key: 'Proposal', label: 'Proposal', probability: 70, kind: 'open', requires: 'none', tone: 'teal', color: '#14b8a6', system: true },
  { key: 'Cold', label: 'Cold', probability: 5, kind: 'parked', requires: 'none', tone: 'neutral', color: '#94a3b8', system: true },
  { key: 'Won', label: 'Won', probability: 100, kind: 'won', requires: 'convert', tone: 'green', color: '#10b981', system: true },
  { key: 'Lost', label: 'Lost', probability: 0, kind: 'lost', requires: 'loss-reason', tone: 'red', color: '#ef4444', system: true },
  { key: 'Not interested', label: 'Not interested', probability: 0, kind: 'lost', requires: 'loss-reason', tone: 'neutral', color: '#a1a1ab', system: true },
]

const INDUSTRY_SEED: Record<string, string[]> = {
  Healthcare: ['Clinics', 'Hospitals', 'Pharmacies', 'Diagnostics'],
  'Real Estate': ['Brokerage', 'Developers', 'Property Management'],
  Hospitality: ['Hotels', 'Restaurants', 'Travel Agencies'],
  Retail: ['Fashion', 'Electronics', 'Grocery'],
  Logistics: ['Freight', 'Last Mile', 'Warehousing'],
  Education: ['Schools', 'Universities', 'Training Centers'],
  'Financial Services': ['Banking', 'Insurance', 'Exchange Houses'],
  Construction: ['Contracting', 'MEP', 'Interior Fit-out'],
  Automotive: ['Dealerships', 'Service Centers', 'Rentals'],
  'Professional Services': ['Legal', 'Consulting', 'Accounting Firms'],
}

export const lookups: Lookups = {
  statuses: STATUS_SEED.map((s, i) => ({ ...s, active: true, order: i })),
  sources: ['Website', 'Directory', 'Online Research', 'LinkedIn', 'Referral', 'Event', 'Cold Outreach'].map(opt),
  industries: Object.entries(INDUSTRY_SEED).map(([industry, subs], i) => ({
    ...opt(industry, i),
    subIndustries: subs.map(opt),
  })),
  lossReasons: [
    'Budget too low',
    'Chose a competitor',
    'No decision maker reached',
    'Timing — not a priority',
    'Built in-house',
    'Unresponsive after proposal',
  ]
    .map(opt)
    .concat({
      // Protected system item, pinned last: set by Excel import on Lost / Not interested rows.
      key: IMPORTED_LOSS_REASON,
      label: 'Imported - no reason recorded',
      active: true,
      order: 6,
      system: true,
      hiddenFromPickers: true,
    }),
  tags: ['Hot', 'Arabic support', 'Government', 'Free zone', 'Partner referral', 'Enterprise'].map(opt),
  serviceCategories: ['Chatbot', 'CRM Automation', 'OCR', 'Dashboards', 'System Integration', 'Website & Apps'].map(opt),
}

export const automationRules: AutomationRules = { ...DEFAULT_AUTOMATION_RULES }

/** Built-in status keys: one copy, shared with the client (src/shared/lib/systemStatus.ts). */
export { SYSTEM_STATUS }

/* ---------- Server-side helpers so mock business logic never hardcodes status names ---------- */

export function statusOf(key: string): StatusOption | undefined {
  return lookups.statuses.find((s) => s.key === key)
}

/** Status keys whose leads are out of the active pipeline (won, lost, parked). */
export function closedStatusKeys(): string[] {
  return lookups.statuses.filter((s) => s.kind !== 'open').map((s) => s.key)
}

export function isClosedStatus(key: string): boolean {
  return (statusOf(key)?.kind ?? 'open') !== 'open'
}

export function isWonStatus(key: string): boolean {
  return statusOf(key)?.kind === 'won'
}

export function isLostStatus(key: string): boolean {
  return statusOf(key)?.kind === 'lost'
}

export function probabilityOf(key: string): number {
  return statusOf(key)?.probability ?? 0
}

/** The status key a kind maps to by default (e.g. where "Cold" leads go). */
export function firstStatusOfKind(kind: StatusOption['kind']): string | undefined {
  return [...lookups.statuses].sort((a, b) => a.order - b.order).find((s) => s.kind === kind && s.active)?.key
}
