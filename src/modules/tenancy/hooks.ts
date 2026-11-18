import { useSyncExternalStore } from 'react'
import type { Branding, Company, RegionalSettings } from '@/modules/tenancy/types'
import { useAppSelector } from '@/store/hooks'
import { getRegion, subscribeRegion } from '@/shared/lib/region'
import { DEFAULT_BRANDING } from '@/modules/tenancy/branding'

/** The signed-in user's company (from the session; refreshed from GET /tenant). */
export function useTenant(): Company | null {
  return useAppSelector((s) => s.auth.session?.tenant ?? null)
}

/** Branding to render: the session's tenant, else the workspace address's public branding, else Apex CRM. */
export function useBranding(): Branding {
  const tenant = useAppSelector((s) => s.auth.session?.tenant.branding)
  const publicBranding = useAppSelector((s) => s.tenant.publicWorkspace?.branding)
  return tenant ?? publicBranding ?? DEFAULT_BRANDING
}

/** Tenant regional settings (currency, timezone, date format, country); re-renders when they change. */
export function useRegion(): RegionalSettings {
  return useSyncExternalStore(subscribeRegion, getRegion, getRegion)
}

/* Plan gating lives in modules/billing (useEntitlements().hasModule, gating.ts), not on the tenant. */

/** The support session (operator, reason, expiresAt, mode) while a platform operator is impersonating; else null. */
export function useImpersonation() {
  return useAppSelector((s) => s.auth.session?.impersonation ?? null)
}

export const SUPPORT_BLOCK_HINT = 'Not available during a support session'

/**
 * Password, 2FA, billing / payment methods and full data export are never allowed while
 * impersonating (the API answers 403 impersonation_blocked). Buttons for them use this to disable.
 */
export function useSupportSessionBlock(): { blocked: boolean; hint: string | undefined } {
  const blocked = useAppSelector((s) => !!s.auth.session?.impersonation)
  return { blocked, hint: blocked ? SUPPORT_BLOCK_HINT : undefined }
}
