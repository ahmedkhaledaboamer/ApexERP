import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, CalendarClock, CheckSquare, FileClock, Hourglass, type LucideIcon } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { groupAlerts, useAlerts } from '@/modules/alerts/hooks/useAlerts'
import { ALERT_TYPE_LABEL, type Alert, type AlertType } from '@/modules/alerts/types'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Menu, MenuItem, MenuSeparator } from '@/shared/components/ui/Menu'
import { Skeleton } from '@/shared/components/ui/Feedback'

const ICON: Record<AlertType, LucideIcon> = {
  'follow-up': CalendarClock,
  'no-contact': BellRing,
  stalled: Hourglass,
  task: CheckSquare,
  renewal: FileClock,
}

const SEVERITY_DOT: Record<Alert['severity'], string> = {
  danger: 'bg-danger-500',
  warning: 'bg-warning-500',
  info: 'bg-accent-500',
}

/** How many items each group shows before "Show all". */
const PREVIEW = 4

/**
 * Header bell: the automation alerts (GET /alerts) grouped by type with counts —
 * follow-ups due, leads never contacted, stalled interest, tasks and contract renewals.
 */
export function AlertsBell() {
  const navigate = useNavigate()
  const query = useAlerts()
  const alerts = query.data ?? []
  const groups = groupAlerts(alerts)
  const urgent = alerts.filter((a) => a.severity !== 'info').length
  const [expanded, setExpanded] = useState<AlertType | null>(null)

  return (
    <Menu
      className="w-[23rem]"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Notifications${alerts.length ? `, ${alerts.length} alerts` : ''}`}
          className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <Bell className="size-[1.125rem]" />
          {alerts.length > 0 && (
            <span
              className={cn(
                'num absolute -top-0.5 -end-0.5 min-w-[1.125rem] rounded-full px-1 text-center text-[0.625rem] leading-[1.125rem] font-bold text-white ring-2 ring-surface',
                urgent ? 'bg-danger-600' : 'bg-accent-600',
              )}
            >
              {alerts.length > 99 ? '99+' : alerts.length}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <p className="text-[0.8125rem] font-semibold">Alerts</p>
            {alerts.length > 0 && <p className="num text-xs text-muted">{alerts.length} open</p>}
          </div>
          {query.isPending ? (
            <div className="space-y-2 px-2 pb-2" aria-busy="true">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : query.isError ? (
            <p className="px-2 py-6 text-center text-[0.8125rem] text-muted">Alerts couldn’t load. They’ll retry shortly.</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-[0.8125rem] text-muted">You’re all caught up.</p>
          ) : (
            <div className="max-h-[26rem] space-y-2 overflow-y-auto">
              {groups.map(({ type, items }) => {
                const Icon = ICON[type]
                const open = expanded === type
                return (
                  <section key={type} aria-label={ALERT_TYPE_LABEL[type]}>
                    <h3 className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-muted uppercase">
                      <Icon className="size-3.5" aria-hidden />
                      <span className="flex-1">{ALERT_TYPE_LABEL[type]}</span>
                      <span className="num rounded-full bg-sunken px-1.5 text-[0.6875rem] text-ink-2">{items.length}</span>
                    </h3>
                    {(open ? items : items.slice(0, PREVIEW)).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          close()
                          navigate(a.link)
                        }}
                        className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-start hover:bg-hover"
                      >
                        <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', SEVERITY_DOT[a.severity])} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.8125rem] font-medium">{a.title}</span>
                          <span className="block truncate text-xs text-muted">{a.body}</span>
                        </span>
                        <span className="shrink-0 text-[0.6875rem] text-subtle">{fmtDate(a.at, 'd MMM')}</span>
                      </button>
                    ))}
                    {items.length > PREVIEW && (
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : type)}
                        className="w-full rounded-md px-2 py-1 text-start text-xs font-medium text-brand-700 hover:bg-hover dark:text-brand-300"
                      >
                        {open ? 'Show fewer' : `Show all ${items.length}`}
                      </button>
                    )}
                  </section>
                )
              })}
            </div>
          )}
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              close()
              navigate(PATHS.followUps)
            }}
          >
            Open follow-ups
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
