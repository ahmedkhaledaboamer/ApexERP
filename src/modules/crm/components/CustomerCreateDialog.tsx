import { useEffect, useId } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { customerPath } from '@/app/paths'
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABEL, EMIRATES } from '@/modules/crm/constants'
import { customerCreateSchema, type CustomerCreateValues } from '@/modules/crm/schemas'
import { useCreateCustomer } from '@/modules/crm/hooks/useCrm'
import { useOwnerOptions } from '@/modules/crm/components/useOwnerOptions'
import { useRegion } from '@/modules/tenancy/hooks'
import { useLookups } from '@/shared/hooks/useLookups'
import { MOBILE_RULES } from '@/shared/lib/phone'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

/**
 * New customer (POST /customers): an existing client added directly, without the pipeline. Usually a
 * customer comes from a won lead (Won flow); this is for clients the company already works with.
 * Opens from the Customers page and the "+ New" menu (`/crm/customers?new=1`); on save it opens the profile.
 */
export function CustomerCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId()
  const user = useCurrentUser()
  const region = useRegion()
  const lookups = useLookups()
  const owners = useOwnerOptions()
  const create = useCreateCustomer()
  const toast = useToast()
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CustomerCreateValues>({ resolver: zodResolver(customerCreateSchema), mode: 'onTouched' })

  useEffect(() => {
    if (!open) return
    reset({
      name: '',
      industry: '',
      subIndustry: '',
      sourceType: '',
      status: 'active',
      website: '',
      address: '',
      emirate: '',
      ownerId: user?.id ?? '',
      contactName: '',
      contactTitle: '',
      contactMobile: '',
      contactEmail: '',
    })
    create.reset()
    // After the dialog focused its panel (a child effect runs first): start in the name.
    document.getElementById(`${id}-name`)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const industry = watch('industry')
  const subIndustries = industry ? lookups.subIndustriesOf(industry) : []
  const ownerChoices = owners.options.some((u) => u.id === user?.id) || !user ? owners.options : [user, ...owners.options]

  const onSubmit = handleSubmit((v) => {
    const hasContact = !!(v.contactName || v.contactMobile || v.contactEmail)
    create.mutate(
      {
        name: v.name,
        industry: v.industry,
        subIndustry: v.subIndustry || undefined,
        sourceType: v.sourceType,
        status: v.status,
        website: v.website,
        address: v.address,
        emirate: region.country === 'AE' ? v.emirate : '',
        ownerId: v.ownerId,
        contact: hasContact ? { name: v.contactName, title: v.contactTitle, mobile: v.contactMobile, email: v.contactEmail } : null,
      },
      {
        onSuccess: (row) => {
          toast.success('Customer added', row.name)
          onClose()
          navigate(customerPath(row.id))
        },
      },
    )
  })

  return (
    <Drawer
      variant="dialog"
      open={open}
      onClose={onClose}
      width="lg"
      title="New customer"
      description="An existing client you already work with. New prospects start as leads and become customers when won."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form={`${id}-form`} loading={create.isPending}>
            Add customer
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={onSubmit} className="space-y-5" aria-label="New customer">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={`${id}-name`} label="Company name" required error={errors.name?.message} className="sm:col-span-2">
            <TextInput id={`${id}-name`} autoComplete="organization" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field id={`${id}-industry`} label="Industry" required error={errors.industry?.message}>
            <SelectInput
              id={`${id}-industry`}
              invalid={!!errors.industry}
              {...register('industry', { onChange: () => setValue('subIndustry', '') })}
            >
              <option value="">{lookups.isLoading ? 'Loading…' : 'Choose…'}</option>
              {lookups.industries.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id={`${id}-sub`} label="Sub-industry">
            <SelectInput id={`${id}-sub`} disabled={subIndustries.length === 0} {...register('subIndustry')}>
              <option value="">{subIndustries.length ? 'Optional' : '—'}</option>
              {subIndustries.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id={`${id}-source`} label="Source" required error={errors.sourceType?.message}>
            <SelectInput id={`${id}-source`} invalid={!!errors.sourceType} {...register('sourceType')}>
              <option value="">{lookups.isLoading ? 'Loading…' : 'Choose…'}</option>
              {lookups.sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id={`${id}-status`} label="Status">
            <SelectInput id={`${id}-status`} {...register('status')}>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CUSTOMER_STATUS_LABEL[s]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id={`${id}-website`} label="Website" error={errors.website?.message}>
            <TextInput id={`${id}-website`} type="url" inputMode="url" placeholder="company.com" invalid={!!errors.website} {...register('website')} />
          </Field>
          <Field
            id={`${id}-owner`}
            label="Account owner"
            error={errors.ownerId?.message}
            hint={owners.canReassign ? undefined : 'You’ll own this customer.'}
          >
            <SelectInput id={`${id}-owner`} disabled={!owners.canReassign || owners.loading} invalid={!!errors.ownerId} {...register('ownerId')}>
              {ownerChoices.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === user?.id ? `Me (${u.name})` : u.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          {region.country === 'AE' && (
            <Field id={`${id}-emirate`} label="Emirate" error={errors.emirate?.message}>
              <SelectInput id={`${id}-emirate`} invalid={!!errors.emirate} {...register('emirate')}>
                <option value="">Not set</option>
                {EMIRATES.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
          <Field id={`${id}-address`} label="Address" error={errors.address?.message} className="sm:col-span-2">
            <TextArea id={`${id}-address`} className="min-h-16" placeholder="Office, building, street, area" invalid={!!errors.address} {...register('address')} />
          </Field>
        </div>

        <fieldset className="space-y-4 border-t border-line pt-4">
          <legend className="sr-only">Primary contact</legend>
          <div>
            <p className="text-[0.8125rem] font-medium text-ink-2">Primary contact</p>
            <p className="text-xs text-muted">Optional. More contacts can be added from the customer’s profile.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={`${id}-cname`} label="Contact name" error={errors.contactName?.message}>
              <TextInput id={`${id}-cname`} autoComplete="name" invalid={!!errors.contactName} {...register('contactName')} />
            </Field>
            <Field id={`${id}-ctitle`} label="Job title" error={errors.contactTitle?.message}>
              <TextInput id={`${id}-ctitle`} autoComplete="organization-title" invalid={!!errors.contactTitle} {...register('contactTitle')} />
            </Field>
            <Field id={`${id}-cmobile`} label="Mobile" error={errors.contactMobile?.message} hint={MOBILE_RULES[region.country].example}>
              <TextInput id={`${id}-cmobile`} type="tel" inputMode="tel" autoComplete="tel" invalid={!!errors.contactMobile} {...register('contactMobile')} />
            </Field>
            <Field id={`${id}-cemail`} label="Email" error={errors.contactEmail?.message}>
              <TextInput id={`${id}-cemail`} type="email" inputMode="email" autoComplete="email" invalid={!!errors.contactEmail} {...register('contactEmail')} />
            </Field>
          </div>
        </fieldset>

        {create.isError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {create.error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
