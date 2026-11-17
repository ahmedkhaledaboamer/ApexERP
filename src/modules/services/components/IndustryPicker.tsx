import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn } from '@/shared/lib/utils'
import { Checkbox, SearchInput } from '@/shared/components/form/Field'

interface IndustryPickerProps {
  value: string[]
  onChange: (keys: string[]) => void
  onBlur?: () => void
  invalid?: boolean
  /** id of the visible label, for the group's accessible name. */
  labelledBy?: string
}

/** Multi-select of industries: picked chips on top, a searchable checkbox list below. */
export function IndustryPicker({ value, onChange, onBlur, invalid, labelledBy }: IndustryPickerProps) {
  const lookups = useLookups()
  const [q, setQ] = useState('')
  const listId = useId()
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key])
  const query = q.trim().toLowerCase()
  const options = lookups.industries.filter((i) => !query || i.label.toLowerCase().includes(query))
  const allActive = lookups.industries.map((i) => i.key)

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      onBlur={onBlur}
      className={cn('overflow-hidden rounded-lg border', invalid ? 'border-danger-500' : 'border-line-strong')}
    >
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b border-line bg-sunken/40 px-2.5 py-2">
        {value.length === 0 ? (
          <span className="text-[0.8125rem] text-subtle">Suits any industry</span>
        ) : (
          value.map((k) => (
            <span
              key={k}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-surface ps-2 pe-1 text-xs font-medium text-ink-2 ring-1 ring-line-strong ring-inset"
            >
              {lookups.industryLabel(k)}
              <button
                type="button"
                onClick={() => toggle(k)}
                aria-label={`Remove ${lookups.industryLabel(k)}`}
                className="rounded p-0.5 text-subtle hover:bg-hover hover:text-ink"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))
        )}
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="ms-auto text-xs text-muted hover:text-ink">
            Clear
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 px-2.5 pt-2.5">
        <SearchInput
          aria-label="Search industries"
          aria-controls={listId}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search industries…"
          className="flex-1"
        />
        {allActive.length > 0 && value.length < allActive.length && !query && (
          <button type="button" onClick={() => onChange([...new Set([...value, ...allActive])])} className="shrink-0 text-xs text-muted hover:text-ink">
            Select all
          </button>
        )}
      </div>
      <ul id={listId} className="max-h-52 overflow-y-auto p-1.5">
        {lookups.isLoading ? (
          <li className="px-2 py-2 text-[0.8125rem] text-muted">Loading industries…</li>
        ) : options.length === 0 ? (
          <li className="px-2 py-2 text-[0.8125rem] text-muted">No industries match “{q}”.</li>
        ) : (
          options.map((i) => {
            const on = value.includes(i.key)
            return (
              <li key={i.key}>
                <label className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-hover', on && 'text-ink')}>
                  <Checkbox checked={on} onChange={() => toggle(i.key)} />
                  <span className="truncate">{i.label}</span>
                </label>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
