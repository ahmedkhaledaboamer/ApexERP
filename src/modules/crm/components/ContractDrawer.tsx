import { useEffect, useMemo } from 'react'
import { useAutomationRules } from '@/shared/hooks/useAutomationRules'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { addMonths, addYears, format, parseISO } from 'date-fns'
import type { ContractBilling, ContractRow } from '@/modules/crm/types'
import { BILLINGS } from '@/modules/crm/constants'
import { contractSchema, type ContractValues } from '@/modules/crm/schemas'
import { useCreateContract, useCustomersQuery, useUpdateContract } from '@/modules/crm/hooks/useCrm'
import { useServicesQuery } from '@/modules/services/hooks/useServices'
import type { Service } from '@/modules/services/types'
import { CategoryIcon } from '@/modules/leads/components/ServiceFields'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn, fmtMoney } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useRegion } from '@/modules/tenancy/hooks'

interface ContractDrawerProps {
  open: boolean
  onClose: () => void
  /** Edit this contract; omit to create one. */
  contract?: ContractRow | null
  /** Pin the customer (e.g. on the customer profile). */
  customer?: { id: string; name: string }
}

const day = (d: Date) => format(d, 'yyyy-MM-dd')

/** Next renewal for a start date: a month for monthly billing, a year otherwise. */
function defaultRenewal(start: string, billing: ContractBilling): string {
  if (!start) return ''
  const d = parseISO(start)
  return day(billing === 'Monthly' ? addMonths(d, 1) : addYears(d, 1))
}

/** Catalog total for the picked services, matched to the billing cycle. */
function catalogTotal(picked: Service[], billing: ContractBilling): number {
  return picked.reduce((sum, s) => {
    if (billing === 'Monthly') return sum + (s.pricingType === 'Monthly' ? s.price : 0)
    if (billing === 'Annual') return sum + (s.pricingType === 'Monthly' ? s.price * 12 : 0)
    return sum + (s.pricingType === 'Fixed' ? s.price : 0)
  }, 0)
}

/** New or edited contract: customer, catalog services, value, billing and renewal date. */
export function ContractDrawer({ open, onClose, contract, customer }: ContractDrawerProps) {
  const region = useRegion()
  const { rules } = useAutomationRules()
  const editing = !!contract
  const create = useCreateContract()
  const update = useUpdateContract()
  const toast = useToast()
  const services = useServicesQuery()
  const customers = useCustomersQuery()
  const lookups = useLookups()

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<ContractValues>({ resolver: zodResolver(contractSchema), mode: 'onTouched' })

  useEffect(() => {
    if (!open) return
    const today = day(new Date())
    reset(
      contract
        ? {
            customerId: contract.customerId,
            title: contract.title,
            serviceIds: contract.serviceIds,
            value: contract.value,
            billing: contract.billing,
            startDate: day(parseISO(contract.startDate)),
            renewalDate: day(parseISO(contract.renewalDate)),
          }
        : {
            customerId: customer?.id ?? '',
            title: '',
            serviceIds: [],
            value: '' as unknown as number,
            billing: 'One-off',
            startDate: today,
            renewalDate: defaultRenewal(today, 'One-off'),
          },
    )
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract, customer?.id])

  // Keep the renewal date in step with start and billing until someone sets it by hand.
  const startDate = watch('startDate')
  const billing = watch('billing')
  const renewalTouched = !!dirtyFields.renewalDate
  useEffect(() => {
    if (!open || editing || renewalTouched) return
    setValue('renewalDate', defaultRenewal(startDate, billing))
  }, [open, editing, renewalTouched, startDate, billing, setValue])

  // New picks come from ACTIVE services only; services already on the contract stay listed.
  const catalog = useMemo(() => (services.data ?? []).filter((s) => s.active || contract?.serviceIds.includes(s.id)), [services.data, contract])
  const pickedIds = watch('serviceIds') ?? []
  const picked = catalog.filter((s) => pickedIds.includes(s.id))
  const suggested = catalogTotal(picked, billing ?? 'One-off')

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const onSubmit = handleSubmit((v) => {
    if (contract) {
      const input = { title: v.title, serviceIds: v.serviceIds, value: v.value, billing: v.billing, startDate: v.startDate, renewalDate: v.renewalDate }
      update.mutate(
        { id: contract.id, input },
        {
          onSuccess: () => {
            toast.success('Contract saved', v.title)
            onClose()
          },
        },
      )
      return
    }
    create.mutate(v, {
      onSuccess: (row) => {
        toast.success('Contract created', `${row.title} · ${row.customerName}`)
        onClose()
      },
    })
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={editing ? 'Edit contract' : 'New contract'}
      description={contract ? `${contract.id} · ${contract.customerName}` : customer?.name ?? 'Record what the customer signed and when it renews.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="contract-form" loading={pending}>
            {editing ? 'Save contract' : 'Create contract'}
          </Button>
        </>
      }
    >
      <form id="contract-form" noValidate onSubmit={onSubmit} className="space-y-5">
        {!editing && !customer && (
          <Field id="co-customer" label="Customer" required error={errors.customerId?.message}>
            <SelectInput id="co-customer" disabled={customers.isPending} invalid={!!errors.customerId} {...register('customerId')}>
              <option value="">{customers.isPending ? 'Loading customers…' : 'Choose a customer…'}</option>
              {[...(customers.data ?? [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </SelectInput>
          </Field>
        )}

        <Field id="co-title" label="Title" required error={errors.title?.message}>
          <TextInput id="co-title" placeholder="e.g. Chatbot rollout & hosting" invalid={!!errors.title} {...register('title')} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">
            Services<span className="ms-0.5 text-danger-600" aria-hidden>*</span>
          </legend>
          {services.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : services.isError ? (
            <p className="text-[0.8125rem] text-danger-600">
              Couldn’t load the service catalog.{' '}
              <button type="button" className="underline" onClick={() => services.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <Controller
              control={control}
              name="serviceIds"
              render={({ field }) => (
                <ul className={cn('divide-y divide-line overflow-hidden rounded-lg border', errors.serviceIds ? 'border-danger-500' : 'border-line-strong')}>
                  {catalog.map((s) => {
                    const on = field.value?.includes(s.id) ?? false
                    return (
                      <li key={s.id}>
                        <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-hover/60', on && 'bg-brand-50/50 dark:bg-brand-500/10')}>
                          <Checkbox
                            checked={on}
                            onBlur={field.onBlur}
                            onChange={() =>
                              field.onChange(on ? field.value.filter((id) => id !== s.id) : [...(field.value ?? []), s.id])
                            }
                          />
                          <CategoryIcon category={s.category} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.8125rem] font-medium">{s.name}</span>
                            <span className="block text-xs text-muted">
                              {lookups.serviceCategoryLabel(s.category)}
                              {!s.active && ' · inactive (kept on this contract)'}
                            </span>
                          </span>

                          <span className="num shrink-0 text-xs text-ink-2">
                            {fmtMoney(s.price)}
                            {s.pricingType === 'Monthly' ? '/mo' : s.pricingType === 'Hourly' ? '/hr' : ''}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            />
          )}
          {errors.serviceIds && <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">{errors.serviceIds.message}</p>}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="co-billing" label="Billing" required error={errors.billing?.message}>
            <SelectInput id="co-billing" invalid={!!errors.billing} {...register('billing')}>
              {BILLINGS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field
            id="co-value"
            label={`${billing === 'Monthly' ? 'Value per month' : billing === 'Annual' ? 'Value per year' : 'Value'} (${region.currency})`}
            required
            error={errors.value?.message}
          >
            <TextInput id="co-value" type="number" inputMode="decimal" min={0} step={100} invalid={!!errors.value} {...register('value')} />
          </Field>
        </div>
        {suggested > 0 && (
          <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="brand">Catalog</Badge>
            <span className="num">
              {fmtMoney(suggested)} for the picked services{billing === 'Monthly' ? ' per month' : billing === 'Annual' ? ' per year' : ''}
            </span>
            <Button variant="ghost" size="xs" onClick={() => setValue('value', suggested, { shouldDirty: true, shouldValidate: true })}>
              Use this
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="co-start" label="Start date" required error={errors.startDate?.message}>
            <TextInput id="co-start" type="date" invalid={!!errors.startDate} {...register('startDate')} />
          </Field>
          <Field id="co-renewal" label="Renewal date" required error={errors.renewalDate?.message} hint={`You’ll be alerted ${rules.renewalAlertDays} days before.`}>
            <TextInput id="co-renewal" type="date" invalid={!!errors.renewalDate} {...register('renewalDate')} />
          </Field>
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
