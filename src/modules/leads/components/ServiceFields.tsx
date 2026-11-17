import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, ChevronsUpDown, Sparkles, X } from 'lucide-react'
import type { Service } from '@/modules/services/types'
import { categoryMeta } from '@/modules/services/categoryMeta'
import { matchServiceText } from '@/modules/services/match'
import { servicePath } from '@/app/paths'
import { useLookups, type LookupsApi } from '@/shared/hooks/useLookups'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Menu } from '@/shared/components/ui/Menu'
import { Skeleton } from '@/shared/components/ui/Feedback'

/**
 * Catalog-backed service fields for leads: services are always picked from the catalog
 * (Services module), never typed. Pickers offer ACTIVE services only; ids a record already has
 * keep rendering even when the service has since been deactivated.
 */

/** Round category icon in the category's tint. */
export function CategoryIcon({ category, className }: { category: string | null | undefined; className?: string }) {
  const meta = categoryMeta(category)
  return (
    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3', meta.tone, className)}>
      <meta.icon aria-hidden />
    </span>
  )
}

/** Groups services by category, in the order of the serviceCategories lookup (unknown keys last). */
export function groupByCategory<T extends Pick<Service, 'category' | 'name'>>(list: T[], lookups: LookupsApi): [string, T[]][] {
  const order = new Map(lookups.all.serviceCategories.map((c, i) => [c.key, i]))
  const map = new Map<string, T[]>()
  for (const s of list) map.set(s.category, [...(map.get(s.category) ?? []), s])
  return [...map.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b))
    .map(([k, items]) => [k, items.sort((x, y) => x.name.localeCompare(y.name))])
}

/** Read-only chip: category icon + service name, linking to the service page. */
export function ServiceChip({ service, id, link = true }: { service?: Service; id: string; link?: boolean }) {
  const body = (
    <>
      <CategoryIcon category={service?.category} className="size-4 [&_svg]:size-2.5" />
      <span className="truncate">{service?.name ?? id}</span>
      {service && !service.active && <span className="text-subtle">(inactive)</span>}
    </>
  )
  const cls =
    'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-sunken ps-1 pe-2.5 text-xs text-ink-2 ring-1 ring-line ring-inset'
  return link && service ? (
    <Link to={servicePath(id)} className={cn(cls, 'hover:text-ink hover:ring-line-strong')}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  )
}

/** Amber "Unmatched: <text>" chip for a legacy free-text recommendation. */
export function UnmatchedChip({ text, className }: { text: string; className?: string }) {
  return (
    <span
      title="Legacy free text that doesn't match a catalog service yet"
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-warning-50 px-2.5 text-xs text-warning-700 ring-1 ring-warning-100 ring-inset dark:bg-warning-500/15 dark:text-warning-500 dark:ring-warning-500/20',
        className,
      )}
    >
      <AlertTriangle className="size-3 shrink-0" aria-hidden />
      <span className="truncate">Unmatched: {text}</span>
    </span>
  )
}

/* ---------------- Multi select (services of interest) ---------------- */

interface MultiProps {
  id?: string
  catalog: Service[]
  loading?: boolean
  value: string[]
  onChange: (ids: string[]) => void
}

/** Toggle chips of ACTIVE catalog services grouped by category; selected inactive ids stay listed. */
export function ServiceMultiSelect({ id, catalog, loading, value, onChange }: MultiProps) {
  const lookups = useLookups()
  const groups = useMemo(
    () => groupByCategory(catalog.filter((s) => s.active || value.includes(s.id)), lookups),
    [catalog, value, lookups],
  )
  const unknown = value.filter((v) => !catalog.some((s) => s.id === v))

  if (loading) return <Skeleton className="h-16 w-full" />
  if (groups.length === 0 && unknown.length === 0) return <p className="text-xs text-muted">The service catalog has no active services.</p>

  return (
    <div id={id} className="space-y-3">
      {groups.map(([category, list]) => (
        <div key={category} role="group" aria-label={lookups.serviceCategoryLabel(category)}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-medium text-subtle">
            <CategoryIcon category={category} className="size-4 [&_svg]:size-2.5" />
            {lookups.serviceCategoryLabel(category)}
          </p>
          <div className="flex flex-wrap gap-2">
            {list.map((s) => {
              const on = value.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] transition-colors',
                    on
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                      : 'border-line-strong bg-surface text-ink-2 hover:bg-hover',
                  )}
                >
                  {s.name}
                  {!s.active && <span className="text-xs text-subtle">(inactive)</span>}
                  {on && <Check className="size-3.5" aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {unknown.map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(value.filter((x) => x !== u))}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[0.8125rem] text-muted hover:bg-hover"
        >
          Unknown service {u}
          <X className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  )
}

/* ---------------- Single select (recommended service) ---------------- */

interface SelectProps {
  id: string
  catalog: Service[]
  loading?: boolean
  value: string
  onChange: (id: string) => void
  invalid?: boolean
  placeholder?: string
  /** Show a "None" option. */
  allowNone?: boolean
}

/** Searchable select of ACTIVE catalog services grouped by category (current inactive value still shown). */
export function ServiceSelect({ id, catalog, loading, value, onChange, invalid, placeholder = 'Pick a catalog service…', allowNone = true }: SelectProps) {
  const [q, setQ] = useState('')
  const lookups = useLookups()
  const selected = catalog.find((s) => s.id === value)

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = catalog
      .filter((s) => s.active)
      .filter((s) => !needle || [s.name, s.description, lookups.serviceCategoryLabel(s.category)].join(' ').toLowerCase().includes(needle))
    return groupByCategory(list, lookups)
  }, [catalog, q, lookups])

  if (loading) return <Skeleton className="h-9 w-full rounded-lg" />

  return (
    <Menu
      align="start"
      className="w-[min(26rem,calc(100vw-2rem))] p-0"
      trigger={(props) => (
        <button
          id={id}
          type="button"
          {...props}
          aria-invalid={invalid || undefined}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg border bg-surface px-2.5 text-start text-[0.8125rem] shadow-xs transition-[border-color,box-shadow] focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
            invalid ? 'border-danger-500' : 'border-line-strong hover:border-subtle',
          )}
        >
          {selected ? (
            <>
              <CategoryIcon category={selected.category} />
              <span className="min-w-0 flex-1 truncate text-ink">
                {selected.name}
                {!selected.active && <span className="ms-1 text-subtle">(inactive)</span>}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-subtle">{value ? `Unknown service ${value}` : placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-subtle" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="border-b border-line p-1.5">
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the service catalog"
              aria-label="Search the service catalog"
              className="h-8 w-full rounded-md bg-sunken px-2.5 text-[0.8125rem] placeholder:text-subtle focus-visible:outline-none"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1" role="listbox" aria-label="Catalog services">
            {allowNone && !q && (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => {
                  onChange('')
                  close()
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[0.8125rem] text-muted hover:bg-hover"
              >
                <span className="flex-1">None yet</span>
                <Check className={cn('size-4 text-brand-600', value && 'invisible')} aria-hidden />
              </button>
            )}
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-[0.8125rem] text-muted">
                {q ? `No active services match “${q}”.` : 'The catalog has no active services.'}
              </p>
            ) : (
              groups.map(([category, list]) => (
                <div key={category} role="group" aria-label={lookups.serviceCategoryLabel(category)}>
                  <p className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[0.6875rem] font-medium text-subtle">
                    <CategoryIcon category={category} className="size-4 [&_svg]:size-2.5" />
                    {lookups.serviceCategoryLabel(category)}
                  </p>
                  {list.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={s.id === value}
                      onClick={() => {
                        onChange(s.id)
                        setQ('')
                        close()
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] text-ink">{s.name}</span>
                        <span className="block truncate text-xs text-muted">{s.description}</span>
                      </span>
                      <Check className={cn('size-4 shrink-0 text-brand-600', s.id !== value && 'invisible')} aria-hidden />
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Menu>
  )
}

/* ---------------- Unmatched legacy text ---------------- */

interface MatchProps {
  text: string
  catalog: Service[]
  onPick: (id: string) => void
}

/**
 * Legacy free-text recommendation: shows the amber chip, the best catalog suggestion
 * (`matchServiceText`) and a manual picker. Picking a service clears the text on save.
 */
export function UnmatchedServiceNotice({ text, catalog, onPick }: MatchProps) {
  const suggestion = useMemo(() => matchServiceText(text, catalog), [text, catalog])
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-warning-500/30 bg-warning-50/60 p-3 text-xs dark:bg-warning-700/10">
      <div className="flex flex-wrap items-center gap-2">
        <UnmatchedChip text={text} />
        {!open && (
          <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
            Match to catalog
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2.5 space-y-2">
          {suggestion ? (
            <p className="flex flex-wrap items-center gap-2 text-ink-2">
              <Sparkles className="size-3.5 text-brand-600" aria-hidden />
              Best match: <strong className="font-medium text-ink">{suggestion.name}</strong>
              <Button variant="secondary" size="xs" onClick={() => onPick(suggestion.id)}>
                Use it
              </Button>
            </p>
          ) : (
            <p className="text-muted">No confident catalog match — pick one:</p>
          )}
          <ServiceSelect id="unmatched-picker" catalog={catalog} value="" onChange={(id) => id && onPick(id)} allowNone={false} placeholder="Or pick a catalog service…" />
          <p className="text-muted">The free text is removed when you save with a catalog service.</p>
        </div>
      )}
    </div>
  )
}
