import { addMonths, format, parseISO } from 'date-fns'
import type { User } from '@/shared/types'
import { can, inScope, scopeOf } from '@/shared/lib/permissions'
import type { WonInput, WonPreview, WonResult, WonStep } from '@/modules/won/types'
import type { Contract } from '@/modules/crm/types'
import type { Task } from '@/modules/tasks/types'
import { isoDate, nextWorkingDay, planProject, type PlannedProject } from '@/modules/won/plan'
import { activities, contacts, customerFromLead, customers, leads, notes } from '@/shared/mocks/db'
import { registerSet } from '@/shared/mocks/persist/registry'
import { deliveryDepartmentId } from '@/shared/mocks/data/departments'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { projectTemplateFor, services } from '@/shared/mocks/data/services'
import { nextProjectId, nextTaskId, notifications, projects, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { isWonStatus, statusOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { QUOTATION_STATUS_LABEL } from '@/shared/domain/enums'
import { auditLog, recordAudit } from '@/shared/mocks/data/audit'
import { leadStatusHistory, recordLeadStatusChange } from '@/shared/mocks/data/leadStatusHistory'
import { companyTeamIds, companyUsers, companyWeekend, userInCompany } from '@/shared/mocks/selectors/company'
import { LimitReachedError, subOf, subPlan, usedOf } from '@/shared/mocks/services/billing'
import { CodedApiError, findInTenant, stamp, type Tenant } from '@/shared/mocks/tenant'
import { ApiError } from '@/shared/lib/apiError'
import { companyById } from '@/shared/mocks/data/tenancy'
import { delay, fail } from '@/shared/mocks/server'

/**
 * The Won flow (spec §4 "Won: becomes a customer in CRM, a project with tasks is created from the
 * service template, and the team is notified"). One atomic action: every store it touches is
 * snapshotted first and restored if any step throws, so a failure leaves nothing behind.
 *
 * Tenancy: the lead must belong to the caller's company (another company's lead answers 404 like a
 * missing one). Everything the flow creates is stamped with the lead's company, and quotations,
 * services, customers and people are all resolved inside that company only.
 */

/**
 * Error that carries the failing step for the dialog. A coded error raised inside the flow (402
 * LIMIT_REACHED, 403 module_not_in_plan, 423 workspace_read_only, …) keeps its `code` and `details`,
 * so the response body is `{ message, code?, ...details, step }` and the global upgrade prompt
 * (axios → billingEvents) still sees it.
 */
export class WonError extends CodedApiError {
  constructor(
    message: string,
    status: number,
    public step: WonStep,
    code?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message, status, code ?? '', details)
    if (!code) this.code = undefined
  }
}

/** Re-tags any error thrown inside the flow with the step it failed at, keeping code + details. */
function asWonError(e: unknown, step: WonStep): WonError {
  if (e instanceof WonError) return e
  if (e instanceof ApiError) {
    const details = e instanceof CodedApiError ? e.details : {}
    return new WonError(`${e.message} Nothing was saved.`, e.status, step, e.code, details)
  }
  return new WonError(`Couldn’t complete the Won flow at “${step}”: ${(e as Error).message} Nothing was saved.`, 500, step)
}

/* ---------------- Guards ---------------- */

/** Used idempotency keys, per company (`companyId␟key`): the same key in two tenants never clashes. */
const usedKeys = registerSet('won.usedIdempotencyKeys', new Set<string>())
/** Request-scoped (a lead being won right now): deliberately not persisted, a reload ends every request. */
const inFlight = new Set<string>()
const keyOf = (companyId: string, key: string) => `${companyId}␟${key}`

type LeadRow = (typeof leads)[number]
/** Company context for one Won request: the lead's company. */
type Co = Pick<User, 'companyId'>

async function leadFor(user: User, id: string): Promise<LeadRow> {
  // Another company's lead is indistinguishable from a missing one.
  const lead = findInTenant(leads, user, (l) => l.id === id)
  if (!lead) return fail('That lead doesn’t exist.', 404)
  const team = companyTeamIds(user)
  if (!inScope(scopeOf(user.role, 'sales'), user, lead.ownerId, team)) return fail('This lead belongs to someone outside your access.', 403)
  if (!can(user.role, 'sales', 'edit')) return fail('Your role can view leads but not win them.', 403)
  return lead
}

function defaultManager(co: Co, ownerId: string): string {
  const owner = userInCompany(co.companyId, ownerId)
  const mgr = owner?.managerId ? userInCompany(co.companyId, owner.managerId) : undefined
  return mgr && mgr.active !== false ? mgr.id : ownerId
}

const quotationIn = (co: Co, id: string | null | undefined) => (id ? findInTenant(quotations, co, (x) => x.id === id) : undefined)
const serviceIn = (co: Co, id: string) => findInTenant(services, co, (s) => s.id === id)

/** Services from the quotation's lines, else the lead's recommended + interest services (active only). */
function suggestedServices(co: Co, lead: LeadRow, quotationId: string | null | undefined): string[] {
  const q = quotationIn(co, quotationId)
  const fromQuote = q ? q.items.map((i) => i.serviceId).filter((s): s is string => !!s) : []
  const fromLead = [lead.recommendedServiceId, ...lead.serviceIds].filter((s): s is string => !!s)
  const ids = fromQuote.length ? fromQuote : fromLead
  return [...new Set(ids)].filter((id) => !!serviceIn(co, id))
}

/**
 * Contract from the quotation's recurring lines (unit "month"): monthly value = their net total;
 * renewal = start + the longest monthly term on the quote (12 when unspecified).
 */
function contractFrom(co: Co, quotationId: string | null | undefined, startDate: string, company: string) {
  const q = quotationIn(co, quotationId)
  if (!q) return null
  const monthly = q.items.filter((i) => i.unit === 'month')
  if (!monthly.length) return null
  const value = Math.round(monthly.reduce((s, i) => s + i.quantity * i.unitPrice * (1 - i.discountPct / 100), 0) / Math.max(1, Math.max(...monthly.map((i) => i.quantity))))
  const months = Math.max(1, ...monthly.map((i) => i.quantity))
  return {
    title: `${q.title || 'Recurring services'} — ${company}`,
    billing: 'Monthly' as const,
    value,
    startDate,
    renewalDate: format(addMonths(parseISO(startDate), months), 'yyyy-MM-dd'),
    serviceIds: [...new Set(monthly.map((i) => i.serviceId).filter((s): s is string => !!s))],
  }
}

/** Plans every project with the company's people, delivery department and weekend. */
function planAll(co: Co, serviceIds: string[], projectManagerId: string, startDate: string): PlannedProject[] {
  const load = new Map<string, number>()
  const people = companyUsers(co.companyId)
  return serviceIds.map((id) => {
    const service = serviceIn(co, id)!
    return planProject(service, projectTemplateFor(id), {
      users: people,
      projectManagerId,
      startDate,
      load,
      deliveryDepartmentId: deliveryDepartmentId(co.companyId),
      weekend: companyWeekend(co.companyId),
    })
  })
}

/**
 * "At least one contact" means a real person to deliver to: a contact record of the lead (with a
 * name), or the lead's primary contact with a name AND a mobile or an email. A bare contactName
 * text does not count.
 */
export function hasRealContact(lead: LeadRow): boolean {
  if (contacts.some((c) => c.companyId === lead.companyId && c.leadId === lead.id && c.name.trim())) return true
  return !!lead.contactName.trim() && !!(lead.mobile.trim() || lead.contactEmail.trim())
}

export const NO_CONTACT = 'Add at least one contact (a name with a mobile or an email) before winning this lead.'

type QuoteCheck = { ok: true; quote: QuoteRow | null } | { ok: false; status: number; message: string; code?: string }
type QuoteRow = (typeof quotations)[number]

/**
 * The contract (and the quotation's services) only ever come from an ACCEPTED quotation of this lead.
 * Missing or another company's id → 404 (identical); another lead's → 422; not Accepted → 422
 * `quotation_not_accepted`. No id → no quotation.
 */
function checkQuotation(co: Co, lead: LeadRow, quotationId: string | null | undefined): QuoteCheck {
  if (!quotationId) return { ok: true, quote: null }
  const q = quotationIn(co, quotationId)
  if (!q) return { ok: false, status: 404, message: 'That quotation doesn’t exist.' }
  if (q.leadId !== lead.id) return { ok: false, status: 422, message: `Quotation ${q.number} belongs to another lead.` }
  if (q.status !== 'accepted') {
    return { ok: false, status: 422, code: 'quotation_not_accepted', message: `Quotation ${q.number} is ${QUOTATION_STATUS_LABEL[q.status]}, not Accepted. Accept it first, or win without a quotation.` }
  }
  return { ok: true, quote: q }
}

function problemsFor(co: Co, lead: LeadRow, serviceIds: string[], projectManagerId: string, startDate: string): string[] {
  const out: string[] = []
  if (!hasRealContact(lead)) out.push(NO_CONTACT)
  if (!serviceIds.length) out.push('Pick at least one purchased service.')
  const bad = serviceIds.filter((id) => !serviceIn(co, id))
  if (bad.length) out.push(`Unknown services: ${bad.join(', ')}.`)
  const inactive = serviceIds.map((id) => serviceIn(co, id)).filter((s) => s && !s.active)
  if (inactive.length) out.push(`Inactive services can’t be sold: ${inactive.map((s) => s!.name).join(', ')}.`)
  // The project manager must be a person of the lead's company.
  const pm = userInCompany(co.companyId, projectManagerId)
  if (!pm || pm.active === false) out.push('Pick an active project manager.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) out.push('Pick a project start date.')
  return out
}

/* ---------------- Preview ---------------- */

export async function previewWon(
  user: User,
  leadId: string,
  q: { quotationId?: string | null; serviceIds?: string[]; projectManagerId?: string; startDate?: string } = {},
): Promise<WonPreview> {
  const lead = await leadFor(user, leadId)
  const co: Co = { companyId: lead.companyId }
  const accepted = quotations.filter((x) => x.companyId === lead.companyId && x.leadId === leadId && x.status === 'accepted')
  const quotationId = q.quotationId === undefined ? (accepted[0]?.id ?? null) : q.quotationId
  const quote = quotationIn(co, quotationId)
  // Only an accepted quotation of this lead feeds services and the contract; anything else is a blocking problem.
  const quoteCheck = checkQuotation(co, lead, quotationId)
  const usableQuoteId = quoteCheck.ok ? (quoteCheck.quote?.id ?? null) : null
  const serviceIds = q.serviceIds ?? suggestedServices(co, lead, usableQuoteId)
  const projectManagerId = q.projectManagerId ?? defaultManager(co, lead.ownerId)
  const startDate = q.startDate ?? isoDate(nextWorkingDay(new Date(Date.now() + 86_400_000), companyWeekend(lead.companyId)))
  const existing = existingCustomer(lead)
  const pmKnown = !!userInCompany(co.companyId, projectManagerId)
  const plans = pmKnown && serviceIds.every((id) => !!serviceIn(co, id)) ? planAll(co, serviceIds, projectManagerId, startDate) : []
  const contract = contractFrom(co, usableQuoteId, startDate, lead.company)
  const warnings = plans.filter((p) => !p.hasTemplate).map((p) => `“${p.serviceName}” has no project template: its project will start with no tasks.`)
  const fallbacks = plans.flatMap((p) => p.tasks).filter((t) => t.fallbackOwner).length
  if (fallbacks) warnings.push(`${fallbacks} task${fallbacks === 1 ? '' : 's'} had no matching person for their role and go to the project manager.`)
  const problems = problemsFor(co, lead, serviceIds, projectManagerId, startDate)
  if (!quoteCheck.ok) problems.unshift(quoteCheck.message)
  // Names only from the lead's company (an id of another company in the body stays a bare id).
  const name = (id: string) => userInCompany(co.companyId, id)?.name ?? id
  const notifyIds = new Map<string, string>([[lead.ownerId, 'Lead owner'], [projectManagerId, 'Project manager']])
  for (const t of plans.flatMap((p) => p.tasks)) if (!notifyIds.has(t.ownerId)) notifyIds.set(t.ownerId, 'Task owner')

  return delay({
    leadId,
    company: lead.company,
    status: lead.status,
    alreadyWon: isWonStatus(lead.companyId, lead.status) && !!lead.customerId,
    problems,
    warnings,
    customer: existing ? { mode: 'link', id: existing.id, name: existing.name } : { mode: 'create', id: null, name: lead.company },
    contacts: contacts.filter((c) => c.leadId === leadId).length,
    notes: notes.filter((n) => n.leadId === leadId).length,
    activities: activities.filter((a) => a.leadId === leadId).length,
    quotation: quote ? { id: quote.id, number: quote.number, status: quote.status, total: quoteTotal(quote) } : null,
    quotationOptions: accepted.map((x) => ({ id: x.id, number: x.number, title: x.title, total: quoteTotal(x), status: x.status })),
    serviceIds,
    defaults: { projectManagerId, startDate },
    contract: contract ? { title: contract.title, billing: contract.billing, value: contract.value, startDate: contract.startDate, renewalDate: contract.renewalDate } : null,
    projects: plans.map((p) => ({
      serviceId: p.serviceId,
      serviceName: p.serviceName,
      hasTemplate: p.hasTemplate,
      startDate: p.startDate,
      endDate: p.endDate,
      estimatedHours: p.estimatedHours,
      tasks: p.tasks.map((t) => ({ title: t.title, role: t.role, ownerId: t.ownerId, ownerName: name(t.ownerId), fallbackOwner: t.fallbackOwner, dueDate: t.dueDate, hours: t.hours, priority: t.priority })),
    })),
    notify: [...notifyIds.entries()].map(([id, why]) => ({ id, name: name(id), why })),
  })
}

/** The customer this lead becomes: already linked, or one with the same name, in the lead's company only. */
function existingCustomer(lead: LeadRow) {
  const mine = (c: (typeof customers)[number]) => c.companyId === lead.companyId
  return customers.find((c) => mine(c) && c.leadId === lead.id) ?? customers.find((c) => mine(c) && c.name.toLowerCase() === lead.company.toLowerCase())
}

function quoteTotal(q: (typeof quotations)[number]): number {
  const net = q.items.reduce((s, i) => s + i.quantity * i.unitPrice * (1 - i.discountPct / 100), 0)
  return Math.round(net * (1 + q.vatPct / 100))
}

/* ---------------- The transaction ---------------- */

/** Every store the Won flow writes to. Snapshotted before, restored on failure. */
const STORES = { leads, customers, contacts, quotations, contracts, projects, tasks, notifications, activities, auditLog, leadStatusHistory } as const

function snapshot() {
  return Object.fromEntries(Object.entries(STORES).map(([k, arr]) => [k, structuredClone(arr)])) as { [K in keyof typeof STORES]: (typeof STORES)[K] }
}

function restore(snap: ReturnType<typeof snapshot>) {
  for (const [k, arr] of Object.entries(STORES) as [keyof typeof STORES, unknown[]][]) {
    arr.splice(0, arr.length, ...(snap[k] as unknown[]))
  }
}

/**
 * Test-only failpoints: make a step throw to prove the rollback. `failWith` picks the error (default
 * a plain Error → 500; `limit` → 402 LIMIT_REACHED, `module` → 403 module_not_in_plan, `read_only` →
 * 423 workspace_read_only), the same errors the plan checks raise. Unit tests pass them as `hooks`;
 * browser tests set the window failpoint globals (a step, and optionally the error kind) before the
 * app loads, like the move-failure hook. They are read only in dev and tests, so a production build
 * drops them. The real backend has no failpoints.
 */
export type WonFailKind = 'error' | 'limit' | 'module' | 'read_only'
export interface WonTestHooks {
  failAt?: WonStep
  failWith?: WonFailKind
}

const WON_STEPS: WonStep[] = ['lead', 'customer', 'contract', 'projects', 'notify', 'audit']
const FAIL_KINDS: WonFailKind[] = ['error', 'limit', 'module', 'read_only']

/** Hooks from the arguments, else the browser-test globals. */
function failpoints(hooks: WonTestHooks): WonTestHooks {
  if (hooks.failAt) return hooks
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return {}
  const g = globalThis as { __apexWonFailAt?: unknown; __apexWonFailWith?: unknown }
  const failAt = WON_STEPS.find((s) => s === g.__apexWonFailAt)
  const failWith = FAIL_KINDS.find((k) => k === g.__apexWonFailWith)
  return failAt ? { failAt, failWith } : {}
}

/** The error a failpoint throws: the same classes (and bodies) the plan checks raise. */
function simulatedError(companyId: string, step: WonStep, kind: WonFailKind = 'error'): Error {
  const plan = subPlan(subOf(companyId))
  switch (kind) {
    case 'limit': {
      // A stock limit the flow would count if it created contacts; current = max, so it is "full".
      const current = usedOf(companyId, 'leadsContacts')
      return new LimitReachedError('leadsContacts', current, plan.limits.leadsContacts ?? current, plan)
    }
    case 'module':
      return new CodedApiError(`This feature isn’t included in your ${plan.name} plan. Upgrade to use it.`, 403, 'module_not_in_plan', { module: 'accounting', planId: plan.id })
    case 'read_only':
      return new CodedApiError('This workspace is suspended and read-only. Update the payment method to make changes.', 423, 'workspace_read_only', { status: 'suspended' })
    default:
      return new Error(`Simulated failure at step “${step}”.`)
  }
}

export async function winLead(user: User, leadId: string, input: WonInput, hooks: WonTestHooks = {}): Promise<WonResult> {
  const lead = await leadFor(user, leadId)
  // Everything below runs in the lead's company (equal to the caller's: leadFor is tenant-scoped).
  // A companyId in the body is never read.
  const co: Co = { companyId: lead.companyId }
  const fp = failpoints(hooks)

  // Double-submit and concurrency guards. Idempotency keys are scoped per company.
  if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') throw new WonError('Missing idempotency key.', 422, 'validate')
  const usedKey = keyOf(co.companyId, input.idempotencyKey)
  if (usedKeys.has(usedKey)) throw new WonError('This Won request was already submitted.', 409, 'validate')
  if (inFlight.has(leadId)) throw new WonError('This lead is already being won. Wait a moment.', 409, 'validate')
  if (isWonStatus(co.companyId, lead.status) && lead.customerId) throw new WonError(`${lead.company} is already Won.`, 409, 'validate')
  const wonKey = SYSTEM_STATUS.won
  if (!statusOf(co.companyId, wonKey)?.active) throw new WonError('The Won status is inactive in Settings › Fixed lists.', 422, 'validate')

  // Ids in the body: another company's quotation or person answers exactly like a missing one (404).
  const quoteCheck = checkQuotation(co, lead, input.quotationId)
  if (!quoteCheck.ok) throw new WonError(quoteCheck.message, quoteCheck.status, 'validate', quoteCheck.code)
  const quotationId = quoteCheck.quote?.id ?? null
  if (input.projectManagerId && !userInCompany(co.companyId, input.projectManagerId)) throw new WonError('That project manager doesn’t exist.', 404, 'validate')

  const serviceIds = [...new Set(input.serviceIds ?? [])]
  const problems = problemsFor(co, lead, serviceIds, input.projectManagerId, input.startDate)
  if (problems.length) throw new WonError(problems.join(' '), 422, 'validate')

  usedKeys.add(usedKey)
  inFlight.add(leadId)
  const snap = snapshot()
  let step: WonStep = 'lead'
  const check = (s: WonStep) => {
    step = s
    if (fp.failAt === s) throw simulatedError(co.companyId, s, fp.failWith)
  }

  try {
    const now = new Date().toISOString()
    const plans = planAll(co, serviceIds, input.projectManagerId, input.startDate)

    // 1. Lead → Won (leads.won_at + a lead_status_history row).
    check('lead')
    const prevStatus = lead.status
    lead.status = wonKey
    lead.stageChangedAt = now
    lead.wonAt = now
    lead.nextFollowUpDate = null
    lead.nextStep = ''
    recordLeadStatusChange(lead, prevStatus, wonKey, { changedBy: user.id, reason: 'Won (Won flow)', at: now })

    // 2. Customer: link an existing one or create it from the lead (contacts, notes and activities
    //    stay on the lead id, which the customer references, so nothing is retyped).
    check('customer')
    let customer = existingCustomer(lead)
    const customerCreated = !customer
    if (!customer) {
      customer = stamp(customerFromLead(lead, { id: `C-${lead.id.slice(2)}`, wonAt: now, country: companyById(lead.companyId)?.regional.country }), co)
      if (customers.some((c) => c.id === customer!.id)) customer.id = `C-${lead.id.slice(2)}-${Date.now().toString(36).slice(-3)}`
      customers.push(customer)
    }
    const customerServicesBefore = [...customer.serviceIds]
    customer.serviceIds = [...new Set([...customer.serviceIds, ...serviceIds])]
    lead.customerId = customer.id
    // contacts.customer_id: the lead's contacts now also belong to the customer (they keep lead_id).
    for (const k of contacts) if (k.companyId === co.companyId && k.leadId === lead.id) k.customerId = customer.id
    // The accepted quotation gets customer_id and accepted_at.
    if (quoteCheck.quote) {
      quoteCheck.quote.customerId = customer.id
      quoteCheck.quote.acceptedAt = quoteCheck.quote.acceptedAt ?? quoteCheck.quote.decidedAt ?? now
    }

    // 3. Contract from the accepted quotation's recurring lines.
    check('contract')
    let contractId: string | null = null
    const c = contractFrom(co, quotationId, input.startDate, lead.company)
    if (c) {
      const contract: Tenant<Contract> = {
        companyId: co.companyId,
        id: `CT-${Date.now().toString(36).toUpperCase()}`,
        customerId: customer.id,
        title: c.title,
        serviceIds: c.serviceIds.length ? c.serviceIds : serviceIds,
        value: c.value,
        billing: c.billing,
        startDate: c.startDate,
        renewalDate: c.renewalDate,
        status: 'active',
        ownerId: lead.ownerId,
        quotationId,
        createdBy: user.id,
      }
      contracts.push(contract)
      contractId = contract.id
    }

    // 4. One project per purchased service, tasks from its template.
    check('projects')
    const projectIds: string[] = []
    const taskIds: string[] = []
    const projectAudit: { id: string; name: string; tasks: number }[] = []
    for (const plan of plans) {
      const id = nextProjectId()
      projects.push({
        companyId: co.companyId,
        id,
        name: `${plan.serviceName} — ${customer.name}`,
        customerId: customer.id,
        serviceId: plan.serviceId,
        leadId,
        quotationId,
        contractId,
        projectTemplateId: plan.hasTemplate ? plan.serviceId : null,
        managerId: input.projectManagerId,
        startDate: plan.startDate,
        endDate: plan.endDate,
        status: 'planned',
        estimatedHours: plan.estimatedHours,
        createdAt: now,
        createdBy: user.id,
        createdFrom: 'won',
      })
      projectIds.push(id)
      projectAudit.push({ id, name: `${plan.serviceName} — ${customer.name}`, tasks: plan.tasks.length })
      for (const [k, p] of plan.tasks.entries()) {
        const t: Tenant<Task> = {
          companyId: co.companyId,
          id: nextTaskId(),
          title: p.title,
          description: `${p.role ?? 'No role'} · from the ${plan.serviceName} template`,
          ownerId: p.ownerId,
          followerIds: p.ownerId === input.projectManagerId ? [] : [input.projectManagerId],
          priority: p.priority,
          dueDate: p.dueDate,
          status: 'todo',
          link: null,
          projectId: id,
          parentTaskId: null,
          estimatedHours: p.hours,
          templateTaskId: p.templateTaskId,
          dayOffset: p.dayOffset,
          sortOrder: k + 1,
          blockedAt: null,
          blockedReason: null,
          reminderSentAt: null,
          overdueNotifiedAt: null,
          attachments: [],
          comments: [],
          history: [{ id: `${id}-${p.templateTaskId}-h0`, kind: 'created', userId: user.id, at: now, summary: `Created by the Won flow for ${lead.company}` }],
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        }
        tasks.push(t)
        taskIds.push(t.id)
      }
    }

    // 5. Notify the team.
    check('notify')
    const link = projectIds[0] ? `/projects/${projectIds[0]}` : `/crm/customers/${customer.id}`
    const companyId = co.companyId
    pushNotification({ companyId, userId: lead.ownerId, type: 'won', title: `${lead.company} is Won`, body: `${projectIds.length} project${projectIds.length === 1 ? '' : 's'} created.`, link })
    if (input.projectManagerId !== lead.ownerId) {
      pushNotification({ companyId, userId: input.projectManagerId, type: 'assignment', title: `You manage ${projectIds.length === 1 ? 'a new project' : `${projectIds.length} new projects`}`, body: lead.company, link })
    }
    const perOwner = new Map<string, number>()
    for (const p of plans) for (const t of p.tasks) perOwner.set(t.ownerId, (perOwner.get(t.ownerId) ?? 0) + 1)
    for (const [ownerId, n] of perOwner) {
      if (ownerId === input.projectManagerId || ownerId === lead.ownerId) continue
      pushNotification({ companyId, userId: ownerId, type: 'assignment', title: `${n} new task${n === 1 ? '' : 's'} for ${lead.company}`, body: 'Delivery tasks from the project template', link })
    }

    // 6. Audit (customer, contract, each project, then the lead) and a system activity on the lead,
    //    plus on the customer's own lead when an existing customer of another lead was linked (a
    //    customer's timeline reads its lead's activities). The project entries give each project's
    //    Activity tab its history from day one.
    check('audit')
    recordAudit(user, {
      action: customerCreated ? 'create' : 'update',
      entity: 'customer',
      entityId: customer.id,
      summary: customerCreated ? `Customer ${customer.name} created from won lead ${lead.id}` : `Customer ${customer.name} linked to won lead ${lead.id}`,
      changes: customerCreated ? [] : [{ field: 'serviceIds', from: customerServicesBefore.join(', '), to: customer.serviceIds.join(', ') }],
    })
    if (contractId && c) {
      recordAudit(user, {
        action: 'create',
        entity: 'contract',
        entityId: contractId,
        summary: `Contract “${c.title}” created by the Won flow from quotation ${quoteCheck.quote?.number ?? ''}`.trim(),
      })
    }
    for (const p of projectAudit) {
      recordAudit(user, {
        action: 'create',
        entity: 'project',
        entityId: p.id,
        summary: `Project ${p.name} created by the Won flow for ${lead.company} (lead ${lead.id}) with ${p.tasks} template task${p.tasks === 1 ? '' : 's'}`,
      })
    }
    recordAudit(user, {
      action: 'update',
      entity: 'lead',
      entityId: lead.id,
      summary: `Won ${lead.company}: customer ${customerCreated ? 'created' : 'linked'} (${customer.id}), ${projectIds.length} project(s), ${taskIds.length} task(s)${contractId ? ', 1 contract' : ''}`,
      changes: [{ field: 'status', from: prevStatus, to: wonKey }],
    })
    const summary = `Won by ${user.name}. Customer ${customer.name}${contractId ? ', contract created' : ''}; ${projectIds.length} delivery project(s) with ${taskIds.length} task(s).`
    for (const timeline of new Set([lead.id, customer.leadId])) {
      activities.push(stamp({ id: `A-${timeline}-won-${Date.now().toString(36)}`, leadId: timeline, type: 'system' as const, summary, userId: user.id, at: now }, co))
    }

    return await delay({
      leadId,
      customerId: customer.id,
      customerCreated,
      contractId,
      projectIds,
      taskIds,
      redirectTo: projectIds[0] ? `/projects/${projectIds[0]}` : `/crm/customers/${customer.id}`,
    })
  } catch (e) {
    restore(snap)
    usedKeys.delete(usedKey)
    throw asWonError(e, step)
  } finally {
    inFlight.delete(leadId)
  }
}
