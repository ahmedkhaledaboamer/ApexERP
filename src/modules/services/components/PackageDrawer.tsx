import { useEffect, useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Minus, Plus, Trash2 } from 'lucide-react'
import type { PackageRow } from '@/modules/services/types'
import { packageSchema, type PackageValues } from '@/modules/services/schemas'
import { useCatalog, useCreatePackage, useUpdatePackage } from '@/modules/services/hooks/useServices'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn, fmtMoney } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SearchInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { CategoryIcon, PRICING_SUFFIX, priceText } from '@/modules/services/components/ServiceBits'
import { getRegion } from '@/shared/lib/region'

interface PackageDrawerProps {
  open: boolean
  onClose: () => void
  /** Edit this package; omit to create one. */
  pkg?: PackageRow | null
}

/** New records start in the workspace currency. */
const empty = (): PackageValues => ({ name: '', description: '', items: [], packagePrice: '' as unknown as number, currency: getRegion().currency })

/** New / edit package: pick services with quantities, set the package price, see the saving live. */
export function PackageDrawer({ open, onClose, pkg }: PackageDrawerProps) {
  const editing = !!pkg
  const catalog = useCatalog()
  const lookups = useLookups()
  const create = useCreatePackage()
  const update = useUpdatePackage()
  const toast = useToast()
  const [q, setQ] = useState('')

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitted },
  } = useForm<PackageValues>({ resolver: zodResolver(packageSchema), mode: 'onTouched', defaultValues: empty() })
  const { fields, append, remove } = useFieldArray({ control, name: 'items', keyName: '_key' })

  useEffect(() => {
    if (!open) return
    reset(
      pkg
        ? {
            name: pkg.name,
            description: pkg.description,
            items: pkg.items.map((i) => ({ serviceId: i.serviceId, quantity: i.quantity })),
            packagePrice: pkg.packagePrice,
            currency: pkg.currency,
          }
        : empty(),
    )
    setQ('')
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pkg])

  const items = watch('items') ?? []
  const currency = watch('currency') || getRegion().currency
  const packagePrice = Number(watch('packagePrice'))
  const listPrice = items.reduce((sum, it) => sum + (catalog.byId(it.serviceId)?.price ?? 0) * (Number(it.quantity) || 0), 0)
  const priced = Number.isFinite(packagePrice) && String(watch('packagePrice') ?? '') !== ''
  const saving = priced ? listPrice - packagePrice : 0
  const savingPct = priced && listPrice > 0 ? (saving / listPrice) * 100 : 0
  const mixedPricing = new Set(items.map((it) => catalog.byId(it.serviceId)?.pricingType).filter(Boolean)).size > 1

  const picked = new Set(items.map((i) => i.serviceId))
  const query = q.trim().toLowerCase()
  const options = useMemo(
    () =>
      catalog.active
        .filter((s) => !picked.has(s.id))
        .filter((s) => !query || `${s.name} ${lookups.serviceCategoryLabel(s.category)}`.toLowerCase().includes(query)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.active, items, query, lookups],
  )

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  const itemsError = errors.items?.message ?? errors.items?.root?.message

  function close() {
    if (isDirty && !pending && !window.confirm('Discard your changes to this package?')) return
    onClose()
  }

  const onSubmit = handleSubmit((v) => {
    const input = { name: v.name, description: v.description, items: v.items, packagePrice: v.packagePrice, currency: v.currency }
    if (pkg) {
      update.mutate(
        { id: pkg.id, input },
        {
          onSuccess: (row) => {
            toast.success('Package saved', row.name)
            onClose()
          },
        },
      )
      return
    }
    create.mutate(input, {
      onSuccess: (row) => {
        toast.success('Package created', row.name)
        onClose()
      },
    })
  })

  return (
    <Drawer
      open={open}
      onClose={close}
      width="lg"
      title={editing ? 'Edit package' : 'New package'}
      description={pkg ? `${pkg.id} · ${pkg.name}` : 'Bundle services and sell them at a package price.'}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button write type="submit" form="package-form" loading={pending}>
            {editing ? 'Save package' : 'Create package'}
          </Button>
        </>
      }
    >
      <form id="package-form" noValidate onSubmit={onSubmit} className="space-y-5">
        <Field id="pk-name" label="Name" required error={errors.name?.message}>
          <TextInput id="pk-name" placeholder="e.g. Clinic growth bundle" maxLength={120} invalid={!!errors.name} {...register('name')} />
        </Field>

        <Field id="pk-description" label="Description" error={errors.description?.message}>
          <TextArea id="pk-description" rows={3} maxLength={2000} placeholder="Who it’s for and what it includes." invalid={!!errors.description} {...register('description')} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">
            Services<span className="ms-0.5 text-danger-600" aria-hidden>*</span>
            <span className="ms-2 text-xs font-normal text-muted">at least 2</span>
          </legend>

          {fields.length > 0 ? (
            <ul className={cn('divide-y divide-line overflow-hidden rounded-lg border', itemsError ? 'border-danger-500' : 'border-line-strong')}>
              {fields.map((f, index) => {
                const s = catalog.byId(f.serviceId)
                const qty = Number(items[index]?.quantity) || 0
                const qtyError = errors.items?.[index]?.quantity?.message
                return (
                  <li key={f._key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <CategoryIcon category={s?.category ?? ''} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[0.8125rem] font-medium">{s?.name ?? f.serviceId}</span>
                        {s && !s.active && <Badge tone="amber">Inactive</Badge>}
                      </span>
                      <span className="block text-xs text-muted">{s ? priceText(s.price, s.currency, s.pricingType) : 'Unknown service'}</span>
                    </span>
                    <Controller
                      control={control}
                      name={`items.${index}.quantity`}
                      render={({ field }) => (
                        <span className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            iconOnly
                            aria-label={`Fewer ${s?.name ?? 'units'}`}
                            disabled={qty <= 1}
                            onClick={() => field.onChange(Math.max(1, qty - 1))}
                          >
                            <Minus />
                          </Button>
                          <TextInput
                            aria-label={`Quantity of ${s?.name ?? f.serviceId}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={999}
                            step={1}
                            className="num h-8 w-16 text-center"
                            invalid={!!qtyError}
                            value={field.value as unknown as string}
                            onChange={(e) => field.onChange(e.target.value)}
                            onBlur={field.onBlur}
                          />
                          <Button
                            variant="ghost"
                            size="xs"
                            iconOnly
                            aria-label={`More ${s?.name ?? 'units'}`}
                            disabled={qty >= 999}
                            onClick={() => field.onChange(Math.min(999, qty + 1))}
                          >
                            <Plus />
                          </Button>
                        </span>
                      )}
                    />
                    <span className="num w-24 text-end text-[0.8125rem] text-ink-2">{fmtMoney((s?.price ?? 0) * qty, s?.currency ?? currency)}</span>
                    <Button variant="ghost" size="xs" iconOnly aria-label={`Remove ${s?.name ?? f.serviceId}`} onClick={() => remove(index)} className="hover:text-danger-600">
                      <Trash2 />
                    </Button>
                    {qtyError && <p className="w-full text-end text-xs text-danger-600 dark:text-danger-500">Quantity: {qtyError}</p>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className={cn('rounded-lg border border-dashed px-3 py-4 text-center text-[0.8125rem] text-muted', itemsError ? 'border-danger-500' : 'border-line-strong')}>
              No services yet. Add them from the catalog below.
            </p>
          )}
          {itemsError && (isSubmitted || fields.length > 0) && <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">{itemsError}</p>}

          <div className="mt-3 overflow-hidden rounded-lg border border-line">
            <div className="border-b border-line bg-sunken/40 p-2">
              <SearchInput aria-label="Search the catalog" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a service: search the catalog…" />
            </div>
            <ul className="max-h-56 overflow-y-auto p-1" aria-label="Active services">
              {catalog.isPending ? (
                Array.from({ length: 3 }, (_, i) => (
                  <li key={i} className="p-1">
                    <Skeleton className="h-9" />
                  </li>
                ))
              ) : catalog.isError ? (
                <li className="px-2 py-2 text-[0.8125rem] text-danger-600">
                  Couldn’t load the catalog.{' '}
                  <button type="button" className="underline" onClick={() => catalog.refetch()}>
                    Try again
                  </button>
                </li>
              ) : options.length === 0 ? (
                <li className="px-2 py-2 text-[0.8125rem] text-muted">{query ? `No active services match “${q}”.` : 'Every active service is in the package.'}</li>
              ) : (
                options.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => append({ serviceId: s.id, quantity: 1 }, { shouldFocus: false })}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                    >
                      <CategoryIcon category={s.category} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-medium text-ink">{s.name}</span>
                        <span className="block truncate text-xs text-muted">{lookups.serviceCategoryLabel(s.category)}</span>
                      </span>
                      <span className="num shrink-0 text-xs text-ink-2">
                        {fmtMoney(s.price, s.currency)}
                        <span className="text-muted">{PRICING_SUFFIX[s.pricingType]}</span>
                      </span>
                      <Plus className="size-4 shrink-0 text-muted" aria-hidden />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </fieldset>

        <div className="rounded-lg border border-line bg-sunken/40 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted">List price</p>
              <p aria-live="polite" className="num mt-1 text-base font-semibold text-ink">{fmtMoney(listPrice, currency)}</p>
            </div>
            <div>
              <Field id="pk-price" label="Package price" required error={errors.packagePrice?.message}>
                <TextInput id="pk-price" type="number" inputMode="decimal" min={0} step="any" invalid={!!errors.packagePrice} {...register('packagePrice')} />
              </Field>
            </div>
            <div>
              <p className="text-xs text-muted">Customer saves</p>
              <p aria-live="polite" className={cn('num mt-1 text-base font-semibold', saving > 0 ? 'text-success-600 dark:text-success-500' : saving < 0 ? 'text-danger-600' : 'text-ink')}>
                {priced ? fmtMoney(saving, currency) : '—'}
                {priced && listPrice > 0 && <span className="ms-1.5 text-xs font-medium">({savingPct.toFixed(0)}%)</span>}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            {listPrice > 0 && (
              <>
                <span>Quick discount:</span>
                {[5, 10, 15, 20].map((pct) => (
                  <Button
                    key={pct}
                    variant="secondary"
                    size="xs"
                    onClick={() => setValue('packagePrice', Math.round(listPrice * (1 - pct / 100)), { shouldDirty: true, shouldValidate: true })}
                  >
                    −{pct}%
                  </Button>
                ))}
              </>
            )}
            {priced && saving < 0 && <span className="w-full text-danger-600">The package costs more than the services bought separately.</span>}
            {mixedPricing && <span className="w-full">Mixes fixed, monthly and hourly services; the list price adds one unit of each price as listed.</span>}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
