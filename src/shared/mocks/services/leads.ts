import type { Activity, ActivityType, Lead, LeadStatus, Note, User } from '@/shared/types'
import { ApiError } from '@/shared/lib/apiError'
import { OUTREACH_TYPES } from '@/shared/lib/constants'
import { automationRules, isClosedStatus, statusOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import {
  coldStatusKey,
  DAY_MS,
  isActiveIndustry,
  isActiveLossReason,
  isActiveSource,
  isActiveStatus,
  isActiveSubIndustry,
  isReopenEligible,
  statusLabelOf,
} from '@/shared/mocks/lookupChecks'
import { can, inScope, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { departments } from '@/shared/mocks/data/departments'
import { isUaeMobile, normalizeUaeMobile } from '@/shared/lib/phone'
import { activities, contacts, customerFromLead, customers, leads, notes, tasks, users } from '@/shared/mocks/db'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { services as catalog } from '@/shared/mocks/data/services'
import type {
  LeadRow,
  LeadDetail,
  LeadUpdateInput,
  MoveLeadInput,
  ActivityView,
  NoteView,
  TaskView,
  DuplicateMatch,
  QuickAddInput,
  ContactInput,
  LeadCreateInput,
  LeadOwnerOption,
} from '@/modules/leads/types'

/** Leads the user may see under their Sales & CRM scope. */
export function visibleLeads(user: User): Lead[] {
  const scope = scopeOf(user.role, 'sales')
  const team = teamIdsFor(user, users, departments)
  return leads.filter((l) => inScope(scope, user, l.ownerId, team))
}

export async function getLeads(user: User): Promise<LeadRow[]> {
  if (scopeOf(user.role, 'sales') === 'hidden') {
    await delay(null)
    throw new ApiError('Your role has no access to leads.', 403)
  }
  const rows = visibleLeads(user)
    .map(toRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return delay(rows)
}

/* ------------------------------------------------------------------------------------------
 * Leads: detail, pipeline moves, activity, notes, tasks, quick add and duplicate checks
 * ---------------------------------------------------------------------------------------- */

/**
 * A small share of pipeline moves fail on purpose so the board's optimistic rollback is
 * visible in the demo. Set to 0 to turn it off.
 */
const MOVE_FAILURE_RATE = 0.08

export function toRow(lead: Lead): LeadRow {
  return { ...lead, ownerName: ownerName(lead.ownerId), reopenEligible: isReopenEligible(lead) }
}

/** Finds a lead the user may see; with `write`, also checks they may change it. */
async function leadFor(user: User, id: string, write = false): Promise<Lead> {
  const scope = scopeOf(user.role, 'sales')
  const lead = leads.find((l) => l.id === id)
  if (!lead) return fail('That lead doesn’t exist.', 404)
  if (!inScope(scope, user, lead.ownerId, teamIdsFor(user, users, departments))) {
    return fail('This lead belongs to someone outside your access.', 403)
  }
  if (write && !can(user.role, 'sales', 'edit')) return fail('Your role can view leads but not change them.', 403)
  return lead
}

export async function getLead(user: User, id: string): Promise<LeadDetail> {
  const lead = await leadFor(user, id)
  return delay({ ...toRow(lead), contacts: contacts.filter((c) => c.leadId === id), website: leadWebsites.get(id) ?? '' })
}

/**
 * Moves a lead to a stage, enforcing what the target status `requires` (from the lookups).
 * "convert" (Won) converts to a customer; moving to No response schedules the next follow-up
 * `noResponseFollowUpDays` later; closed (won/lost/parked) statuses clear the follow-up.
 */
export async function moveLeadStage(user: User, input: MoveLeadInput): Promise<LeadRow> {
  const lead = await leadFor(user, input.id, true)
  if (input.status === lead.status) return delay(toRow(lead))

  const target = statusOf(input.status)
  if (!target || !target.active) return fail('Pick a status from the list.', 422)
  if (target.requires === 'loss-reason') {
    if (!input.lossReason?.trim()) return fail('A reason is required to close this lead.', 422)
    if (!isActiveLossReason(input.lossReason)) return fail('Pick a loss reason from the list.', 422)
  }
  if (target.requires === 'next-step' && (!input.nextStep?.trim() || !input.nextFollowUpDate)) {
    return fail('Record the next step and its date first.', 422)
  }
  if (Math.random() < MOVE_FAILURE_RATE) {
    return fail(`The server didn’t save the move for ${lead.company}. It’s back where it was.`, 503)
  }

  const wasClosed = isClosedStatus(lead.status)
  const now = Date.now()
  lead.status = input.status
  lead.stageChangedAt = new Date(now).toISOString()
  if (target.kind !== 'open') lead.nextFollowUpDate = null
  if (target.requires === 'loss-reason') {
    lead.lossReason = input.lossReason ?? ''
  } else if (target.requires === 'next-step') {
    lead.nextStep = input.nextStep ?? ''
  } else if (target.kind === 'won' && !lead.customerId) {
    const customerId = `C-${lead.id.slice(2)}`
    // Company, industry, website, emirate, value and services carry over from the lead.
    customers.push(customerFromLead(lead, { id: customerId, wonAt: new Date(now).toISOString() }))
    lead.customerId = customerId
  }
  if (target.kind === 'open') {
    if (input.status === SYSTEM_STATUS.noResponse) {
      // Spec: "No response: the system sets a follow-up two days later."
      lead.nextFollowUpDate = new Date(now + automationRules.noResponseFollowUpDays * DAY_MS).toISOString()
    } else if (input.nextFollowUpDate) {
      lead.nextFollowUpDate = input.nextFollowUpDate
    } else if (wasClosed || !lead.nextFollowUpDate) {
      // Reopened (or never scheduled): the next contact is due tomorrow.
      lead.nextFollowUpDate = new Date(now + DAY_MS).toISOString()
    }
    if (wasClosed) lead.lossReason = ''
  }
  return delay(toRow(lead))
}

export async function setDoNotContact(user: User, id: string, value: boolean): Promise<LeadRow> {
  const lead = await leadFor(user, id, true)
  lead.doNotContact = value
  return delay(toRow(lead))
}

export async function getLeadActivities(user: User, id: string): Promise<ActivityView[]> {
  await leadFor(user, id)
  const list = activities
    .filter((a) => a.leadId === id)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((a) => ({ ...a, userName: ownerName(a.userId) }))
  return delay(list)
}

export async function logActivity(
  user: User,
  input: { leadId: string; type: ActivityType; summary: string },
): Promise<ActivityView> {
  const lead = await leadFor(user, input.leadId, true)
  if (lead.doNotContact && OUTREACH_TYPES.includes(input.type)) {
    return fail(`${lead.company} is marked Do Not Contact, so calls, emails and WhatsApp are blocked.`, 422)
  }
  if (!input.summary.trim()) return fail('Add a short summary of what happened.', 422)
  const activity: Activity = {
    id: `A-${Date.now().toString(36)}`,
    leadId: lead.id,
    type: input.type,
    summary: input.summary.trim(),
    userId: user.id,
    at: new Date().toISOString(),
  }
  activities.push(activity)
  const view: ActivityView = { ...activity, userName: user.name }
  if (!OUTREACH_TYPES.includes(input.type)) return delay(view)

  if (lead.status === SYSTEM_STATUS.new && isActiveStatus(SYSTEM_STATUS.contacted)) {
    lead.status = SYSTEM_STATUS.contacted
    lead.stageChangedAt = activity.at
  } else if (lead.status === SYSTEM_STATUS.noResponse) {
    // Spec: "After 3 attempts with no reply, the lead becomes Cold and is parked."
    const attempts = activities.filter(
      (a) => a.leadId === lead.id && OUTREACH_TYPES.includes(a.type) && a.at > lead.stageChangedAt,
    ).length
    const cold = coldStatusKey()
    if (cold && attempts >= automationRules.attemptsBeforeCold) {
      lead.status = cold
      lead.stageChangedAt = new Date().toISOString()
      lead.nextFollowUpDate = null
      view.autoStatus = { from: SYSTEM_STATUS.noResponse, to: cold, label: statusLabelOf(cold), attempts }
    } else {
      // Each unanswered attempt schedules the next one `noResponseFollowUpDays` later.
      lead.nextFollowUpDate = new Date(Date.now() + automationRules.noResponseFollowUpDays * DAY_MS).toISOString()
    }
  }
  return delay(view)
}

export async function getLeadNotes(user: User, id: string): Promise<NoteView[]> {
  await leadFor(user, id)
  const list = notes
    .filter((n) => n.leadId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => ({ ...n, authorName: ownerName(n.authorId) }))
  return delay(list)
}

export async function addLeadNote(user: User, input: { leadId: string; body: string }): Promise<NoteView> {
  await leadFor(user, input.leadId, true)
  if (!input.body.trim()) return fail('A note can’t be empty.', 422)
  const note: Note = {
    id: `N-${Date.now().toString(36)}`,
    leadId: input.leadId,
    body: input.body.trim(),
    authorId: user.id,
    createdAt: new Date().toISOString(),
  }
  notes.push(note)
  return delay({ ...note, authorName: user.name })
}

export async function getLeadTasks(user: User, id: string): Promise<TaskView[]> {
  await leadFor(user, id)
  const list = tasks
    .filter((t) => t.leadId === id)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((t) => ({ ...t, ownerName: ownerName(t.ownerId) }))
  return delay(list)
}

/* ------------------------------------------------------------------------------------------
 * Duplicate detection (company name, website/email domain, email)
 * ---------------------------------------------------------------------------------------- */

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c|fze|fzco|co|company|group|est|trading|ltd)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Free-mail and webmail domains never identify a company. */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'zoho.com',
  'emirates.net.ae',
  'eim.ae',
])

/** "https://www.Acme.ae/about" → "acme.ae"; "a@acme.ae" → "acme.ae". Free-mail domains give ''. */
export function domainOf(value: string): string {
  const v = value.trim().toLowerCase()
  if (!v) return ''
  const host = v.includes('@') ? (v.split('@').pop() ?? '') : (v.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0] ?? '')
  const domain = host.replace(/^www\./, '').replace(/\.$/, '')
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) return ''
  return FREE_MAIL_DOMAINS.has(domain) ? '' : domain
}

/** Websites captured by the full form / import; seeded leads only have email domains. */
export const leadWebsites = new Map<string, string>()

export interface DuplicateProbe {
  company: string
  emails: string[]
  website?: string
  excludeId?: string
}

/** Every existing lead matching a probe, one entry per lead with the strongest reason. */
export function findDuplicates(probe: DuplicateProbe): DuplicateMatch[] {
  const name = normalizeCompany(probe.company)
  const emails = probe.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'))
  const domains = new Set([...emails.map(domainOf), domainOf(probe.website ?? '')].filter(Boolean))
  const matches: DuplicateMatch[] = []
  for (const l of leads) {
    if (l.id === probe.excludeId) continue
    const leadEmails = [l.contactEmail, ...contacts.filter((c) => c.leadId === l.id).map((c) => c.email)]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    const leadDomains = new Set([...leadEmails.map(domainOf), domainOf(leadWebsites.get(l.id) ?? '')].filter(Boolean))
    const reason: DuplicateMatch['reason'] | null =
      name.length > 2 && normalizeCompany(l.company) === name
        ? 'company'
        : emails.some((e) => leadEmails.includes(e))
          ? 'email'
          : [...domains].some((d) => leadDomains.has(d))
            ? 'domain'
            : null
    if (reason) matches.push({ leadId: l.id, company: l.company, ownerName: ownerName(l.ownerId), status: l.status, reason })
  }
  return matches
}

/** Matches across every lead, not just the caller's scope — a duplicate is a duplicate. */
export async function checkDuplicates(input: {
  company: string
  email: string
  emails?: string[]
  website?: string
  excludeId?: string
}): Promise<DuplicateMatch[]> {
  return delay(
    findDuplicates({
      company: input.company,
      emails: [input.email, ...(input.emails ?? [])],
      website: input.website,
      excludeId: input.excludeId,
    }),
  )
}

/** Managers (team or full sales scope) may override a duplicate block. */
export function canOverrideDuplicates(user: User): boolean {
  const scope = scopeOf(user.role, 'sales')
  return scope === 'full' || scope === 'team'
}

function duplicateMessage(matches: DuplicateMatch[]): string {
  const m = matches[0]
  const why = m.reason === 'company' ? 'company name' : m.reason === 'domain' ? 'domain' : 'email'
  return `${m.company} (${m.leadId}, owned by ${m.ownerName}) already has the same ${why}.`
}

/* ------------------------------------------------------------------------------------------
 * Owners and assignment
 * ---------------------------------------------------------------------------------------- */

function openLoad(id: string): number {
  return leads.filter((l) => l.ownerId === id && !isClosedStatus(l.status)).length
}

/** People the caller may assign leads to: everyone selling (full), the team (team), or only themselves. */
export function assignableOwners(user: User): User[] {
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'full') {
    return users.filter((u) => u.active && ['full', 'team', 'own'].includes(scopeOf(u.role, 'sales')))
  }
  if (scope === 'team') {
    const team = teamIdsFor(user, users, departments)
    return users.filter((u) => u.active && team.includes(u.id))
  }
  return [user]
}

/** GET /leads/owners */
export async function getLeadOwners(user: User): Promise<LeadOwnerOption[]> {
  if (!can(user.role, 'sales', 'create')) return fail('Your role can’t assign leads.', 403)
  const list = assignableOwners(user)
    .map((u) => ({ id: u.id, name: u.name, title: u.title, role: u.role, openLeads: openLoad(u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return delay(list)
}

/**
 * Auto-assignment: full scope → least-loaded Sales Agent; team scope → least-loaded agent in the
 * team (or the manager); own scope → the caller.
 */
export function autoOwnerFor(user: User): string {
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'own') return user.id
  const pool =
    scope === 'full'
      ? users.filter((u) => u.active && u.role === 'Sales Agent')
      : users.filter((u) => u.active && teamIdsFor(user, users, departments).includes(u.id) && u.role === 'Sales Agent')
  return [...pool].sort((a, b) => openLoad(a.id) - openLoad(b.id))[0]?.id ?? user.id
}

/** Validates an explicit owner against the caller's reach; returns an error message or null. */
export function ownerProblem(user: User, ownerId: string): string | null {
  const owner = users.find((u) => u.id === ownerId)
  if (!owner) return 'That owner doesn’t exist.'
  if (!owner.active) return `${owner.name} is deactivated and can’t own leads.`
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'own' && ownerId !== user.id) return 'Only managers can assign leads to someone else.'
  if (scope === 'team' && !teamIdsFor(user, users, departments).includes(ownerId)) return 'You can only assign leads within your team.'
  return null
}

/* ------------------------------------------------------------------------------------------
 * Create and update
 * ---------------------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isActiveService = (id: string) => catalog.some((s) => s.id === id && s.active)

/**
 * Catalog service fields: new ids (not already on the lead) must be ACTIVE catalog services;
 * unchanged ids pass even if the service has since been deactivated. Returns the problem or null.
 */
export function serviceFieldsProblem(
  input: { serviceIds?: string[]; recommendedServiceId?: string | null },
  current?: Pick<Lead, 'serviceIds' | 'recommendedServiceId'>,
): string | null {
  if (input.serviceIds !== undefined) {
    if (!Array.isArray(input.serviceIds)) return 'Services of interest must be a list of catalog services.'
    const kept = new Set(current?.serviceIds ?? [])
    const bad = input.serviceIds.find((sid) => !kept.has(sid) && !isActiveService(sid))
    if (bad) return `${bad} isn’t an active catalog service.`
  }
  const rec = input.recommendedServiceId
  if (rec && rec !== current?.recommendedServiceId && !isActiveService(rec)) {
    return 'Pick an active service from the catalog as the recommended service.'
  }
  return null
}

function nextLeadId(): string {
  let n = 1001 + leads.length
  while (leads.some((l) => l.id === `L-${n}`)) n++
  return `L-${n}`
}

function cleanContacts(list: ContactInput[]): ContactInput[] {
  return list
    .map((c) => ({
      ...c,
      name: (c.name ?? '').trim(),
      title: (c.title ?? '').trim(),
      mobile: (c.mobile ?? '').trim() ? (normalizeUaeMobile(c.mobile) ?? c.mobile.trim()) : '',
      email: (c.email ?? '').trim().toLowerCase(),
      isDecisionMaker: !!c.isDecisionMaker,
    }))
    .filter((c) => c.name || c.mobile || c.email)
}

/** Field rules shared by the form and the import; returns the first problem or null. */
export function validateLeadFields(input: {
  company: string
  sourceType: string
  industry: string
  subIndustry?: string
  status?: string
  contacts: ContactInput[]
}): string | null {
  if (!input.company.trim()) return 'Company is required.'
  if (!isActiveSource(input.sourceType)) return 'Pick a source from the list.'
  if (!isActiveIndustry(input.industry)) return 'Pick an industry from the list.'
  if (input.subIndustry && !isActiveSubIndustry(input.industry, input.subIndustry)) {
    return `${input.subIndustry} isn’t a sub-industry of ${input.industry}.`
  }
  if (input.status && !isActiveStatus(input.status)) return 'Pick a status from the list.'
  for (const c of input.contacts) {
    if (c.mobile && !isUaeMobile(c.mobile)) return `${c.mobile} isn’t a UAE mobile (+971 5X XXX XXXX).`
    if (c.email && !EMAIL_RE.test(c.email)) return `${c.email} isn’t a valid email address.`
  }
  return null
}

function replaceContacts(leadId: string, list: ContactInput[]): void {
  for (let i = contacts.length - 1; i >= 0; i--) if (contacts[i].leadId === leadId) contacts.splice(i, 1)
  const stamp = Date.now().toString(36)
  list.forEach((c, i) => {
    contacts.push({
      id: c.id && !c.id.startsWith('new-') ? c.id : `CT-${leadId}-${stamp}-${i + 1}`,
      leadId,
      name: c.name,
      title: c.title,
      mobile: c.mobile,
      email: c.email,
      isDecisionMaker: c.isDecisionMaker,
    })
  })
}

export interface InsertOptions {
  status?: LeadStatus
}

/**
 * Writes an already validated lead to the db. Used by POST /leads and the importer, so both
 * apply the same defaults, contact handling and auto-assignment.
 */
export function insertLead(user: User, input: LeadCreateInput, opts: InsertOptions = {}): Lead {
  const id = nextLeadId()
  const now = new Date().toISOString()
  const list = cleanContacts(input.contacts)
  const primary = list[0]
  const status = opts.status ?? SYSTEM_STATUS.new
  const lead: Lead = {
    id,
    company: input.company.trim(),
    contactName: primary?.name ?? '',
    contactEmail: primary?.email ?? '',
    mobile: primary?.mobile ?? '',
    industry: input.industry,
    subIndustry: input.subIndustry ?? '',
    sourceType: input.sourceType,
    sourceDetail: input.sourceDetail?.trim() ?? '',
    status,
    stageChangedAt: now,
    ownerId: input.ownerId || autoOwnerFor(user),
    value: Math.max(0, Number(input.value) || 0),
    nextFollowUpDate: isClosedStatus(status)
      ? null
      : (input.nextFollowUpDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
    createdAt: now,
    doNotContact: !!input.doNotContact,
    nextStep: input.nextStep?.trim() ?? '',
    lossReason: '',
    customerId: null,
    companyServices: [...new Set((input.companyServices ?? []).map((s) => s.trim()).filter(Boolean))],
    serviceIds: [...new Set(input.serviceIds ?? [])],
    recommendedServiceId: input.recommendedServiceId || null,
    recommendedServiceText: null,
    score: 25,
  }
  leads.push(lead)
  if (input.website?.trim()) leadWebsites.set(id, input.website.trim())
  replaceContacts(id, list)
  if (input.note?.trim()) {
    notes.push({ id: `N-${id}-${Date.now().toString(36)}`, leadId: id, body: input.note.trim(), authorId: user.id, createdAt: now })
  }
  return lead
}

function isFullInput(input: QuickAddInput | LeadCreateInput): input is LeadCreateInput {
  return Array.isArray((input as LeadCreateInput).contacts)
}

/**
 * POST /leads — quick add or full form. New leads start as New and are auto-assigned unless a
 * manager picks an owner. Duplicates (name, domain, email) answer 409 unless a manager forces.
 */
export async function createLead(user: User, raw: QuickAddInput | LeadCreateInput): Promise<LeadRow> {
  if (!can(user.role, 'sales', 'create')) return fail('Your role can’t add leads.', 403)
  const input: LeadCreateInput = isFullInput(raw)
    ? raw
    : {
        company: raw.company,
        sourceType: raw.sourceType,
        industry: raw.industry,
        contacts: [{ name: raw.contactName, title: '', mobile: raw.mobile, email: raw.email, isDecisionMaker: false }],
        nextFollowUpDate: null,
        force: raw.force,
      }
  const list = cleanContacts(input.contacts)
  const problem = validateLeadFields({ ...input, contacts: list }) ?? serviceFieldsProblem(input)
  if (problem) return fail(problem, 422)
  if (isFullInput(raw)) {
    if (list.length === 0) return fail('Add at least one contact.', 422)
    if (list.some((c) => !c.name)) return fail('Every contact needs a name.', 422)
  }
  if (input.website?.trim() && !domainOf(input.website) && !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(input.website.replace(/^https?:\/\//, ''))) {
    return fail('Enter the website as a domain, e.g. company.ae.', 422)
  }
  if (input.ownerId) {
    const ownerErr = ownerProblem(user, input.ownerId)
    if (ownerErr) return fail(ownerErr, 403)
  }

  const matches = findDuplicates({ company: input.company, emails: list.map((c) => c.email), website: input.website })
  if (matches.length > 0) {
    if (!input.force) return fail(`Possible duplicate: ${duplicateMessage(matches)}`, 409)
    if (!canOverrideDuplicates(user)) return fail('Only a manager can add a lead that duplicates an existing one.', 403)
  }

  const lead = insertLead(user, { ...input, contacts: list })
  return delay(toRow(lead))
}

/**
 * Edits a lead's fields. Owner changes need team or full scope; the new owner must be in reach.
 * When the name, website or contact emails change, the duplicate rule applies again.
 */
export async function updateLead(user: User, id: string, input: LeadUpdateInput): Promise<LeadRow> {
  const lead = await leadFor(user, id, true)
  const { contacts: contactRows, website, doNotContact, force, ...fields } = input
  if (fields.company !== undefined && !fields.company.trim()) return fail('Company is required.', 422)
  if (fields.mobile && !isUaeMobile(fields.mobile)) return fail('Use the UAE mobile format +971 5X XXX XXXX.', 422)
  if (fields.contactEmail && !EMAIL_RE.test(fields.contactEmail)) return fail('Enter a valid email address.', 422)
  // Unchanged values pass even if since deactivated; new values must be active list items.
  if (fields.sourceType !== undefined && fields.sourceType !== lead.sourceType && !isActiveSource(fields.sourceType)) {
    return fail('Pick a source from the list.', 422)
  }
  if (fields.industry !== undefined && fields.industry !== lead.industry && !isActiveIndustry(fields.industry)) {
    return fail('Pick an industry from the list.', 422)
  }
  const industry = fields.industry ?? lead.industry
  const sub = fields.subIndustry ?? (fields.industry !== undefined && fields.industry !== lead.industry ? '' : lead.subIndustry)
  const subUnchanged = industry === lead.industry && sub === lead.subIndustry
  if (sub && !subUnchanged && !isActiveSubIndustry(industry, sub)) return fail(`${sub} isn’t a sub-industry of ${industry}.`, 422)
  const serviceProblem = serviceFieldsProblem(fields, lead)
  if (serviceProblem) return fail(serviceProblem, 422)
  if (fields.ownerId && fields.ownerId !== lead.ownerId) {
    const scope = scopeOf(user.role, 'sales')
    if (scope === 'own') return fail('Only managers can reassign leads.', 403)
    if (scope === 'team' && !teamIdsFor(user, users, departments).includes(fields.ownerId)) {
      return fail('You can only assign leads within your team.', 403)
    }
    const owner = users.find((u) => u.id === fields.ownerId)
    if (!owner) return fail('That owner doesn’t exist.', 422)
    if (!owner.active) return fail(`${owner.name} is deactivated and can’t own leads.`, 422)
  }

  let list: ContactInput[] | null = null
  if (contactRows) {
    list = cleanContacts(contactRows)
    if (list.length === 0) return fail('Add at least one contact.', 422)
    if (list.some((c) => !c.name)) return fail('Every contact needs a name.', 422)
    for (const c of list) {
      if (c.mobile && !isUaeMobile(c.mobile)) return fail(`${c.mobile} isn’t a UAE mobile (+971 5X XXX XXXX).`, 422)
      if (c.email && !EMAIL_RE.test(c.email)) return fail(`${c.email} isn’t a valid email address.`, 422)
    }
  }

  // Re-check duplicates only when an identifying field changed, so old data never blocks an edit.
  const currentEmails = contacts.filter((c) => c.leadId === id).map((c) => c.email.toLowerCase())
  const nextEmails = list ? list.map((c) => c.email) : fields.contactEmail ? [fields.contactEmail] : []
  const nameChanged = fields.company !== undefined && normalizeCompany(fields.company) !== normalizeCompany(lead.company)
  const websiteChanged = website !== undefined && domainOf(website) !== domainOf(leadWebsites.get(id) ?? '')
  const newEmails = nextEmails.filter((e) => e && !currentEmails.includes(e.toLowerCase()))
  if (nameChanged || websiteChanged || newEmails.length > 0) {
    const matches = findDuplicates({
      company: nameChanged ? (fields.company ?? '') : '',
      emails: newEmails,
      website: websiteChanged ? website : '',
      excludeId: id,
    })
    if (matches.length > 0) {
      if (!force) return fail(`Possible duplicate: ${duplicateMessage(matches)}`, 409)
      if (!canOverrideDuplicates(user)) return fail('Only a manager can save a lead that duplicates another.', 403)
    }
  }

  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<Lead>
  Object.assign(lead, clean)
  lead.subIndustry = sub
  if (clean.company) lead.company = clean.company.trim()
  if (clean.value !== undefined) lead.value = Math.max(0, Number(clean.value) || 0)
  if (clean.companyServices) lead.companyServices = [...new Set(clean.companyServices.map((s) => s.trim()).filter(Boolean))]
  if (clean.serviceIds) lead.serviceIds = [...new Set(clean.serviceIds)]
  // Picking a catalog service replaces any legacy free-text recommendation.
  if (fields.recommendedServiceId !== undefined) {
    lead.recommendedServiceId = fields.recommendedServiceId || null
    if (lead.recommendedServiceId) lead.recommendedServiceText = null
  }
  if (doNotContact !== undefined) lead.doNotContact = doNotContact
  if (website !== undefined) {
    if (website.trim()) leadWebsites.set(id, website.trim())
    else leadWebsites.delete(id)
  }
  if (list) {
    replaceContacts(id, list)
    lead.contactName = list[0].name
    lead.contactEmail = list[0].email
    lead.mobile = list[0].mobile
  }
  return delay(toRow(lead))
}
