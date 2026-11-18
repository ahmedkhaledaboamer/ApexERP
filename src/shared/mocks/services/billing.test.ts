import { afterEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import type { ImportLeadRow } from '@/modules/leads/types'
import type { LimitKey } from '@/modules/billing/types'
import { ApiError } from '@/shared/lib/apiError'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { contacts, leads, users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { auditLog } from '@/shared/mocks/data/audit'
import { notifications, tasks } from '@/shared/mocks/data/tasks'
import { quotations } from '@/shared/mocks/data/quotations'
import { billingInvoices, subscriptionOf, usageSimulation } from '@/shared/mocks/data/subscriptions'
import { billingSettings } from '@/shared/mocks/data/plans'
import { advanceClock, nowMs } from '@/shared/mocks/clock'
import { tokenFor } from '@/shared/mocks/server'
import { CodedApiError } from '@/shared/mocks/tenant'
import { errorBody, respond, userFrom } from '@/shared/mocks/handlers/utils'
import {
  cancelScheduledChange,
  cancelSubscription,
  changePlan,
  consumeAiCredits,
  devFailNextPayment,
  devSetStatus,
  devSetUsage,
  exportData,
  getBillingOverview,
  getEntitlements,
  reactivateSubscription,
  resumeSubscription,
  runLifecycleForAll,
  setPaymentMethod,
  usedOf,
  usageOf,
} from '@/shared/mocks/services/billing'
import { createUser, deactivateUser, reactivateUser } from '@/shared/mocks/services/settingsUsers'
import { createLead } from '@/shared/mocks/services/leads'
import { createContact } from '@/shared/mocks/services/crm'
import { runImport } from '@/shared/mocks/services/leadImport'
import { addAttachment } from '@/shared/mocks/services/tasks'
import { sendMessage } from '@/shared/mocks/services/messages'
import { sendQuotation } from '@/shared/mocks/services/quotations'
import { completeSignup, startSignup, verifySignup } from '@/shared/mocks/services/signup'
import { login } from '@/shared/mocks/services/auth'
import { DEMO_PASSWORD } from '@/shared/lib/constants'

/* Every test starts from the seed (mock DB, clock offset and billing state are all registered stores). */
const seed = takeSnapshot(true)
afterEach(() => {
  restoreSnapshot(seed)
})

const DAY = 86_400_000
const u = (id: string) => users.find((x) => x.id === id)!
const apexAdmin = () => u('u1')
const apexManagement = () => u('u2')
const crestAdmin = () => u('u101')
const crestManagement = () => u('u102')
const crestManager = () => u('u103')

async function apiError(p: Promise<unknown> | (() => unknown)): Promise<ApiError> {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('Expected the call to fail')
}

/** Sets a simulated usage so that `used` = target exactly (real + offset). */
function simulate(companyId: string, key: LimitKey, target: number): void {
  for (let i = usageSimulation.length - 1; i >= 0; i--) {
    if (usageSimulation[i].companyId === companyId && usageSimulation[i].key === key) usageSimulation.splice(i, 1)
  }
  const real = usedOf(companyId, key)
  usageSimulation.push({ companyId, key, offset: target - real })
}

const daysUntil = (iso: string) => Math.ceil((Date.parse(iso) - nowMs()) / DAY)

/** Moves the mock clock and runs the lifecycle for all companies (what POST /dev/billing/advance does). */
function advance(days: number): void {
  advanceClock(days)
  runLifecycleForAll()
}

const card = { holder: 'Test Admin', cardNumber: '4242 4242 4242 4242', expiry: '12/39', cvc: '123' }

let n = 0
/** A new company on the trial (sign-up flow), returning its Company Admin. */
async function trialCompany(): Promise<User> {
  n++
  const s = await startSignup(
    {
      companyName: `Trial Co ${n}`,
      subdomain: `trial-co-${n}`,
      country: 'AE',
      language: 'en',
      adminName: 'Trial Admin',
      adminEmail: `admin${n}@trial-co.example`,
      mobile: '0501234567',
      password: 'Sunny-Harbor-42',
      acceptTerms: true,
    },
    `billing-test-${n}`,
  )
  await verifySignup(s.signupId, { code: s.devCode })
  const session = await completeSignup(s.signupId, { plan: 'trial' })
  return u(session.user.id)
}

const req = (user: User, method: string, path: string) =>
  new Request(`http://localhost/api${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(user)}` } })

/** What the HTTP layer answers for a request (userFrom inside respond, like every handler). */
async function call(user: User, method: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await respond(() => {
    userFrom(req(user, method, path))
    return { ok: true }
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/* ---------------- Seeds ---------------- */

describe('billing seeds', () => {
  it('Apex is Enterprise, Crest is Business, both active with a renewal in 2–3 weeks; company mirrors match', async () => {
    const apex = subscriptionOf(APEX_ID)!
    const crest = subscriptionOf(CREST_ID)!
    expect(apex).toMatchObject({ planId: 'enterprise', status: 'active' })
    expect(crest).toMatchObject({ planId: 'business', status: 'active' })
    for (const s of [apex, crest]) {
      expect(daysUntil(s.currentPeriodEnd)).toBeGreaterThanOrEqual(14)
      expect(daysUntil(s.currentPeriodEnd)).toBeLessThanOrEqual(21)
    }
    expect(companyById(CREST_ID)!.enabledModules).toEqual(expect.arrayContaining(['marketing', 'accounting']))
    expect(companyById(CREST_ID)!.enabledModules).not.toContain('hr')
    const overview = await getBillingOverview(crestAdmin())
    expect(overview.invoices.length).toBeGreaterThanOrEqual(3)
    expect(overview.invoices.every((i) => i.status === 'paid')).toBe(true)
    expect(overview.plans.map((p) => p.id)).toEqual(['trial', 'starter', 'business', 'enterprise'])
    expect(overview.settings).toEqual(billingSettings)
  })
})

/* ---------------- Limits ---------------- */

describe('limit enforcement (402 LIMIT_REACHED, details in the body)', () => {
  it('users: create and reactivate are blocked at the limit', async () => {
    simulate(CREST_ID, 'users', 25)
    const input = {
      name: 'One Too Many',
      email: 'one.too.many@crestlogistics.sa',
      mobile: '+966 55 777 1234',
      role: 'Sales Agent' as const,
      title: '',
      departmentId: 'c2-sales',
      managerId: null,
    }
    const e = await apiError(createUser(crestAdmin(), input))
    expect(e.status).toBe(402)
    expect(e.code).toBe('LIMIT_REACHED')
    expect((e as CodedApiError).details).toEqual({ limit: 'users', current: 25, max: 25, planId: 'business' })
    expect(errorBody(e)).toMatchObject({ code: 'LIMIT_REACHED', limit: 'users', current: 25, max: 25, planId: 'business' })

    // Room for one: deactivate frees a seat, reactivating takes it back, the next reactivation is blocked.
    simulate(CREST_ID, 'users', 24)
    await deactivateUser(crestAdmin(), 'u107', true)
    await reactivateUser(crestAdmin(), 'u107')
    simulate(CREST_ID, 'users', 25)
    await deactivateUser(crestAdmin(), 'u107', true)
    // Deactivating lowered real usage to 24; put it back at the limit.
    simulate(CREST_ID, 'users', 25)
    expect((await apiError(reactivateUser(crestAdmin(), 'u107'))).code).toBe('LIMIT_REACHED')
    // Nothing is deleted because of the limit.
    expect(users.some((x) => x.id === 'u107')).toBe(true)
  })

  it('leads + contacts: quick add and new contacts are blocked; existing data stays readable', async () => {
    simulate(CREST_ID, 'leadsContacts', 25000 - 1)
    // A quick add creates the lead and its contact: 2 needed, 1 left.
    const e = await apiError(
      createLead(crestManager(), { company: 'Limit Test Co', contactName: 'Sami', mobile: '+966 55 321 7788', email: 'sami@limit.example', sourceType: 'Website', industry: 'Logistics' }),
    )
    expect(e.status).toBe(402)
    expect((e as CodedApiError).details).toMatchObject({ limit: 'leadsContacts', max: 25000, planId: 'business' })

    const lead = leads.find((l) => l.companyId === CREST_ID)!
    simulate(CREST_ID, 'leadsContacts', 25000)
    const ce = await apiError(
      createContact(crestAdmin(), { recordType: 'Lead', recordId: lead.id, name: 'Extra Person', title: '', mobile: '', email: 'extra@limit.example', isDecisionMaker: false }),
    )
    expect(ce.code).toBe('LIMIT_REACHED')

    simulate(CREST_ID, 'leadsContacts', 10)
    const created = await createLead(crestManager(), {
      company: 'Limit Test Co',
      contactName: 'Sami',
      mobile: '+966 55 321 7788',
      email: 'sami@limit.example',
      sourceType: 'Website',
      industry: 'Logistics',
    })
    expect(created.id).toBeTruthy()
    expect(usedOf(CREST_ID, 'leadsContacts')).toBe(12)
  })

  it('leads + contacts: an import creates rows up to the limit and reports the rest', async () => {
    const row = (i: number): ImportLeadRow => ({
      row: i + 2,
      company: `Imported Co ${i}`,
      website: '',
      contactName: `Person ${i}`,
      contactTitle: '',
      mobile: '',
      email: `person${i}@imported-${i}.example`,
      isDecisionMaker: false,
      sourceType: 'Website',
      sourceDetail: '',
      industry: 'Logistics',
      subIndustry: '',
      status: '',
      ownerId: '',
      nextFollowUpDate: '',
      nextStep: '',
      value: null,
      companyServices: [],
      recommendedServiceId: '',
      recommendedServiceText: '',
      notes: '',
      doNotContact: false,
    })
    // Room for 5 more: each row is a lead + its contact (2), so 2 rows fit.
    simulate(CREST_ID, 'leadsContacts', 25000 - 5)
    const before = leads.filter((l) => l.companyId === CREST_ID).length
    const result = await runImport(crestAdmin(), { rows: [0, 1, 2, 3, 4].map(row), decisions: {}, ownerRule: 'auto' })
    expect(result.created).toBe(2)
    expect(result.skippedForLimit).toBe(3)
    expect(result.failed).toEqual([])
    expect(result.skippedRows).toEqual([])
    expect(result.limitReached).toMatchObject({ code: 'LIMIT_REACHED', limit: 'leadsContacts', max: 25000, planId: 'business' })
    expect(leads.filter((l) => l.companyId === CREST_ID).length).toBe(before + 2)

    // Without a limit problem the report is clean.
    simulate(CREST_ID, 'leadsContacts', 0)
    const ok = await runImport(crestAdmin(), { rows: [5].map(row), decisions: {}, ownerRule: 'auto' })
    expect(ok).toMatchObject({ created: 1, skippedForLimit: 0, limitReached: null })
  })

  it('storage: task attachments are blocked when the file doesn’t fit', async () => {
    const task = tasks.find((t) => t.companyId === CREST_ID)!
    const owner = crestAdmin()
    simulate(CREST_ID, 'storageMb', 51200 - 1)
    const e = await apiError(addAttachment(owner, task.id, { name: 'big.pdf', size: 2 * 1024 * 1024, type: 'application/pdf' }))
    expect(e.status).toBe(402)
    expect((e as CodedApiError).details).toMatchObject({ limit: 'storageMb', max: 51200 })
    const view = await addAttachment(owner, task.id, { name: 'small.pdf', size: 512 * 1024, type: 'application/pdf' })
    expect(view.attachments.some((a) => a.name === 'small.pdf')).toBe(true)
  })

  it('emails per period: lead emails and quotation sends count and are blocked at the limit', async () => {
    const team = ['u103', 'u104', 'u105']
    const lead = leads.find((l) => l.companyId === CREST_ID && team.includes(l.ownerId) && !l.doNotContact)!
    const send = () => sendMessage(crestManager(), lead.id, { channel: 'email', to: 'buyer@example.sa', subject: 'Hello', body: 'Hi there' })

    await send()
    expect(usedOf(CREST_ID, 'emailsPerMonth')).toBe(1)
    expect(usageOf(CREST_ID).items.find((i) => i.key === 'emailsPerMonth')!.used).toBe(1)

    simulate(CREST_ID, 'emailsPerMonth', 20000)
    const e = await apiError(send())
    expect(e.code).toBe('LIMIT_REACHED')
    expect((e as CodedApiError).details).toMatchObject({ limit: 'emailsPerMonth', current: 20000, max: 20000 })

    const draft = quotations.find((q) => q.companyId === CREST_ID && q.status === 'Draft' && q.contactEmail.trim())
    if (draft) {
      const qe = await apiError(sendQuotation(crestAdmin(), draft.id))
      expect(qe.code).toBe('LIMIT_REACHED')
      expect(quotations.find((q) => q.id === draft.id)!.status).toBe('Draft')
    }
  })

  it('AI credits: the consume endpoint is gated by module and limit', async () => {
    const r = await consumeAiCredits(crestAdmin(), { credits: 30 })
    expect(r).toEqual({ used: 30, limit: 1000, remaining: 970 })
    const e = await apiError(consumeAiCredits(crestAdmin(), { credits: 971 }))
    expect(e.code).toBe('LIMIT_REACHED')
    expect((e as CodedApiError).details).toEqual({ limit: 'aiCredits', current: 30, max: 1000, planId: 'business' })
    expect((await apiError(consumeAiCredits(crestAdmin(), { credits: 0 }))).status).toBe(422)

    // The trial (Starter modules) has no AI.
    const trialAdmin = await trialCompany()
    const locked = await apiError(consumeAiCredits(trialAdmin, { credits: 1 }))
    expect(locked.status).toBe(403)
    expect(locked.code).toBe('module_not_in_plan')
    expect((locked as CodedApiError).details).toEqual({ module: 'ai', planId: 'trial' })
  })

  it('entitlements list reached limits', async () => {
    simulate(CREST_ID, 'users', 25)
    const ent = await getEntitlements(crestManager())
    expect(ent).toMatchObject({ planId: 'business', status: 'active', readOnly: false, reached: ['users'] })
    expect(ent.modules).toContain('ai')
  })
})

/* ---------------- Usage warnings ---------------- */

describe('usage warnings', () => {
  it('go to Company Admins once per threshold per limit per period', async () => {
    const usageNotes = () => notifications.filter((x) => x.companyId === CREST_ID && x.type === 'usage')
    const admins = users.filter((x) => x.companyId === CREST_ID && x.role === 'Company Admin' && x.active)
    await devSetUsage(crestAdmin(), { key: 'users', percent: 80 })
    expect(usageNotes()).toHaveLength(admins.length)
    expect(usageNotes()[0]).toMatchObject({ userId: admins[0].id, link: '/settings/billing' })
    await devSetUsage(crestAdmin(), { key: 'users', percent: 85 })
    expect(usageNotes()).toHaveLength(admins.length)
    await devSetUsage(crestAdmin(), { key: 'users', percent: 100 })
    expect(usageNotes()).toHaveLength(2 * admins.length)
    await devSetUsage(crestAdmin(), { key: 'users', percent: 100 })
    expect(usageNotes()).toHaveLength(2 * admins.length)
    // Unlimited limits (Apex Enterprise) are ignored.
    await devSetUsage(apexAdmin(), { key: 'users', percent: 100 })
    expect(notifications.some((x) => x.companyId === APEX_ID && x.type === 'usage')).toBe(false)
  })

  it('period counters reset at renewal (and warnings can fire again in the new period)', async () => {
    await consumeAiCredits(crestAdmin(), { credits: 900 })
    expect(notifications.filter((x) => x.companyId === CREST_ID && x.type === 'usage')).toHaveLength(1)
    advance(daysUntil(subscriptionOf(CREST_ID)!.currentPeriodEnd) + 1)
    expect(subscriptionOf(CREST_ID)!.status).toBe('active')
    expect(usedOf(CREST_ID, 'aiCredits')).toBe(0)
    await consumeAiCredits(crestAdmin(), { credits: 850 })
    expect(notifications.filter((x) => x.companyId === CREST_ID && x.type === 'usage')).toHaveLength(2)
  })
})

/* ---------------- Plan changes ---------------- */

describe('plan changes', () => {
  it('a downgrade is blocked when stock usage exceeds the new limits (409 with blocks)', async () => {
    // Crest has 7 active users; Starter allows 5.
    const e = await apiError(changePlan(crestAdmin(), { planId: 'starter' }))
    expect(e.status).toBe(409)
    expect(e.code).toBe('downgrade_blocked')
    expect((e as CodedApiError).details.blocks).toEqual([{ key: 'users', label: 'Users', used: 7, limit: 5 }])
    expect(subscriptionOf(CREST_ID)!.scheduledChange).toBeNull()
  })

  it('an allowed downgrade is scheduled for the period end, can be cancelled, and is applied at renewal', async () => {
    const sub = subscriptionOf(APEX_ID)!
    const r = await changePlan(apexAdmin(), { planId: 'business' })
    expect(r.kind).toBe('scheduled')
    expect(r.invoice).toBeNull()
    expect(r.overview.subscription.scheduledChange).toMatchObject({ toPlan: 'business', effectiveAt: sub.currentPeriodEnd, requestedBy: 'Omar Haddad' })
    expect(sub.planId).toBe('enterprise')

    await cancelScheduledChange(apexAdmin())
    expect(sub.scheduledChange).toBeNull()
    expect((await apiError(cancelScheduledChange(apexAdmin()))).code).toBe('no_scheduled_change')

    await changePlan(apexAdmin(), { planId: 'business' })
    const invoices = billingInvoices.filter((i) => i.companyId === APEX_ID).length
    advance(daysUntil(sub.currentPeriodEnd) + 1)
    expect(sub).toMatchObject({ planId: 'business', status: 'active', scheduledChange: null, customPrice: null })
    expect(companyById(APEX_ID)!.plan).toBe('business')
    // Losing HR: data is kept, the module is locked.
    expect(companyById(APEX_ID)!.enabledModules).not.toContain('hr')
    const renewal = billingInvoices.filter((i) => i.companyId === APEX_ID)
    expect(renewal).toHaveLength(invoices + 1)
    expect(renewal.at(-1)).toMatchObject({ planId: 'business', amount: 79, status: 'paid' })
    expect((await call(apexAdmin(), 'GET', '/hr/employees')).body.code).toBe('module_not_in_plan')
  })

  it('an upgrade is immediate and prorated; rules for roles, plans and states', async () => {
    const trialAdmin = await trialCompany()
    // trial → paid needs a payment method.
    expect((await apiError(changePlan(trialAdmin, { planId: 'starter' }))).code).toBe('payment_method_required')
    await setPaymentMethod(trialAdmin, card)
    const up = await changePlan(trialAdmin, { planId: 'starter' })
    expect(up.kind).toBe('upgraded')
    expect(up.invoice).toMatchObject({ amount: 29, status: 'paid', planId: 'starter' })
    expect(up.overview.subscription).toMatchObject({ status: 'active', planId: 'starter', trialEndsAt: null })
    expect(companyById(trialAdmin.companyId)!.status).toBe('active')

    // Starter → Business mid-period: prorated difference (≤ 50).
    const biz = await changePlan(trialAdmin, { planId: 'business' })
    expect(biz.invoice!.amount).toBeGreaterThan(0)
    expect(biz.invoice!.amount).toBeLessThanOrEqual(50)
    expect(companyById(trialAdmin.companyId)!.enabledModules).toEqual(expect.arrayContaining(['marketing', 'accounting']))

    expect((await apiError(changePlan(trialAdmin, { planId: 'business' }))).code).toBe('same_plan')
    expect((await apiError(changePlan(trialAdmin, { planId: 'enterprise' }))).code).toBe('contact_sales')
    expect((await apiError(changePlan(trialAdmin, { planId: 'nope' }))).code).toBe('invalid_plan')
    expect((await apiError(changePlan(crestManagement(), { planId: 'starter' }))).status).toBe(403)
    // Management reads the overview; other roles can't.
    expect((await getBillingOverview(crestManagement())).plan.id).toBe('business')
    expect((await apiError(getBillingOverview(crestManager()))).status).toBe(403)
  })

  it('cancel at period end, resume, and cancel → cancelled at renewal', async () => {
    await cancelSubscription(crestAdmin())
    expect(subscriptionOf(CREST_ID)!.cancelAtPeriodEnd).toBe(true)
    await resumeSubscription(crestAdmin())
    expect(subscriptionOf(CREST_ID)!.cancelAtPeriodEnd).toBe(false)
    await cancelSubscription(crestAdmin())
    advance(daysUntil(subscriptionOf(CREST_ID)!.currentPeriodEnd) + 1)
    const sub = subscriptionOf(CREST_ID)!
    expect(sub.status).toBe('cancelled')
    expect(Date.parse(sub.deleteAt!) - Date.parse(sub.statusChangedAt)).toBe(billingSettings.retentionDays * DAY)
  })
})

/* ---------------- Lifecycle ---------------- */

describe('subscription lifecycle', () => {
  it('trial → active when a payment method is on file (reminders at 7, 3 and 1 days)', async () => {
    const admin = await trialCompany()
    const co = admin.companyId
    await setPaymentMethod(admin, card)
    advance(billingSettings.trialDays + 1)
    const sub = subscriptionOf(co)!
    expect(sub).toMatchObject({ status: 'active', planId: 'starter', trialEndsAt: null })
    expect(billingInvoices.filter((i) => i.companyId === co)).toEqual([expect.objectContaining({ amount: 29, status: 'paid' })])
    const billingNotes = notifications.filter((x) => x.companyId === co && x.type === 'billing')
    expect(billingNotes.filter((x) => x.title.startsWith('Your trial ends in'))).toHaveLength(3)
    expect(companyById(co)!.status).toBe('active')
    expect(auditLog.some((a) => a.companyId === co && a.userName === 'System' && a.summary.includes('Trial converted'))).toBe(true)
  })

  it('trial → suspended without a payment method; read-only; a card restores access', async () => {
    const admin = await trialCompany()
    const co = admin.companyId
    advance(billingSettings.trialDays + 1)
    expect(subscriptionOf(co)!.status).toBe('suspended')
    // The console status is not the operator lock.
    expect(companyById(co)!.status).toBe('active')

    const ent = await getEntitlements(admin)
    expect(ent).toMatchObject({ status: 'suspended', readOnly: true })

    // Read-only: writes 423, reads fine, exemptions pass.
    const write = await call(admin, 'POST', '/leads')
    expect(write.status).toBe(423)
    expect(write.body).toMatchObject({ code: 'workspace_read_only', status: 'suspended' })
    expect((await call(admin, 'PATCH', '/settings/company-profile')).status).toBe(423)
    expect((await call(admin, 'GET', '/leads')).status).toBe(200)
    for (const path of ['/billing/payment-method', '/billing/reactivate', '/billing/resume', '/alerts/read-all', '/alerts/NT-1/read', '/auth/switch-role', '/dev/billing/advance']) {
      expect((await call(admin, path.endsWith('/read') ? 'PATCH' : 'POST', path)).status).toBe(200)
    }
    expect((await call(admin, 'GET', '/billing/export')).status).toBe(200)
    expect((await exportData(admin)).company.subdomain).toBe(companyById(co)!.subdomain)

    // Paying restores access: a new period on the conversion plan.
    await setPaymentMethod(admin, card)
    expect(subscriptionOf(co)).toMatchObject({ status: 'active', planId: 'starter' })
    expect((await call(admin, 'POST', '/leads')).status).toBe(200)
  })

  it('renewal failure → past due → suspended → cancelled → deleted, step by step', async () => {
    const sub = subscriptionOf(CREST_ID)!
    await devFailNextPayment(crestAdmin(), { fail: true })
    advance(daysUntil(sub.currentPeriodEnd) + 0.01)
    expect(sub.status).toBe('past_due')
    expect(Date.parse(sub.graceEndsAt!) - Date.parse(sub.statusChangedAt)).toBe(billingSettings.graceDays * DAY)
    expect(billingInvoices.filter((i) => i.companyId === CREST_ID && i.status === 'open')).toHaveLength(1)
    expect((await getEntitlements(crestManager())).graceEndsAt).toBe(sub.graceEndsAt)
    // Past due keeps full access.
    expect((await call(crestManager(), 'POST', '/leads')).status).toBe(200)

    advance(billingSettings.graceDays)
    expect(sub.status).toBe('suspended')
    const reminders = notifications.filter((x) => x.companyId === CREST_ID && x.title === 'Payment overdue')
    expect(reminders).toHaveLength(billingSettings.pastDueReminderDays.length * users.filter((x) => x.companyId === CREST_ID && x.role === 'Company Admin' && x.active).length)

    advance(billingSettings.suspendedDaysBeforeCancel)
    expect(sub.status).toBe('cancelled')
    expect(billingInvoices.filter((i) => i.companyId === CREST_ID && i.status === 'open')).toHaveLength(0)
    expect((await getEntitlements(crestManager())).deleteAt).toBe(sub.deleteAt)

    advance(billingSettings.retentionDays)
    expect(sub.status).toBe('deleted')
    const gone = await call(crestManager(), 'GET', '/leads')
    expect(gone.status).toBe(410)
    expect(gone.body.code).toBe('workspace_deleted')
    const signIn = await apiError(login(crestAdmin().email, DEMO_PASSWORD, 'crest'))
    expect(signIn.status).toBe(410)
    expect(signIn.code).toBe('workspace_deleted')
    // Apex is untouched.
    expect(subscriptionOf(APEX_ID)!.status).toBe('active')
  })

  it('advancing many days at once walks every transition in order', async () => {
    await devFailNextPayment(crestAdmin(), { fail: true })
    advance(200)
    expect(subscriptionOf(CREST_ID)!.status).toBe('deleted')
    const trail = auditLog
      .filter((a) => a.companyId === CREST_ID && a.entity === 'subscription' && a.userName === 'System')
      .map((a) => ({ at: a.at, to: a.changes.find((c) => c.field === 'status')?.to }))
      .filter((x) => x.to)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((x) => x.to)
    expect(trail).toEqual(['Past due', 'Suspended', 'Cancelled', 'Deleted'])
    // Apex renewed every month on the way (paid, no failure flag).
    expect(subscriptionOf(APEX_ID)!.status).toBe('active')
    expect(billingInvoices.filter((i) => i.companyId === APEX_ID && i.issuedAt > new Date().toISOString()).length).toBeGreaterThanOrEqual(6)
  })

  it('a new card fixes past due (the open invoice is paid)', async () => {
    const sub = subscriptionOf(CREST_ID)!
    await devFailNextPayment(crestAdmin(), { fail: true })
    advance(daysUntil(sub.currentPeriodEnd) + 1)
    expect(sub.status).toBe('past_due')
    const declined = await apiError(setPaymentMethod(crestAdmin(), { ...card, cardNumber: '4000 0000 0000 0002' }))
    expect(declined).toMatchObject({ status: 402, code: 'card_declined' })
    expect(sub.status).toBe('past_due')
    await setPaymentMethod(crestAdmin(), { ...card, cardNumber: '5555 5555 5555 4444' })
    expect(sub).toMatchObject({ status: 'active', graceEndsAt: null })
    expect(sub.paymentMethod).toMatchObject({ brand: 'mastercard', last4: '4444' })
    expect(billingInvoices.filter((i) => i.companyId === CREST_ID && i.status === 'open')).toHaveLength(0)
  })

  it('reactivate a cancelled workspace with the saved card', async () => {
    await devSetStatus(crestAdmin(), { status: 'cancelled' })
    expect((await call(crestAdmin(), 'POST', '/leads')).status).toBe(423)
    expect((await apiError(changePlan(crestAdmin(), { planId: 'business' }))).code).toBe('same_plan')
    expect((await apiError(reactivateSubscription(crestAdmin(), { planId: 'starter' }))).code).toBe('downgrade_blocked')
    const o = await reactivateSubscription(crestAdmin(), { planId: 'business' })
    expect(o.subscription).toMatchObject({ status: 'active', deleteAt: null })
    expect(o.invoices[0]).toMatchObject({ amount: 79, status: 'paid' })
    expect((await call(crestAdmin(), 'POST', '/leads')).status).toBe(200)
  })
})

/* ---------------- Gating and isolation (HTTP layer) ---------------- */

describe('module gating at the API (userFrom)', () => {
  it('locked modules answer 403 module_not_in_plan with the module and plan', async () => {
    const crestHr = await call(crestManager(), 'GET', '/hr/employees')
    expect(crestHr.status).toBe(403)
    expect(crestHr.body).toMatchObject({ code: 'module_not_in_plan', module: 'hr', planId: 'business' })
    expect((await call(apexAdmin(), 'GET', '/hr/employees')).status).toBe(200)
    expect((await call(crestManager(), 'GET', '/events')).status).toBe(200)

    const trialAdmin = await trialCompany()
    for (const [path, module] of [
      ['/events', 'events'],
      ['/marketing/campaigns', 'marketing'],
      ['/finance/invoices', 'accounting'],
      ['/integrations', 'integrations'],
      ['/settings/email-connection', 'integrations'],
      ['/ai/credits/consume', 'ai'],
    ] as const) {
      const r = await call(trialAdmin, path.startsWith('/ai') ? 'POST' : 'GET', path)
      expect(r.status).toBe(403)
      expect(r.body.module).toBe(module)
    }
    expect((await call(trialAdmin, 'GET', '/leads')).status).toBe(200)
  })
})

describe('cross-company isolation of usage and billing', () => {
  it('Crest actions never move Apex usage or invoices; reads only return the caller’s company', async () => {
    const apexUsage = JSON.stringify(usageOf(APEX_ID))
    const apexInvoices = JSON.stringify(billingInvoices.filter((i) => i.companyId === APEX_ID))
    const apexNotes = notifications.filter((x) => x.companyId === APEX_ID).length

    await consumeAiCredits(crestAdmin(), { credits: 900 })
    await devSetUsage(crestAdmin(), { key: 'users', percent: 100 })
    await devFailNextPayment(crestAdmin(), { fail: true })
    await setPaymentMethod(crestAdmin(), card)
    advance(daysUntil(subscriptionOf(CREST_ID)!.currentPeriodEnd) + 1)
    expect(subscriptionOf(CREST_ID)!.status).toBe('past_due')

    expect(subscriptionOf(APEX_ID)!.status).toBe('active')
    expect(usedOf(APEX_ID, 'aiCredits')).toBe(0)
    expect(JSON.parse(apexUsage).items.find((i: { key: string }) => i.key === 'users').used).toBe(usedOf(APEX_ID, 'users'))
    // Apex got its own renewal invoice; its old ones are unchanged and no Crest invoice leaked in.
    const now = billingInvoices.filter((i) => i.companyId === APEX_ID)
    expect(JSON.stringify(now.slice(0, JSON.parse(apexInvoices).length))).toBe(apexInvoices)
    expect(now.every((i) => i.planId === 'enterprise')).toBe(true)
    expect(notifications.filter((x) => x.companyId === APEX_ID && (x.type === 'usage' || x.type === 'billing')).length).toBe(0)
    expect(notifications.filter((x) => x.companyId === APEX_ID).length).toBe(apexNotes)

    const apexOverview = await getBillingOverview(apexManagement())
    expect(apexOverview.plan.id).toBe('enterprise')
    expect(apexOverview.invoices.every((i) => i.planId === 'enterprise')).toBe(true)
    expect(JSON.stringify(apexOverview)).not.toContain('co_crest')
    expect((await getEntitlements(apexAdmin())).planId).toBe('enterprise')
    const exp = await exportData(apexAdmin())
    expect(exp.counts.leads).toBe(leads.filter((l) => l.companyId === APEX_ID).length)
    expect(exp.counts.contacts).toBe(contacts.filter((c) => c.companyId === APEX_ID).length)
    expect(JSON.stringify(exp.data)).not.toContain('"companyId"')
    expect((exp.data.users as { id: string }[]).every((x) => u(x.id).companyId === APEX_ID)).toBe(true)
  })
})
