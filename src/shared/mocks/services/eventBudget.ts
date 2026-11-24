import type { User } from '@/shared/types'
import type { BudgetLine, BudgetLineInput, EventBudget } from '@/modules/events/types'
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABEL } from '@/modules/events/types'
import { campaignCosts, campaigns, nextMarketingId } from '@/shared/mocks/data/marketing'
import { eventBudgetLines, eventCostLinks, type BudgetLineRecord, type EventRecord } from '@/shared/mocks/data/events'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import { findInTenant, type Tenant } from '@/shared/mocks/tenant'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { planAt } from '@/shared/mocks/data/plans'
import { effectiveModules } from '@/shared/mocks/data/platform'
import { currencyOf, eventFor, log } from '@/shared/mocks/services/events'
import { canManageEvent } from '@/shared/mocks/selectors/events'
import { logisticsSourceOf } from '@/shared/mocks/data/eventLogistics'
import { sponsorshipIncomeOf } from '@/shared/mocks/data/eventSponsors'
import { lineVendorId, lineVendorView, vendorsToRateOf } from '@/shared/mocks/services/eventLibraryCore'
import { CodedApiError } from '@/shared/mocks/tenant'
import { scopeOf } from '@/shared/lib/permissions'
import { billedByLine, lineCostOf, type LineBilled } from './financeEventCosts'

/**
 * Budget lines, the campaign link and ROI (docs/API.md › Events › Budget & ROI).
 *  - Lines: category (venue / booth, travel, printing, sponsorship, catering, marketing, other), planned,
 *    actual, note. Totals are compared with the event's budget. Read: anyone who sees the event; write:
 *    marketing full or the event owner (the *manage* right).
 *  - Campaign link: the event may link to a Marketing campaign of the company (plan module `marketing`);
 *    every line's ACTUAL amount (> 0) is posted as a campaign cost entry, once per line and campaign
 *    (event_cost_links), and kept in step when the line changes (idempotent, like synced ad costs). A
 *    line set to 0 or deleted removes its entry. Unlinking (or linking another campaign) keeps the
 *    entries already posted (history); the new campaign gets its own.
 *  - Stats (GET /events/:id/stats) use the lines' actual total as the actual cost when there are lines:
 *    ROI = (won value − actual cost) / actual cost; cost per won deal = actual cost / deals won.
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
let seq = 0
const nextId = () => `EBL-${nowMs().toString(36)}${(++seq).toString(36)}`
const round2 = (n: number) => Math.round(n * 100) / 100

/** The company's plan (± platform overrides) includes module. */
function marketingIn(companyId: string): boolean {
  const sub = subscriptionOf(companyId)
  return !!sub && effectiveModules(companyId, planAt(sub.planId, sub.planVersion).modules).includes('marketing')
}

const linesOf = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) =>
  eventBudgetLines.filter((l) => l.eventId === e.id && l.companyId === e.companyId).sort((a, b) => BUDGET_CATEGORIES.indexOf(a.category) - BUDGET_CATEGORIES.indexOf(b.category) || a.createdAt.localeCompare(b.createdAt))

function lineView(e: Tenant<EventRecord>, l: Tenant<BudgetLineRecord>, billed: LineBilled | undefined, showBills: boolean): BudgetLine {
  const posted = !!e.campaignId && eventCostLinks.some((k) => k.companyId === e.companyId && k.lineId === l.id && k.campaignId === e.campaignId)
  return {
    id: l.id,
    category: l.category,
    note: l.note,
    planned: l.planned,
    actual: l.actual,
    posted,
    source: logisticsSourceOf(e.companyId, l.id),
    ...lineVendorView(e.companyId, l.vendorId),
    billed: billed?.billed ?? 0,
    bills: showBills ? (billed?.bills ?? []).map((b) => ({ ...b })) : [],
  }
}

export function budgetOf(e: Tenant<EventRecord>, viewer: User): EventBudget {
  const lines = linesOf(e)
  // Billed cost (SEAM with Accounts & finance › Bills): amounts for every budget viewer; bill links only for users who
  // can open bills (accounting full / view).
  const billed = billedByLine(e.companyId, e.id)
  const showBills = scopeOf(viewer.role, 'accounting') !== 'hidden'
  const campaign = e.campaignId ? campaigns.find((c) => c.id === e.campaignId && c.companyId === e.companyId) : undefined
  const actualTotal = round2(lines.reduce((s, l) => s + l.actual, 0))
  const postedTotal = campaign
    ? round2(
        eventCostLinks
          .filter((k) => k.companyId === e.companyId && k.eventId === e.id && k.campaignId === campaign.id)
          .reduce((s, k) => s + (campaignCosts.find((c) => c.id === k.costId && c.companyId === e.companyId)?.amount ?? 0), 0),
      )
    : 0
  return {
    lines: lines.map((l) => lineView(e, l, billed.perLine.get(l.id), showBills)),
    billedTotal: round2(lines.reduce((s, l) => s + (billed.perLine.get(l.id)?.billed ?? 0), 0)),
    unlinkedBilled: billed.unlinked,
    costTotal: round2(lines.reduce((s, l) => s + lineCostOf(l.actual, billed.perLine.get(l.id)?.billed ?? 0), 0)),
    plannedTotal: round2(lines.reduce((s, l) => s + l.planned, 0)),
    actualTotal,
    budget: e.budget,
    remaining: e.budget === null ? null : round2(e.budget - actualTotal),
    currency: currencyOf(e.companyId),
    campaignId: campaign?.id ?? null,
    campaignName: campaign?.name ?? null,
    postedTotal,
    sponsorshipIncome: e.isOrganizer ? sponsorshipIncomeOf(e).total : null,
    vendorsToRate: vendorsToRateOf(e),
    canManage: canManageEvent(viewer, e),
  }
}

/**
 * Posts / updates the linked campaign's cost entries from the lines' actual amounts (idempotent):
 * one entry per (line, campaign); its amount follows the line; 0 or a deleted line removes it.
 */
export function syncCampaignCosts(e: Tenant<EventRecord>): void {
  if (!e.campaignId) return
  const co = e.companyId
  const campaignId = e.campaignId
  if (!campaigns.some((c) => c.id === campaignId && c.companyId === co)) return
  const lines = linesOf(e)
  for (let i = eventCostLinks.length - 1; i >= 0; i--) {
    const k = eventCostLinks[i]
    if (k.companyId !== co || k.eventId !== e.id || k.campaignId !== campaignId) continue
    const line = lines.find((l) => l.id === k.lineId)
    if (line && line.actual > 0) continue
    const ci = campaignCosts.findIndex((c) => c.id === k.costId && c.companyId === co)
    if (ci >= 0) campaignCosts.splice(ci, 1)
    eventCostLinks.splice(i, 1)
  }
  for (const l of lines) {
    if (l.actual <= 0) continue
    const note = `Event ${e.name}: ${BUDGET_CATEGORY_LABEL[l.category]}${l.note ? ` (${l.note})` : ''}`.slice(0, 255)
    const link = eventCostLinks.find((k) => k.companyId === co && k.lineId === l.id && k.campaignId === campaignId)
    const cost = link ? campaignCosts.find((c) => c.id === link.costId && c.companyId === co) : undefined
    if (cost) {
      cost.amount = round2(l.actual)
      cost.note = note
      continue
    }
    const costId = nextMarketingId('CC')
    campaignCosts.push({ companyId: co, id: costId, campaignId, date: companyDayOf(co).today, amount: round2(l.actual), note, createdAt: nowIso() })
    if (link) link.costId = costId
    else eventCostLinks.push({ companyId: co, eventId: e.id, lineId: l.id, campaignId, costId })
  }
}

export async function getBudget(user: User, id: string): Promise<EventBudget> {
  const e = await eventFor(user, id)
  return delay(budgetOf(e, user))
}

function amount(v: unknown, label: string): number | string {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return `${label} must be 0 or a positive amount.`
  return round2(n)
}

function cleanLine(input: Partial<BudgetLineInput> | null, existing?: BudgetLineRecord): Pick<BudgetLineRecord, 'category' | 'note' | 'planned' | 'actual'> | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<BudgetLineInput>
  const category = v.category as BudgetLineRecord['category']
  if (!BUDGET_CATEGORIES.includes(category)) return `Category must be one of: ${BUDGET_CATEGORIES.join(', ')}.`
  const note = str(v.note)
  if (note.length > 255) return 'Keep the note under 255 characters.'
  const planned = amount(v.planned, 'Planned')
  if (typeof planned === 'string') return planned
  const actual = amount(v.actual, 'Actual')
  if (typeof actual === 'string') return actual
  return { category, note, planned, actual }
}

export async function addBudgetLine(user: User, id: string, input: Partial<BudgetLineInput> | null): Promise<EventBudget> {
  const e = await eventFor(user, id, 'manage')
  const clean = cleanLine(input)
  if (typeof clean === 'string') return fail(clean, 422)
  const vendorId = lineVendorId(e.companyId, input)
  const now = nowIso()
  eventBudgetLines.push({ companyId: e.companyId, id: nextId(), eventId: e.id, ...clean, vendorId, createdAt: now, updatedAt: now })
  syncCampaignCosts(e)
  log(e, user, `Added a ${BUDGET_CATEGORY_LABEL[clean.category].toLowerCase()} budget line`)
  return delay(budgetOf(e, user))
}

async function lineFor(user: User, e: Tenant<EventRecord>, lineId: string): Promise<Tenant<BudgetLineRecord>> {
  const l = findInTenant(eventBudgetLines, user, (x) => x.id === lineId && x.eventId === e.id)
  if (!l) return fail('That budget line doesn’t exist.', 404)
  return l
}

/** Lines kept in step by a trip or a shipment change from Travel & logistics only (409 `managed_by_logistics`). */
function assertManualLine(l: Tenant<BudgetLineRecord>): void {
  const src = logisticsSourceOf(l.companyId, l.id)
  if (src) throw new CodedApiError(`This line follows a ${src.kind} in Travel & logistics: change the ${src.kind} there.`, 409, 'managed_by_logistics')
}

export async function updateBudgetLine(user: User, id: string, lineId: string, input: Partial<BudgetLineInput> | null): Promise<EventBudget> {
  const e = await eventFor(user, id, 'manage')
  const l = await lineFor(user, e, lineId)
  assertManualLine(l)
  const clean = cleanLine(input, l)
  if (typeof clean === 'string') return fail(clean, 422)
  const vendorId = lineVendorId(e.companyId, input, l.vendorId)
  Object.assign(l, clean, { vendorId, updatedAt: nowIso() })
  syncCampaignCosts(e)
  return delay(budgetOf(e, user))
}

export async function removeBudgetLine(user: User, id: string, lineId: string): Promise<EventBudget> {
  const e = await eventFor(user, id, 'manage')
  const l = await lineFor(user, e, lineId)
  assertManualLine(l)
  eventBudgetLines.splice(eventBudgetLines.indexOf(l), 1)
  syncCampaignCosts(e)
  log(e, user, `Removed a ${BUDGET_CATEGORY_LABEL[l.category].toLowerCase()} budget line`)
  return delay(budgetOf(e, user))
}

/** PUT /events/:id/campaign { campaign_id | null } — link (and post the actual costs) or unlink (history kept). */
export async function linkCampaign(user: User, id: string, input: { campaignId?: unknown } | null): Promise<EventBudget> {
  const e = await eventFor(user, id, 'manage')
  const campaignId = str(input?.campaignId) || null
  if (campaignId) {
    if (!marketingIn(e.companyId)) return fail('Your plan doesn’t include Marketing, so events can’t link to campaigns.', 422)
    const c = campaigns.find((x) => x.id === campaignId && x.companyId === e.companyId)
    if (!c) return fail('That campaign doesn’t exist.', 422)
    if (e.campaignId !== c.id) log(e, user, `Linked to the campaign ${c.name}`)
    e.campaignId = c.id
    syncCampaignCosts(e)
  } else if (e.campaignId) {
    log(e, user, 'Unlinked the campaign (its posted costs stay)')
    e.campaignId = null
  }
  e.updatedAt = nowIso()
  return delay(budgetOf(e, user))
}
