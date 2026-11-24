import type { Activity, ActivityType, Lead, LeadStatus, Note, User } from '@/shared/types'
import { recordLeadStatusChange } from '@/shared/mocks/data/leadStatusHistory'
import type { CountryCode } from '@/modules/tenancy/types'
import { ApiError } from '@/shared/lib/apiError'
import { OUTREACH_TYPES } from '@/shared/lib/constants'
import { automationRulesFor, isClosedStatus, isWonFlowStatus, statusOf, SYSTEM_STATUS, USE_WON_FLOW } from '@/shared/mocks/data/lookups'
import {
  coldStatusKey,
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
import { companyById } from '@/shared/mocks/data/tenancy'
import { isMobile, MOBILE_RULES, normalizeMobile } from '@/shared/lib/phone'
import { activities, CREST_SEED_LEAD_BASE, contacts, leads, notes, users } from '@/shared/mocks/db'
import { tasksForLink } from '@/shared/mocks/selectors/tasks'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { services as catalog } from '@/shared/mocks/data/services'
import { campaigns } from '@/shared/mocks/data/marketing'
import { CodedApiError, findInTenant, scoped, stamp, tenantOf, type Tenant, type TenantOwned } from '@/shared/mocks/tenant'
import { assertCapacity, noteUsage } from '@/shared/mocks/services/billing'
import { registerMap } from '@/shared/mocks/persist/registry'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { followUpInDays, isIsoDate } from '@/shared/domain/followUp'
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

/* ------------------------------------------------------------------------------------------
 * Tenant helpers shared by the sales services (leads, import, messages, CRM, quotations)
 * ---------------------------------------------------------------------------------------- */

/** A server row without its company id: what the client gets. */
export function untenant<T extends TenantOwned>(row: T): Omit<T, 'companyId'> {
  const { companyId: _companyId, ...rest } = row
  return rest
}

/** The country of the user's company (mobile validation, emirates). */
export function countryOf(user: Pick<User, 'companyId'>): CountryCode {
  const company = companyById(tenantOf(user))
  if (!company) throw new ApiError('Your workspace no longer exists.', 401)
  return company.regional.country
}

/** "UAE mobile (+971 5X XXX XXXX)" for the user's company country. */
export function mobileHint(country: CountryCode): string {
  const rule = MOBILE_RULES[country]
  return `${rule.countryName} mobile (${rule.example})`
}

/** Team ids for the Sales & CRM "team" scope, from the user's own company only. */
export function salesTeamOf(user: User): string[] {
  return teamIdsFor(user, scoped(users, user), scoped(departments, user))
}

/** Active users of the caller's company (owners, assignees). */
export const companyUser = (user: User, id: string | null | undefined): User | undefined =>
  id ? findInTenant(users, user, (u) => u.id === id) : undefined

/** Leads the user may see under their Sales & CRM scope (own company only). */
export function visibleLeads(user: User): Tenant<Lead>[] {
  const scope = scopeOf(user.role, 'sales')
  const team = salesTeamOf(user)
  return scoped(leads, user).filter((l) => inScope(scope, user, l.ownerId, team))
}

/**
 * The sales opportunities in scope: visibleLeads without the backing records of customers added
 * directly (they never went through the pipeline, so they would skew the list, board and win rates).
 */
export function pipelineLeads(user: User): Tenant<Lead>[] {
  return visibleLeads(user).filter((l) => !l.addedAsCustomer)
}

export async function getLeads(user: User): Promise<LeadRow[]> {
  if (scopeOf(user.role, 'sales') === 'hidden') {
    await delay(null)
    throw new ApiError('Your role has no access to leads.', 403)
  }
  const rows = pipelineLeads(user)
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

/**
 * The failure rate in effect: 0 under unit tests (deterministic), else MOVE_FAILURE_RATE. Browser
 * tests set the move-failure window global (0 = never fail, 1 = always fail) before the app loads;
 * it is read only in dev and tests, so a production build drops the hook.
 */
function moveFailureRate(): number {
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    const override = (globalThis as { __apexMoveFailureRate?: unknown }).__apexMoveFailureRate
    if (typeof override === 'number') return override
  }
  return import.meta.env.MODE === 'test' ? 0 : MOVE_FAILURE_RATE
}

export function toRow(lead: Tenant<Lead>): LeadRow {
  return { ...untenant(lead), ownerName: ownerName(lead.ownerId), reopenEligible: isReopenEligible(lead.companyId, lead) }
}

/** Finds a lead the user may see; with `write`, also checks they may change it. Other companies' leads are 404. */
async function leadFor(user: User, id: string, write = false): Promise<Tenant<Lead>> {
  const scope = scopeOf(user.role, 'sales')
  const lead = findInTenant(leads, user, (l) => l.id === id)
  if (!lead) return fail('That lead doesn’t exist.', 404)
  if (!inScope(scope, user, lead.ownerId, salesTeamOf(user))) {
    return fail('This lead belongs to someone outside your access.', 403)
  }
  if (write && !can(user.role, 'sales', 'edit')) return fail('Your role can view leads but not change them.', 403)
  return lead
}

export async function getLead(user: User, id: string): Promise<LeadDetail> {
  const lead = await leadFor(user, id)
  return delay({
    ...toRow(lead),
    contacts: scoped(contacts, user).filter((c) => c.leadId === id).map(untenant),
    website: leadWebsites.get(id) ?? '',
  })
}

/**
 * Moves a lead to a stage, enforcing the target status's flags (from the lookups, never its name):
 * `requiresLossReason` → a reason from the list; `requiresNextStep` → a next step and its follow-up
 * date (yyyy-MM-dd). A `won` status is refused with 409 `use_won_flow`: only the atomic Won flow
 * (services/won.ts) sets it. Moving to No response schedules the next follow-up
 * `noResponseFollowUpDays` after the company's today; closed (won/lost/cold/parked) statuses clear it.
 */
export async function moveLeadStage(user: User, input: MoveLeadInput): Promise<LeadRow> {
  const lead = await leadFor(user, input.id, true)
  if (input.status === lead.status) return delay(toRow(lead))
  const co = lead.companyId

  const target = statusOf(co, input.status)
  if (!target || !target.active) return fail('Pick a status from the list.', 422)
  // Winning creates the customer, contract, projects and tasks atomically: only POST /leads/:id/won does
  // that. Same rule as the client's moveActionFor: status type won.
  if (target.type === 'won') throw new CodedApiError(USE_WON_FLOW, 409, 'use_won_flow')
  if (target.requiresLossReason) {
    if (!input.lossReason?.trim()) return fail('A reason is required to close this lead.', 422)
    if (!isActiveLossReason(co, input.lossReason)) return fail('Pick a loss reason from the list.', 422)
  }
  if (target.requiresNextStep && (!input.nextStep?.trim() || !input.nextFollowUpDate)) {
    return fail('Record the next step and its date first.', 422)
  }
  if (input.nextFollowUpDate && !isIsoDate(input.nextFollowUpDate)) return fail(FOLLOW_UP_DATE_FORMAT, 422)
  if (Math.random() < moveFailureRate()) {
    return fail(`The server didn’t save the move for ${lead.company}. It’s back where it was.`, 503)
  }

  const wasClosed = isClosedStatus(co, lead.status)
  const now = Date.now()
  // Follow-ups are company-local calendar dates: "+N days" counts from the company's today.
  const today = companyDayOf(co).today
  recordLeadStatusChange(lead, lead.status, input.status, {
    changedBy: user.id,
    reason: input.lossReason ?? input.nextStep ?? null,
    at: new Date(now).toISOString(),
  })
  lead.status = input.status
  lead.stageChangedAt = new Date(now).toISOString()
  if (target.type !== 'open') lead.nextFollowUpDate = null
  if (target.requiresLossReason) {
    lead.lossReason = input.lossReason ?? ''
  } else if (target.requiresNextStep) {
    lead.nextStep = input.nextStep ?? ''
  }
  // (Won is refused above: customer conversion happens only in the atomic Won flow, services/won.ts.)
  if (target.type === 'open') {
    if (input.status === SYSTEM_STATUS.noResponse) {
      // Spec: "No response: the system sets a follow-up two days later."
      lead.nextFollowUpDate = followUpInDays(today, automationRulesFor(co).noResponseFollowUpDays)
    } else if (input.nextFollowUpDate) {
      lead.nextFollowUpDate = input.nextFollowUpDate
    } else if (wasClosed || !lead.nextFollowUpDate) {
      // Reopened (or never scheduled): the next contact is due tomorrow.
      lead.nextFollowUpDate = followUpInDays(today, 1)
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
  const list = scoped(activities, user)
    .filter((a) => a.leadId === id)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((a) => ({ ...untenant(a), userName: ownerName(a.userId) }))
  return delay(list)
}

export async function logActivity(
  user: User,
  input: { leadId: string; type: ActivityType; summary: string },
): Promise<ActivityView> {
  const lead = await leadFor(user, input.leadId, true)
  const co = lead.companyId
  if (lead.doNotContact && OUTREACH_TYPES.includes(input.type)) {
    return fail(`${lead.company} is marked Do Not Contact, so calls, emails and WhatsApp are blocked.`, 422)
  }
  if (!input.summary.trim()) return fail('Add a short summary of what happened.', 422)
  const activity: Tenant<Activity> = stamp(
    {
      id: `A-${Date.now().toString(36)}`,
      leadId: lead.id,
      type: input.type,
      summary: input.summary.trim(),
      userId: user.id,
      at: new Date().toISOString(),
    },
    user,
  )
  activities.push(activity)
  const view: ActivityView = { ...untenant(activity), userName: user.name }
  if (!OUTREACH_TYPES.includes(input.type)) return delay(view)

  const rules = automationRulesFor(co)
  if (lead.status === SYSTEM_STATUS.new && isActiveStatus(co, SYSTEM_STATUS.contacted)) {
    recordLeadStatusChange(lead, lead.status, SYSTEM_STATUS.contacted, { changedBy: null, reason: 'First contact logged', at: activity.at })
    lead.status = SYSTEM_STATUS.contacted
    lead.stageChangedAt = activity.at
  } else if (lead.status === SYSTEM_STATUS.noResponse) {
    // Spec: "After 3 attempts with no reply, the lead becomes Cold and is parked."
    const attempts = activities.filter(
      (a) => a.leadId === lead.id && OUTREACH_TYPES.includes(a.type) && a.at > lead.stageChangedAt,
    ).length
    const cold = coldStatusKey(co)
    if (cold && attempts >= rules.attemptsBeforeCold) {
      recordLeadStatusChange(lead, lead.status, cold, { changedBy: null, reason: `${attempts} attempts with no reply` })
      lead.status = cold
      lead.stageChangedAt = new Date().toISOString()
      lead.nextFollowUpDate = null
      view.autoStatus = { from: SYSTEM_STATUS.noResponse, to: cold, label: statusLabelOf(co, cold), attempts }
    } else {
      // Each unanswered attempt schedules the next one `noResponseFollowUpDays` after the company's today.
      lead.nextFollowUpDate = followUpInDays(companyDayOf(co).today, rules.noResponseFollowUpDays)
    }
  }
  return delay(view)
}

export async function getLeadNotes(user: User, id: string): Promise<NoteView[]> {
  await leadFor(user, id)
  const list = scoped(notes, user)
    .filter((n) => n.leadId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => ({ ...untenant(n), authorName: ownerName(n.authorId) }))
  return delay(list)
}

export async function addLeadNote(user: User, input: { leadId: string; body: string }): Promise<NoteView> {
  await leadFor(user, input.leadId, true)
  if (!input.body.trim()) return fail('A note can’t be empty.', 422)
  const note: Tenant<Note> = stamp(
    {
      id: `N-${Date.now().toString(36)}`,
      leadId: input.leadId,
      body: input.body.trim(),
      authorId: user.id,
      createdAt: new Date().toISOString(),
    },
    user,
  )
  notes.push(note)
  return delay({ ...untenant(note), authorName: user.name })
}

/**
 * Legacy lead-tasks endpoint (GET /leads/:id/tasks), now read from the unified task store.
 * The lead page uses GET /tasks?linkType=lead&linkId=… instead; this keeps the old shape for callers.
 * (The lead was found inside the caller's company and lead ids are globally unique.)
 */
export async function getLeadTasks(user: User, id: string): Promise<TaskView[]> {
  await leadFor(user, id)
  const list: TaskView[] = tasksForLink('lead', id)
    .filter((t) => !!t.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .map((t) => ({
      id: t.id,
      leadId: id,
      title: t.title,
      ownerId: t.ownerId,
      dueDate: t.dueDate ?? '',
      // Legacy shape: three statuses and three priorities (labels).
      status: t.status === 'done' ? 'Done' : t.status === 'todo' ? 'To do' : 'In progress',
      priority: t.priority === 'low' ? 'Low' : t.priority === 'medium' ? 'Medium' : 'High',
      ownerName: ownerName(t.ownerId),
    }))
  return delay(list)
}

/* ------------------------------------------------------------------------------------------
 * Duplicate detection (company name, website/email domain, email) — within one company
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

/** Websites captured by the full form / import; seeded leads only have email domains. Keyed by (globally unique) lead id. */
export const leadWebsites = registerMap('leadWebsites', new Map<string, string>())

export interface DuplicateProbe {
  company: string
  emails: string[]
  website?: string
  excludeId?: string
}

/**
 * Every existing lead OF THE SAME COMPANY matching a probe, one entry per lead with the strongest
 * reason. The same name, email or domain in another company's workspace is not a duplicate.
 */
export function findDuplicates(companyId: string, probe: DuplicateProbe): DuplicateMatch[] {
  const name = normalizeCompany(probe.company)
  const emails = probe.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'))
  const domains = new Set([...emails.map(domainOf), domainOf(probe.website ?? '')].filter(Boolean))
  const matches: DuplicateMatch[] = []
  for (const l of leads) {
    if (l.companyId !== companyId || l.id === probe.excludeId) continue
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

/** Matches across every lead of the caller's company, not just their scope — a duplicate is a duplicate. */
export async function checkDuplicates(
  user: User,
  input: {
    company: string
    email: string
    emails?: string[]
    website?: string
    excludeId?: string
  },
): Promise<DuplicateMatch[]> {
  return delay(
    findDuplicates(tenantOf(user), {
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
 * Owners and assignment (people of the caller's company only)
 * ---------------------------------------------------------------------------------------- */

function openLoad(companyId: string, id: string): number {
  return leads.filter((l) => l.companyId === companyId && l.ownerId === id && !isClosedStatus(companyId, l.status)).length
}

/** People the caller may assign leads to: everyone selling (full), the team (team), or only themselves. */
export function assignableOwners(user: User): User[] {
  const scope = scopeOf(user.role, 'sales')
  const colleagues = scoped(users, user)
  if (scope === 'full') {
    return colleagues.filter((u) => u.active && ['full', 'team', 'own'].includes(scopeOf(u.role, 'sales')))
  }
  if (scope === 'team') {
    const team = salesTeamOf(user)
    return colleagues.filter((u) => u.active && team.includes(u.id))
  }
  return [user]
}

/** GET /leads/owners */
export async function getLeadOwners(user: User): Promise<LeadOwnerOption[]> {
  if (!can(user.role, 'sales', 'create')) return fail('Your role can’t assign leads.', 403)
  const co = tenantOf(user)
  const list = assignableOwners(user)
    .map((u) => ({ id: u.id, name: u.name, title: u.title, role: u.role, openLeads: openLoad(co, u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return delay(list)
}

/**
 * Auto-assignment: full scope → least-loaded Sales Agent; team scope → least-loaded agent in the
 * team (or the manager); own scope → the caller. Only people of the caller's company.
 */
export function autoOwnerFor(user: User): string {
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'own') return user.id
  const co = tenantOf(user)
  const colleagues = scoped(users, user)
  const pool =
    scope === 'full'
      ? colleagues.filter((u) => u.active && u.role === 'Sales Agent')
      : colleagues.filter((u) => u.active && salesTeamOf(user).includes(u.id) && u.role === 'Sales Agent')
  return [...pool].sort((a, b) => openLoad(co, a.id) - openLoad(co, b.id))[0]?.id ?? user.id
}

/** Validates an explicit owner against the caller's reach; returns an error message or null. */
export function ownerProblem(user: User, ownerId: string): string | null {
  const owner = companyUser(user, ownerId)
  if (!owner) return 'That owner doesn’t exist.'
  if (!owner.active) return `${owner.name} is deactivated and can’t own leads.`
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'own' && ownerId !== user.id) return 'Only managers can assign leads to someone else.'
  if (scope === 'team' && !salesTeamOf(user).includes(ownerId)) return 'You can only assign leads within your team.'
  return null
}

/* ------------------------------------------------------------------------------------------
 * Create and update
 * ---------------------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** next_follow_up_date is a company-local calendar date, never a datetime. */
export const FOLLOW_UP_DATE_FORMAT = 'Set the follow-up as a calendar date (yyyy-MM-dd).'

/** An ACTIVE catalog service of the company. Other companies' services don't exist here. */
export const isActiveService = (companyId: string, id: string) =>
  catalog.some((s) => s.id === id && s.companyId === companyId && s.active)

/**
 * Catalog service fields: new ids (not already on the lead) must be ACTIVE catalog services of the
 * company; unchanged ids pass even if the service has since been deactivated. Returns the problem or null.
 */
export function serviceFieldsProblem(
  companyId: string,
  input: { serviceIds?: string[]; recommendedServiceId?: string | null },
  current?: Pick<Lead, 'serviceIds' | 'recommendedServiceId'>,
): string | null {
  if (input.serviceIds !== undefined) {
    if (!Array.isArray(input.serviceIds)) return 'Services of interest must be a list of catalog services.'
    const kept = new Set(current?.serviceIds ?? [])
    const bad = input.serviceIds.find((sid) => !kept.has(sid) && !isActiveService(companyId, sid))
    if (bad) return `${bad} isn’t an active catalog service.`
  }
  const rec = input.recommendedServiceId
  if (rec && rec !== current?.recommendedServiceId && !isActiveService(companyId, rec)) {
    return 'Pick an active service from the catalog as the recommended service.'
  }
  return null
}

/**
 * One global sequence (L-1001, L-1002, …) for every company, so ids never collide across tenants.
 * Seeded second-tenant leads sit in their own block (L-5001+) and don't advance it.
 */
function nextLeadId(): string {
  let n = 1001 + leads.filter((l) => !(Number(l.id.slice(2)) >= CREST_SEED_LEAD_BASE)).length
  while (leads.some((l) => l.id === `L-${n}`)) n++
  return `L-${n}`
}

function cleanContacts(country: CountryCode, list: ContactInput[]): ContactInput[] {
  return (Array.isArray(list) ? list : [])
    .map((c) => ({
      ...c,
      name: (c.name ?? '').trim(),
      title: (c.title ?? '').trim(),
      mobile: (c.mobile ?? '').trim() ? (normalizeMobile(c.mobile, country) ?? c.mobile.trim()) : '',
      email: (c.email ?? '').trim().toLowerCase(),
      isDecisionMaker: !!c.isDecisionMaker,
    }))
    .filter((c) => c.name || c.mobile || c.email)
}

/** Field rules shared by the form and the import; returns the first problem or null. Lists are the company's. */
export function validateLeadFields(
  companyId: string,
  country: CountryCode,
  input: {
    company: string
    sourceType: string
    industry: string
    subIndustry?: string
    status?: string
    contacts: ContactInput[]
  },
): string | null {
  // Malformed bodies (missing fields, wrong types) answer 422, never a 500.
  if (typeof input.company !== 'string' || !input.company.trim()) return 'Company is required.'
  if (!Array.isArray(input.contacts)) return 'Add at least one named contact.'
  if (!isActiveSource(companyId, input.sourceType)) return 'Pick a source from the list.'
  if (!isActiveIndustry(companyId, input.industry)) return 'Pick an industry from the list.'
  if (input.subIndustry && !isActiveSubIndustry(companyId, input.industry, input.subIndustry)) {
    return `${input.subIndustry} isn’t a sub-industry of ${input.industry}.`
  }
  if (input.status && !isActiveStatus(companyId, input.status)) return 'Pick a status from the list.'
  for (const c of input.contacts) {
    if (c.mobile && !isMobile(c.mobile, country)) return `${c.mobile} isn’t a ${mobileHint(country)}.`
    if (c.email && !EMAIL_RE.test(c.email)) return `${c.email} isn’t a valid email address.`
  }
  return null
}

function replaceContacts(companyId: string, leadId: string, list: ContactInput[]): void {
  for (let i = contacts.length - 1; i >= 0; i--) if (contacts[i].leadId === leadId) contacts.splice(i, 1)
  const seq = Date.now().toString(36)
  list.forEach((c, i) => {
    contacts.push({
      companyId,
      id: c.id && !c.id.startsWith('new-') ? c.id : `CT-${leadId}-${seq}-${i + 1}`,
      leadId,
      name: c.name,
      title: c.title,
      mobile: c.mobile,
      email: c.email,
      isDecisionMaker: c.isDecisionMaker,
    })
  })
}

/** 422 `use_won_flow`: create, update and import never set a Won status (status type won). */
export function wonFlowRefusal(): CodedApiError {
  return new CodedApiError(USE_WON_FLOW, 422, 'use_won_flow')
}

/** The `status` a create / update body tries to set, if any (status is not an editable field there). */
function requestedStatus(raw: unknown): string | null {
  const s = raw && typeof raw === 'object' ? (raw as { status?: unknown }).status : undefined
  return typeof s === 'string' && s ? s : null
}

export interface InsertOptions {
  status?: LeadStatus
}

/**
 * Writes an already validated lead to the db, in the caller's company. Used by POST /leads and the
 * importer, so both apply the same defaults, contact handling and auto-assignment.
 */
export function insertLead(user: User, input: LeadCreateInput, opts: InsertOptions = {}): Tenant<Lead> {
  const co = tenantOf(user)
  // Defence in depth for every caller (create, import): a lead is never born Won.
  if (opts.status && isWonFlowStatus(co, opts.status)) throw wonFlowRefusal()
  const id = nextLeadId()
  const now = new Date().toISOString()
  const list = cleanContacts(countryOf(user), input.contacts)
  const primary = list[0]
  const status = opts.status ?? SYSTEM_STATUS.new
  const lead: Tenant<Lead> = stamp(
    {
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
      // A company-local calendar date; tomorrow (company time) when none is given.
      nextFollowUpDate: isClosedStatus(co, status) ? null : (input.nextFollowUpDate || followUpInDays(companyDayOf(co).today, 1)),
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
      campaignId: input.campaignId || null,
    },
    user,
  )
  leads.push(lead)
  recordLeadStatusChange(lead, null, lead.status, { changedBy: user.id, reason: 'Created', at: lead.createdAt })
  if (input.website?.trim()) leadWebsites.set(id, input.website.trim())
  replaceContacts(co, id, list)
  if (input.note?.trim()) {
    notes.push(
      stamp({ id: `N-${id}-${Date.now().toString(36)}`, leadId: id, body: input.note.trim(), authorId: user.id, createdAt: now }, user),
    )
  }
  return lead
}

/** leads.campaign_id must be a campaign of the lead's company (another company's id = unknown, 422). */
export const UNKNOWN_CAMPAIGN = 'That campaign doesn’t exist.'
export function isCampaignOf(companyId: string, campaignId: string): boolean {
  return campaigns.some((c) => c.companyId === companyId && c.id === campaignId)
}

function isFullInput(input: QuickAddInput | LeadCreateInput): input is LeadCreateInput {
  return Array.isArray((input as LeadCreateInput).contacts)
}

/**
 * POST /leads — quick add or full form. New leads start as New and are auto-assigned unless a
 * manager picks an owner. Duplicates (name, domain, email) within the company answer 409 unless a manager forces.
 */
export async function createLead(user: User, raw: QuickAddInput | LeadCreateInput): Promise<LeadRow> {
  if (!can(user.role, 'sales', 'create')) return fail('Your role can’t add leads.', 403)
  const co = tenantOf(user)
  // New leads start as the first open status; a Won-flow status in the body is refused, not ignored.
  const askedStatus = requestedStatus(raw)
  if (askedStatus && isWonFlowStatus(co, askedStatus)) throw wonFlowRefusal()
  const country = countryOf(user)
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
  const list = cleanContacts(country, input.contacts)
  const problem = validateLeadFields(co, country, { ...input, contacts: list }) ?? serviceFieldsProblem(co, input)
  if (problem) return fail(problem, 422)
  if (input.nextFollowUpDate && !isIsoDate(input.nextFollowUpDate)) return fail(FOLLOW_UP_DATE_FORMAT, 422)
  if (isFullInput(raw)) {
    if (list.length === 0) return fail('Add at least one contact.', 422)
    if (list.some((c) => !c.name)) return fail('Every contact needs a name.', 422)
  }
  if (input.website?.trim() && !domainOf(input.website) && !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(input.website.replace(/^https?:\/\//, ''))) {
    return fail('Enter the website as a domain, e.g. company.com.', 422)
  }
  if (input.ownerId) {
    const ownerErr = ownerProblem(user, input.ownerId)
    if (ownerErr) return fail(ownerErr, 403)
  }
  if (input.campaignId && !isCampaignOf(co, input.campaignId)) return fail(UNKNOWN_CAMPAIGN, 422)

  const matches = findDuplicates(co, { company: input.company, emails: list.map((c) => c.email), website: input.website })
  if (matches.length > 0) {
    if (!input.force) return fail(`Possible duplicate: ${duplicateMessage(matches)}`, 409)
    if (!canOverrideDuplicates(user)) return fail('Only a manager can add a lead that duplicates an existing one.', 403)
  }

  // Plan limit: the lead plus its contacts count toward leads + contacts (402 LIMIT_REACHED).
  assertCapacity(co, 'leadsContacts', 1 + list.length)
  const lead = insertLead(user, { ...input, contacts: list })
  noteUsage(co)
  return delay(toRow(lead))
}

/**
 * Edits a lead's fields. Owner changes need team or full scope; the new owner must be in reach
 * (and in the same company). When the name, website or contact emails change, the duplicate rule applies again.
 */
/** Lead fields a PATCH may set (LeadUpdateInput minus contacts/website/doNotContact/force, handled separately). */
const LEAD_UPDATE_FIELDS = [
  'company', 'contactName', 'contactEmail', 'mobile', 'industry', 'subIndustry', 'sourceType', 'sourceDetail', 'ownerId',
  'value', 'nextFollowUpDate', 'nextStep', 'companyServices', 'serviceIds', 'recommendedServiceId', 'campaignId',
] as const satisfies readonly (keyof LeadUpdateInput)[]

export async function updateLead(user: User, id: string, input: LeadUpdateInput): Promise<LeadRow> {
  const lead = await leadFor(user, id, true)
  const co = lead.companyId
  // Status changes go through PATCH /leads/:id/stage; a Won-flow status here is refused with a clear 422.
  const askedStatus = requestedStatus(input)
  if (askedStatus && askedStatus !== lead.status && isWonFlowStatus(co, askedStatus)) throw wonFlowRefusal()
  const country = countryOf(user)
  const { contacts: contactRows, website, doNotContact, force, ...rawFields } = input
  // Only the editable lead fields: never companyId / id / tenant fields or unknown keys (no mass assignment).
  const fields = Object.fromEntries(
    Object.entries(rawFields).filter(([k]) => (LEAD_UPDATE_FIELDS as readonly string[]).includes(k)),
  ) as typeof rawFields
  if (fields.company !== undefined && !fields.company.trim()) return fail('Company is required.', 422)
  if (fields.nextFollowUpDate != null && !isIsoDate(fields.nextFollowUpDate)) return fail(FOLLOW_UP_DATE_FORMAT, 422)
  if (fields.mobile && !isMobile(fields.mobile, country)) {
    return fail(`Use the ${MOBILE_RULES[country].countryName} mobile format ${MOBILE_RULES[country].example}.`, 422)
  }
  if (fields.contactEmail && !EMAIL_RE.test(fields.contactEmail)) return fail('Enter a valid email address.', 422)
  // Unchanged values pass even if since deactivated; new values must be active list items.
  if (fields.sourceType !== undefined && fields.sourceType !== lead.sourceType && !isActiveSource(co, fields.sourceType)) {
    return fail('Pick a source from the list.', 422)
  }
  if (fields.industry !== undefined && fields.industry !== lead.industry && !isActiveIndustry(co, fields.industry)) {
    return fail('Pick an industry from the list.', 422)
  }
  const industry = fields.industry ?? lead.industry
  const sub = fields.subIndustry ?? (fields.industry !== undefined && fields.industry !== lead.industry ? '' : lead.subIndustry)
  const subUnchanged = industry === lead.industry && sub === lead.subIndustry
  if (sub && !subUnchanged && !isActiveSubIndustry(co, industry, sub)) return fail(`${sub} isn’t a sub-industry of ${industry}.`, 422)
  const serviceProblem = serviceFieldsProblem(co, fields, lead)
  if (serviceProblem) return fail(serviceProblem, 422)
  if (fields.campaignId && fields.campaignId !== lead.campaignId && !isCampaignOf(co, fields.campaignId)) return fail(UNKNOWN_CAMPAIGN, 422)
  if (fields.campaignId === '') fields.campaignId = null
  if (fields.ownerId && fields.ownerId !== lead.ownerId) {
    const scope = scopeOf(user.role, 'sales')
    if (scope === 'own') return fail('Only managers can reassign leads.', 403)
    if (scope === 'team' && !salesTeamOf(user).includes(fields.ownerId)) {
      return fail('You can only assign leads within your team.', 403)
    }
    const owner = companyUser(user, fields.ownerId)
    if (!owner) return fail('That owner doesn’t exist.', 422)
    if (!owner.active) return fail(`${owner.name} is deactivated and can’t own leads.`, 422)
  }

  let list: ContactInput[] | null = null
  if (contactRows) {
    list = cleanContacts(country, contactRows)
    if (list.length === 0) return fail('Add at least one contact.', 422)
    if (list.some((c) => !c.name)) return fail('Every contact needs a name.', 422)
    for (const c of list) {
      if (c.mobile && !isMobile(c.mobile, country)) return fail(`${c.mobile} isn’t a ${mobileHint(country)}.`, 422)
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
    const matches = findDuplicates(co, {
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

  // Plan limit: only extra contacts count (removing some frees room).
  if (list) {
    const added = list.length - contacts.filter((c) => c.companyId === co && c.leadId === id).length
    if (added > 0) assertCapacity(co, 'leadsContacts', added)
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
    replaceContacts(co, id, list)
    lead.contactName = list[0].name
    lead.contactEmail = list[0].email
    lead.mobile = list[0].mobile
  }
  return delay(toRow(lead))
}
