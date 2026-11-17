import { endOfMonth, endOfQuarter, endOfYear, format, isSameYear, parseISO, startOfMonth, startOfQuarter, startOfYear, subDays, subMonths } from 'date-fns'

export type RangePreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'last90' | 'thisYear' | 'custom'

export const PRESET_LABELS: Record<RangePreset, string> = {
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisQuarter: 'This quarter',
  last90: 'Last 90 days',
  thisYear: 'This year',
  custom: 'Custom range',
}

export const PRESETS: Exclude<RangePreset, 'custom'>[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'last90', 'thisYear']

export interface DateRange {
  from: string
  to: string
}

const day = (d: Date) => format(d, 'yyyy-MM-dd')

/** Calendar range for a preset. Current periods end at the period end (future days are empty). */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): DateRange {
  switch (preset) {
    case 'thisMonth':
      return { from: day(startOfMonth(now)), to: day(endOfMonth(now)) }
    case 'lastMonth': {
      const prev = subMonths(now, 1)
      return { from: day(startOfMonth(prev)), to: day(endOfMonth(prev)) }
    }
    case 'thisQuarter':
      return { from: day(startOfQuarter(now)), to: day(endOfQuarter(now)) }
    case 'last90':
      return { from: day(subDays(now, 89)), to: day(now) }
    case 'thisYear':
      return { from: day(startOfYear(now)), to: day(endOfYear(now)) }
  }
}

/** "1 – 30 Nov 2026", "1 Oct – 31 Dec 2026", "17 Aug 2025 – 15 Nov 2026". */
export function rangeLabel(r: DateRange): string {
  const a = parseISO(r.from)
  const b = parseISO(r.to)
  if (!isSameYear(a, b)) return `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`
  if (a.getMonth() === b.getMonth()) return `${format(a, 'd')} – ${format(b, 'd MMM yyyy')}`
  return `${format(a, 'd MMM')} – ${format(b, 'd MMM yyyy')}`
}
