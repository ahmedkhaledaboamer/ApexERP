import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import { isOnline, subscribeNetwork } from '@/shared/lib/networkStatus'

/** True while the browser is offline or requests get no response (shared/lib/networkStatus). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeNetwork, isOnline, () => true)
}

/**
 * Thin global banner while offline. Reads pause and are retried when the connection is back;
 * writes are not queued (they fail with a toast), hence "reads" in the copy.
 */
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div
      id="offline-banner"
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 border-b border-warning-100 bg-warning-50 px-4 py-1.5 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      You’re offline — changes will be retried when you’re back.
    </div>
  )
}
