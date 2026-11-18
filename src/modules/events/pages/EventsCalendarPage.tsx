import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isValid, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { EventRow } from '@/modules/events/types'
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from '@/modules/events/types'
import { useEventsQuery } from '@/modules/events/hooks/useEvents'
import { EVENT_TYPE_CHIP, EVENT_TYPE_ICON } from '@/modules/events/components/eventMeta'
import { EventsFrame } from '@/modules/events/components/EventsFrame'
import { eventPath } from '@/app/paths'
import { useRegion } from '@/modules/tenancy/hooks'
import { companyDay } from '@/shared/lib/companyDay'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { PageBody } from '@/shared/components/layout/PageHeader'

type View = 'month' | 'week'
const ISO = 'yyyy-MM-dd'
const MONTH_VISIBLE = 3

/**
 * Events by day, month or week (TaskCalendarPage patterns): "today" and the week start are the
 * company's (regional timezone + week start); a multi-day event shows on each of its days.
 */
export default function EventsCalendarPage() {
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'week' ? 'week' : 'month'
  const region = useRegion()
  const day = companyDay({ timezone: region.timezone, weekStartsOn: region.weekStartsOn })
  const WEEK = { weekStartsOn: day.weekStartsOn }
  const anchorParam = params.get('d')
  const anchor = anchorParam && isValid(parseISO(anchorParam)) ? parseISO(anchorParam) : parseISO(day.today)

  const { range, days } = useMemo(() => {
    const start = view === 'month' ? startOfWeek(startOfMonth(anchor), WEEK) : startOfWeek(anchor, WEEK)
    const end = view === 'month' ? endOfWeek(endOfMonth(anchor), WEEK) : endOfWeek(anchor, WEEK)
    return { range: { from: format(start, ISO), to: format(end, ISO) }, days: eachDayOfInterval({ start, end }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, format(anchor, ISO), day.weekStartsOn])

  const query = useEventsQuery(range)

  function setParam(updates: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(updates)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )
  }
  const go = (d: Date) => setParam({ d: format(d, ISO) })
  const step = (dir: 1 | -1) => go(view === 'month' ? addMonths(anchor, dir) : addWeeks(anchor, dir))

  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>()
    for (const e of query.data ?? []) {
      if (e.status === 'cancelled') continue
      for (const d of days) {
        const iso = format(d, ISO)
        if (iso < e.startDate || iso > e.endDate) continue
        const list = map.get(iso) ?? []
        list.push(e)
        map.set(iso, list)
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    return map
  }, [query.data, days])

  const title = view === 'month' ? format(anchor, 'MMMM yyyy') : `${format(days[0], 'd MMM')} – ${format(days[days.length - 1], 'd MMM yyyy')}`
  const empty = !query.isPending && !query.error && byDay.size === 0

  return (
    <EventsFrame description="Events by day, in your company’s time zone">
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Navigate">
            <Button variant="secondary" size="sm" iconOnly aria-label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}>
              <ChevronLeft className="rtl:-scale-x-100" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => go(parseISO(day.today))}>
              Today
            </Button>
            <Button variant="secondary" size="sm" iconOnly aria-label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}>
              <ChevronRight className="rtl:-scale-x-100" />
            </Button>
          </div>
          <h2 className="ms-1 text-base font-semibold" aria-live="polite">
            {title}
          </h2>
          <Segmented<View>
            className="ms-auto"
            label="Calendar view"
            size="sm"
            value={view}
            onChange={(v) => setParam({ view: v === 'month' ? null : v })}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
            ]}
          />
        </div>
        {empty && (
          <p role="status" className="rounded-md border border-dashed border-line-strong px-3 py-2 text-[0.8125rem] text-muted">
            No events this {view}. Pick another {view}, or create an event.
          </p>
        )}
        {query.error ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (
          <Card className="overflow-hidden">
            <div className={cn('grid-cols-7 border-b border-line bg-sunken/70', view === 'month' ? 'grid' : 'hidden sm:grid')} aria-hidden>
              {days.slice(0, 7).map((d) => (
                <div key={d.toISOString()} className="px-2 py-1.5 text-xs font-medium text-muted">
                  {format(d, 'EEE')}
                </div>
              ))}
            </div>
            {query.isPending ? (
              <div aria-busy="true" className="grid grid-cols-7 gap-0.5 p-0.5">
                {days.map((d) => (
                  <Skeleton key={d.toISOString()} className={view === 'month' ? 'h-24' : 'h-64'} />
                ))}
              </div>
            ) : (
              <div className={cn('grid', view === 'month' ? 'grid-cols-7' : 'grid-cols-1 sm:grid-cols-7')}>
                {days.map((d) => {
                  const iso = format(d, ISO)
                  const items = byDay.get(iso) ?? []
                  const today = iso === day.today
                  const shown = view === 'month' ? items.slice(0, MONTH_VISIBLE) : items
                  return (
                    <div
                      key={iso}
                      data-day={iso}
                      className={cn(
                        'min-w-0 border-e border-b border-line p-1 sm:p-1.5 [&:nth-child(7n)]:border-e-0',
                        view === 'month' ? 'min-h-16 sm:min-h-28' : 'min-h-20 sm:min-h-[26rem]',
                        view === 'month' && !isSameMonth(d, anchor) && 'bg-sunken/40',
                        today && 'bg-brand-50/50 dark:bg-brand-500/10',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setParam({ view: 'week', d: iso })}
                        aria-label={`${format(d, 'EEEE d MMMM')}${today ? ', today' : ''}, ${items.length} event${items.length === 1 ? '' : 's'}. Open week`}
                        className={cn(
                          'num inline-flex size-6 items-center justify-center rounded-full text-xs',
                          today ? 'bg-brand-600 font-semibold text-white dark:bg-brand-500' : 'text-ink-2 hover:bg-hover',
                        )}
                      >
                        {format(d, 'd')}
                      </button>
                      {view === 'month' && items.length > 0 && <span className="num mt-0.5 block text-center text-[0.6875rem] text-muted sm:hidden">{items.length}</span>}
                      <div className={cn('space-y-1', view === 'month' && 'hidden sm:block')}>
                        {shown.map((e) => (
                          <EventChip key={e.id} event={e} iso={iso} />
                        ))}
                        {view === 'month' && items.length > MONTH_VISIBLE && (
                          <button
                            type="button"
                            onClick={() => setParam({ view: 'week', d: iso })}
                            className="w-full rounded px-1 text-start text-[0.6875rem] font-medium text-muted hover:bg-hover hover:text-ink"
                          >
                            +{items.length - MONTH_VISIBLE} more
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )}
      </PageBody>
    </EventsFrame>
  )
}

function EventChip({ event: e, iso }: { event: EventRow; iso: string }) {
  const Icon = EVENT_TYPE_ICON[e.type]
  const first = iso === e.startDate
  return (
    <Link
      to={eventPath(e.id)}
      title={`${e.name} · ${EVENT_TYPE_LABEL[e.type]} · ${EVENT_STATUS_LABEL[e.status]}`}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset transition-opacity hover:opacity-80 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
        EVENT_TYPE_CHIP[e.type],
        e.status === 'completed' && 'opacity-70',
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {first && e.startTime && <span className="num shrink-0">{e.startTime}</span>}
      <span className="truncate">{e.name}</span>
    </Link>
  )
}
