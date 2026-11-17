import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, Package, PenLine, Plus } from 'lucide-react'
import type { LeadRow } from '@/modules/leads/types'
import type { PackageRow, Service } from '@/modules/services/types'
import { fmtIn, UNIT_FOR_PRICING } from '@/modules/quotations/lib/totals'
import { usePackagesQuery } from '@/modules/services/hooks/useServices'
import { CategoryIcon, groupByCategory } from '@/modules/leads/components/ServiceFields'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Menu } from '@/shared/components/ui/Menu'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'

/** Search box at the top of a picker popover. */
function PickerSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="border-b border-line p-1.5">
      <input
        autoFocus
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-md bg-sunken px-2.5 text-[0.8125rem] placeholder:text-subtle focus-visible:outline-none"
      />
    </div>
  )
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium text-subtle">{children}</p>
}

/* ---------------- Lead picker ---------------- */


interface LeadPickerProps {
  id: string
  leads: LeadRow[]
  loading: boolean
  value: string
  onChange: (leadId: string) => void
  invalid?: boolean
}

/** Searchable select of the leads in the user's scope. */
export function LeadPicker({ id, leads, loading, value, onChange, invalid }: LeadPickerProps) {
  const [q, setQ] = useState('')
  const selected = leads.find((l) => l.id === value)
  const lookups = useLookups()

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return leads
      .filter((l) => !lookups.isClosed(l.status) || lookups.isWon(l.status))
      .filter((l) => !needle || [l.company, l.contactName, l.contactEmail, l.id].join(' ').toLowerCase().includes(needle))
      // Stages most likely to need a quotation first: open leads by win probability (highest
      // first), then won customers.
      .sort((a, b) => rank(a.status) - rank(b.status) || a.company.localeCompare(b.company))
      .slice(0, 50)
    function rank(status: string) {
      return lookups.isWon(status) ? 1000 : 100 - lookups.probability(status)
    }
  }, [leads, q, lookups])

  if (loading) return <Skeleton className="h-11 w-full rounded-lg" />

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
            'flex min-h-11 w-full items-center gap-2.5 rounded-lg border bg-surface px-3 py-1.5 text-start shadow-xs transition-[border-color,box-shadow] focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
            invalid ? 'border-danger-500' : 'border-line-strong hover:border-subtle',
          )}
        >
          {selected ? (
            <>
              <Avatar name={selected.company} size="md" square />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium text-ink">{selected.company}</span>
                <span className="block truncate text-xs text-muted">
                  {selected.contactName} · {selected.contactEmail}
                </span>
              </span>
              <StatusBadge status={selected.status} />
            </>
          ) : (
            <span className="flex-1 text-[0.8125rem] text-subtle">Search leads by company or contact…</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-subtle" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          <PickerSearch value={q} onChange={setQ} placeholder="Search leads" />
          <div className="max-h-80 overflow-y-auto p-1" role="listbox" aria-label="Leads">
            {options.length === 0 ? (
              <p className="px-2 py-6 text-center text-[0.8125rem] text-muted">No open leads match “{q}”.</p>
            ) : (
              options.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="option"
                  aria-selected={l.id === value}
                  onClick={() => {
                    onChange(l.id)
                    setQ('')
                    close()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start hover:bg-hover"
                >
                  <Avatar name={l.company} size="sm" square />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium text-ink">{l.company}</span>
                    <span className="block truncate text-xs text-muted">
                      {l.contactName} · {l.ownerName}
                    </span>
                  </span>
                  <StatusBadge status={l.status} />
                  <Check className={cn('size-4 shrink-0 text-brand-600', l.id !== value && 'invisible')} aria-hidden />
                </button>
              ))
            )}
          </div>
        </>
      )}
    </Menu>
  )
}

/* ---------------- Service picker ---------------- */

interface ServicePickerProps {
  services: Service[]
  loading: boolean
  onPick: (service: Service) => void
  onCustom: () => void
}

/** "Add line" popover: catalog services grouped by category, plus a custom line. */
export function ServicePicker({ services, loading, onPick, onCustom }: ServicePickerProps) {
  const [q, setQ] = useState('')
  const lookups = useLookups()

  // ACTIVE services only; grouped by category in the serviceCategories lookup order.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = services
      .filter((s) => s.active)
      .filter((s) => !needle || [s.name, lookups.serviceCategoryLabel(s.category), s.description].join(' ').toLowerCase().includes(needle))
    return groupByCategory(list, lookups)
  }, [services, q, lookups])

  return (
    <Menu
      align="start"
      className="w-[min(28rem,calc(100vw-2rem))] p-0"
      trigger={(props) => (
        <Button variant="secondary" size="sm" {...props}>
          <Plus />
          Add line
        </Button>
      )}
    >
      {(close) => (
        <>
          <PickerSearch value={q} onChange={setQ} placeholder="Search the service catalog" />
          <div className="max-h-80 overflow-y-auto p-1">
            {loading ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-[0.8125rem] text-muted">
                {services.length === 0 ? 'The service catalog is empty.' : `No services match “${q}”.`}
              </p>
            ) : (
              groups.map(([category, list]) => (
                <div key={category} role="group" aria-label={lookups.serviceCategoryLabel(category)}>
                  <GroupLabel>
                    <span className="flex items-center gap-1.5">
                      <CategoryIcon category={category} className="size-4 [&_svg]:size-2.5" />
                      {lookups.serviceCategoryLabel(category)}
                    </span>
                  </GroupLabel>
                  {list.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onPick(s)
                        setQ('')
                        close()
                      }}
                      className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-start hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-medium text-ink">{s.name}</span>
                        <span className="block truncate text-xs text-muted">{s.description}</span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="num block text-[0.8125rem] text-ink">{fmtIn(s.price, s.currency)}</span>

                        <span className="block text-[0.6875rem] text-subtle">
                          per {UNIT_FOR_PRICING[s.pricingType]}
                          {s.deliveryDays > 0 && ` · ${s.deliveryDays} days`}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="border-t border-line p-1">
            <button
              type="button"
              onClick={() => {
                onCustom()
                setQ('')
                close()
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[0.8125rem] text-ink hover:bg-hover"
            >
              <PenLine className="size-4 text-muted" aria-hidden />
              Custom line
              <span className="ms-auto text-xs text-subtle">Not from the catalog</span>
            </button>
          </div>
        </>
      )}
    </Menu>
  )
}

/* ---------------- Package picker ---------------- */

/** "Add package" popover: ACTIVE packages with list vs package price; adds the package as a group of lines. */
export function PackagePicker({ onPick }: { onPick: (pkg: PackageRow) => void }) {
  const [q, setQ] = useState('')
  const packages = usePackagesQuery()

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (packages.data ?? [])
      .filter((p) => p.active)
      .filter((p) => !needle || [p.name, p.description, ...p.lines.map((l) => l.name)].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [packages.data, q])

  return (
    <Menu
      align="start"
      className="w-[min(28rem,calc(100vw-2rem))] p-0"
      trigger={(props) => (
        <Button variant="secondary" size="sm" {...props}>
          <Package />
          Add package
        </Button>
      )}
    >
      {(close) => (
        <>
          <PickerSearch value={q} onChange={setQ} placeholder="Search packages" />
          <div className="max-h-80 overflow-y-auto p-1">
            {packages.isPending ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : packages.isError ? (
              <p className="px-2 py-6 text-center text-[0.8125rem] text-danger-600 dark:text-danger-500">
                Couldn’t load packages.{' '}
                <button type="button" className="underline" onClick={() => packages.refetch()}>
                  Try again
                </button>
              </p>
            ) : list.length === 0 ? (
              <p className="px-2 py-6 text-center text-[0.8125rem] text-muted">
                {q ? `No active packages match “${q}”.` : 'No active packages yet.'}
              </p>
            ) : (
              list.map((p) => {
                const blocked = p.lines.some((l) => !l.active)
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={blocked}
                    title={blocked ? 'A service in this package is no longer offered.' : undefined}
                    onClick={() => {
                      onPick(p)
                      setQ('')
                      close()
                    }}
                    className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-start hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-sunken text-muted ring-1 ring-line [&_svg]:size-3.5">
                      <Package aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {p.lines.map((l) => (l.quantity > 1 ? `${l.name} × ${l.quantity}` : l.name)).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="num block text-[0.8125rem] font-medium text-ink">{fmtIn(p.packagePrice, p.currency)}</span>
                      {p.saving > 0 ? (
                        <span className="num block text-[0.6875rem] text-subtle">
                          <s>{fmtIn(p.listPrice, p.currency)}</s> · save {Math.round(p.savingPct)}%
                        </span>
                      ) : (
                        <span className="num block text-[0.6875rem] text-subtle">list {fmtIn(p.listPrice, p.currency)}</span>
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </Menu>
  )
}
