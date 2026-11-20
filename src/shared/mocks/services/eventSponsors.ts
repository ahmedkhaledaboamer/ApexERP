import type { User } from '@/shared/types'
import type {
  DeliverableTemplate,
  EventSponsorship,
  SponsorBoard,
  SponsorDeal,
  SponsorDealInput,
  SponsorDealUpdate,
  SponsorDeliverable,
  SponsorDeliverableInput,
  SponsorFilter,
  SponsorOrganization,
  SponsorPackage,
  SponsorPackageInput,
  SponsorStage,
  SponsorStageInput,
} from '@/modules/events/sponsorTypes'
import { DELIVERABLE_STATUSES, OPEN_SPONSOR_STAGES, SPONSOR_STAGES, SPONSOR_STAGE_LABEL, WON_SPONSOR_STAGES } from '@/modules/events/sponsorTypes'
import { scopeOf } from '@/shared/lib/permissions'
import { isMobile, normalizeMobile } from '@/shared/lib/phone'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { customers, leads, users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import type { EventRecord } from '@/shared/mocks/data/events'
import { nextTaskId, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import {
  eventStartDate,
  sponsorDeals,
  sponsorDeliverables,
  sponsorPackages,
  sponsorshipIncomeOf,
  type SponsorDealRecord,
  type SponsorDeliverableRecord,
  type SponsorPackageRecord,
} from '@/shared/mocks/data/eventSponsors'
import { canEditEvent, eventsVisibleTo, teamIdsOf } from '@/shared/mocks/selectors/events'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { now as clockNow, nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, assertModule, noteUsage, onLifecycleTick } from '@/shared/mocks/services/billing'
import { canOverrideDuplicates, findDuplicates, insertLead, visibleLeads } from '@/shared/mocks/services/leads'
import { canOwnLeads, currencyOf, EVENT_SOURCE_MISSING, eventFor, eventSourceKey, log } from '@/shared/mocks/services/events'

/**
 * Sponsors & exhibitors (docs/API.md › Events › Sponsors & exhibitors), for events the company ORGANIZES.
 *  - Packages per event: name, price (company currency), quantity, benefits, deliverables template.
 *  - Deals: an organization (an existing lead / customer, or a new lead with source Event + event_id through
 *    the normal lead path: duplicates 409 unless a manager forces), contact, package, amount (default the
 *    package price; a discount is allowed, never above the price), stage, owner, payment dates.
 *  - Stages: prospect → contacted → proposal_sent → negotiating (free moves) → signed (holds a package slot:
 *    409 `sold_out` when the quantity is taken) → paid; any stage → lost (reason required). Signed / paid only
 *    go to paid / signed / lost; lost reopens to an open stage only.
 *  - Signing creates the deliverables from the package template (due dates counted from the event's start,
 *    company calendar), once. A deliverable can get a linked task (idempotent). Overdue deliverables notify
 *    their owner once (stored notification), re-armed when the due date changes.
 *  - Signed + paid amounts are the event's sponsorship income (event stats / ROI, budget tab).
 * Access: read = sees the event; write = the event's edit right (marketing full or the event team).
 */

const PACKAGE_NOT_FOUND = 'That sponsorship package doesn’t exist.'
const DEAL_NOT_FOUND = 'That sponsor doesn’t exist.'
const DELIVERABLE_NOT_FOUND = 'That deliverable doesn’t exist.'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LIST = 30

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const round2 = (n: number) => Math.round(n * 100) / 100
let seq = 0
const nextId = (prefix: string) => `${prefix}-${nowMs().toString(36)}${(++seq).toString(36)}`

/* ---------------- Views ---------------- */

const packagesOf = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) =>
  sponsorPackages.filter((p) => p.companyId === e.companyId && p.eventId === e.id).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
const dealsOf = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) => sponsorDeals.filter((d) => d.companyId === e.companyId && d.eventId === e.id)
const deliverablesOf = (d: Tenant<SponsorDealRecord>) =>
  sponsorDeliverables.filter((x) => x.companyId === d.companyId && x.dealId === d.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt))
const slotsTaken = (p: Tenant<SponsorPackageRecord>, exceptDealId?: string) =>
  sponsorDeals.filter((d) => d.companyId === p.companyId && d.packageId === p.id && d.id !== exceptDealId && WON_SPONSOR_STAGES.includes(d.stage)).length

function packageView(p: Tenant<SponsorPackageRecord>, e: Tenant<EventRecord>): SponsorPackage {
  const sold = slotsTaken(p)
  return {
    id: p.id,
    eventId: p.eventId,
    eventName: e.name,
    name: p.name,
    price: p.price,
    currency: p.currency,
    quantity: p.quantity,
    sold,
    remaining: Math.max(0, p.quantity - sold),
    benefits: [...p.benefits],
    deliverables: p.deliverables.map((x) => ({ ...x })),
    dealCount: sponsorDeals.filter((d) => d.companyId === p.companyId && d.packageId === p.id).length,
  }
}

function deliverableView(x: Tenant<SponsorDeliverableRecord>, today: string): SponsorDeliverable {
  return {
    id: x.id,
    title: x.title,
    offsetDays: x.offsetDays,
    dueDate: x.dueDate,
    status: x.status,
    ownerId: x.ownerId,
    ownerName: x.ownerId ? ownerName(x.ownerId) : '',
    taskId: x.taskId,
    overdue: x.status !== 'done' && x.dueDate < today,
  }
}

function canOpenOrganization(viewer: User, d: Tenant<SponsorDealRecord>): boolean {
  if (scopeOf(viewer.role, 'sales') === 'hidden') return false
  if (d.customerId) return true
  return !!d.leadId && visibleLeads(viewer).some((l) => l.id === d.leadId)
}

function dealView(d: Tenant<SponsorDealRecord>, e: Tenant<EventRecord>, viewer: User): SponsorDeal {
  const p = sponsorPackages.find((x) => x.companyId === d.companyId && x.id === d.packageId)
  const today = companyDayOf(d.companyId).today
  return {
    id: d.id,
    eventId: d.eventId,
    eventName: e.name,
    eventStartDate: eventStartDate(e),
    packageId: d.packageId,
    packageName: p?.name ?? '',
    packagePrice: p?.price ?? d.amount,
    discount: round2(Math.max(0, (p?.price ?? d.amount) - d.amount)),
    organizationName: d.organizationName,
    leadId: d.leadId,
    customerId: d.customerId,
    canOpenOrganization: canOpenOrganization(viewer, d),
    contactName: d.contactName,
    contactEmail: d.contactEmail,
    amount: d.amount,
    currency: p?.currency ?? currencyOf(d.companyId),
    stage: d.stage,
    lostReason: d.lostReason,
    ownerId: d.ownerId,
    ownerName: d.ownerId ? ownerName(d.ownerId) : '',
    expectedPaymentDate: d.expectedPaymentDate,
    actualPaymentDate: d.actualPaymentDate,
    notes: d.notes,
    signedAt: d.signedAt,
    deliverables: deliverablesOf(d).map((x) => deliverableView(x, today)),
    canManage: canEditEvent(viewer, e),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }
}

function sponsorshipOf(e: Tenant<EventRecord>, viewer: User): EventSponsorship {
  return {
    eventId: e.id,
    isOrganizer: e.isOrganizer,
    currency: currencyOf(e.companyId),
    packages: packagesOf(e).map((p) => packageView(p, e)),
    deals: dealsOf(e)
      .sort((a, b) => SPONSOR_STAGES.indexOf(a.stage) - SPONSOR_STAGES.indexOf(b.stage) || a.createdAt.localeCompare(b.createdAt))
      .map((d) => dealView(d, e, viewer)),
    income: sponsorshipIncomeOf(e),
    canManage: canEditEvent(viewer, e),
  }
}

/* ---------------- Access ---------------- */

/** An organized event the caller may see (`edit` = may change its sponsors). Attended events → 422 `not_organizer` on writes. */
async function organizedEvent(user: User, id: string, need: 'view' | 'edit'): Promise<Tenant<EventRecord>> {
  const e = await eventFor(user, id, need)
  if (need === 'edit' && !e.isOrganizer) throw new CodedApiError('Sponsors and exhibitors are for events your company organizes.', 422, 'not_organizer')
  return e
}

async function packageFor(user: User, e: Tenant<EventRecord>, packageId: string): Promise<Tenant<SponsorPackageRecord>> {
  const p = findInTenant(sponsorPackages, user, (x) => x.id === packageId && x.eventId === e.id)
  if (!p) return fail(PACKAGE_NOT_FOUND, 404)
  return p
}

async function dealFor(user: User, e: Tenant<EventRecord>, dealId: string): Promise<Tenant<SponsorDealRecord>> {
  const d = findInTenant(sponsorDeals, user, (x) => x.id === dealId && x.eventId === e.id)
  if (!d) return fail(DEAL_NOT_FOUND, 404)
  return d
}

/** An active user of the company (owner pickers); another company's id → the same 422 as an unknown one. */
function memberOf(companyId: string, id: unknown): User | null | string {
  const v = str(id)
  if (!v) return null
  const u = users.find((x) => x.id === v && x.companyId === companyId && x.active !== false)
  return u ?? 'Pick someone from your company as the owner.'
}

function isoDateOrNull(v: unknown, label: string): string | null | string[] {
  if (v === undefined || v === null || v === '') return null
  const s = str(v)
  return isRealIsoDate(s) ? s : [`${label} must be a date (yyyy-MM-dd).`]
}

/* ---------------- Packages ---------------- */

function cleanPackage(companyId: string, input: Partial<SponsorPackageInput> | null, existing?: SponsorPackageRecord): Omit<SponsorPackageRecord, 'id' | 'eventId' | 'sortOrder' | 'createdAt' | 'updatedAt'> | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<SponsorPackageInput>
  const name = str(v.name)
  if (name.length < 2 || name.length > 80) return 'Name the package (2–80 characters), e.g. Gold or Exhibitor booth.'
  const price = Number(v.price)
  if (!Number.isFinite(price) || price < 0 || price > 1e10) return 'Price must be 0 or a positive amount.'
  const quantity = Number(v.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return 'Quantity must be a whole number from 1 to 500.'
  const currency = currencyOf(companyId)
  const askedCurrency = str(v.currency).toUpperCase()
  if (askedCurrency && askedCurrency !== currency) return `Packages are priced in the company currency (${currency}).`
  const benefits = (Array.isArray(v.benefits) ? v.benefits : []).map((b) => str(b)).filter(Boolean)
  if (benefits.length > 30 || benefits.some((b) => b.length > 200)) return 'Keep the benefits to 30 lines of up to 200 characters.'
  const rawDeliverables = Array.isArray(v.deliverables) ? v.deliverables : []
  if (rawDeliverables.length > 30) return 'Keep the deliverables template to 30 items.'
  const deliverables: DeliverableTemplate[] = []
  for (const raw of rawDeliverables) {
    const r = (raw ?? {}) as Partial<DeliverableTemplate>
    const title = str(r.title)
    if (!title) continue
    const offsetDays = Number(r.offsetDays ?? 0)
    if (title.length > 120) return 'Keep each deliverable under 120 characters.'
    if (!Number.isInteger(offsetDays) || offsetDays < -365 || offsetDays > 365) return `“${title}”: days from the event must be a whole number from −365 to 365.`
    deliverables.push({ title, offsetDays })
  }
  return { name, price: round2(price), currency, quantity, benefits, deliverables }
}

/** POST /events/:id/sponsor-packages */
export async function createPackage(user: User, id: string, input: Partial<SponsorPackageInput> | null): Promise<SponsorPackage> {
  const e = await organizedEvent(user, id, 'edit')
  const clean = cleanPackage(e.companyId, input)
  if (typeof clean === 'string') return fail(clean, 422)
  if (packagesOf(e).some((p) => p.name.toLowerCase() === clean.name.toLowerCase())) return fail(`${e.name} already has a “${clean.name}” package.`, 409)
  const now = nowIso()
  const row: Tenant<SponsorPackageRecord> = { companyId: e.companyId, id: nextId('ESP'), eventId: e.id, ...clean, sortOrder: packagesOf(e).length + 1, createdAt: now, updatedAt: now }
  sponsorPackages.push(row)
  log(e, user, `Added the sponsorship package ${row.name}`)
  return delay(packageView(row, e))
}

/** PATCH /events/:id/sponsor-packages/:packageId — the quantity can't go below the slots already sold. */
export async function updatePackage(user: User, id: string, packageId: string, input: Partial<SponsorPackageInput> | null): Promise<SponsorPackage> {
  const e = await organizedEvent(user, id, 'edit')
  const p = await packageFor(user, e, packageId)
  const clean = cleanPackage(e.companyId, input, p)
  if (typeof clean === 'string') return fail(clean, 422)
  if (packagesOf(e).some((x) => x.id !== p.id && x.name.toLowerCase() === clean.name.toLowerCase())) return fail(`${e.name} already has a “${clean.name}” package.`, 409)
  const sold = slotsTaken(p)
  if (clean.quantity < sold) throw new CodedApiError(`${sold} ${p.name} slot${sold === 1 ? ' is' : 's are'} already signed: the quantity can’t be lower.`, 409, 'quantity_below_sold')
  Object.assign(p, clean, { updatedAt: nowIso() })
  return delay(packageView(p, e))
}

/** DELETE /events/:id/sponsor-packages/:packageId — only while no deal uses it (409). */
export async function deletePackage(user: User, id: string, packageId: string): Promise<{ removed: true }> {
  const e = await organizedEvent(user, id, 'edit')
  const p = await packageFor(user, e, packageId)
  if (sponsorDeals.some((d) => d.companyId === p.companyId && d.packageId === p.id)) throw new CodedApiError(`Sponsors are on the ${p.name} package: move or delete them first.`, 409, 'package_in_use')
  sponsorPackages.splice(sponsorPackages.indexOf(p), 1)
  log(e, user, `Removed the sponsorship package ${p.name}`)
  return delay({ removed: true as const })
}

/* ---------------- Reads ---------------- */

/** GET /events/:id/sponsorship */
export async function getSponsorship(user: User, id: string): Promise<EventSponsorship> {
  const e = await organizedEvent(user, id, 'view')
  runSponsorReminders(e.companyId)
  return delay(sponsorshipOf(e, user))
}

/** GET /events/sponsors — every sponsor of the organized events the caller sees, filtered. */
export async function listSponsors(user: User, filter: SponsorFilter = {}): Promise<SponsorBoard> {
  const co = tenantOf(user)
  assertModule(co, 'events')
  runSponsorReminders(co)
  const visible = eventsVisibleTo(user).filter((e) => e.isOrganizer && e.status !== 'cancelled')
  const byId = new Map(visible.map((e) => [e.id, e]))
  const stage = str(filter.stage) as SponsorStage | ''
  const deals = sponsorDeals
    .filter((d) => d.companyId === co && byId.has(d.eventId))
    .filter((d) => !filter.eventId || d.eventId === filter.eventId)
    .filter((d) => !filter.packageId || d.packageId === filter.packageId)
    .filter((d) => !stage || d.stage === stage)
    .filter((d) => !filter.ownerId || d.ownerId === filter.ownerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((d) => dealView(d, byId.get(d.eventId)!, user))
  const packages = sponsorPackages
    .filter((p) => p.companyId === co && byId.has(p.eventId))
    .sort((a, b) => a.eventId.localeCompare(b.eventId) || a.sortOrder - b.sortOrder)
    .map((p) => packageView(p, byId.get(p.eventId)!))
  return delay({
    currency: currencyOf(co),
    deals,
    packages,
    events: visible
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((e) => ({ id: e.id, name: e.name, startDate: eventStartDate(e), canManage: canEditEvent(user, e) })),
  })
}

/** GET /events/sponsor-organizations?q= — leads and customers the caller's Sales scope reaches (sponsor picker). */
export async function searchOrganizations(user: User, q: string): Promise<SponsorOrganization[]> {
  const co = tenantOf(user)
  assertModule(co, 'events')
  const needle = str(q).toLowerCase()
  if (scopeOf(user.role, 'sales') === 'hidden') return delay([])
  const match = (s: string) => !needle || s.toLowerCase().includes(needle)
  const out: SponsorOrganization[] = [
    ...customers.filter((c) => c.companyId === co && match(c.name)).map((c) => {
      const lead = leads.find((l) => l.id === c.leadId && l.companyId === co)
      return { kind: 'customer' as const, id: c.id, name: c.name, contactName: lead?.contactName ?? '', contactEmail: lead?.contactEmail ?? '' }
    }),
    ...visibleLeads(user).filter((l) => match(l.company)).map((l) => ({ kind: 'lead' as const, id: l.id, name: l.company, contactName: l.contactName, contactEmail: l.contactEmail })),
  ]
  return delay(out.slice(0, MAX_LIST))
}

/* ---------------- Deals ---------------- */

/** The lead owner for a new sponsor lead: the deal owner when they can own leads, else a team member who can, else a Sales Agent. */
function leadOwnerFor(e: Tenant<EventRecord>, dealOwner: User | null, actor: User): User {
  for (const u of [dealOwner, actor]) if (u && canOwnLeads(u)) return u
  const team = teamIdsOf(e)
  const pool = users.filter((u) => u.companyId === e.companyId && canOwnLeads(u))
  return pool.find((u) => team.includes(u.id)) ?? pool.filter((u) => u.role === 'Sales Agent').sort((a, b) => a.id.localeCompare(b.id))[0] ?? pool[0] ?? actor
}

interface Organization {
  leadId: string | null
  customerId: string | null
  name: string
  contactName: string
  contactEmail: string
}

/** Resolves the sponsor organization: an existing lead / customer of the company, or a new lead (normal lead path). */
function organizationFor(user: User, e: Tenant<EventRecord>, v: Partial<SponsorDealInput>, owner: User | null): Organization {
  const co = e.companyId
  const leadId = str(v.leadId)
  const customerId = str(v.customerId)
  if (leadId) {
    const l = leads.find((x) => x.id === leadId && x.companyId === co)
    if (!l) throw new CodedApiError('That lead doesn’t exist.', 422, 'invalid_organization')
    return { leadId: l.id, customerId: null, name: l.company, contactName: l.contactName, contactEmail: l.contactEmail }
  }
  if (customerId) {
    const c = customers.find((x) => x.id === customerId && x.companyId === co)
    if (!c) throw new CodedApiError('That customer doesn’t exist.', 422, 'invalid_organization')
    const l = leads.find((x) => x.id === c.leadId && x.companyId === co)
    return { leadId: null, customerId: c.id, name: c.name, contactName: l?.contactName ?? '', contactEmail: l?.contactEmail ?? '' }
  }
  const n = v.newLead
  if (!n || typeof n !== 'object') throw new CodedApiError('Pick the sponsor: an existing lead or customer, or a new organization.', 422, 'invalid_organization')
  const company = str(n.company)
  if (company.length < 2 || company.length > 255) throw new CodedApiError('Enter the organization’s name (2–255 characters).', 422, 'invalid_organization')
  const email = str(n.email).toLowerCase()
  if (email && (!EMAIL_RE.test(email) || email.length > 190)) throw new CodedApiError(`${email} isn’t a valid email address.`, 422, 'invalid_organization')
  const country = companyById(co)?.regional.country ?? 'AE'
  const rawMobile = str(n.mobile)
  if (rawMobile && !isMobile(rawMobile, country)) throw new CodedApiError(`${rawMobile} isn’t a valid mobile number.`, 422, 'invalid_organization')
  const mobile = rawMobile ? (normalizeMobile(rawMobile, country) ?? rawMobile) : ''
  const contactName = str(n.contactName)
  // The normal lead rule: a duplicate (name, email, domain) in the company is refused unless a manager forces it.
  const matches = findDuplicates(co, { company, emails: [email] })
  if (matches.length) {
    const m = matches[0]
    if (v.force !== true) {
      throw new CodedApiError(`Possible duplicate: ${m.company} (${m.leadId}, owned by ${m.ownerName}) already exists. Pick that lead, or ask a manager to add it anyway.`, 409, 'duplicate_lead', {
        matches: matches.map((x) => ({ lead_id: x.leadId, company: x.company, owner_name: x.ownerName, reason: x.reason })),
      })
    }
    if (!canOverrideDuplicates(user)) throw new CodedApiError('Only a manager can add a lead that duplicates an existing one.', 403, 'duplicate_lead')
  }
  const sourceKey = eventSourceKey(co)
  if (!sourceKey) throw new CodedApiError(EVENT_SOURCE_MISSING, 422, 'event_source_missing')
  assertCapacity(co, 'leadsContacts', contactName || email || mobile ? 2 : 1)
  const leadOwner = leadOwnerFor(e, owner, user)
  const lead = insertLead(leadOwner, {
    company,
    sourceType: sourceKey,
    sourceDetail: e.name,
    industry: '',
    contacts: contactName || email || mobile ? [{ name: contactName || company, title: '', mobile, email, isDecisionMaker: true }] : [],
    ownerId: leadOwner.id,
    nextFollowUpDate: null,
    note: `Sponsor prospect for ${e.name}.`,
  })
  ;(lead as { eventId?: string | null }).eventId = e.id
  noteUsage(co)
  return { leadId: lead.id, customerId: null, name: lead.company, contactName: contactName, contactEmail: email }
}

function cleanAmount(v: unknown, price: number): number | string {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 'The amount must be 0 or a positive amount.'
  if (n > price) return `The amount can’t be more than the package price (${price}); a discount is fine.`
  return round2(n)
}

/** Creates the deliverables of a signed deal from its package template (once). */
function createDeliverables(d: Tenant<SponsorDealRecord>, e: Tenant<EventRecord>): void {
  if (sponsorDeliverables.some((x) => x.companyId === d.companyId && x.dealId === d.id)) return
  const p = sponsorPackages.find((x) => x.companyId === d.companyId && x.id === d.packageId)
  if (!p) return
  const start = eventStartDate(e)
  const now = nowIso()
  for (const t of p.deliverables) {
    sponsorDeliverables.push({
      companyId: d.companyId,
      id: nextId('ESV'),
      eventId: e.id,
      dealId: d.id,
      title: t.title,
      offsetDays: t.offsetDays,
      dueDate: addDays(start, t.offsetDays),
      status: 'todo',
      ownerId: d.ownerId,
      taskId: null,
      overdueNotifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  }
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The slot rule: signing can't exceed the package's quantity (409 `sold_out`). */
function assertSlot(p: Tenant<SponsorPackageRecord>, dealId?: string): void {
  if (slotsTaken(p, dealId) >= p.quantity) {
    throw new CodedApiError(`${p.name} is sold out (${p.quantity} of ${p.quantity} signed). Raise the quantity or pick another package.`, 409, 'sold_out')
  }
}

/**
 * The stage rule (also used by the board to explain a refused drop). Returns the refusal, or null.
 * Open stages move freely; → signed needs a free slot; → paid only from signed; signed / paid only go to
 * paid / signed / lost; lost reopens to an open stage only.
 */
export function stageProblem(from: SponsorStage, to: SponsorStage): string | null {
  if (from === to) return null
  if (to === 'lost') return null
  if (from === 'lost') return OPEN_SPONSOR_STAGES.includes(to) ? null : 'Reopen the sponsor (move it to an open stage) before signing.'
  if (to === 'paid' && from !== 'signed') return 'Mark the sponsor signed before paid.'
  if (WON_SPONSOR_STAGES.includes(from) && OPEN_SPONSOR_STAGES.includes(to)) return 'A signed sponsor can only be marked paid or lost.'
  return null
}

function applyStage(d: Tenant<SponsorDealRecord>, e: Tenant<EventRecord>, user: User, to: SponsorStage, lostReason: string, paidOn: string | null): void {
  const from = d.stage
  const problem = stageProblem(from, to)
  if (problem) throw new CodedApiError(problem, 409, 'invalid_stage')
  if (to === 'lost' && lostReason.length < 3) throw new CodedApiError('Give a reason the sponsor was lost.', 422, 'lost_reason_required')
  if (to === 'signed' && !WON_SPONSOR_STAGES.includes(from)) {
    const p = sponsorPackages.find((x) => x.companyId === d.companyId && x.id === d.packageId)
    if (!p) throw new CodedApiError(PACKAGE_NOT_FOUND, 422, 'invalid_package')
    assertSlot(p, d.id)
  }
  const now = nowIso()
  d.stage = to
  d.lostReason = to === 'lost' ? lostReason.slice(0, 255) : ''
  if (to === 'signed' && !d.signedAt) d.signedAt = now
  if (to === 'paid') d.actualPaymentDate = paidOn ?? d.actualPaymentDate ?? companyDayOf(d.companyId).today
  if (to === 'signed' && from === 'paid') d.actualPaymentDate = null
  if (WON_SPONSOR_STAGES.includes(to)) createDeliverables(d, e)
  d.updatedAt = now
  if (from !== to) log(e, user, `${d.organizationName}: ${SPONSOR_STAGE_LABEL[from]} → ${SPONSOR_STAGE_LABEL[to]}${to === 'lost' ? ` (${d.lostReason})` : ''}`)
}

/** POST /events/:id/sponsors */
export async function createDeal(user: User, id: string, input: Partial<SponsorDealInput> | null): Promise<SponsorDeal> {
  const e = await organizedEvent(user, id, 'edit')
  const v = input ?? {}
  const p = findInTenant(sponsorPackages, user, (x) => x.id === str(v.packageId) && x.eventId === e.id)
  if (!p) throw new CodedApiError(PACKAGE_NOT_FOUND, 422, 'invalid_package')
  const owner = memberOf(e.companyId, v.ownerId ?? user.id)
  if (typeof owner === 'string') return fail(owner, 422)
  const amount = v.amount === undefined || v.amount === null || (v.amount as unknown) === '' ? p.price : cleanAmount(v.amount, p.price)
  if (typeof amount === 'string') return fail(amount, 422)
  const stage = (str(v.stage) || 'prospect') as SponsorStage
  if (!SPONSOR_STAGES.includes(stage) || stage === 'lost' || stage === 'paid') return fail('A new sponsor starts in an open stage or signed.', 422)
  const expected = isoDateOrNull(v.expectedPaymentDate, 'Expected payment date')
  if (Array.isArray(expected)) return fail(expected[0], 422)
  const notes = str(v.notes)
  if (notes.length > 2000) return fail('Keep the notes under 2,000 characters.', 422)
  const contactEmail = str(v.contactEmail).toLowerCase()
  if (contactEmail && !EMAIL_RE.test(contactEmail)) return fail(`${contactEmail} isn’t a valid email address.`, 422)
  if (stage === 'signed') assertSlot(p)
  const org = organizationFor(user, e, v, owner)
  if (dealsOf(e).some((d) => d.stage !== 'lost' && ((org.leadId && d.leadId === org.leadId) || (org.customerId && d.customerId === org.customerId)))) {
    throw new CodedApiError(`${org.name} is already a sponsor of ${e.name}.`, 409, 'already_sponsor')
  }
  const now = nowIso()
  const d: Tenant<SponsorDealRecord> = {
    companyId: e.companyId,
    id: nextId('ESD'),
    eventId: e.id,
    packageId: p.id,
    leadId: org.leadId,
    customerId: org.customerId,
    organizationName: org.name,
    contactName: str(v.contactName).slice(0, 120) || org.contactName,
    contactEmail: contactEmail || org.contactEmail,
    amount,
    stage: 'prospect',
    lostReason: '',
    ownerId: owner?.id ?? null,
    expectedPaymentDate: expected,
    actualPaymentDate: null,
    notes,
    signedAt: null,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  }
  sponsorDeals.push(d)
  log(e, user, `Added the sponsor ${d.organizationName} (${p.name})`)
  if (stage !== 'prospect') applyStage(d, e, user, stage, '', null)
  return delay(dealView(d, e, user))
}

/** GET /events/:id/sponsors/:sponsorId */
export async function getDeal(user: User, id: string, dealId: string): Promise<SponsorDeal> {
  const e = await organizedEvent(user, id, 'view')
  const d = await dealFor(user, e, dealId)
  runSponsorReminders(e.companyId)
  return delay(dealView(d, e, user))
}

/** PATCH /events/:id/sponsors/:sponsorId — fields (stage changes go through /stage). */
export async function updateDeal(user: User, id: string, dealId: string, input: SponsorDealUpdate | null): Promise<SponsorDeal> {
  const e = await organizedEvent(user, id, 'edit')
  const d = await dealFor(user, e, dealId)
  const v = input ?? {}
  let pkg = sponsorPackages.find((x) => x.companyId === d.companyId && x.id === d.packageId)
  if (v.packageId !== undefined && str(v.packageId) !== d.packageId) {
    const next = findInTenant(sponsorPackages, user, (x) => x.id === str(v.packageId) && x.eventId === e.id)
    if (!next) throw new CodedApiError(PACKAGE_NOT_FOUND, 422, 'invalid_package')
    if (WON_SPONSOR_STAGES.includes(d.stage)) assertSlot(next, d.id)
    pkg = next
  }
  const price = pkg?.price ?? d.amount
  let amount = d.amount
  if (v.amount !== undefined && v.amount !== null) {
    const a = cleanAmount(v.amount, price)
    if (typeof a === 'string') return fail(a, 422)
    amount = a
  } else if (pkg && pkg.id !== d.packageId) amount = pkg.price // another package: its price unless an amount is given
  let ownerId = d.ownerId
  if (v.ownerId !== undefined) {
    const owner = memberOf(e.companyId, v.ownerId)
    if (typeof owner === 'string') return fail(owner, 422)
    ownerId = owner?.id ?? null
  }
  const expected = v.expectedPaymentDate === undefined ? d.expectedPaymentDate : isoDateOrNull(v.expectedPaymentDate, 'Expected payment date')
  if (Array.isArray(expected)) return fail(expected[0], 422)
  const actual = v.actualPaymentDate === undefined ? d.actualPaymentDate : isoDateOrNull(v.actualPaymentDate, 'Payment date')
  if (Array.isArray(actual)) return fail(actual[0], 422)
  const notes = v.notes === undefined ? d.notes : str(v.notes)
  if (notes.length > 2000) return fail('Keep the notes under 2,000 characters.', 422)
  const contactEmail = v.contactEmail === undefined ? d.contactEmail : str(v.contactEmail).toLowerCase()
  if (contactEmail && !EMAIL_RE.test(contactEmail)) return fail(`${contactEmail} isn’t a valid email address.`, 422)
  Object.assign(d, {
    packageId: pkg?.id ?? d.packageId,
    amount,
    ownerId,
    expectedPaymentDate: expected,
    actualPaymentDate: actual,
    notes,
    contactEmail,
    contactName: v.contactName === undefined ? d.contactName : str(v.contactName).slice(0, 120),
    updatedAt: nowIso(),
  })
  return delay(dealView(d, e, user))
}

/** POST /events/:id/sponsors/:sponsorId/stage { stage, lost_reason?, actual_payment_date? } */
export async function moveDeal(user: User, id: string, dealId: string, input: Partial<SponsorStageInput> | null): Promise<SponsorDeal> {
  const e = await organizedEvent(user, id, 'edit')
  const d = await dealFor(user, e, dealId)
  const to = str(input?.stage) as SponsorStage
  if (!SPONSOR_STAGES.includes(to)) return fail(`Stage must be one of: ${SPONSOR_STAGES.join(', ')}.`, 422)
  const paidOn = isoDateOrNull(input?.actualPaymentDate, 'Payment date')
  if (Array.isArray(paidOn)) return fail(paidOn[0], 422)
  applyStage(d, e, user, to, str(input?.lostReason), paidOn)
  return delay(dealView(d, e, user))
}

/** DELETE /events/:id/sponsors/:sponsorId — removes the deal and its deliverables (linked tasks stay). */
export async function deleteDeal(user: User, id: string, dealId: string): Promise<{ removed: true }> {
  const e = await organizedEvent(user, id, 'edit')
  const d = await dealFor(user, e, dealId)
  for (let i = sponsorDeliverables.length - 1; i >= 0; i--) {
    const x = sponsorDeliverables[i]
    if (x.companyId === d.companyId && x.dealId === d.id) sponsorDeliverables.splice(i, 1)
  }
  sponsorDeals.splice(sponsorDeals.indexOf(d), 1)
  log(e, user, `Removed the sponsor ${d.organizationName}`)
  return delay({ removed: true as const })
}

/* ---------------- Deliverables ---------------- */

async function deliverableFor(user: User, d: Tenant<SponsorDealRecord>, deliverableId: string): Promise<Tenant<SponsorDeliverableRecord>> {
  const x = findInTenant(sponsorDeliverables, user, (r) => r.id === deliverableId && r.dealId === d.id)
  if (!x) return fail(DELIVERABLE_NOT_FOUND, 404)
  return x
}

/** PATCH /events/:id/sponsors/:sponsorId/deliverables/:deliverableId { status?, due_date?, owner_id? } */
export async function updateDeliverable(user: User, id: string, dealId: string, deliverableId: string, input: SponsorDeliverableInput | null): Promise<SponsorDeal> {
  const e = await organizedEvent(user, id, 'edit')
  const d = await dealFor(user, e, dealId)
  const x = await deliverableFor(user, d, deliverableId)
  const v = input ?? {}
  if (v.status !== undefined && !DELIVERABLE_STATUSES.includes(v.status)) return fail(`Status must be one of: ${DELIVERABLE_STATUSES.join(', ')}.`, 422)
  if (v.dueDate !== undefined && !isRealIsoDate(str(v.dueDate))) return fail('Due date must be a date (yyyy-MM-dd).', 422)
  let ownerId = x.ownerId
  if (v.ownerId !== undefined) {
    const owner = memberOf(e.companyId, v.ownerId)
    if (typeof owner === 'string') return fail(owner, 422)
    ownerId = owner?.id ?? null
  }
  if (v.dueDate !== undefined && str(v.dueDate) !== x.dueDate) {
    x.dueDate = str(v.dueDate)
    x.overdueNotifiedAt = null // re-armed: a new due date gets its own notice
  }
  if (v.status !== undefined) x.status = v.status
  x.ownerId = ownerId
  x.updatedAt = nowIso()
  const t = x.taskId ? tasks.find((k) => k.id === x.taskId && k.companyId === x.companyId) : undefined
  if (t && t.status !== 'done' && x.status === 'done') {
    t.status = 'done'
    t.completedAt = nowIso()
  }
  return delay(dealView(d, e, user))
}

/** POST …/deliverables/:deliverableId/task — a task linked to the event for the deliverable (idempotent). */
export async function createDeliverableTask(user: User, id: string, dealId: string, deliverableId: string): Promise<SponsorDeal> {
  const e = await organizedEvent(user, id, 'edit')
  const d = await dealFor(user, e, dealId)
  const x = await deliverableFor(user, d, deliverableId)
  if (x.taskId && tasks.some((t) => t.id === x.taskId && t.companyId === x.companyId)) return delay(dealView(d, e, user))
  const ownerId = x.ownerId ?? d.ownerId ?? user.id
  const now = nowIso()
  const taskId = nextTaskId()
  tasks.push({
    companyId: e.companyId,
    id: taskId,
    title: `${x.title} · ${d.organizationName}`,
    description: `Sponsor deliverable for ${e.name} (${d.organizationName}).`,
    ownerId,
    followerIds: ownerId === user.id ? [] : [user.id],
    priority: 'medium',
    dueDate: x.dueDate,
    status: x.status === 'done' ? 'done' : 'todo',
    link: { type: 'event', id: e.id },
    projectId: null,
    parentTaskId: null,
    estimatedHours: 0,
    templateTaskId: `sponsor-deliverable:${x.id}`,
    dayOffset: null,
    sortOrder: 0,
    blockedAt: null,
    blockedReason: null,
    reminderSentAt: null,
    overdueNotifiedAt: null,
    attachments: [],
    comments: [],
    history: [{ id: `${taskId}-h0`, kind: 'created', userId: user.id, at: now, summary: `Created from the sponsor deliverable “${x.title}”` }],
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    completedAt: x.status === 'done' ? now : null,
  })
  x.taskId = taskId
  x.updatedAt = now
  return delay(dealView(d, e, user))
}

/* ---------------- Reminders ---------------- */

export interface SponsorTick {
  overdue: number
}

/**
 * Overdue sponsor deliverables → one stored notification to the deliverable's owner (else the deal owner),
 * from the first day after the due date (company calendar at `at`), once per deliverable (overdue_notified_at).
 * Done deliverables and lost deals never notify. Runs lazily (lifecycle tick + the sponsor reads).
 */
export function runSponsorReminders(companyId: string, at: Date = clockNow()): SponsorTick {
  const today = companyDayOf(companyId, at).today
  const out: SponsorTick = { overdue: 0 }
  for (const x of sponsorDeliverables) {
    if (x.companyId !== companyId || x.overdueNotifiedAt || x.status === 'done' || x.dueDate >= today) continue
    const d = sponsorDeals.find((k) => k.companyId === companyId && k.id === x.dealId)
    const stamp = at.toISOString()
    x.overdueNotifiedAt = stamp
    if (!d || d.stage === 'lost') continue
    const to = users.find((u) => u.id === (x.ownerId ?? d.ownerId) && u.companyId === companyId && u.active !== false)
    if (!to) continue
    const late = daysBetweenIso(x.dueDate, today)
    pushNotification({
      companyId,
      userId: to.id,
      type: 'marketing-overdue',
      title: `${x.title} · ${d.organizationName}`,
      body: `Sponsor deliverable ${late} day${late === 1 ? '' : 's'} overdue`,
      link: `/events/${encodeURIComponent(d.eventId)}?tab=sponsors`,
      at: stamp,
    })
    out.overdue++
  }
  return out
}

onLifecycleTick('events.sponsors', (companyId, until) => runSponsorReminders(companyId, new Date(until)))
