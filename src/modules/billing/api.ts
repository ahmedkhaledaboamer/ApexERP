import type {
  BillingOverview,
  ChangePlanResult,
  DataExport,
  Entitlements,
  PaymentMethodInput,
  PlanId,
} from '@/modules/billing/types'
import { http } from '@/shared/lib/axios'
import { billingMapper } from '@/shared/api/mappers'

const fromApi = <T,>(data: unknown) => billingMapper.fromApi(data) as T
const toApi = (body: object) => billingMapper.toApi(body as never)

/**
 * Billing endpoints (docs/API.md › Billing). The company comes from the session; nothing here
 * sends a company id. Mutations answer with the fresh overview where the server returns one; the
 * hooks invalidate ['billing'] either way.
 */

export async function getEntitlements(): Promise<Entitlements> {
  return fromApi<Entitlements>((await http.get<unknown>('/billing/entitlements')).data)
}

export async function getBillingOverview(): Promise<BillingOverview> {
  return fromApi<BillingOverview>((await http.get<unknown>('/billing/overview')).data)
}

export async function changePlan(planId: PlanId): Promise<ChangePlanResult> {
  return fromApi<ChangePlanResult>((await http.post<unknown>('/billing/change-plan', toApi({ planId }))).data)
}

/** Trialing only (Company Admin): the paid plan the trial converts to; the saved card is charged for it at trial end. */
export async function setTrialPlan(planId: PlanId): Promise<BillingOverview> {
  return fromApi<BillingOverview>((await http.post<unknown>('/billing/trial-plan', toApi({ planId }))).data)
}

export async function cancelScheduledChange(): Promise<unknown> {
  return fromApi<unknown>((await http.delete('/billing/scheduled-change')).data)
}

export async function updatePaymentMethod(input: PaymentMethodInput): Promise<unknown> {
  return fromApi<unknown>((await http.post('/billing/payment-method', toApi(input))).data)
}

export async function cancelSubscription(): Promise<unknown> {
  return fromApi<unknown>((await http.post('/billing/cancel', {})).data)
}

export async function resumeSubscription(): Promise<unknown> {
  return fromApi<unknown>((await http.post('/billing/resume', {})).data)
}

export async function reactivateSubscription(planId: PlanId): Promise<unknown> {
  return fromApi<unknown>((await http.post('/billing/reactivate', toApi({ planId }))).data)
}

export async function exportData(): Promise<DataExport> {
  return fromApi<DataExport>((await http.get<unknown>('/billing/export', { timeout: 120_000 })).data)
}
