import type { LeadStatus } from '@/shared/types'
import { useLookups } from '@/shared/hooks/useLookups'
import { Badge } from '@/shared/components/ui/Badge'

/**
 * Lead stage as an Attio-style dot chip; `soft` gives the tinted pill for headers.
 * Label and tone come from the statuses lookup, so a renamed status shows everywhere; while the
 * lookups load (or for a removed key) the key itself is shown in a neutral chip.
 */
export function StatusBadge({ status, soft = false, className }: { status: LeadStatus; soft?: boolean; className?: string }) {
  const lookups = useLookups()
  const s = lookups.status(status)
  return (
    <Badge tone={s.tone} variant={soft ? 'soft' : 'dot'} className={className}>
      {s.label}
    </Badge>
  )
}
