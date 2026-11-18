import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { CustomerRow } from '@/modules/crm/types'
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_TONE, EMIRATES } from '@/modules/crm/constants'
import { customerSchema, type CustomerValues } from '@/modules/crm/schemas'
import { useUpdateCustomer } from '@/modules/crm/hooks/useCrm'
import { useOwnerOptions } from '@/modules/crm/components/useOwnerOptions'
import { cn } from '@/shared/lib/utils'
import { DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useRegion } from '@/modules/tenancy/hooks'

const STATUS_HINT = {
  Active: 'Normal account',
  VIP: 'Priority service',
  Paused: 'On hold',
} as const

/** Edits status and company details. Name, industry and value came from the lead. */
export function CustomerEditDrawer({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: CustomerRow }) {
  const region = useRegion()
  const update = useUpdateCustomer()
  const toast = useToast()
  const owners = useOwnerOptions()
  const ownerChoices = owners.options.some((u) => u.id === customer.ownerId)
    ? owners.options
    : [{ id: customer.ownerId, name: customer.ownerName }, ...owners.options]

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CustomerValues>({ resolver: zodResolver(customerSchema), mode: 'onTouched' })

  useEffect(() => {
    if (!open) return
    reset({
      status: customer.status,
      website: customer.website,
      address: customer.address,
      emirate: customer.emirate,
      ownerId: customer.ownerId,
    })
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer])

  const status = watch('status')

  const onSubmit = handleSubmit((v) => {
    update.mutate(
      { id: customer.id, input: v },
      {
        onSuccess: () => {
          toast.success('Customer updated', customer.name)
          onClose()
        },
      },
    )
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Edit customer"
      description={customer.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="customer-form" loading={update.isPending} disabled={!isDirty}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="customer-form" noValidate onSubmit={onSubmit} className="space-y-5">
        <fieldset>
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Status</legend>
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
            {CUSTOMER_STATUSES.map((s) => {
              const on = status === s
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setValue('status', s, { shouldDirty: true })}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-start transition-colors',
                    on ? 'border-brand-500 bg-brand-50/60 shadow-[var(--shadow-focus)] dark:bg-brand-500/10' : 'border-line-strong hover:bg-hover',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
                    <span className={cn('size-2 rounded-full', DOT[CUSTOMER_STATUS_TONE[s]])} aria-hidden />
                    {s}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{STATUS_HINT[s]}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <Field id="cu-website" label="Website" error={errors.website?.message}>
          <TextInput id="cu-website" type="url" inputMode="url" placeholder="https://company.com" invalid={!!errors.website} {...register('website')} />
        </Field>

        {/* Emirates only apply to UAE workspaces (or a customer that already has one). */}
        {(region.country === 'AE' || !!customer.emirate) && (
          <Field id="cu-emirate" label="Emirate" error={errors.emirate?.message}>
            <SelectInput id="cu-emirate" invalid={!!errors.emirate} {...register('emirate')}>
              <option value="">Not set</option>
              {EMIRATES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}

        <Field id="cu-address" label="Address" error={errors.address?.message}>
          <TextArea id="cu-address" className="min-h-20" placeholder="Office, building, street, area" invalid={!!errors.address} {...register('address')} />
        </Field>

        <Field
          id="cu-owner"
          label="Account owner"
          error={errors.ownerId?.message}
          hint={owners.canReassign ? undefined : 'Only managers can reassign customers.'}
        >
          <SelectInput id="cu-owner" disabled={!owners.canReassign || owners.loading} invalid={!!errors.ownerId} {...register('ownerId')}>
            {ownerChoices.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        {update.isError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {update.error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
