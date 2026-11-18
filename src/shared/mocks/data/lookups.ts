import {
  DEFAULT_AUTOMATION_RULES,
  type AutomationRules,
  type ListOption,
  type Lookups,
  type StatusOption,
} from '@/modules/settings/types'
import { SYSTEM_STATUS } from '@/shared/lib/systemStatus'
import { isClosedType } from '@/shared/domain/leadStatus'
import { IMPORTED_LOSS_REASON } from '@/modules/leads/lossReason'
import { perTenant } from '@/shared/mocks/tenant'

/**
 * Mutable lookup store for the mock API (Settings > Fixed lists), one set per company. Keys of
 * the original statuses/sources/industries equal their labels so existing records keep working.
 * Every helper takes the company id: a status, source or industry only exists inside its company.
 */

const opt = (label: string, order: number): ListOption => ({ key: label, label, active: true, order })

const STATUS_SEED: Omit<StatusOption, 'order' | 'active'>[] = [
  { key: 'New', label: 'New', probability: 10, type: 'open', requiresNextStep: false, requiresLossReason: false, tone: 'blue', color: '#3b82f6', system: true },
  { key: 'Contacted', label: 'Contacted', probability: 20, type: 'open', requiresNextStep: false, requiresLossReason: false, tone: 'sky', color: '#0ea5e9', system: true },
  { key: 'No response', label: 'No response', probability: 10, type: 'open', requiresNextStep: false, requiresLossReason: false, tone: 'amber', color: '#f59e0b', system: true },
  { key: 'Call later', label: 'Call later', probability: 15, type: 'open', requiresNextStep: false, requiresLossReason: false, tone: 'amber', color: '#fbbf24', system: true },
  { key: 'Interested', label: 'Interested', probability: 40, type: 'open', requiresNextStep: true, requiresLossReason: false, tone: 'brand', color: '#8b5cf6', system: true },
  { key: 'Meeting', label: 'Meeting', probability: 50, type: 'open', requiresNextStep: true, requiresLossReason: false, tone: 'pink', color: '#ec4899', system: true },
  { key: 'Proposal', label: 'Proposal', probability: 70, type: 'open', requiresNextStep: false, requiresLossReason: false, tone: 'teal', color: '#14b8a6', system: true },
  { key: 'Cold', label: 'Cold', probability: 5, type: 'cold', requiresNextStep: false, requiresLossReason: false, tone: 'neutral', color: '#94a3b8', system: true },
  { key: 'Won', label: 'Won', probability: 100, type: 'won', requiresNextStep: false, requiresLossReason: false, tone: 'green', color: '#10b981', system: true },
  { key: 'Lost', label: 'Lost', probability: 0, type: 'lost', requiresNextStep: false, requiresLossReason: true, tone: 'red', color: '#ef4444', system: true },
  { key: 'Not interested', label: 'Not interested', probability: 0, type: 'lost', requiresNextStep: false, requiresLossReason: true, tone: 'neutral', color: '#a1a1ab', system: true },
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

const lossReasonsSeed = (labels: string[]): ListOption[] =>
  labels.map(opt).concat({
    // Protected system item, pinned last: set by Excel import on Lost / Not interested rows.
    key: IMPORTED_LOSS_REASON,
    label: 'Imported - no reason recorded',
    active: true,
    order: labels.length,
    system: true,
    hiddenFromPickers: true,
  })

const industriesSeed = (seed: Record<string, string[]>) =>
  Object.entries(seed).map(([industry, subs], i) => ({ ...opt(industry, i), subIndustries: subs.map(opt) }))

/** Crest Logistics (Saudi, second tenant): its own sources, industries, tags and service categories. */
const CREST_INDUSTRY_SEED: Record<string, string[]> = {
  Logistics: ['Freight Forwarding', 'Cold Chain', 'Warehousing', 'Last Mile'],
  Construction: ['Contracting', 'Infrastructure', 'MEP'],
  'Oil & Gas Services': ['Upstream Services', 'Downstream', 'Equipment Rental'],
  Healthcare: ['Hospitals', 'Medical Supply'],
  'Retail & FMCG': ['Supermarkets', 'Distribution'],
  Manufacturing: ['Food Processing', 'Packaging', 'Plastics'],
}

function seedLookups(companyId: string): Lookups {
  const statuses = STATUS_SEED.map((s, i) => ({ ...s, active: true, order: i }))
  if (companyId === 'co_crest') {
    return {
      statuses,
      // 'Event': the source of leads registered at an event (Events module).
      sources: ['Website', 'Referral', 'Tender Portal', 'LinkedIn', 'Trade Show', 'Event', 'Cold Outreach'].map(opt),
      industries: industriesSeed(CREST_INDUSTRY_SEED),
      lossReasons: lossReasonsSeed(['Price too high', 'Lost the tender', 'Chose a competitor', 'Project postponed', 'No budget this year']),
      tags: ['Hot', 'Tender', 'Government', 'Vision 2030', 'Key account'].map(opt),
      serviceCategories: ['Freight', 'Warehousing', 'Customs Clearance', 'Fleet & Tracking', 'Supply Chain Consulting'].map(opt),
    }
  }
  // Apex Aora (first tenant) and the defaults for any new tenant.
  return {
    statuses,
    sources: ['Website', 'Directory', 'Online Research', 'LinkedIn', 'Referral', 'Event', 'Cold Outreach'].map(opt),
    industries: industriesSeed(INDUSTRY_SEED),
    lossReasons: lossReasonsSeed([
      'Budget too low',
      'Chose a competitor',
      'No decision maker reached',
      'Timing — not a priority',
      'Built in-house',
      'Unresponsive after proposal',
    ]),
    tags: ['Hot', 'Arabic support', 'Government', 'Free zone', 'Partner referral', 'Enterprise'].map(opt),
    serviceCategories: ['Chatbot', 'CRM Automation', 'OCR', 'Dashboards', 'System Integration', 'Website & Apps'].map(opt),
  }
}

/** Fixed lists per company (Settings > Fixed lists). Uniqueness of keys/labels is per company. */
const lookupStore = perTenant(seedLookups, 'lookups')
const rulesStore = perTenant<AutomationRules>(() => ({ ...DEFAULT_AUTOMATION_RULES }), 'automationRules')

/** The company's lookups (mutable: settings edits change them in place). */
export function lookupsFor(companyId: string): Lookups {
  return lookupStore.get(companyId)
}

/** The company's automation rules (mutable). */
export function automationRulesFor(companyId: string): AutomationRules {
  return rulesStore.get(companyId)
}

/** Tests: back to seeded lookups and default rules for every company. */
export function resetLookups(): void {
  lookupStore.reset()
  rulesStore.reset()
}

/** Built-in status keys: one copy, shared with the client (src/shared/lib/systemStatus.ts). */
export { SYSTEM_STATUS }

/* ---------- Server-side helpers so mock business logic never hardcodes status names ---------- */

export function statusOf(companyId: string, key: string): StatusOption | undefined {
  return lookupsFor(companyId).statuses.find((s) => s.key === key)
}

/** Status keys whose leads are out of the active pipeline (won, lost, cold, parked). */
export function closedStatusKeys(companyId: string): string[] {
  return lookupsFor(companyId).statuses.filter((s) => isClosedType(s.type)).map((s) => s.key)
}

export function isClosedStatus(companyId: string, key: string): boolean {
  return isClosedType(statusOf(companyId, key)?.type ?? 'open')
}

export function isWonStatus(companyId: string, key: string): boolean {
  return statusOf(companyId, key)?.type === 'won'
}

/**
 * A status only the Won flow (POST /leads/:id/won) may set: type `won`.
 * The same rule as the client's `moveActionFor(...) === 'won'` (modules/leads/lib/transitions.ts).
 */
export function isWonFlowStatus(companyId: string, key: string): boolean {
  return statusOf(companyId, key)?.type === 'won'
}

/** The 422 message every non-Won-flow write answers when asked to set a Won-flow status. */
export const USE_WON_FLOW = 'Use the Won flow to win a lead: it creates the customer, contract and projects together (POST /leads/:id/won).'

export function isLostStatus(companyId: string, key: string): boolean {
  return statusOf(companyId, key)?.type === 'lost'
}

export function probabilityOf(companyId: string, key: string): number {
  return statusOf(companyId, key)?.probability ?? 0
}

/** The first active status of a type (e.g. where "cold" leads go). */
export function firstStatusOfType(companyId: string, type: StatusOption['type']): string | undefined {
  return [...lookupsFor(companyId).statuses].sort((a, b) => a.order - b.order).find((s) => s.type === type && s.active)?.key
}
