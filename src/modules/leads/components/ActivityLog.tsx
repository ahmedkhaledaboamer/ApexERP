import { Mail, MapPin, MessageCircle, Phone, Users, type LucideIcon } from 'lucide-react'
import type { ActivityType } from '@/shared/types'
import { useLeadActivitiesQuery } from '@/modules/leads/hooks/useLeads'
import { ACTIVITY_LABELS } from '@/shared/lib/constants'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'

export const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  call: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  visit: MapPin,
  meeting: Users,
}

const ICON_TONE: Record<ActivityType, string> = {
  call: 'bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-300',
  email: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  whatsapp: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500',
  visit: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500',
  meeting: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300',
}

/** HubSpot-style activity timeline. `limit` shows only the latest entries (overview). */
export function ActivityLog({
  leadId,
  canLog,
  onLog,
  limit,
}: {
  leadId: string
  canLog: boolean
  onLog: () => void
  limit?: number
}) {
  const query = useLeadActivitiesQuery(leadId)

  if (query.isPending) {
    return (
      <div aria-busy="true" className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-7 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
  if (query.data.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        body="Calls, emails, WhatsApp messages, visits and meetings logged on this lead appear here."
        action={
          canLog ? (
            <Button size="sm" onClick={onLog}>
              Log the first activity
            </Button>
          ) : undefined
        }
      />
    )
  }

  const items = limit ? query.data.slice(0, limit) : query.data
  return (
    <ol className="relative">
      {items.map((a, i) => {
        const Icon = ACTIVITY_ICONS[a.type]
        const last = i === items.length - 1
        return (
          <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span aria-hidden className="absolute start-3.5 top-8 bottom-1 w-px bg-line" />}
            <span className={cn('relative flex size-7 shrink-0 items-center justify-center rounded-md', ICON_TONE[a.type])}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex flex-wrap items-baseline gap-x-1.5 text-[0.8125rem]">
                <span className="font-medium text-ink">{a.userName}</span>
                <span className="text-muted">logged a {ACTIVITY_LABELS[a.type].toLowerCase()}</span>
                <span className="num ms-auto text-xs text-subtle">{fmtDate(a.at, 'd MMM, HH:mm')}</span>
              </p>
              <p className="mt-1 rounded-md border border-line bg-sunken/50 px-3 py-2 text-[0.8125rem] text-ink-2">{a.summary}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
