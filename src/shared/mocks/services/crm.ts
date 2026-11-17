import { differenceInCalendarDays, differenceInCalendarMonths, isValid, parseISO } from 'date-fns'
import type { Contact, Customer, Lead, User } from '@/shared/types'
import type {
  ContactInput,
  ContactRow,
  ContactUpdateInput,
  Contract,
  ContractInput,
  ContractRow,
  ContractStatus,
  ContractUpdateInput,
  CustomerDetail,
  CustomerRow,
  CustomerUpdateInput,
} from '@/modules/crm/types'
import { can, inScope, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { departments } from '@/shared/mocks/data/departments'
import { formatUaeMobile, isUaeMobile } from '@/shared/lib/phone'
import { activities, contacts, customers, leads, notes, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { services } from '@/shared/mocks/data/services'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { automationRules, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'

/**
 * CRM mock API: customers (won companies), contacts across leads and customers, and contracts.
 * Everything is scoped by the Sales & CRM permission ('sales'), by record owner.
 */

/** Renewals inside this window raise the alert (spec: "Alert 30 days before the renewal date"; Settings > Automation). */
export const renewalAlertDays = () => automationRules.renewalAlertDays

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']

/* ---------------- Scope helpers ---------------- */

function scopeCheck(user: User) {
  const scope = scopeOf(user.role, 'sales')
  const team = teamIdsFor(user, users, departments)
  return (ownerId: string) => inScope(scope, user, ownerId, team)
}

async function ensureAccess(user: User): Promise<void> {
  if (scopeOf(user.role, 'sales') === 'hidden') await fail('Your role has no access to Sales & CRM.', 403)
}

async function ensureWrite(user: User, what: string): Promise<void> {
  if (!can(user.role, 'sales', 'edit')) await fail(`Your role can view ${what} but not change them.`, 403)
}

function visibleCustomers(user: User): Customer[] {
  const ok = scopeCheck(user)
  return customers.filter((c) => ok(c.ownerId))
}

async function customerFor(user: User, id: string, write = false): Promise<Customer> {
  await ensureAccess(user)
  const customer = customers.find((c) => c.id === id)
  if (!customer) return fail('That customer doesn’t exist.', 404)
  if (!scopeCheck(user)(customer.ownerId)) return fail('This customer belongs to someone outside your access.', 403)
  if (write) await ensureWrite(user, 'customers')
  return customer
}

/* ---------------- Contracts: derived figures ---------------- */

function daysTo(iso: string): number {
  return differenceInCalendarDays(parseISO(iso), new Date())
}

function effectiveStatus(c: Contract): ContractStatus {
  if (c.status === 'Cancelled') return 'Cancelled'
  const days = daysTo(c.renewalDate)
  if (days < 0) return 'Expired'
  if (days <= renewalAlertDays()) return 'Expiring'
  return 'Active'
}

function annualValue(c: Contract): number {
  return c.billing === 'Monthly' ? c.value * 12 : c.value
}

function mrrOf(c: Contract): number {
  if (c.billing === 'Monthly') return c.value
  if (c.billing === 'Annual') return Math.round(c.value / 12)
  return 0
}

/** What the contract has billed so far: one-off once, monthly per started month, annual per started year. */
function billedToDate(c: Contract): number {
  const start = parseISO(c.startDate)
  if (start > new Date()) return 0
  const end = c.status === 'Cancelled' ? new Date(Math.min(Date.now(), parseISO(c.renewalDate).getTime())) : new Date()
  const months = Math.max(1, differenceInCalendarMonths(end, start) + 1)
  if (c.billing === 'Monthly') return c.value * months
  if (c.billing === 'Annual') return c.value * Math.ceil(months / 12)
  return c.value
}

function contractRow(c: Contract): ContractRow {
  const status = effectiveStatus(c)
  const live = status === 'Active' || status === 'Expiring'
  return {
    ...c,
    status,
    customerName: customers.find((x) => x.id === c.customerId)?.name ?? 'Unknown customer',
    ownerName: ownerName(c.ownerId),
    serviceNames: c.serviceIds.map((id) => services.find((s) => s.id === id)?.name ?? id),
    daysToRenewal: daysTo(c.renewalDate),
    annualValue: annualValue(c),
    mrr: live ? mrrOf(c) : 0,
  }
}

const isLive = (c: ContractRow) => c.status === 'Active' || c.status === 'Expiring'

/* ---------------- Customers ---------------- */

function customerRow(c: Customer): CustomerRow {
  const rows = contracts.filter((k) => k.customerId === c.id).map(contractRow)
  const live = rows.filter(isLive)
  const next = live.map((k) => k.renewalDate).sort()[0] ?? null
  const last = activities
    .filter((a) => a.leadId === c.leadId)
    .map((a) => a.at)
    .sort()
    .at(-1)
  return {
    ...c,
    ownerName: ownerName(c.ownerId),
    contactsCount: contacts.filter((x) => x.leadId === c.leadId).length,
    activeContractValue: live.reduce((s, k) => s + k.annualValue, 0),
    activeContracts: live.length,
    nextRenewal: next,
    daysToRenewal: next ? daysTo(next) : null,
    lastActivityAt: last ?? null,
  }
}

export async function getCustomers(user: User): Promise<CustomerRow[]> {
  await ensureAccess(user)
  const rows = visibleCustomers(user)
    .map(customerRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return delay(rows)
}

export async function getCustomer(user: User, id: string): Promise<CustomerDetail> {
  const customer = await customerFor(user, id)
  const lead = leads.find((l) => l.id === customer.leadId)
  const rows = contracts
    .filter((k) => k.customerId === customer.id)
    .map(contractRow)
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
  const billed = rows.reduce((s, k) => s + billedToDate(k), 0)

  const detail: CustomerDetail = {
    ...customerRow(customer),
    lead: {
      id: customer.leadId,
      status: lead?.status ?? SYSTEM_STATUS.won,
      sourceType: lead?.sourceType ?? customer.sourceType,
      sourceDetail: lead?.sourceDetail ?? '',
      createdAt: lead?.createdAt ?? customer.createdAt,
      value: lead?.value ?? customer.wonValue,
      ownerName: ownerName(lead?.ownerId ?? customer.ownerId),
      serviceIds: lead?.serviceIds ?? customer.serviceIds,
      doNotContact: lead?.doNotContact ?? false,
    },
    contacts: contacts.filter((x) => x.leadId === customer.leadId),
    contracts: rows,
    recentActivities: activities
      .filter((a) => a.leadId === customer.leadId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10)
      .map((a) => ({ ...a, userName: ownerName(a.userId) })),
    notes: notes
      .filter((n) => n.leadId === customer.leadId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({ ...n, authorName: ownerName(n.authorId) })),
    lifetimeValue: rows.length ? billed : customer.wonValue,
  }
  return delay(detail)
}

/** Edits status and company details. Owner changes need team or full scope, like leads. */
export async function updateCustomer(user: User, id: string, input: CustomerUpdateInput): Promise<CustomerRow> {
  const customer = await customerFor(user, id, true)
  if (input.status !== undefined && !['Active', 'Paused', 'VIP'].includes(input.status)) {
    return fail('Status must be Active, Paused or VIP.', 422)
  }
  if (input.emirate !== undefined && input.emirate !== '' && !EMIRATES.includes(input.emirate)) {
    return fail('Pick one of the seven emirates.', 422)
  }
  let website = input.website?.trim()
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`
    try {
      const url = new URL(website)
      if (!url.hostname.includes('.')) throw new Error('no tld')
    } catch {
      return fail('Enter a valid website, e.g. https://company.ae.', 422)
    }
  }
  if (input.address !== undefined && input.address.length > 200) return fail('Keep the address under 200 characters.', 422)
  if (input.ownerId && input.ownerId !== customer.ownerId) {
    const scope = scopeOf(user.role, 'sales')
    if (scope === 'own') return fail('Only managers can reassign customers.', 403)
    if (scope === 'team' && !teamIdsFor(user, users, departments).includes(input.ownerId)) {
      return fail('You can only assign customers within your team.', 403)
    }
    if (!users.some((u) => u.id === input.ownerId)) return fail('That owner doesn’t exist.', 422)
    customer.ownerId = input.ownerId
  }
  if (input.status !== undefined) customer.status = input.status
  if (website !== undefined) customer.website = website
  if (input.address !== undefined) customer.address = input.address.trim()
  if (input.emirate !== undefined) customer.emirate = input.emirate
  return delay(customerRow(customer))
}

/* ---------------- Contacts ---------------- */

/** The record a contact hangs off: the customer once its lead is won, otherwise the lead. */
function contactRow(c: Contact, lead: Lead): ContactRow {
  const customer = lead.customerId ? customers.find((x) => x.id === lead.customerId) : undefined
  return {
    ...c,
    company: customer?.name ?? lead.company,
    recordType: customer ? 'Customer' : 'Lead',
    recordId: customer?.id ?? lead.id,
    ownerName: ownerName(customer?.ownerId ?? lead.ownerId),
  }
}

function contactOwner(lead: Lead): string {
  const customer = lead.customerId ? customers.find((x) => x.id === lead.customerId) : undefined
  return customer?.ownerId ?? lead.ownerId
}

export async function getContacts(user: User): Promise<ContactRow[]> {
  await ensureAccess(user)
  const ok = scopeCheck(user)
  const rows: ContactRow[] = []
  for (const c of contacts) {
    const lead = leads.find((l) => l.id === c.leadId)
    if (lead && ok(contactOwner(lead))) rows.push(contactRow(c, lead))
  }
  rows.sort((a, b) => a.company.localeCompare(b.company) || Number(b.isDecisionMaker) - Number(a.isDecisionMaker))
  return delay(rows)
}

function validateContact(input: ContactUpdateInput): string | null {
  if (input.name !== undefined && !input.name.trim()) return 'Name is required.'
  if (input.name && input.name.trim().length > 80) return 'Keep the name under 80 characters.'
  if (input.mobile && !isUaeMobile(input.mobile)) return 'Use the UAE mobile format +971 5X XXX XXXX.'
  if (input.email && !EMAIL_RE.test(input.email.trim())) return 'Enter a valid email address.'
  return null
}

export async function createContact(user: User, input: ContactInput): Promise<ContactRow> {
  await ensureAccess(user)
  await ensureWrite(user, 'contacts')
  let lead: Lead | undefined
  if (input.recordType === 'Customer') {
    const customer = await customerFor(user, input.recordId, true)
    lead = leads.find((l) => l.id === customer.leadId)
  } else {
    lead = leads.find((l) => l.id === input.recordId)
    if (lead && !scopeCheck(user)(contactOwner(lead))) return fail('This lead belongs to someone outside your access.', 403)
  }
  if (!lead) return fail(`That ${input.recordType.toLowerCase()} doesn’t exist.`, 404)

  const error = validateContact(input) ?? (!input.name?.trim() ? 'Name is required.' : null)
  if (error) return fail(error, 422)
  if (!input.mobile.trim() && !input.email.trim()) return fail('Add a mobile or an email so the contact can be reached.', 422)
  const email = input.email.trim().toLowerCase()
  if (email && contacts.some((c) => c.leadId === lead.id && c.email.toLowerCase() === email)) {
    return fail('A contact with this email already exists for this company.', 409)
  }

  const contact: Contact = {
    id: `CT-${Date.now().toString(36)}`,
    leadId: lead.id,
    name: input.name.trim(),
    title: input.title.trim(),
    mobile: input.mobile.trim() ? formatUaeMobile(input.mobile) : '',
    email,
    isDecisionMaker: input.isDecisionMaker,
  }
  contacts.push(contact)
  return delay(contactRow(contact, lead))
}

export async function updateContact(user: User, id: string, input: ContactUpdateInput): Promise<ContactRow> {
  await ensureAccess(user)
  const contact = contacts.find((c) => c.id === id)
  const lead = contact && leads.find((l) => l.id === contact.leadId)
  if (!contact || !lead) return fail('That contact doesn’t exist.', 404)
  if (!scopeCheck(user)(contactOwner(lead))) return fail('This contact belongs to someone outside your access.', 403)
  await ensureWrite(user, 'contacts')
  const error = validateContact(input)
  if (error) return fail(error, 422)
  const mobile = input.mobile !== undefined ? input.mobile.trim() : contact.mobile
  const email = input.email !== undefined ? input.email.trim().toLowerCase() : contact.email
  if (!mobile && !email) return fail('Keep a mobile or an email so the contact can be reached.', 422)

  const isPrimary = contacts.find((c) => c.leadId === lead.id)?.id === contact.id
  if (input.name !== undefined) contact.name = input.name.trim()
  if (input.title !== undefined) contact.title = input.title.trim()
  contact.mobile = mobile ? formatUaeMobile(mobile) : ''
  contact.email = email
  if (input.isDecisionMaker !== undefined) contact.isDecisionMaker = input.isDecisionMaker
  // Keep the lead's primary contact fields in step with its first contact.
  if (isPrimary) {
    lead.contactName = contact.name
    lead.contactEmail = contact.email
    lead.mobile = contact.mobile
  }
  return delay(contactRow(contact, lead))
}

/* ---------------- Contracts ---------------- */

export async function getContracts(user: User): Promise<ContractRow[]> {
  await ensureAccess(user)
  const visible = new Set(visibleCustomers(user).map((c) => c.id))
  const rows = contracts
    .filter((k) => visible.has(k.customerId))
    .map(contractRow)
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
  return delay(rows)
}

function validDate(iso: string | undefined): boolean {
  return !!iso && isValid(parseISO(iso))
}

/** `currentIds`: services already on the contract — they stay valid even if since deactivated. */
function validateContract(
  input: ContractUpdateInput,
  merged: { startDate: string; renewalDate: string },
  currentIds: string[] = [],
): string | null {
  if (input.title !== undefined && !input.title.trim()) return 'Give the contract a title.'
  if (input.title && input.title.trim().length > 120) return 'Keep the title under 120 characters.'
  if (input.serviceIds !== undefined) {
    if (input.serviceIds.length === 0) return 'Pick at least one service.'
    const unknown = input.serviceIds.find((id) => !services.some((s) => s.id === id))
    if (unknown) return `Service ${unknown} isn’t in the catalog.`
    const inactive = input.serviceIds.find((id) => !currentIds.includes(id) && !services.some((s) => s.id === id && s.active))
    if (inactive) return `${services.find((s) => s.id === inactive)?.name ?? inactive} is no longer offered; pick an active service.`
  }
  if (input.value !== undefined && (!Number.isFinite(input.value) || input.value <= 0)) return 'Value must be more than AED 0.'
  if (input.billing !== undefined && !['One-off', 'Monthly', 'Annual'].includes(input.billing)) {
    return 'Billing must be One-off, Monthly or Annual.'
  }
  if (!validDate(merged.startDate) || !validDate(merged.renewalDate)) return 'Enter valid start and renewal dates.'
  if (parseISO(merged.renewalDate) <= parseISO(merged.startDate)) return 'The renewal date must be after the start date.'
  if (input.status !== undefined && !['Active', 'Cancelled'].includes(input.status)) {
    return 'A contract can only be set Active or Cancelled; expiry is worked out from the renewal date.'
  }
  return null
}

async function ownerAllowed(user: User, ownerId: string, current: string): Promise<void> {
  if (ownerId === current) return
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'own') await fail('Only managers can assign contracts to someone else.', 403)
  if (scope === 'team' && !teamIdsFor(user, users, departments).includes(ownerId)) await fail('You can only assign within your team.', 403)
  if (!users.some((u) => u.id === ownerId)) await fail('That owner doesn’t exist.', 422)
}

export async function createContract(user: User, input: ContractInput): Promise<ContractRow> {
  const customer = await customerFor(user, input.customerId, true)
  const error = validateContract(
    { ...input, title: input.title ?? '', serviceIds: input.serviceIds ?? [] },
    { startDate: input.startDate, renewalDate: input.renewalDate },
  )
  if (error) return fail(error, 422)
  const ownerId = input.ownerId || customer.ownerId
  await ownerAllowed(user, ownerId, customer.ownerId)

  const contract: Contract = {
    id: `CON-${1001 + contracts.length}`,
    customerId: customer.id,
    title: input.title.trim(),
    serviceIds: [...new Set(input.serviceIds)],
    value: Math.round(input.value),
    billing: input.billing,
    startDate: parseISO(input.startDate).toISOString(),
    renewalDate: parseISO(input.renewalDate).toISOString(),
    status: 'Active',
    ownerId,
  }
  contracts.push(contract)
  return delay(contractRow(contract))
}

export async function updateContract(user: User, id: string, input: ContractUpdateInput): Promise<ContractRow> {
  await ensureAccess(user)
  const contract = contracts.find((k) => k.id === id)
  if (!contract) return fail('That contract doesn’t exist.', 404)
  await customerFor(user, contract.customerId, true)
  const merged = { startDate: input.startDate ?? contract.startDate, renewalDate: input.renewalDate ?? contract.renewalDate }
  const error = validateContract(input, merged, contract.serviceIds)

  if (error) return fail(error, 422)
  if (input.ownerId) await ownerAllowed(user, input.ownerId, contract.ownerId)

  if (input.title !== undefined) contract.title = input.title.trim()
  if (input.serviceIds !== undefined) contract.serviceIds = [...new Set(input.serviceIds)]
  if (input.value !== undefined) contract.value = Math.round(input.value)
  if (input.billing !== undefined) contract.billing = input.billing
  if (input.startDate !== undefined) contract.startDate = parseISO(input.startDate).toISOString()
  if (input.renewalDate !== undefined) contract.renewalDate = parseISO(input.renewalDate).toISOString()
  if (input.status !== undefined) contract.status = input.status
  if (input.ownerId) contract.ownerId = input.ownerId
  return delay(contractRow(contract))
}
