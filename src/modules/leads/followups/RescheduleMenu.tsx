import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarDays, CalendarPlus, ChevronDown } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'

import { addDaysIso, weekdayOfIso } from '@/shared/lib/companyDay'
import { companyTodayIso } from '@/modules/leads/lib/followUp'

/** A yyyy-MM-dd calendar date as a local Date, for date-fns labels only. */
const dayOf = (iso: string) => new Date(`${iso}T00:00:00`)

interface RescheduleMenuProps {
  /** `date` is the new follow-up as a company-local calendar date (yyyy-MM-dd). */
  onPick: (date: string, label: string) => void
  loading?: boolean
  disabled?: boolean
}

/** Quick picks (tomorrow, in 2 days, next week) plus a date field for anything else. */
export function RescheduleMenu({ onPick, loading, disabled }: RescheduleMenuProps) {
  const [custom, setCustom] = useState('')
  // Company-local today (tenant timezone); follow-ups are calendar dates.
  const minDate = companyTodayIso()
  const picks = [
    { label: 'Tomorrow', day: addDaysIso(minDate, 1) },
    { label: 'In 2 days', day: addDaysIso(minDate, 2) },
    // Next Monday (a Monday today → the one after).
    { label: 'Next week', day: addDaysIso(minDate, ((8 - weekdayOfIso(minDate)) % 7) || 7) },
  ]

  return (
    <Menu
      align="end"
      className="w-60"
      trigger={(props) => (
        <Button write {...props} variant="secondary" size="sm" loading={loading} disabled={disabled} aria-label="Reschedule follow-up">
          {!loading && <CalendarPlus />}
          <span className="hidden sm:inline">Reschedule</span>
          <ChevronDown className="hidden text-subtle sm:block" />
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Move follow-up to</MenuLabel>
          {picks.map((p) => (
            <MenuItem
              key={p.label}
              icon={<CalendarDays />}
              hint={format(dayOf(p.day), 'EEE d MMM')}
              onSelect={() => {
                close()
                onPick(p.day, p.label.toLowerCase())
              }}
            >
              {p.label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <form
            className="px-2 pt-1 pb-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (!custom) return
              const day = custom
              close()
              setCustom('')
              onPick(day, format(dayOf(day), 'EEE d MMM'))
            }}
          >
            <label className="mb-1 block text-[0.6875rem] font-medium text-subtle" htmlFor="reschedule-date">
              Pick a date
            </label>
            <div className="flex gap-1.5">
              <input
                id="reschedule-date"
                type="date"
                min={minDate}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[0.8125rem] text-ink focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
              />
              <Button write type="submit" size="sm" disabled={!custom || custom < minDate}>
                Set
              </Button>
            </div>
          </form>
        </>
      )}
    </Menu>
  )
}
