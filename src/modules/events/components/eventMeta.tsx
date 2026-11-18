import { format, parseISO } from 'date-fns'
import { Building, CalendarDays, Mic2, Presentation, Video, type LucideIcon } from 'lucide-react'
import type { EventRow, EventStatus, EventType } from '@/modules/events/types'
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from '@/modules/events/types'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

export const EVENT_STATUS_TONE: Record<EventStatus, Tone> = {
  planned: 'sky',
  confirmed: 'brand',
  completed: 'green',
  cancelled: 'neutral',
}

export const EVENT_TYPE_ICON: Record<EventType, LucideIcon> = {
  exhibition: Building,
  conference: Mic2,
  meeting: Presentation,
  webinar: Video,
  other: CalendarDays,
}

/** Calendar chip colours per type (light + dark). */
export const EVENT_TYPE_CHIP: Record<EventType, string> = {
  exhibition: 'bg-warning-50 text-warning-700 ring-warning-500/30 dark:bg-warning-500/15 dark:text-warning-500',
  conference: 'bg-brand-50 text-brand-700 ring-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300',
  meeting: 'bg-teal-50 text-teal-700 ring-teal-500/30 dark:bg-teal-500/15 dark:text-teal-300',
  webinar: 'bg-info-50 text-info-700 ring-info-500/30 dark:bg-info-500/15 dark:text-info-500',
  other: 'bg-sunken text-ink-2 ring-line-strong',
}

export function EventStatusBadge({ status, className }: { status: EventStatus; className?: string }) {
  return (
    <Badge tone={EVENT_STATUS_TONE[status]} variant="dot" className={className}>
      {EVENT_STATUS_LABEL[status]}
    </Badge>
  )
}

export function EventTypeBadge({ type }: { type: EventType }) {
  const Icon = EVENT_TYPE_ICON[type]
  return <Badge icon={<Icon aria-hidden />}>{EVENT_TYPE_LABEL[type]}</Badge>
}

const day = (iso: string, pattern: string) => format(parseISO(iso), pattern)

/** "Tue 12 Nov 2026 · 09:00–10:30", "10–12 Feb 2027", "28 Jan – 2 Feb 2027" (company-local dates). */
export function eventWhen(e: Pick<EventRow, 'startDate' | 'endDate' | 'startTime' | 'endTime'>): string {
  const time = e.startTime ? ` · ${e.startTime}${e.endTime && e.endTime !== e.startTime ? `–${e.endTime}` : ''}` : ''
  if (e.startDate === e.endDate) return `${day(e.startDate, 'EEE d MMM yyyy')}${time}`
  const sameMonth = e.startDate.slice(0, 7) === e.endDate.slice(0, 7)
  const sameYear = e.startDate.slice(0, 4) === e.endDate.slice(0, 4)
  const from = sameMonth ? day(e.startDate, 'd') : sameYear ? day(e.startDate, 'd MMM') : day(e.startDate, 'd MMM yyyy')
  return `${from}–${day(e.endDate, 'd MMM yyyy')}${e.startTime ? ` · from ${e.startTime}` : ''}`
}

export function moneyIn(value: number | null, currency: string): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}
