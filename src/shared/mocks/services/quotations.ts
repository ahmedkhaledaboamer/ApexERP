import type { Lead, LeadStatus, User } from '@/shared/types'
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
  AWAITING_STATUSES,
  DEFAULT_QUOTE_CURRENCY,
  DEFAULT_VALIDITY_DAYS,

  DEFAULT_VAT_PCT,
  addDaysIso,
  computeTotals,
  daysUntil,
  fmtAed,
  todayIso,
} from '@/modules/quotations/lib/totals'
import { can, inScope, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { departments } from '@/shared/mocks/data/departments'
import { activities, leads, users } from '@/shared/mocks/db'
import { quotations } from '@/shared/mocks/data/quotations'
import { services as catalog } from '@/shared/mocks/data/services'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { statusOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'

/* ------------------------------------------------------------------------------------------
 * Quotations. Scope follows the lead: you see a quotation when you can see its lead.
 * ---------------------------------------------------------------------------------------- */

/**
 * Open stages ordered before Proposal (per the statuses lookup); sending a quotation moves these
 * leads to Proposal. Parked and closed leads are left alone.
 */
function isBeforeProposal(status: LeadStatus): boolean {
  const proposal = statusOf(SYSTEM_STATUS.proposal)
  const current = statusOf(status)
  return !!proposal?.active && current?.kind === 'open' && current.order < proposal.order
}

const UNITS = ['project', 'month', 'hour'] as const
const CURRENCY_RE = /^[A-Z]{3}$/

/** Sent or Viewed quotations past their last valid day read as Expired. */
function effectiveStatus(q: QuotationRecord): QuotationStatus {
  if (AWAITING_STATUSES.includes(q.status) && daysUntil(q.validUntil) < 0) return 'Expired'
  return q.status
}

function toView(q: QuotationRecord): Quotation {
  const lead = leads.find((l) => l.id === q.leadId)
  const ownerId = lead?.ownerId ?? q.createdBy
  return {
    ...q,
    status: effectiveStatus(q),
    customerId: lead?.customerId ?? q.customerId,
    ownerId,
    ownerName: ownerName(ownerId),
    createdByName: ownerName(q.createdBy),
    totals: computeTotals(q.items, q.vatPct),
  }
}

function canSee(user: User, lead: Lead | undefined): boolean {
  if (!lead) return false
  return inScope(scopeOf(user.role, 'sales'), user, lead.ownerId, teamIdsFor(user, users, departments))
}

async function requireSales(user: User): Promise<void> {
  if (scopeOf(user.role, 'sales') === 'hidden') return fail('Your role has no access to quotations.', 403)
}

/** Finds a quotation the user may see; with `write`, also checks they may change it. */
async function quotationFor(user: User, id: string, write = false): Promise<QuotationRecord> {
  await requireSales(user)
  const q = quotations.find((x) => x.id === id)
  if (!q) return fail('That quotation doesn’t exist.', 404)
  if (!canSee(user, leads.find((l) => l.id === q.leadId))) {
    return fail('This quotation belongs to a lead outside your access.', 403)
  }
  if (write && !can(user.role, 'sales', 'edit')) return fail('Your role can view quotations but not change them.', 403)
  return q
}

/** Next number for the current year: QT-2026-0016. */
function nextNumber(): string {
  const year = new Date().getFullYear()
  const prefix = `QT-${year}-`
  const max = quotations
    .filter((q) => q.number.startsWith(prefix))
    .reduce((m, q) => Math.max(m, Number(q.number.slice(prefix.length)) || 0), 0)
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

function nextId(): string {
  const max = quotations.reduce((m, q) => Math.max(m, Number(q.id.slice(2)) || 0), 1000)
  return `Q-${max + 1}`
}

/** Validates and normalises the editable fields. Returns an error message or the clean values. */
function clean(
  input: QuotationUpdateInput,
  current?: QuotationRecord,
): { error: string } | { value: Pick<QuotationRecord, 'title' | 'validUntil' | 'items' | 'notes' | 'terms' | 'vatPct' | 'currency'> } {
  const title = (input.title ?? current?.title ?? '').trim()
  if (!title) return { error: 'Give the quotation a title.' }

  const validUntil = (input.validUntil ?? current?.validUntil ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { error: 'Set the date the quotation is valid until.' }
  if (validUntil < todayIso()) return { error: 'The validity date can’t be in the past.' }

  const currency = String(input.currency ?? current?.currency ?? DEFAULT_QUOTE_CURRENCY).trim().toUpperCase()
  if (!CURRENCY_RE.test(currency)) return { error: 'Currency must be a 3-letter ISO code, e.g. AED.' }

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
      const service = catalog.find((s) => s.id === serviceId)
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

  const vatPct = Number(input.vatPct ?? current?.vatPct ?? DEFAULT_VAT_PCT)
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
  if (filter.leadId && !canSee(user, leads.find((l) => l.id === filter.leadId))) {
    return fail('This lead belongs to someone outside your access.', 403)
  }
  const rows = quotations
    .filter((q) => (filter.leadId ? q.leadId === filter.leadId : true))
    .filter((q) => canSee(user, leads.find((l) => l.id === q.leadId)))
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
  const lead = leads.find((l) => l.id === input.leadId)
  if (!lead) return fail('Pick the lead this quotation is for.', 422)
  if (!canSee(user, lead)) return fail('This lead belongs to someone outside your access.', 403)

  const result = clean(input)
  if ('error' in result) return fail(result.error, 422)

  const now = new Date().toISOString()
  const record: QuotationRecord = {
    id: nextId(),
    number: nextNumber(),
    leadId: lead.id,
    customerId: lead.customerId,
    company: lead.company,
    contactName: lead.contactName,
    contactEmail: lead.contactEmail,
    status: 'Draft',
    ...result.value,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    decidedAt: null,
  }
  quotations.push(record)
  return delay(toView(record))
}

export async function updateQuotation(user: User, id: string, input: QuotationUpdateInput): Promise<Quotation> {
  const q = await quotationFor(user, id, true)
  if (q.status !== 'Draft') return fail(`${q.number} was already sent, so it can’t be edited. Duplicate it instead.`, 409)
  const result = clean(input, q)
  if ('error' in result) return fail(result.error, 422)
  Object.assign(q, result.value, { updatedAt: new Date().toISOString() })
  return delay(toView(q))
}

/** Draft → Sent. Moves an earlier-stage lead to Proposal and logs the email on its timeline. */
export async function sendQuotation(user: User, id: string): Promise<Quotation> {
  const q = await quotationFor(user, id, true)
  if (q.status !== 'Draft') return fail(`${q.number} was already sent.`, 409)
  const lead = leads.find((l) => l.id === q.leadId)
  if (!lead) return fail('The lead for this quotation no longer exists.', 422)
  if (lead.doNotContact) return fail(`${lead.company} is marked Do Not Contact, so emails are blocked.`, 422)
  if (!q.contactEmail.trim()) return fail('The lead has no contact email to send to.', 422)

  // Re-check the stored draft before it leaves the building.
  const result = clean({}, q)
  if ('error' in result) return fail(result.error, 422)

  const now = new Date().toISOString()
  q.status = 'Sent'
  q.sentAt = now
  q.updatedAt = now

  if (isBeforeProposal(lead.status)) {
    lead.status = SYSTEM_STATUS.proposal
    lead.stageChangedAt = now
    lead.nextStep = 'Walk through the quotation and confirm the start date'
  }
  activities.push({
    id: `A-${Date.now().toString(36)}`,
    leadId: lead.id,
    type: 'email',
    summary: `Sent quotation ${q.number} · ${q.title} (${fmtAed(computeTotals(q.items, q.vatPct).total)}) to ${q.contactEmail}`,
    userId: user.id,
    at: now,
  })
  return delay(toView(q))
}

/** Records the client's answer on a Sent or Viewed quotation. */
export async function setQuotationStatus(user: User, id: string, status: QuotationDecision): Promise<Quotation> {
  const q = await quotationFor(user, id, true)
  if (status !== 'Accepted' && status !== 'Rejected') return fail('Status must be Accepted or Rejected.', 422)
  const current = effectiveStatus(q)
  if (current === 'Expired') {
    return fail(`${q.number} expired on ${q.validUntil}. Duplicate it to send a fresh quotation.`, 409)
  }
  if (!AWAITING_STATUSES.includes(current)) {
    return fail(current === 'Draft' ? 'Send the quotation before recording an answer.' : `${q.number} is already ${current}.`, 409)
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
  const lead = leads.find((l) => l.id === source.leadId)
  const now = new Date().toISOString()
  const newId = nextId()
  const record: QuotationRecord = {
    ...structuredClone(source),
    id: newId,
    number: nextNumber(),
    customerId: lead?.customerId ?? source.customerId,
    company: lead?.company ?? source.company,
    contactName: lead?.contactName ?? source.contactName,
    contactEmail: lead?.contactEmail ?? source.contactEmail,
    status: 'Draft',
    items: source.items.map((it, i) => ({ ...it, id: `${newId}-${i + 1}` })),
    validUntil: addDaysIso(DEFAULT_VALIDITY_DAYS),
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    decidedAt: null,
  }
  quotations.push(record)
  return delay(toView(record))
}
