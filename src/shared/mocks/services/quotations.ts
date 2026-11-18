import type { Lead, LeadStatus, User } from '@/shared/types'
import { recordLeadStatusChange } from '@/shared/mocks/data/leadStatusHistory'
import type {
  Quotation,
  QuotationDecision,
  QuotationInput,
  QuotationItem,
  QuotationItemInput,
  QuotationRecord,
  QuotationStatus,
  QuotationUpdateInput,
} from '@/modules/quotations/types'
import {
  DEFAULT_VALIDITY_DAYS,
  addDaysIso,
  computeTotals,
  fmtIn,
  todayIso,
} from '@/modules/quotations/lib/totals'
import { isOneOf, QUOTATION_AWAITING, QUOTATION_DECISIONS, QUOTATION_STATUS_LABEL } from '@/shared/domain/enums'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { nowMs } from '@/shared/mocks/clock'
import { can, inScope, scopeOf } from '@/shared/lib/permissions'
import { activities, leads } from '@/shared/mocks/db'
import { CREST_SEED_QUOTATION_BASE, quotations } from '@/shared/mocks/data/quotations'
import { services as catalog } from '@/shared/mocks/data/services'
import { companyById } from '@/shared/mocks/data/tenancy'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { statusOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { findInTenant, scoped, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, onLifecycleTick, recordUsage } from '@/shared/mocks/services/billing'
import { salesTeamOf, untenant } from '@/shared/mocks/services/leads'

/* ------------------------------------------------------------------------------------------
 * Quotations. Scope follows the lead: you see a quotation when you can see its lead, inside
 * your own company. Currency and VAT default to the company's regional settings.
 * ---------------------------------------------------------------------------------------- */

/** Currency and VAT defaults of a company (Settings > Company > Regional). */
function regionalDefaults(companyId: string): { currency: string; vatPct: number } {
  const regional = companyById(companyId)?.regional
  if (!regional) throw new Error(`Unknown company ${companyId}`)
  return { currency: regional.currency, vatPct: regional.vatPct }
}

/**
 * Open stages ordered before Proposal (per the statuses lookup); sending a quotation moves these
 * leads to Proposal. Parked and closed leads are left alone.
 */
function isBeforeProposal(companyId: string, status: LeadStatus): boolean {
  const proposal = statusOf(companyId, SYSTEM_STATUS.proposal)
  const current = statusOf(companyId, status)
  return !!proposal?.active && current?.type === 'open' && current.order < proposal.order
}

const UNITS = ['project', 'month', 'hour'] as const
const CURRENCY_RE = /^[A-Z]{3}$/

/**
 * Expiry: a sent or viewed quotation whose `validUntil` (last valid day) is before the company's
 * today (timezone, mock clock) becomes `expired`. Stored, not just displayed. Accepted / rejected
 * quotations never expire. Runs lazily on every quotation read and on the lifecycle tick that every
 * authenticated request (and Dev › advance clock) runs for the company (services/billing.ts).
 */
export function expireQuotations(companyId: string, at: number = nowMs()): number {
  const today = companyDayOf(companyId, new Date(at)).today
  let n = 0
  for (const q of quotations) {
    if (q.companyId !== companyId || !QUOTATION_AWAITING.includes(q.status) || q.validUntil >= today) continue
    q.status = 'expired'
    q.updatedAt = new Date(at).toISOString()
    n++
  }
  return n
}
onLifecycleTick('quotations.expiry', expireQuotations)

function toView(q: Tenant<QuotationRecord>): Quotation {
  const lead = leads.find((l) => l.id === q.leadId && l.companyId === q.companyId)
  const ownerId = lead?.ownerId ?? q.createdBy
  return {
    ...untenant(q),
    customerId: lead?.customerId ?? q.customerId,
    ownerId,
    ownerName: ownerName(ownerId),
    createdByName: ownerName(q.createdBy),
    totals: computeTotals(q.items, q.vatPct),
  }
}

/** The lead of the caller's company with this id (another company's lead doesn't exist here). */
const companyLead = (user: User, id: string | undefined) => (id ? findInTenant(leads, user, (l) => l.id === id) : undefined)

function canSee(user: User, lead: Lead | undefined): boolean {
  if (!lead) return false
  return inScope(scopeOf(user.role, 'sales'), user, lead.ownerId, salesTeamOf(user))
}

async function requireSales(user: User): Promise<void> {
  if (scopeOf(user.role, 'sales') === 'hidden') return fail('Your role has no access to quotations.', 403)
}

/** Finds a quotation the user may see; with `write`, also checks they may change it. */
async function quotationFor(user: User, id: string, write = false): Promise<Tenant<QuotationRecord>> {
  await requireSales(user)
  expireQuotations(tenantOf(user))
  const q = findInTenant(quotations, user, (x) => x.id === id)
  if (!q) return fail('That quotation doesn’t exist.', 404)
  if (!canSee(user, companyLead(user, q.leadId))) {
    return fail('This quotation belongs to a lead outside your access.', 403)
  }
  if (write && !can(user.role, 'sales', 'edit')) return fail('Your role can view quotations but not change them.', 403)
  return q
}

/** Below the seeded second-tenant block (Q-5001+, QT-yyyy-5001+), which never advances the sequences. */
const inSequence = (n: number) => n < CREST_SEED_QUOTATION_BASE

/**
 * Next number for the current year: QT-2026-0016. One global sequence for every company, so
 * quotation numbers stay unique across tenants.
 */
function nextNumber(): string {
  const year = new Date().getFullYear()
  const prefix = `QT-${year}-`
  const max = quotations
    .filter((q) => q.number.startsWith(prefix))
    .map((q) => Number(q.number.slice(prefix.length)) || 0)
    .filter(inSequence)
    .reduce((m, n) => Math.max(m, n), 0)
  let next = max + 1
  while (quotations.some((q) => q.number === `${prefix}${String(next).padStart(4, '0')}`)) next++
  return `${prefix}${String(next).padStart(4, '0')}`
}

/** Global id sequence (Q-1001…) shared by every company. */
function nextId(): string {
  const max = quotations
    .map((q) => Number(q.id.slice(2)) || 0)
    .filter(inSequence)
    .reduce((m, n) => Math.max(m, n), 1000)
  let next = max + 1
  while (quotations.some((q) => q.id === `Q-${next}`)) next++
  return `Q-${next}`
}

/** Validates and normalises the editable fields. Returns an error message or the clean values. */
function clean(
  companyId: string,
  input: QuotationUpdateInput,
  current?: QuotationRecord,
): { error: string } | { value: Pick<QuotationRecord, 'title' | 'validUntil' | 'items' | 'notes' | 'terms' | 'vatPct' | 'currency'> } {
  const defaults = regionalDefaults(companyId)
  const title = (input.title ?? current?.title ?? '').trim()
  if (!title) return { error: 'Give the quotation a title.' }

  const validUntil = (input.validUntil ?? current?.validUntil ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { error: 'Set the date the quotation is valid until.' }
  if (validUntil < todayIso()) return { error: 'The validity date can’t be in the past.' }

  const currency = String(input.currency ?? current?.currency ?? defaults.currency).trim().toUpperCase()
  if (!CURRENCY_RE.test(currency)) return { error: `Currency must be a 3-letter ISO code, e.g. ${defaults.currency}.` }

  const rawItems: QuotationItemInput[] = input.items ?? current?.items ?? []
  if (rawItems.length === 0) return { error: 'Add at least one line item.' }
  // Services already on the quotation stay valid even if since deactivated; new lines need ACTIVE ones.
  const keptServices = new Set((current?.items ?? []).map((x) => x.serviceId).filter(Boolean))
  const items: QuotationItem[] = []
  for (const [i, it] of rawItems.entries()) {
    const n = i + 1
    const description = String(it.description ?? '').trim()
    const quantity = Number(it.quantity)
    const unitPrice = Number(it.unitPrice)
    const discountPct = Number(it.discountPct ?? 0)
    if (!description) return { error: `Line ${n} needs a description.` }
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Line ${n}: quantity must be more than 0.` }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: `Line ${n}: price can’t be negative.` }
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      return { error: `Line ${n}: discount must be between 0 and 100%.` }
    }
    if (!UNITS.includes(it.unit)) return { error: `Line ${n}: choose a unit.` }
    const serviceId = it.serviceId || null
    if (serviceId) {
      // The company's own catalog only: another company's service id isn't in "the catalog".
      const service = catalog.find((s) => s.id === serviceId && s.companyId === companyId)
      if (!service) return { error: `Line ${n}: service ${serviceId} isn’t in the catalog.` }
      if (!service.active && !keptServices.has(serviceId)) {
        return { error: `Line ${n}: ${service.name} is no longer offered; pick an active service.` }
      }
    }
    const lineCurrency = it.currency == null || it.currency === '' ? undefined : String(it.currency).trim().toUpperCase()
    if (lineCurrency !== undefined && !CURRENCY_RE.test(lineCurrency)) return { error: `Line ${n}: currency must be a 3-letter ISO code.` }
    const groupId = it.groupId ? String(it.groupId).slice(0, 64) : null
    const groupLabel = groupId ? String(it.groupLabel ?? '').trim().slice(0, 120) || 'Package' : null
    items.push({
      id: it.id || `QI-${Date.now().toString(36)}-${i}`,
      serviceId,
      description,
      quantity,
      unit: it.unit,
      unitPrice,
      discountPct,
      ...(lineCurrency ? { currency: lineCurrency } : {}),
      ...(groupId ? { groupId, groupLabel } : {}),
    })
  }

  const vatPct = Number(input.vatPct ?? current?.vatPct ?? defaults.vatPct)
  if (!Number.isFinite(vatPct) || vatPct < 0 || vatPct > 100) return { error: 'VAT must be between 0 and 100%.' }

  return {
    value: {
      title,
      validUntil,
      items,
      notes: (input.notes ?? current?.notes ?? '').trim(),
      terms: (input.terms ?? current?.terms ?? '').trim(),
      vatPct,
      currency,
    },

  }
}

export async function getQuotations(user: User, filter: { leadId?: string } = {}): Promise<Quotation[]> {
  await requireSales(user)
  expireQuotations(tenantOf(user))
  if (filter.leadId) {
    const lead = companyLead(user, filter.leadId)
    if (!lead) return fail('That lead doesn’t exist.', 404)
    if (!canSee(user, lead)) return fail('This lead belongs to someone outside your access.', 403)
  }
  const rows = scoped(quotations, user)
    .filter((q) => (filter.leadId ? q.leadId === filter.leadId : true))
    .filter((q) => canSee(user, companyLead(user, q.leadId)))
    .map(toView)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return delay(rows)
}

export async function getQuotation(user: User, id: string): Promise<Quotation> {
  return delay(toView(await quotationFor(user, id)))
}

export async function createQuotation(user: User, input: QuotationInput): Promise<Quotation> {
  await requireSales(user)
  if (!can(user.role, 'sales', 'create')) return fail('Your role can’t create quotations.', 403)
  const lead = companyLead(user, input.leadId)
  if (!lead) return fail('Pick the lead this quotation is for.', 422)
  if (!canSee(user, lead)) return fail('This lead belongs to someone outside your access.', 403)

  const result = clean(tenantOf(user), input)
  if ('error' in result) return fail(result.error, 422)

  const now = new Date().toISOString()
  const record: Tenant<QuotationRecord> = stamp({
    id: nextId(),
    number: nextNumber(),
    leadId: lead.id,
    customerId: lead.customerId,
    company: lead.company,
    contactName: lead.contactName,
    contactEmail: lead.contactEmail,
    status: 'draft',
    ...result.value,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    decidedAt: null,
    viewedAt: null,
  }, user)
  quotations.push(record)
  return delay(toView(record))
}

export async function updateQuotation(user: User, id: string, input: QuotationUpdateInput): Promise<Quotation> {
  const q = await quotationFor(user, id, true)
  if (q.status !== 'draft') return fail(`${q.number} was already sent, so it can’t be edited. Duplicate it instead.`, 409)
  const result = clean(q.companyId, input, q)
  if ('error' in result) return fail(result.error, 422)
  Object.assign(q, result.value, { updatedAt: new Date().toISOString() })
  return delay(toView(q))
}

/** Draft → Sent. Moves an earlier-stage lead to Proposal and logs the email on its timeline. */
export async function sendQuotation(user: User, id: string): Promise<Quotation> {
  const q = await quotationFor(user, id, true)
  if (q.status !== 'draft') return fail(`${q.number} was already sent.`, 409)
  const lead = companyLead(user, q.leadId)
  if (!lead) return fail('The lead for this quotation no longer exists.', 422)
  if (lead.doNotContact) return fail(`${lead.company} is marked Do Not Contact, so emails are blocked.`, 422)
  if (!q.contactEmail.trim()) return fail('The lead has no contact email to send to.', 422)

  // Re-check the stored draft before it leaves the building.
  const result = clean(q.companyId, {}, q)
  if ('error' in result) return fail(result.error, 422)
  // Sending is an email: counts toward the plan's emails per period (402 LIMIT_REACHED).
  assertCapacity(q.companyId, 'emailsPerMonth')

  const now = new Date().toISOString()
  q.status = 'sent'
  q.sentAt = now
  q.updatedAt = now

  if (isBeforeProposal(lead.companyId, lead.status)) {
    recordLeadStatusChange(lead, lead.status, SYSTEM_STATUS.proposal, { changedBy: null, reason: `Quotation ${q.number} sent`, at: now })
    lead.status = SYSTEM_STATUS.proposal
    lead.stageChangedAt = now
    lead.nextStep = 'Walk through the quotation and confirm the start date'
  }
  activities.push(
    stamp(
      {
        id: `A-${Date.now().toString(36)}`,
        leadId: lead.id,
        type: 'email' as const,
        summary: `Sent quotation ${q.number} · ${q.title} (${fmtIn(computeTotals(q.items, q.vatPct).total, q.currency)}) to ${q.contactEmail}`,
        userId: user.id,
        at: now,
      },
      user,
    ),
  )
  recordUsage(q.companyId, 'emailsPerMonth')
  return delay(toView(q))
}

/**
 * The client opened the shared document / link (the mock's "Open as customer" view stands in for the
 * public link a real backend would sign). sent → viewed, once, with `viewedAt`. Other statuses are
 * left as they are (a draft hasn't been shared; decided and expired ones stay decided / expired).
 */
export async function markQuotationViewed(user: User, id: string): Promise<Quotation> {
  const q = await quotationFor(user, id)
  if (q.status === 'draft') return fail('Send the quotation before sharing it with the client.', 409)
  if (q.status === 'sent') {
    const now = new Date(nowMs()).toISOString()
    q.status = 'viewed'
    q.viewedAt = now
    q.updatedAt = now
  }
  return delay(toView(q))
}

/** Records the client's answer on a sent or viewed quotation. An expired one can't be accepted. */
export async function setQuotationStatus(user: User, id: string, status: QuotationDecision): Promise<Quotation> {
  const q = await quotationFor(user, id, true)
  if (!isOneOf(QUOTATION_DECISIONS, status)) return fail(`Status must be ${QUOTATION_DECISIONS.join(' or ')}.`, 422)
  const current: QuotationStatus = q.status
  if (current === 'expired') {
    return fail(`${q.number} expired on ${q.validUntil}. Duplicate it to send a fresh quotation.`, 409)
  }
  if (!QUOTATION_AWAITING.includes(current)) {
    return fail(current === 'draft' ? 'Send the quotation before recording an answer.' : `${q.number} is already ${QUOTATION_STATUS_LABEL[current]}.`, 409)
  }
  const now = new Date().toISOString()
  q.status = status
  q.decidedAt = now
  q.updatedAt = now
  return delay(toView(q))
}

/** Copies a quotation into a new Draft for the same lead, valid for another 30 days. */
export async function duplicateQuotation(user: User, id: string): Promise<Quotation> {
  const source = await quotationFor(user, id)
  if (!can(user.role, 'sales', 'create')) return fail('Your role can’t create quotations.', 403)
  const lead = companyLead(user, source.leadId)
  const now = new Date().toISOString()
  const newId = nextId()
  const record: Tenant<QuotationRecord> = {
    ...structuredClone(source),
    companyId: source.companyId,
    id: newId,
    number: nextNumber(),
    customerId: lead?.customerId ?? source.customerId,
    company: lead?.company ?? source.company,
    contactName: lead?.contactName ?? source.contactName,
    contactEmail: lead?.contactEmail ?? source.contactEmail,
    status: 'draft',
    items: source.items.map((it, i) => ({ ...it, id: `${newId}-${i + 1}` })),
    validUntil: addDaysIso(DEFAULT_VALIDITY_DAYS),
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    decidedAt: null,
    viewedAt: null,
  }
  quotations.push(record)
  return delay(toView(record))
}
