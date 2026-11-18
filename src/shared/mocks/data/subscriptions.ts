import { addMonths, startOfDay, subDays } from 'date-fns'
import type { BillingInvoice, BillingSubscription, LimitKey } from '@/modules/billing/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'
import { APEX_ID, CREST_ID, companies } from '@/shared/mocks/data/tenancy'

/**
 * Billing state of every company (server side; the client never sends a company id):
 *   subscriptions   one per company (plan, status, period, payment method, scheduled change)
 *   billingInvoices platform invoices (mocked charges)
 *   periodCounters  per-period usage counters (emails, AI credits) keyed by company + period start
 *   usageSimulation dev-only simulated usage offsets per company and limit
 *   billingSentKeys usage warnings and lifecycle reminders already sent (each goes out once)
 *   failNextPayment dev-only: companies whose next automatic charge fails
 * Seeds: Apex Aora on Enterprise (negotiated price), Crest Logistics on Business, both active with
 * a renewal about three weeks away and a few paid invoices.
 */

const createdAt = (id: string) => companies.find((c) => c.id === id)!.createdAt

// Period start ~10 / ~12 days ago, so the renewal is 2–3 weeks away.
const APEX_PERIOD_START = subDays(startOfDay(new Date()), 10)
const CREST_PERIOD_START = subDays(startOfDay(new Date()), 12)

const VISA = (holder: string, last4: string) => ({ brand: 'visa' as const, last4, expMonth: 8, expYear: new Date().getFullYear() + 3, holder })

export const subscriptions: Tenant<BillingSubscription>[] = [
  {
    id: 'sub_1',
    companyId: APEX_ID,
    planId: 'enterprise',
    status: 'active',
    startedAt: createdAt(APEX_ID),
    trialEndsAt: null,
    currentPeriodStart: APEX_PERIOD_START.toISOString(),
    currentPeriodEnd: addMonths(APEX_PERIOD_START, 1).toISOString(),
    paymentMethod: VISA('Omar Haddad', '4242'),
    scheduledChange: null,
    cancelAtPeriodEnd: false,
    statusChangedAt: createdAt(APEX_ID),
    graceEndsAt: null,
    deleteAt: null,
    customPrice: 499,
    planVersion: 1,
    pendingPlanVersion: null,
    selectedPlanId: null,
  },
  {
    id: 'sub_2',
    companyId: CREST_ID,
    planId: 'business',
    status: 'active',
    startedAt: createdAt(CREST_ID),
    trialEndsAt: null,
    currentPeriodStart: CREST_PERIOD_START.toISOString(),
    currentPeriodEnd: addMonths(CREST_PERIOD_START, 1).toISOString(),
    paymentMethod: { brand: 'mastercard', last4: '4444', expMonth: 11, expYear: new Date().getFullYear() + 2, holder: 'Faisal Al Harbi' },
    scheduledChange: null,
    cancelAtPeriodEnd: false,
    statusChangedAt: createdAt(CREST_ID),
    graceEndsAt: null,
    deleteAt: null,
    customPrice: null,
    planVersion: 1,
    pendingPlanVersion: null,
    selectedPlanId: null,
  },
]

let seq = subscriptions.length + 1
registerArray('subscriptions', subscriptions)
registerValue('subscriptions.seq', () => seq, (v) => { seq = v })

export function nextSubscriptionId(): string {
  return `sub_${seq++}`
}

export function subscriptionOf(companyId: string): Tenant<BillingSubscription> | undefined {
  return subscriptions.find((s) => s.companyId === companyId)
}

/* ---------------- Invoices ---------------- */

let invoiceSeq = 1

function seedInvoices(companyId: string, periodStart: Date, amount: number, planId: string, planName: string): Tenant<BillingInvoice>[] {
  return [3, 2, 1].map((monthsAgo) => {
    const start = addMonths(periodStart, -monthsAgo)
    const n = invoiceSeq++
    return {
      id: `binv_${n}`,
      companyId,
      number: `APX-${String(n).padStart(5, '0')}`,
      issuedAt: start.toISOString(),
      periodStart: start.toISOString(),
      periodEnd: addMonths(start, 1).toISOString(),
      planId,
      description: `${planName} plan, monthly`,
      amount,
      currency: 'USD',
      status: 'paid' as const,
    }
  })
}

export const billingInvoices: Tenant<BillingInvoice>[] = [
  ...seedInvoices(APEX_ID, APEX_PERIOD_START, 499, 'enterprise', 'Enterprise'),
  ...seedInvoices(CREST_ID, CREST_PERIOD_START, 79, 'business', 'Business'),
]
// The current period's invoices (paid at the start of the period).
for (const [companyId, start, amount, planId, name] of [
  [APEX_ID, APEX_PERIOD_START, 499, 'enterprise', 'Enterprise'],
  [CREST_ID, CREST_PERIOD_START, 79, 'business', 'Business'],
] as const) {
  const n = invoiceSeq++
  billingInvoices.push({
    id: `binv_${n}`,
    companyId,
    number: `APX-${String(n).padStart(5, '0')}`,
    issuedAt: start.toISOString(),
    periodStart: start.toISOString(),
    periodEnd: addMonths(start, 1).toISOString(),
    planId,
    description: `${name} plan, monthly`,
    amount,
    currency: 'USD',
    status: 'paid',
  })
}

registerArray('billingInvoices', billingInvoices)
registerValue('billingInvoices.seq', () => invoiceSeq, (v) => { invoiceSeq = v })

export function nextInvoiceNumber(): { id: string; number: string } {
  const n = invoiceSeq++
  return { id: `binv_${n}`, number: `APX-${String(n).padStart(5, '0')}` }
}

/* ---------------- Per-period counters, simulation, sent keys, dev flags ---------------- */

/** Emails sent and AI credits used in one billing period of one company. A new period = a new row (reset). */
export interface PeriodCounter {
  periodStart: string
  emailsPerMonth: number
  aiCredits: number
}
export const periodCounters: Tenant<PeriodCounter>[] = []
registerArray('billingPeriodCounters', periodCounters)

/** Dev-only simulated usage: `offset` is added to the real count of `key` (POST /dev/billing/usage). */
export interface UsageSimulation {
  key: LimitKey
  offset: number
}
export const usageSimulation: Tenant<UsageSimulation>[] = []
registerArray('billingUsageSimulation', usageSimulation)

/** Keys of usage warnings and lifecycle reminders already sent: `<companyId>|…`. Each goes out once. */
export const billingSentKeys: string[] = []
registerArray('billingSentKeys', billingSentKeys)

/** Dev-only: company ids whose next automatic charge (renewal, trial conversion) fails, then resets. */
export const failNextPayment: string[] = []
registerArray('billingFailNextPayment', failNextPayment)
