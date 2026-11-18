import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Entitlements, LimitKey, PaymentMethodInput, PlanModule } from '@/modules/billing/types'
import {
  cancelScheduledChange,
  cancelSubscription,
  changePlan,
  exportData,
  getBillingOverview,
  getEntitlements,
  reactivateSubscription,
  resumeSubscription,
  setTrialPlan,
  updatePaymentMethod,
} from '@/modules/billing/api'
import { planIncludes, type GateContext } from '@/modules/billing/gating'
import { alertKeys } from '@/modules/alerts/hooks/useAlerts'
import { can } from '@/shared/lib/permissions'
import { useAppSelector, useCurrentUser } from '@/store/hooks'

/** Normal keys: the QueryClient's queryKeyHashFn adds the company id. */
export const billingKeys = {
  all: ['billing'] as const,
  entitlements: ['billing', 'entitlements'] as const,
  overview: ['billing', 'overview'] as const,
  dev: ['billing', 'dev'] as const,
}

const ENTITLEMENTS_POLL_MS = 60_000

function useSignedIn(): boolean {
  return useAppSelector((s) => s.auth.session !== null)
}

/**
 * The raw entitlements query. `poll` is set by the one sync in the app shell (BillingSync), so the
 * 60 s interval runs once, not once per component that reads entitlements.
 */
export function useEntitlementsQuery({ poll = false }: { poll?: boolean } = {}) {
  const signedIn = useSignedIn()
  return useQuery({
    queryKey: billingKeys.entitlements,
    queryFn: getEntitlements,
    enabled: signedIn,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: poll ? ENTITLEMENTS_POLL_MS : false,
  })
}

export interface EntitlementsView {
  /** Null until loaded (gating treats gateable modules as not included yet). */
  data: Entitlements | null
  loading: boolean
  planId: string | null
  planName: string | null
  status: Entitlements['status'] | null
  modules: PlanModule[]
  limits: Entitlements['limits'] | null
  reached: LimitKey[]
  readOnly: boolean
  trialDaysLeft: number | null
  hasModule: (module: PlanModule) => boolean
  isReached: (limit: LimitKey) => boolean
}

/**
 * Central plan gating hook: plan, status, modules, limits, limits reached, read-only, trial days.
 * Hook point for AI features: `useEntitlements().hasModule('ai')`.
 */
export function useEntitlements(): EntitlementsView {
  const query = useEntitlementsQuery()
  const data = query.data ?? null
  return useMemo(
    () => ({
      data,
      loading: query.isPending && query.fetchStatus !== 'idle',
      planId: data?.planId ?? null,
      planName: data?.planName ?? null,
      status: data?.status ?? null,
      modules: data?.modules ?? [],
      limits: data?.limits ?? null,
      reached: data?.reached ?? [],
      readOnly: data?.readOnly ?? false,
      trialDaysLeft: data?.trialDaysLeft ?? null,
      hasModule: (m: PlanModule) => planIncludes(data, m),
      isReached: (l: LimitKey) => !!data?.reached.includes(l),
    }),
    [data, query.isPending, query.fetchStatus],
  )
}

/** Company Admin manages billing; Management reads it; everyone else has no billing page. */
export function useBillingAccess(): { canView: boolean; canManage: boolean } {
  const user = useCurrentUser()
  const canView = !!user && can(user.role, 'settings', 'view')
  const canManage = !!user && can(user.role, 'settings', 'edit')
  return { canView, canManage }
}

export function useBillingOverview(enabled = true) {
  const signedIn = useSignedIn()
  return useQuery({ queryKey: billingKeys.overview, queryFn: getBillingOverview, enabled: signedIn && enabled })
}

/** After a billing action: refresh entitlements, overview, and the alerts bell (billing notifications). */
export function useInvalidateBilling() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: billingKeys.all })
    void qc.invalidateQueries({ queryKey: alertKeys.all })
  }
}

function useBillingMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateBilling()
  return useMutation({ mutationFn: fn, onSettled: invalidate })
}

export function useChangePlan() {
  return useBillingMutation(changePlan)
}

export function useSetTrialPlan() {
  return useBillingMutation(setTrialPlan)
}

export function useCancelScheduledChange() {
  return useBillingMutation(() => cancelScheduledChange())
}

export function useUpdatePaymentMethod() {
  return useBillingMutation((input: PaymentMethodInput) => updatePaymentMethod(input))
}

export function useCancelSubscription() {
  return useBillingMutation(() => cancelSubscription())
}

export function useResumeSubscription() {
  return useBillingMutation(() => resumeSubscription())
}

export function useReactivate() {
  return useBillingMutation(reactivateSubscription)
}

/** Downloads GET /billing/export as a JSON file. */
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const data = await exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${data.company.subdomain || 'workspace'}-export-${data.generatedAt.slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return data
    },
  })
}

/** Role + entitlements for the pure gating helpers (sidebar, routes, command palette). */
export function useGateContext(): GateContext & { entitlementsLoading: boolean } {
  const user = useCurrentUser()
  const ent = useEntitlements()
  return useMemo(
    () => ({ role: user?.role ?? null, entitlements: ent.data, entitlementsLoading: ent.loading }),
    [user?.role, ent.data, ent.loading],
  )
}
