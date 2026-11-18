import { useEntitlements } from '@/modules/billing/hooks'
import { eventsEnabledFor } from '@/shared/lib/features'

/**
 * Whether the company's plan includes the Events module (entitlements). Drives "Events attended"
 * (targets) and task links to events. False while entitlements load.
 */
export function useEventsEnabled(): boolean {
  const ent = useEntitlements()
  return eventsEnabledFor(ent.modules)
}
