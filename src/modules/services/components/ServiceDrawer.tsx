import { useEffect, useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { servicePath } from '@/app/paths'
import { PRICING_TYPES, type ServiceRow } from '@/modules/services/types'
import { serviceSchema, type ServiceValues } from '@/modules/services/schemas'
import { useCreateService, useUpdateService } from '@/modules/services/hooks/useServices'
import { useLookups } from '@/shared/hooks/useLookups'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, Switch, TextArea, TextInput } from '@/shared/components/form/Field'
import { IndustryPicker } from '@/modules/services/components/IndustryPicker'

interface ServiceDrawerProps {
  open: boolean
  onClose: () => void
  /** Edit this service; omit to create one. */
  service?: ServiceRow | null
  /** After creating, open the new service's page. */
  openAfterCreate?: boolean
}

const EMPTY: ServiceValues = {
  name: '',
  category: '',
  description: '',
  industries: [],
  pricingType: 'Fixed',
  price: '' as unknown as number,
  currency: 'AED',
  deliveryDays: '' as unknown as number,
  active: true,
}

const PRICE_LABEL = { Fixed: 'Price', Monthly: 'Price per month', Hourly: 'Price per hour' } as const

/** New / edit service: name, category, industries, pricing, delivery time, description. */
export function ServiceDrawer({ open, onClose, service, openAfterCreate }: ServiceDrawerProps) {
  const editing = !!service
  const lookups = useLookups()
  const create = useCreateService()
  const update = useUpdateService()
  const toast = useToast()
  const navigate = useNavigate()
  const industriesLabel = useId()

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<ServiceValues>({ resolver: zodResolver(serviceSchema), mode: 'onTouched', defaultValues: EMPTY })

  useEffect(() => {
    if (!open) return
    reset(
      service
        ? {
            name: service.name,
            category: service.category,
            description: service.description,
            industries: service.industries,
            pricingType: service.pricingType,
            price: service.price,
            currency: service.currency,
            deliveryDays: service.deliveryDays,
            active: service.active,
          }
        : EMPTY,
    )
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service])

  const pricingType = watch('pricingType')
  const description = watch('description') ?? ''
  // An inactive category stays selectable on the record that already has it.
  const categories = lookups.serviceCategories.some((c) => c.key === service?.category) || !service
    ? lookups.serviceCategories
    : [...lookups.serviceCategories, { key: service.category, label: `${lookups.serviceCategoryLabel(service.category)} (inactive)` }]

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  function close() {
    if (isDirty && !pending && !window.confirm('Discard your changes to this service?')) return
    onClose()
  }

  const onSubmit = handleSubmit((v) => {
    const input = {
      name: v.name,
      category: v.category,
      description: v.description,
      industries: v.industries,
      pricingType: v.pricingType,
      price: v.price,
      currency: v.currency,
      deliveryDays: v.deliveryDays,
    }
    if (service) {
      update.mutate(
        { id: service.id, input },
        {
          onSuccess: (row) => {
            toast.success('Service saved', row.name)
            onClose()
          },
        },
      )
      return
    }
    create.mutate(
      { ...input, active: v.active },
      {
        onSuccess: (row) => {
          toast.success('Service created', row.name)
          onClose()
          if (openAfterCreate) navigate(servicePath(row.id))
        },
      },
    )
  })

  return (
    <Drawer
      open={open}
      onClose={close}
      width="lg"
      title={editing ? 'Edit service' : 'New service'}
      description={service ? `${service.id} · ${service.name}` : 'Add a service to the catalog quotations are built from.'}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="service-form" loading={pending}>
            {editing ? 'Save service' : 'Create service'}
          </Button>
        </>
      }
    >
      <form id="service-form" noValidate onSubmit={onSubmit} className="space-y-5">
        <Field id="sv-name" label="Name" required error={errors.name?.message}>
          <TextInput id="sv-name" placeholder="e.g. WhatsApp AI chatbot" maxLength={120} invalid={!!errors.name} {...register('name')} />
        </Field>

        <Field
          id="sv-category"
          label="Category"
          required
          error={errors.category?.message}
          hint={lookups.serviceCategories.length === 0 && !lookups.isLoading ? 'Add categories in Settings → Fixed lists.' : undefined}
        >
          <SelectInput id="sv-category" invalid={!!errors.category} disabled={lookups.isLoading} {...register('category')}>
            <option value="">{lookups.isLoading ? 'Loading…' : 'Choose a category…'}</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </SelectInput>
        </Field>

        <div>
          <p className="mb-1.5 block text-[0.8125rem] font-medium text-ink-2">
            Pricing type<span className="ms-0.5 text-danger-600" aria-hidden>*</span>
          </p>
          <Controller
            control={control}
            name="pricingType"
            render={({ field }) => (
              <Segmented
                label="Pricing type"
                size="sm"
                value={field.value}
                onChange={field.onChange}
                options={PRICING_TYPES.map((t) => ({ value: t, label: t }))}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field id="sv-price" label={PRICE_LABEL[pricingType ?? 'Fixed']} required error={errors.price?.message}>
            <TextInput id="sv-price" type="number" inputMode="decimal" min={0} step="any" invalid={!!errors.price} {...register('price')} />
          </Field>
          <Field id="sv-currency" label="Currency" required error={errors.currency?.message}>
            <TextInput id="sv-currency" maxLength={3} className="uppercase" invalid={!!errors.currency} {...register('currency')} />
          </Field>
        </div>

        <Field
          id="sv-days"
          label="Delivery time (working days)"
          required
          error={errors.deliveryDays?.message}
          hint={pricingType === 'Monthly' ? 'Setup time for a recurring service; 0 if it starts straight away.' : 'Typical time from kickoff to handover.'}
        >
          <TextInput id="sv-days" type="number" inputMode="numeric" min={0} max={730} step={1} invalid={!!errors.deliveryDays} {...register('deliveryDays')} />
        </Field>

        <div>
          <p id={industriesLabel} className="mb-1.5 block text-[0.8125rem] font-medium text-ink-2">
            Suitable industries
          </p>
          <Controller
            control={control}
            name="industries"
            render={({ field }) => <IndustryPicker value={field.value ?? []} onChange={field.onChange} onBlur={field.onBlur} labelledBy={industriesLabel} />}
          />
          <p className="mt-1.5 text-xs text-muted">Used to filter the catalog and for AI service suggestions on leads.</p>
        </div>

        <Field id="sv-description" label="Description" error={errors.description?.message} hint={`${description.length} / 2000`}>
          <TextArea id="sv-description" rows={4} maxLength={2000} placeholder="What the customer gets, in a sentence or two." invalid={!!errors.description} {...register('description')} />
        </Field>

        {!editing && (
          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5">
                <div>
                  <p className="text-[0.8125rem] font-medium text-ink">Active</p>
                  <p className="text-xs text-muted">Inactive services can’t be picked on new leads or quotations.</p>
                </div>
                <Switch checked={field.value} onChange={field.onChange} label="Active" />
              </div>
            )}
          />
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
