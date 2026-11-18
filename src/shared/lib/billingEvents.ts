import type { LimitReachedDetails, ModuleLockedDetails, ReadOnlyDetails } from '@/modules/billing/types'

/**
 * Plan / subscription errors raised by the API (axios interceptor → UpgradePromptHost), the same
 * pattern as tenant errors (tenantContext.emitTenantError). One listener shows one prompt, so every
 * screen gets the same message for "limit reached", "module not in plan" and "read-only".
 */
export type BillingEvent =
  | { kind: 'limit'; message: string; details: LimitReachedDetails }
  | { kind: 'module'; message: string; details: ModuleLockedDetails }
  | { kind: 'read_only'; message: string; details: ReadOnlyDetails }

type Listener = (event: BillingEvent) => void
const listeners = new Set<Listener>()

export function onBillingEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Turns an error body into a typed billing event (null for anything else). Pure. */
export function toBillingEvent(code: string | undefined, message: string, body: unknown): BillingEvent | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (code === 'LIMIT_REACHED' && typeof b.limit === 'string') {
    return {
      kind: 'limit',
      message,
      details: {
        code: 'LIMIT_REACHED',
        limit: b.limit as LimitReachedDetails['limit'],
        current: Number(b.current ?? 0),
        max: Number(b.max ?? 0),
        planId: String(b.planId ?? ''),
      },
    }
  }
  if (code === 'module_not_in_plan' && typeof b.module === 'string') {
    return {
      kind: 'module',
      message,
      details: { code: 'module_not_in_plan', module: b.module as ModuleLockedDetails['module'], planId: String(b.planId ?? '') },
    }
  }
  if (code === 'workspace_read_only') {
    return {
      kind: 'read_only',
      message,
      details: { code: 'workspace_read_only', status: (b.status as ReadOnlyDetails['status']) ?? 'suspended' },
    }
  }
  return null
}

export function emitBillingError(code: string | undefined, message: string, body: unknown): void {
  const event = toBillingEvent(code, message, body)
  if (event) listeners.forEach((l) => l(event))
}
