import { useId, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { TaskLink, TaskLinkType } from '@/modules/tasks/types'
import { TASK_LINK_TYPES } from '@/modules/tasks/types'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import { useCustomersQuery } from '@/modules/crm/hooks/useCrm'
import { useEventsEnabled } from '@/modules/events/hooks/useEventsEnabled'
import { useEventsQuery } from '@/modules/events/hooks/useEvents'
import { EVENT_STATUS_LABEL } from '@/modules/events/types'
import { cn } from '@/shared/lib/utils'
import { SelectInput, TextInput } from '@/shared/components/form/Field'
import { LINK_LABEL } from './taskMeta'
import { LinkTypeIcon } from './LinkChip'

export interface LinkOption {
  id: string
  label: string
  hint?: string
}

/** Records a task can link to, per type (only the selected type's list is fetched). */
export function useLinkOptions(type: TaskLinkType | '') {
  const leads = useLeadsQuery()
  const customers = useCustomersQuery()
  const events = useEventsQuery({}, { enabled: type === 'event' })
  return useMemo(() => {
    if (type === 'lead') {
      return { options: (leads.data ?? []).map((l) => ({ id: l.id, label: l.company, hint: l.status })), loading: leads.isPending && leads.fetchStatus !== 'idle' }
    }
    if (type === 'customer') {
      return { options: (customers.data ?? []).map((c) => ({ id: c.id, label: c.name, hint: c.status })), loading: customers.isPending && customers.fetchStatus !== 'idle' }
    }
    if (type === 'event') {
      return {
        options: (events.data ?? []).filter((e) => e.status !== 'cancelled').map((e) => ({ id: e.id, label: e.name, hint: `${e.startDate} · ${EVENT_STATUS_LABEL[e.status]}` })),
        loading: events.isPending && events.fetchStatus !== 'idle',
      }
    }
    return { options: [] as LinkOption[], loading: false }
  }, [type, leads.data, leads.isPending, leads.fetchStatus, customers.data, customers.isPending, customers.fetchStatus, events.data, events.isPending, events.fetchStatus])
}

interface LinkPickerProps {
  value: TaskLink | null
  onChange: (link: TaskLink | null) => void
  /** Label of the current link when it isn't in the option list (e.g. out of scope). */
  currentLabel?: string
  disabled?: boolean
  invalid?: boolean
  idPrefix?: string
}

/** Polymorphic link: type + record search. Events need the Events module in the plan (disabled otherwise). */
export function LinkPicker({ value, onChange, currentLabel, disabled, invalid, idPrefix }: LinkPickerProps) {
  const autoId = useId()
  const base = idPrefix ?? autoId
  const eventsOn = useEventsEnabled()
  const [type, setType] = useState<TaskLinkType | ''>(value?.type ?? '')
  const shownType = value?.type ?? type
  const { options, loading } = useLinkOptions(shownType)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const selected = value ? (options.find((o) => o.id === value.id) ?? { id: value.id, label: currentLabel ?? value.id }) : null
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.id.toLowerCase().includes(s)) : options).slice(0, 8)
  }, [options, q])

  function pick(o: LinkOption) {
    if (!shownType) return
    onChange({ type: shownType, id: o.id })
    setQ('')
    setOpen(false)
  }

  const listId = `${base}-list`
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <SelectInput
        id={`${base}-type`}
        aria-label="Link type"
        value={shownType}
        disabled={disabled}
        onChange={(e) => {
          const t = e.target.value as TaskLinkType | ''
          setType(t)
          setQ('')
          if (value) onChange(null)
        }}
      >
        <option value="">No link</option>
        {TASK_LINK_TYPES.map((t) => (
          <option key={t} value={t} disabled={t === 'event' && !eventsOn && value?.type !== 'event'}>
            {LINK_LABEL[t]}
            {t === 'event' && !eventsOn ? ' (not in your plan)' : ''}
          </option>
        ))}
      </SelectInput>

      {selected ? (
        <div
          className={cn(
            'flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-surface px-3 text-[0.8125rem] shadow-xs',
            invalid ? 'border-danger-500' : 'border-line-strong',
          )}
        >
          {shownType && <LinkTypeIcon type={shownType} className="text-muted" />}
          <span className="min-w-0 flex-1 truncate">{selected.label}</span>
          {value?.type === 'event' && !eventsOn && <span className="text-xs text-subtle">inactive</span>}
          {!disabled && (
            <button type="button" aria-label="Remove link" onClick={() => onChange(null)} className="rounded p-0.5 text-subtle hover:text-ink">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative min-w-0">
          <TextInput
            id={`${base}-search`}
            role="combobox"
            aria-label={shownType ? `Search ${LINK_LABEL[shownType].toLowerCase()}s` : 'Pick a link type first'}
            aria-expanded={open && !!shownType}
            aria-controls={listId}
            aria-autocomplete="list"
            invalid={invalid}
            disabled={disabled || !shownType || (shownType === 'event' && !eventsOn)}
            placeholder={
              !shownType ? 'Pick a type first' : shownType === 'event' && !eventsOn ? 'Events isn’t in your plan' : loading ? 'Loading…' : `Search ${LINK_LABEL[shownType].toLowerCase()}s`
            }
            value={q}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, matches.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && open && matches[active]) {
                e.preventDefault()
                e.stopPropagation()
                pick(matches[active])
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
          {open && shownType && (shownType !== 'event' || eventsOn) && (
            <ul
              id={listId}
              role="listbox"
              className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop"
            >
              {loading ? (
                <li className="px-2 py-2 text-xs text-muted">Loading…</li>
              ) : matches.length === 0 ? (
                <li className="px-2 py-2 text-xs text-muted">{options.length ? 'No matches' : `No ${LINK_LABEL[shownType].toLowerCase()}s you can see`}</li>
              ) : (
                matches.map((o, i) => (
                  <li
                    key={o.id}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(o)
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem]', i === active && 'bg-hover')}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-xs text-subtle">{o.hint}</span>}
                    {value?.id === o.id && <Check className="size-3.5 text-brand-600" aria-hidden />}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
