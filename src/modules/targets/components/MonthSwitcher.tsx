import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { monthLabel, shiftMonth } from '@/modules/targets/lib'
import { Button } from '@/shared/components/ui/Button'

interface MonthSwitcherProps {
  month: string
  thisMonth: string
  /** Last month (`yyyy-MM`) the "next" arrow may reach. */
  lastAllowed: string
  onChange: (month: string) => void
}

/** Previous / next month stepper with a "This month" shortcut. */
export function MonthSwitcher({ month, thisMonth, lastAllowed, onChange }: MonthSwitcherProps) {
  return (
    <div className="flex items-center gap-2">
      {month !== thisMonth && (
        <Button variant="ghost" size="sm" onClick={() => onChange(thisMonth)}>
          This month
        </Button>
      )}
      <div className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface shadow-xs">
        <Button variant="ghost" size="sm" iconOnly aria-label="Previous month" className="h-full rounded-e-none" onClick={() => onChange(shiftMonth(month, -1))}>
          <ChevronLeft />
        </Button>
        <span className="num flex min-w-[8.5rem] items-center justify-center gap-1.5 border-x border-line px-3 text-[0.8125rem] font-medium" aria-live="polite">
          <CalendarDays className="size-3.5 text-muted" aria-hidden />
          {monthLabel(month)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Next month"
          className="h-full rounded-s-none"
          disabled={month >= lastAllowed}
          onClick={() => onChange(shiftMonth(month, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
