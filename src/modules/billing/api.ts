import type {
  BillingOverview,
  ChangePlanResult,
  DataExport,
  Entitlements,
  PaymentMethodInput,
  PlanId,
} from '@/modules/billing/types'
import { http } from '@/shared/lib/axios'

/**
 * Billing endpoints (docs/API.md › Billing). The company comes from the session; nothing here
 * sends a company id. Mutations answer with the fresh overview where the server returns one; the
 * hooks invalidate ['billing'] either way.
 */

export async function getEntitlements(): Promise<Entitlements> {
  return (await http.get<Entitlements>('/billing/entitlements')).data
}

export async function getBillingOverview(): Promise<BillingOverview> {
  return (await http.get<BillingOverview>('/billing/overview')).data
}

export async function changePlan(planId: PlanId): Promise<ChangePlanResult> {
  return (await http.post<ChangePlanResult>('/billing/change-plan', { planId })).data
}

/** Trialing only (Company Admin): the paid plan the trial converts to; the saved card is charged for it at trial end. */
export async function setTrialPlan(planId: PlanId): Promise<BillingOverview> {
  return (await http.post<BillingOverview>('/billing/trial-plan', { planId })).data
}

export async function cancelScheduledChange(): Promise<unknown> {
  return (await http.delete('/billing/scheduled-change')).data
}

export async function updatePaymentMethod(input: PaymentMethodInput): Promise<unknown> {
  return (await http.post('/billing/payment-method', input)).data
}

export async function cancelSubscription(): Promise<unknown> {
  return (await http.post('/billing/cancel', {})).data
}

export async function resumeSubscription(): Promise<unknown> {
  return (await http.post('/billing/resume', {})).data
}

export async function reactivateSubscription(planId: PlanId): Promise<unknown> {
  return (await http.post('/billing/reactivate', { planId })).data
}

export async function exportData(): Promise<DataExport> {
  return (await http.get<DataExport>('/billing/export', { timeout: 120_000 })).data
}
