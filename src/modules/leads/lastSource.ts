import { useAppSelector, useCurrentUser } from '@/store/hooks'
import { useLookups } from '@/shared/hooks/useLookups'

/**
 * The signed-in agent's last used lead source (saved per user in prefs), or '' when there is none
 * or it is no longer an active source. Forms use it only as the default; the field stays required.
 */
export function useLastSource(): string {
  const user = useCurrentUser()
  const lookups = useLookups()
  const last = useAppSelector((s) => (user ? s.prefs.lastSourceByUser[user.id] : undefined))
  return last && lookups.sources.some((s) => s.key === last) ? last : ''
}
