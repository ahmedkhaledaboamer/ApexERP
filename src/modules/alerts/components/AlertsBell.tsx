import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AtSign,
  Bell,
  BellRing,
  CalendarClock,
  CalendarX,
  CheckCheck,
  CheckSquare,
  CreditCard,
  FileClock,
  Gauge,
  Hourglass,
  Palette,
  Trophy,
  UserCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { PATHS } from '@/app/paths'
import { groupAlerts, useAlertReadState, useAlerts } from '@/modules/alerts/hooks/useAlerts'
import { ALERT_TYPE_LABEL, type Alert, type AlertType } from '@/modules/alerts/types'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Menu, MenuItem, MenuSeparator } from '@/shared/components/ui/Menu'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/** Keyed by type; types added later (billing, usage…) fall back to a credit-card / bell icon. */
const ICON: Partial<Record<string, LucideIcon>> = {
  won: Trophy,
  assignment: UserCheck,
  mention: AtSign,
  'task-overdue': CalendarX,
  task: CheckSquare,
  'follow-up': CalendarClock,
  'no-contact': BellRing,
  stalled: Hourglass,
  renewal: FileClock,
  billing: CreditCard,
  usage: Gauge,
  marketing: Palette,
  finance: Wallet,
}

const SEVERITY_DOT: Record<Alert['severity'], string> = {
  danger: 'bg-danger-500',
  warning: 'bg-warning-500',
  info: 'bg-accent-500',
}

/** How many items each group shows before "Show all". */
const PREVIEW = 4

/**
 * Header bell: computed reminders (follow-ups, leads never contacted, stalled interest, tasks due
 * soon / overdue, renewals) and stored notifications (deals won, assignments, @mentions), grouped
 * by type. The badge counts unread items; opening one marks it read, and "Mark all read" clears all.
 */
export function AlertsBell() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const canSales = !!user && scopeOf(user.role, 'sales') !== 'hidden'
  const canTasks = !!user && scopeOf(user.role, 'tasks') !== 'hidden'
  const query = useAlerts()
  const alerts = query.data ?? []
  const groups = groupAlerts(alerts)
  const read = useAlertReadState(alerts)
  const unreadCount = read.unread.length
  const urgent = read.unread.some((a) => a.severity !== 'info')
  const [expanded, setExpanded] = useState<AlertType | null>(null)

  return (
    <Menu
      className="w-[23rem] max-w-[calc(100vw-2rem)]"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
          className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <Bell className="size-[1.125rem]" />
          {unreadCount > 0 && (
            <span
              className={cn(
                'num absolute -top-0.5 -end-0.5 min-w-[1.125rem] rounded-full px-1 text-center text-[0.625rem] leading-[1.125rem] font-bold text-white ring-2 ring-surface',
                urgent ? 'bg-danger-600' : 'bg-accent-600',
              )}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
            <p className="text-[0.8125rem] font-semibold">
              Notifications
              {unreadCount > 0 && <span className="num ms-1.5 text-xs font-normal text-muted">{unreadCount} unread</span>}
            </p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={read.markAllRead}
                disabled={read.markingAll}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-hover disabled:opacity-60 dark:text-brand-300"
              >
                <CheckCheck className="size-3.5" aria-hidden />
                Mark all read
              </button>
            )}
          </div>
          {query.isPending ? (
            <div className="space-y-2 px-2 pb-2" aria-busy="true">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : query.isError ? (
            <div className="px-2 py-6 text-center text-[0.8125rem] text-muted">
              <p>Notifications couldn’t load.</p>
              <button type="button" onClick={() => query.refetch()} className="mt-1 font-medium text-brand-700 hover:underline dark:text-brand-300">
                Try again
              </button>
            </div>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-[0.8125rem] text-muted">You’re all caught up.</p>
          ) : (
            <div className="max-h-[26rem] space-y-2 overflow-y-auto">
              {groups.map(({ type, items }) => {
                const Icon = ICON[type] ?? Bell
                const open = expanded === type
                const groupUnread = items.filter(read.isUnread).length
                return (
                  <section key={type} aria-label={ALERT_TYPE_LABEL[type]}>
                    <h3 className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-muted uppercase">
                      <Icon className="size-3.5" aria-hidden />
                      <span className="flex-1">{ALERT_TYPE_LABEL[type]}</span>
                      <span
                        className={cn(
                          'num rounded-full px-1.5 text-[0.6875rem]',
                          groupUnread ? 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200' : 'bg-sunken text-ink-2',
                        )}
                        title={groupUnread ? `${groupUnread} unread` : undefined}
                      >
                        {items.length}
                      </span>
                    </h3>
                    {(open ? items : items.slice(0, PREVIEW)).map((a) => {
                      const unread = read.isUnread(a)
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            read.open(a)
                            close()
                            navigate(a.link)
                          }}
                          className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-start hover:bg-hover"
                        >
                          <span
                            className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', unread ? SEVERITY_DOT[a.severity] : 'bg-line')}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate text-[0.8125rem]', unread ? 'font-semibold text-ink' : 'font-medium text-ink-2')}>
                              {a.title}
                              {unread && <span className="sr-only"> (unread)</span>}
                            </span>
                            <span className="block truncate text-xs text-muted">{a.body}</span>
                          </span>
                          <span className="shrink-0 text-[0.6875rem] text-subtle">{fmtDate(a.at, 'd MMM')}</span>
                        </button>
                      )
                    })}
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
          {(canTasks || canSales) && <MenuSeparator />}
          {canTasks && (
            <MenuItem
              onSelect={() => {
                close()
                navigate(PATHS.myTasks)
              }}
            >
              Open my tasks
            </MenuItem>
          )}
          {canSales && (
            <MenuItem
              onSelect={() => {
                close()
                navigate(PATHS.followUps)
              }}
            >
              Open follow-ups
            </MenuItem>
          )}
        </>
      )}
    </Menu>
  )
}
