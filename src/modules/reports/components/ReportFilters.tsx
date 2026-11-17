import { useState } from 'react'
import { CalendarRange, Check, ChevronDown, Network, Users } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'
import { TextInput } from '@/shared/components/form/Field'
import { PRESET_LABELS, PRESETS, rangeLabel, type DateRange, type RangePreset } from '@/modules/reports/lib/dateRange'
import type { ReportDepartment, ReportOwner } from '@/modules/reports/types'

interface DateRangeMenuProps {
  preset: RangePreset
  range: DateRange
  onPreset: (p: Exclude<RangePreset, 'custom'>) => void
  onCustom: (r: DateRange) => void
}

export function DateRangeMenu({ preset, range, onPreset, onCustom }: DateRangeMenuProps) {
  return (
    <Menu
      align="start"
      className="w-72"
      trigger={(props) => (
        <Button variant="secondary" size="md" {...props} aria-label={`Date range: ${PRESET_LABELS[preset]}, ${rangeLabel(range)}`}>
          <CalendarRange />
          <span className="font-medium">{PRESET_LABELS[preset]}</span>
          <span className="hidden text-muted sm:inline">{rangeLabel(range)}</span>
          <ChevronDown className="text-subtle" />
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Period</MenuLabel>
          {PRESETS.map((p) => (
            <MenuItem
              key={p}
              active={preset === p}
              icon={preset === p ? <Check /> : <span className="block size-4" />}
              onSelect={() => {
                onPreset(p)
                close()
              }}
            >
              {PRESET_LABELS[p]}
            </MenuItem>
          ))}
          <MenuSeparator />
          <CustomRange
            initial={range}
            onApply={(r) => {
              onCustom(r)
              close()
            }}
          />
        </>
      )}
    </Menu>
  )
}

function CustomRange({ initial, onApply }: { initial: DateRange; onApply: (r: DateRange) => void }) {
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const invalid = !from || !to || from > to
  return (
    <form
      className="space-y-2 p-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!invalid) onApply({ from, to })
      }}
    >
      <p className="text-[0.6875rem] font-medium text-subtle">Custom range</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          From
          <TextInput type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-8 px-2" />
        </label>
        <label className="text-xs text-muted">
          To
          <TextInput type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 h-8 px-2" />
        </label>
      </div>
      {from > to && <p className="text-xs text-danger-600">“From” must be on or before “To”.</p>}
      <Button type="submit" size="sm" className="w-full" disabled={invalid}>
        Apply range
      </Button>
    </form>
  )
}

/**
 * Department filter: owners whose department is the picked one or below it. The list comes from
 * the report response (server-decided: every department for full scope, the departments a
 * Team-scope viewer heads otherwise). Shows the current value even before the list loads.
 */
export function DepartmentFilter({
  departments,
  value,
  onChange,
}: {
  departments: ReportDepartment[]
  value: string
  onChange: (id: string) => void
}) {
  const current = departments.find((d) => d.id === value)
  const label = current?.name ?? (value ? 'Department' : 'All departments')
  return (
    <Menu
      align="start"
      className="max-h-80 w-64 overflow-y-auto"
      trigger={(props) => (
        <Button variant="secondary" size="md" {...props} aria-label={`Department: ${label}`}>
          <Network />
          <span className="max-w-36 truncate">{label}</span>
          <ChevronDown className="text-subtle" />
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Department (includes sub-departments)</MenuLabel>
          {[{ id: '', name: 'All departments', depth: 0, active: true }, ...departments].map((d) => (
            <MenuItem
              key={d.id || 'all'}
              active={d.id === value}
              icon={d.id === value ? <Check /> : <span className="block size-4" />}
              hint={d.active ? undefined : 'Inactive'}
              onSelect={() => {
                onChange(d.id)
                close()
              }}
            >
              <span style={{ paddingInlineStart: `${d.depth * 0.75}rem` }}>{d.name}</span>
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

export function OwnerFilter({ owners, value, onChange }: { owners: ReportOwner[]; value: string; onChange: (id: string) => void }) {
  const current = owners.find((o) => o.id === value)
  return (
    <Menu
      align="start"
      className="max-h-80 w-60 overflow-y-auto"
      trigger={(props) => (
        <Button variant="secondary" size="md" {...props} aria-label={`Owner: ${current?.name ?? 'All owners'}`}>
          <Users />
          <span className="max-w-36 truncate">{current?.name ?? 'All owners'}</span>
          <ChevronDown className="text-subtle" />
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Owner</MenuLabel>
          {[{ id: '', name: 'All owners' }, ...owners].map((o) => (
            <MenuItem
              key={o.id || 'all'}
              active={o.id === value}
              icon={o.id === value ? <Check /> : <span className="block size-4" />}
              onSelect={() => {
                onChange(o.id)
                close()
              }}
            >
              {o.name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}
