import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronRight, Lock, Plus } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { Switch, TextInput } from '@/shared/components/form/Field'
import { isLockedOption, newOption, pinSystemLast, type DraftOption } from './draft'
import { SortableList } from './SortableList'

/** Borderless-until-hover text input used for inline label edits. */
export function InlineLabel({
  value,
  onChange,
  label,
  error,
  errorId,
  readOnly,
  muted,
  onFocus,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  error?: string
  errorId?: string
  readOnly?: boolean
  muted?: boolean
  onFocus?: () => void
}) {
  if (readOnly) {
    return <span className={cn('block truncate px-2 text-[0.8125rem]', muted ? 'text-muted' : 'text-ink')}>{value}</span>
  }
  return (
    <input
      type="text"
      value={value}
      maxLength={80}
      aria-label={label}
      aria-invalid={!!error || undefined}
      aria-describedby={error ? errorId : undefined}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-8 w-full min-w-0 rounded-md border bg-transparent px-2 text-[0.8125rem] transition-[border-color,box-shadow,background-color] outline-none placeholder:text-subtle hover:border-line-strong focus-visible:border-brand-500 focus-visible:bg-surface focus-visible:shadow-[var(--shadow-focus)]',
        error ? 'border-danger-500' : 'border-transparent',
        muted ? 'text-muted' : 'text-ink',
      )}
    />
  )
}

/** "Add …" input row at the bottom of a list. Checks duplicates before adding. */
export function AddItem({ noun, existing, onAdd }: { noun: string; existing: string[]; onAdd: (label: string) => void }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const label = value.trim()
    if (!label) return setError(`Type a name for the new ${noun}.`)
    if (existing.some((l) => l.trim().toLowerCase() === label.toLowerCase())) return setError(`“${label}” is already in the list.`)
    onAdd(label)
    setValue('')
    setError(null)
  }

  return (
    <form onSubmit={submit} noValidate className="px-3 pt-3">
      <div className="flex items-center gap-2">
        <TextInput
          id={id}
          value={value}
          placeholder={`New ${noun}`}
          maxLength={80}
          aria-label={`New ${noun}`}
          invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          className="h-8"
        />
        <Button write type="submit" variant="secondary" size="sm">
          <Plus />
          Add
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">
          {error}
        </p>
      )}
    </form>
  )
}

interface ListEditorProps {
  items: DraftOption[]
  onChange: (items: DraftOption[]) => void
  noun: string
  label: string
  readOnly: boolean
  errors: Record<string, string>
  /** Master-detail: highlight and select rows (industries). */
  selectedId?: string
  onSelect?: (id: string) => void
  /** Extra content before the switch (e.g. a sub-industry count). */
  meta?: (item: DraftOption) => ReactNode
  emptyText?: string
}

/**
 * Sortable, inline-editable list with active switches and an "Add" row. Items are never deleted.
 * Protected system items are locked (no drag, rename or toggle) and always pinned at the bottom.
 */
export function ListEditor({ items, onChange: emit, noun, label, readOnly, errors, selectedId, onSelect, meta, emptyText }: ListEditorProps) {
  const errId = useId()
  const onChange = (next: DraftOption[]) => emit(pinSystemLast(next))
  const patch = (id: string, p: Partial<DraftOption>) => onChange(items.map((i) => (i._id === id ? { ...i, ...p } : i)))

  return (
    <div className="pb-3">
      {items.length === 0 ? (
        <p className="px-5 py-6 text-center text-[0.8125rem] text-muted">{emptyText ?? `No ${noun} yet.`}</p>
      ) : (
        <SortableList
          label={label}
          items={items}
          onReorder={onChange}
          disabled={readOnly}
          nameOf={(i) => i.label}
          isLocked={isLockedOption}
          className="divide-y divide-line"
          renderItem={(item, handle, index) => {
            const error = errors[item._id]
            const selected = selectedId === item._id
            const locked = isLockedOption(item)
            return (
              <div
                className={cn(
                  'group/row flex flex-col px-3 py-1.5 transition-colors',
                  onSelect && 'cursor-pointer',
                  selected ? 'bg-brand-50/70 dark:bg-brand-500/10' : onSelect && 'hover:bg-hover/60',
                )}
                onClick={onSelect ? () => onSelect(item._id) : undefined}
              >
                <div className="flex items-center gap-2">
                  {handle}
                  <span className="num w-5 shrink-0 text-end text-xs text-subtle" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <InlineLabel
                      value={item.label}
                      label={`${noun} name`}
                      readOnly={readOnly || locked}
                      muted={!item.active || locked}
                      error={error}
                      errorId={`${errId}-${item._id}`}
                      onFocus={onSelect ? () => onSelect(item._id) : undefined}
                      onChange={(v) => patch(item._id, { label: v })}
                    />
                  </div>
                  {!item.key && (
                    <Badge tone="brand" className="hidden sm:inline-flex">
                      New
                    </Badge>
                  )}
                  {!item.active && <Badge variant="outline">Inactive</Badge>}
                  {meta?.(item)}
                  {locked ? (
                    <Tooltip
                      side="bottom"
                      label={item.hiddenFromPickers ? 'Set by the system only; agents can’t pick it' : 'Set by the system; locked'}
                    >
                      <span tabIndex={0} className="rounded-full outline-none focus-visible:shadow-[var(--shadow-focus)]">
                        <Badge tone="neutral" icon={<Lock className="size-3" aria-hidden />}>
                          System
                        </Badge>
                      </span>
                    </Tooltip>
                  ) : (
                    <span onClick={(e) => e.stopPropagation()} className="flex items-center">
                      <Switch
                        checked={item.active}
                        disabled={readOnly}
                        label={`${item.label || noun} active`}
                        onChange={(v) => patch(item._id, { active: v })}
                      />
                    </span>
                  )}
                  {onSelect && (
                    <ChevronRight
                      aria-hidden
                      className={cn('size-4 shrink-0 transition-colors rtl:-scale-x-100', selected ? 'text-brand-600 dark:text-brand-300' : 'text-subtle')}
                    />
                  )}
                </div>
                {error && (
                  <p id={`${errId}-${item._id}`} className="ms-[3.75rem] mt-0.5 mb-1 text-xs text-danger-600 dark:text-danger-500">
                    {error}
                  </p>
                )}
              </div>
            )
          }}
        />
      )}
      {!readOnly && <AddItem noun={noun} existing={items.map((i) => i.label)} onAdd={(l) => onChange([...items, newOption(l)])} />}
    </div>
  )
}
