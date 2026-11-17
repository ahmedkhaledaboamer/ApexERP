import { BellRing, Hourglass } from 'lucide-react'
import type { Alert } from '@/modules/alerts/types'
import { Badge } from '@/shared/components/ui/Badge'
import { cn } from '@/shared/lib/utils'

const SHORT: Partial<Record<Alert['type'], string>> = {
  'no-contact': 'No contact yet',
  stalled: 'Stalled',
}

/** Small chips for a lead's automation alerts (no first contact, stalled interest). */
export function LeadAlertBadges({ alerts, className }: { alerts: Alert[] | undefined; className?: string }) {
  if (!alerts?.length) return null
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {alerts.map((a) => (
        <span key={a.id} title={a.body}>
          <Badge
            tone={a.severity === 'danger' ? 'red' : 'amber'}
            icon={a.type === 'stalled' ? <Hourglass aria-hidden /> : <BellRing aria-hidden />}
          >
            {SHORT[a.type] ?? a.title}
          </Badge>
        </span>
      ))}
    </span>
  )
}
