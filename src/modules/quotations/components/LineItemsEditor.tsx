import type { ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Library, ListPlus, Package, Trash2 } from 'lucide-react'
import type { QuotationItem, QuotationUnit } from '@/modules/quotations/types'
import type { PackageRow, Service } from '@/modules/services/types'
import { DEFAULT_QUOTE_CURRENCY, fmtAed, fmtIn, lineTotal, UNIT_FOR_PRICING, unitLabel } from '@/modules/quotations/lib/totals'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SelectInput, TextInput } from '@/shared/components/form/Field'
import { PackagePicker, ServicePicker } from '@/modules/quotations/components/Pickers'

let seq = 0
export function newItemId(): string {
  seq += 1
  return `new-${Date.now().toString(36)}-${seq}`
}

/** A line prefilled from a catalog service: description, unit, unit price and currency (all editable). */
export function itemFromService(s: Service): QuotationItem {
  return {
    id: newItemId(),
    serviceId: s.id,
    description: s.name,
    quantity: s.pricingType === 'Monthly' ? 12 : s.pricingType === 'Hourly' ? 10 : 1,
    unit: UNIT_FOR_PRICING[s.pricingType],
    unitPrice: s.price,
    discountPct: 0,
    currency: s.currency || DEFAULT_QUOTE_CURRENCY,
  }
}

/**
 * One line per package item (quantity from the package) sharing a group id. The package saving
 * is spread as the same discount % on every line, so the group total equals the package price.
 * A package priced above its list price gets no discount (the group then totals the list price).
 */
export function itemsFromPackage(p: PackageRow): QuotationItem[] {
  const groupId = `pkg-${p.id}-${newItemId()}`
  const list = p.lines.reduce((sum, l) => sum + l.price * l.quantity, 0)
  const pct = list > 0 && p.packagePrice < list ? Math.round((1 - p.packagePrice / list) * 100 * 10_000) / 10_000 : 0
  const items: QuotationItem[] = p.lines.map((l) => ({
    id: newItemId(),
    serviceId: l.serviceId,
    description: l.name,
    quantity: l.quantity,
    unit: UNIT_FOR_PRICING[l.pricingType],
    unitPrice: l.price,
    discountPct: pct,
    currency: p.currency || DEFAULT_QUOTE_CURRENCY,
    groupId,
    groupLabel: p.name,
  }))
  // Rounding: the last line absorbs the fils so the group totals the package price exactly.
  const last = items.at(-1)
  if (pct > 0 && last) {
    const others = items.slice(0, -1).reduce((s, it) => s + lineTotal(it), 0)
    const gross = last.quantity * last.unitPrice
    const exact = gross > 0 ? (1 - (p.packagePrice - others) / gross) * 100 : pct
    if (exact >= 0 && exact <= 100) last.discountPct = Math.round(exact * 1_000_000) / 1_000_000
  }
  return items
}

function customItem(): QuotationItem {
  return { id: newItemId(), serviceId: null, description: '', quantity: 1, unit: 'project', unitPrice: 0, discountPct: 0 }
}

/** Contiguous blocks: a standalone line, or every line of one package (kept together at its first line). */
type Block = { kind: 'line'; items: [QuotationItem] } | { kind: 'group'; id: string; label: string; items: QuotationItem[] }

export function toBlocks(items: QuotationItem[]): Block[] {
  const blocks: Block[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (!it.groupId) {
      blocks.push({ kind: 'line', items: [it] })
    } else if (!seen.has(it.groupId)) {
      seen.add(it.groupId)
      blocks.push({ kind: 'group', id: it.groupId, label: it.groupLabel || 'Package', items: items.filter((x) => x.groupId === it.groupId) })
    }
  }
  return blocks
}

/** Number input that tolerates an empty box while typing. */
function NumberCell({
  value,
  onChange,
  label,
  invalid,
  step = 'any',
  min = 0,
  max,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  label: string
  invalid?: boolean
  step?: string
  min?: number
  max?: number
  suffix?: ReactNode
}) {
  return (
    <span className="relative block">
      <TextInput
        type="number"
        inputMode="decimal"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : e.target.valueAsNumber)}
        invalid={invalid}
        className={cn('num text-end [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none', suffix && 'pe-7')}
      />
      {suffix && <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-subtle">{suffix}</span>}
    </span>
  )
}

const GRID = '@3xl:grid-cols-[minmax(0,1fr)_4.5rem_6.25rem_7.25rem_4.5rem_7rem_5.25rem]'

interface LineItemsEditorProps {
  items: QuotationItem[]
  onChange: (items: QuotationItem[]) => void
  /** The whole catalog (active + inactive): pickers offer active ones, existing lines still resolve. */
  services: Service[]
  servicesLoading: boolean
  /** Per-line error messages, by item id. */
  errors: Record<string, string>
  /** Shown under the table, e.g. "Add at least one line". */
  listError?: string
  /** The quotation's single currency; totals always use it. */
  currency?: string
}

/** Editable line items: add services or packages from the catalog, or a custom line; edit, reorder and remove. */
export function LineItemsEditor({
  items,
  onChange,
  services,
  servicesLoading,
  errors,
  listError,
  currency = DEFAULT_QUOTE_CURRENCY,
}: LineItemsEditorProps) {
  const lookups = useLookups()
  const serviceById = new Map(services.map((s) => [s.id, s]))
  const blocks = toBlocks(items)
  const mismatched = items.filter((it) => it.currency && it.currency !== currency)

  const emit = (next: Block[]) => onChange(next.flatMap((b) => b.items))
  function patch(id: string, change: Partial<QuotationItem>) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...change } : it)))
  }
  function moveBlock(index: number, delta: number) {
    const next = [...blocks]
    const [b] = next.splice(index, 1)
    next.splice(index + delta, 0, b)
    emit(next)
  }
  function moveInGroup(groupItems: QuotationItem[], index: number, delta: number) {
    const reordered = [...groupItems]
    const [it] = reordered.splice(index, 1)
    reordered.splice(index + delta, 0, it)
    emit(blocks.map((b) => (b.kind === 'group' && b.id === it.groupId ? { ...b, items: reordered } : b)))
  }
  const add = (more: QuotationItem[]) => onChange([...items, ...more])
  const remove = (id: string) => onChange(items.filter((x) => x.id !== id))
  const removeGroup = (groupId: string) => onChange(items.filter((x) => x.groupId !== groupId))

  const pickers = (
    <div className="flex flex-wrap items-center gap-2">
      <ServicePicker services={services} loading={servicesLoading} onPick={(s) => add([itemFromService(s)])} onCustom={() => add([customItem()])} />
      <PackagePicker onPick={(p) => add(itemsFromPackage(p))} />
    </div>
  )

  let lineNo = 0
  function renderLine(it: QuotationItem, opts: { up?: () => void; down?: () => void; inGroup?: boolean }) {
    lineNo += 1
    const n = lineNo
    const service = it.serviceId ? serviceById.get(it.serviceId) : undefined
    const error = errors[it.id]
    const otherCurrency = !!it.currency && it.currency !== currency
    return (
      <li key={it.id} className={cn('py-3', opts.inGroup && 'px-3')}>
        <div className={cn('grid grid-cols-2 items-start gap-2 @3xl:items-center', GRID)}>
          <div className="col-span-2 min-w-0 @3xl:col-span-1">
            <TextInput
              aria-label={`Line ${n} description`}
              value={it.description}
              onChange={(e) => patch(it.id, { description: e.target.value })}
              placeholder="What you’ll deliver"
              invalid={!!error && !it.description.trim()}
            />
            <p className="mt-1 flex items-center gap-1 truncate text-[0.6875rem] text-subtle">
              {it.serviceId ? (
                <>
                  <Library className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    {service
                      ? `${lookups.serviceCategoryLabel(service.category)} · catalog ${fmtIn(service.price, service.currency)} / ${unitLabel(UNIT_FOR_PRICING[service.pricingType], 1)}`
                      : 'From the catalog'}
                  </span>
                  {service && !service.active && <span className="shrink-0 font-medium text-warning-700 dark:text-warning-500">(inactive)</span>}
                </>
              ) : (
                'Custom line'
              )}
              {otherCurrency && (
                <span className="flex shrink-0 items-center gap-0.5 text-warning-700 dark:text-warning-500" title={`Priced in ${it.currency}; totals use ${currency}.`}>
                  <AlertTriangle className="size-3" aria-hidden />
                  {it.currency}
                </span>
              )}
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-[0.6875rem] text-muted @3xl:sr-only">Quantity</span>
            <NumberCell label={`Line ${n} quantity`} value={it.quantity} onChange={(v) => patch(it.id, { quantity: v })} invalid={!!error && !(it.quantity > 0)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.6875rem] text-muted @3xl:sr-only">Unit</span>
            <SelectInput aria-label={`Line ${n} unit`} value={it.unit} onChange={(e) => patch(it.id, { unit: e.target.value as QuotationUnit })}>
              <option value="project">Project</option>
              <option value="month">Month</option>
              <option value="hour">Hour</option>
            </SelectInput>
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.6875rem] text-muted @3xl:sr-only">Unit price ({currency})</span>
            <NumberCell
              label={`Line ${n} unit price in ${currency}`}
              value={it.unitPrice}
              onChange={(v) => patch(it.id, { unitPrice: v })}
              invalid={!!error && !(it.unitPrice >= 0)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.6875rem] text-muted @3xl:sr-only">Discount</span>
            <NumberCell
              label={`Line ${n} discount percent`}
              value={it.discountPct}
              onChange={(v) => patch(it.id, { discountPct: v })}
              max={100}
              suffix="%"
              invalid={!!error && !(it.discountPct >= 0 && it.discountPct <= 100)}
            />
          </label>
          <div className="col-span-2 flex items-center justify-between gap-2 @3xl:contents">
            <p className="num text-[0.8125rem] font-medium text-ink @3xl:text-end">
              <span className="me-1.5 text-xs font-normal text-muted @3xl:hidden">Amount</span>
              {fmtIn(lineTotal(it), currency)}
            </p>
            <div className="flex items-center justify-end gap-0.5">
              <Button variant="ghost" size="xs" iconOnly aria-label={`Move line ${n} up`} disabled={!opts.up} onClick={opts.up}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="xs" iconOnly aria-label={`Move line ${n} down`} disabled={!opts.down} onClick={opts.down}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="xs" iconOnly aria-label={`Remove line ${n}`} className="hover:text-danger-600" onClick={() => remove(it.id)}>
                <Trash2 />
              </Button>
            </div>
          </div>
        </div>
        {error && <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">{error}</p>}
      </li>
    )
  }

  return (
    <div className="@container">
      {items.length === 0 ? (
        <div className={cn('rounded-lg border border-dashed', listError ? 'border-danger-500' : 'border-line-strong')}>
          <EmptyState
            className="py-10"
            icon={<ListPlus aria-hidden />}
            title="No line items yet"
            body="Add services or packages from the catalog. Prices, units and currency are filled in for you, and you can still adjust them."
            action={pickers}
          />
        </div>
      ) : (
        <>
          {mismatched.length > 0 && (
            <p role="status" className="mb-3 flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {mismatched.length === 1 ? 'One line is' : `${mismatched.length} lines are`} priced in{' '}
                {[...new Set(mismatched.map((m) => m.currency))].join(', ')} in the catalog. This quotation is in {currency}: totals use the
                prices as {currency}, so convert them if needed.
              </span>
            </p>
          )}
          <div className={cn('hidden gap-2 border-b border-line pb-2 text-xs font-medium text-muted @3xl:grid', GRID)}>
            <span>Description</span>
            <span className="text-end">Qty</span>
            <span>Unit</span>
            <span className="text-end">Unit price</span>
            <span className="text-end">Disc.</span>
            <span className="text-end">Amount</span>
            <span className="sr-only">Actions</span>
          </div>
          <ol className="divide-y divide-line">
            {blocks.map((b, bi) => {
              const up = bi > 0 ? () => moveBlock(bi, -1) : undefined
              const down = bi < blocks.length - 1 ? () => moveBlock(bi, 1) : undefined
              if (b.kind === 'line') return renderLine(b.items[0], { up, down })
              const total = b.items.reduce((s, x) => s + lineTotal(x), 0)
              const list = b.items.reduce((s, x) => s + (Number(x.quantity) || 0) * (Number(x.unitPrice) || 0), 0)
              return (
                <li key={b.id} className="py-3">
                  <div className="overflow-hidden rounded-lg border border-line bg-sunken/40">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
                      <span className="flex size-6 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300 [&_svg]:size-3.5">
                        <Package aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-medium text-ink">{b.label}</span>
                        <span className="num block text-[0.6875rem] text-muted">
                          Package · {b.items.length} {b.items.length === 1 ? 'line' : 'lines'}
                          {list > total && ` · list ${fmtIn(list, currency)}`}
                        </span>
                      </span>
                      <span className="num text-[0.8125rem] font-semibold text-ink">{fmtIn(total, currency)}</span>
                      <span className="flex items-center gap-0.5">
                        <Button variant="ghost" size="xs" iconOnly aria-label={`Move package ${b.label} up`} disabled={!up} onClick={up}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="xs" iconOnly aria-label={`Move package ${b.label} down`} disabled={!down} onClick={down}>
                          <ArrowDown />
                        </Button>
                        <Button variant="ghost" size="xs" className="hover:text-danger-600" onClick={() => removeGroup(b.id)}>
                          <Trash2 />
                          Remove package
                        </Button>
                      </span>
                    </div>
                    <ol className="divide-y divide-line">
                      {b.items.map((it, ii) =>
                        renderLine(it, {
                          inGroup: true,
                          up: ii > 0 ? () => moveInGroup(b.items, ii, -1) : undefined,
                          down: ii < b.items.length - 1 ? () => moveInGroup(b.items, ii, 1) : undefined,
                        }),
                      )}
                    </ol>
                  </div>
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {pickers}
            <span className="text-xs text-muted">
              {items.length} {items.length === 1 ? 'line' : 'lines'}
            </span>
          </div>
        </>
      )}
      {listError && <p className="mt-2 text-xs text-danger-600 dark:text-danger-500">{listError}</p>}
    </div>
  )
}

/** Read-only lines for sent quotations; packages are shown as a labelled group. */
export function LineItemsView({ items, services = [] }: { items: QuotationItem[]; services?: Service[] }) {
  const serviceById = new Map(services.map((s) => [s.id, s]))
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[35rem] text-[0.8125rem]">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="px-5 py-2 text-start font-medium">Description</th>
            <th className="px-3 py-2 text-end font-medium">Qty</th>
            <th className="px-3 py-2 text-end font-medium">Unit price</th>
            <th className="px-3 py-2 text-end font-medium">Disc.</th>
            <th className="px-5 py-2 text-end font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {toBlocks(items).flatMap((b) => {
            const rows = b.items.map((it) => {
              const service = it.serviceId ? serviceById.get(it.serviceId) : undefined
              return (
                <tr key={it.id}>
                  <td className={cn('py-2.5 pe-5', b.kind === 'group' ? 'ps-8' : 'ps-5')}>
                    <p className="font-medium text-ink">
                      {it.description}
                      {service && !service.active && <span className="ms-1.5 text-xs font-normal text-warning-700 dark:text-warning-500">(inactive)</span>}
                    </p>
                    <p className="text-[0.6875rem] text-subtle">{it.serviceId ? 'From the catalog' : 'Custom line'}</p>
                  </td>
                  <td className="num px-3 py-2.5 text-end whitespace-nowrap">
                    {it.quantity} <span className="text-muted">{unitLabel(it.unit, it.quantity)}</span>
                  </td>
                  <td className="num px-3 py-2.5 text-end whitespace-nowrap">{fmtAed(it.unitPrice)}</td>
                  <td className="num px-3 py-2.5 text-end text-muted">{it.discountPct ? `${Math.round(it.discountPct * 100) / 100}%` : '—'}</td>
                  <td className="num px-5 py-2.5 text-end font-medium whitespace-nowrap text-ink">{fmtAed(lineTotal(it))}</td>
                </tr>
              )
            })
            if (b.kind === 'line') return rows
            const total = b.items.reduce((s, x) => s + lineTotal(x), 0)
            return [
              <tr key={b.id} className="bg-sunken/50">
                <td colSpan={4} className="px-5 py-2 text-xs font-semibold text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Package className="size-3.5" aria-hidden />
                    {b.label}
                  </span>
                </td>
                <td className="num px-5 py-2 text-end text-xs font-semibold text-ink-2">{fmtAed(total)}</td>
              </tr>,
              ...rows,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
