import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import type { AnnouncementTone, CompanyAnnouncement } from '@/modules/platform/types'
import { dismissAnnouncement, getAnnouncements } from '@/modules/tenancy/api'
import { useImpersonation } from '@/modules/tenancy/hooks'
import { useAppSelector } from '@/store/hooks'
import { cn } from '@/shared/lib/utils'

export const announcementKeys = { all: ['announcements'] as const }

const TONE: Record<AnnouncementTone, { cls: string; icon: typeof Info }> = {
  info: {
    cls: 'border-accent-100 bg-accent-50 text-accent-700 dark:border-accent-500/20 dark:bg-accent-500/10 dark:text-accent-300',
    icon: Info,
  },
  warning: {
    cls: 'border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/15 dark:text-warning-500',
    icon: TriangleAlert,
  },
  success: {
    cls: 'border-success-100 bg-success-50 text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-500',
    icon: CheckCircle2,
  },
}

/**
 * Platform announcement for this company (GET /announcements: active, in segment, not dismissed by
 * this user). Dismiss is stored per user on the server; while impersonating it only hides the
 * banner on this screen (a support session never writes on the user's behalf for this).
 */
export function AnnouncementBanner() {
  const signedIn = useAppSelector((s) => s.auth.session !== null)
  const imp = useImpersonation()
  const qc = useQueryClient()
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const query = useQuery({
    queryKey: announcementKeys.all,
    queryFn: getAnnouncements,
    enabled: signedIn,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
  const dismiss = useMutation({
    mutationFn: dismissAnnouncement,
    onSettled: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  })

  const visible = (query.data ?? []).filter((a) => !hidden.has(a.id))
  const current: CompanyAnnouncement | undefined = visible[0]
  if (!current) return null
  const tone = TONE[current.tone] ?? TONE.info
  const Icon = tone.icon

  function onDismiss(a: CompanyAnnouncement) {
    setHidden((s) => new Set(s).add(a.id))
    if (!imp) dismiss.mutate(a.id)
  }

  return (
    <div
      id="announcement-banner"
      role="status"
      data-announcement-id={current.id}
      data-tone={current.tone}
      className={cn('flex shrink-0 items-start gap-3 border-b px-4 py-2.5 text-[0.8125rem] sm:px-6', tone.cls)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold" id="announcement-title">
          {current.title}
        </p>
        <p className="mt-0.5 whitespace-pre-line opacity-90" id="announcement-body">
          {current.body}
        </p>
      </div>
      {visible.length > 1 && <span className="mt-0.5 shrink-0 text-xs opacity-80">+{visible.length - 1} more</span>}
      <button
        type="button"
        id="announcement-dismiss"
        aria-label="Dismiss announcement"
        onClick={() => onDismiss(current)}
        className="-me-1 shrink-0 rounded-md p-1 opacity-80 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
