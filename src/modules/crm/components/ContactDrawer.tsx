import { forwardRef, useEffect, useMemo, type ComponentPropsWithoutRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Contact } from '@/shared/types'
import type { ContactRecordType } from '@/modules/crm/types'
import { contactSchema, type ContactValues } from '@/modules/crm/schemas'
import { useCreateContact, useCustomersQuery, useUpdateContact } from '@/modules/crm/hooks/useCrm'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'

interface ContactDrawerProps {
  open: boolean
  onClose: () => void
  /** Edit this contact; omit to add a new one. */
  contact?: Contact | null
  /** Pin the new contact to one record (e.g. on the customer profile). */
  record?: { type: ContactRecordType; id: string; name: string }
}

const EMPTY: ContactValues = { record: '', name: '', title: '', mobile: '', email: '', isDecisionMaker: false }

/** Add or edit a contact on a lead or a customer. Mobile must be UAE format; email must be valid. */
export function ContactDrawer({ open, onClose, contact, record }: ContactDrawerProps) {
  const editing = !!contact
  const create = useCreateContact()
  const update = useUpdateContact()
  const toast = useToast()
  const pinned = record ? `${record.type}:${record.id}` : ''

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactValues>({ resolver: zodResolver(contactSchema), defaultValues: EMPTY, mode: 'onTouched' })

  useEffect(() => {
    if (!open) return
    reset(
      contact
        ? { record: 'existing', name: contact.name, title: contact.title, mobile: contact.mobile, email: contact.email, isDecisionMaker: contact.isDecisionMaker }
        : { ...EMPTY, record: pinned },
    )
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact, pinned])

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const onSubmit = handleSubmit((v) => {
    const fields = { name: v.name, title: v.title, mobile: v.mobile, email: v.email, isDecisionMaker: v.isDecisionMaker }
    if (contact) {
      update.mutate(
        { id: contact.id, input: fields },
        {
          onSuccess: () => {
            toast.success('Contact saved', v.name)
            onClose()
          },
        },
      )
      return
    }
    const [type, id] = v.record.split(':') as [ContactRecordType, string]
    create.mutate(
      { recordType: type, recordId: id, ...fields },
      {
        onSuccess: (row) => {
          toast.success('Contact added', `${row.name} · ${row.company}`)
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
      title={editing ? 'Edit contact' : 'Add contact'}
      description={record ? record.name : editing ? undefined : 'Link the person to a lead or a customer.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="contact-form" loading={pending}>
            {editing ? 'Save contact' : 'Add contact'}
          </Button>
        </>
      }
    >
      <form id="contact-form" noValidate onSubmit={onSubmit} className="space-y-4">
        {!editing && !record && (
          <Field id="ct-record" label="Company" required error={errors.record?.message}>
            <RecordSelect invalid={!!errors.record} {...register('record')} />
          </Field>
        )}
        <Field id="ct-name" label="Full name" required error={errors.name?.message}>
          <TextInput id="ct-name" autoComplete="name" invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field id="ct-title" label="Job title" error={errors.title?.message}>
          <TextInput id="ct-title" placeholder="e.g. Operations Director" invalid={!!errors.title} {...register('title')} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ct-mobile" label="Mobile" error={errors.mobile?.message} hint="+971 5X XXX XXXX">
            <TextInput
              id="ct-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+971 50 123 4567"
              invalid={!!errors.mobile}
              aria-describedby={errors.mobile ? 'ct-mobile-error' : 'ct-mobile-hint'}
              {...register('mobile')}
            />
          </Field>
          <Field id="ct-email" label="Email" error={errors.email?.message}>
            <TextInput
              id="ct-email"
              type="email"
              autoComplete="email"
              placeholder="name@company.ae"
              invalid={!!errors.email}
              aria-describedby={errors.email ? 'ct-email-error' : undefined}
              {...register('email')}
            />
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-hover/60">
          <Checkbox className="mt-0.5" {...register('isDecisionMaker')} />
          <span>
            <span className="block text-[0.8125rem] font-medium">Decision maker</span>
            <span className="block text-xs text-muted">Signs off budgets or contracts for this company.</span>
          </span>
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}

/** Customers first, then open leads; values are "Customer:<id>" or "Lead:<id>". */
const RecordSelect = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<typeof SelectInput>>(function RecordSelect(props, ref) {
  const customers = useCustomersQuery()
  const leads = useLeadsQuery()
  const openLeads = useMemo(
    () => (leads.data ?? []).filter((l) => !l.customerId).sort((a, b) => a.company.localeCompare(b.company)),
    [leads.data],
  )
  const custs = useMemo(() => [...(customers.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [customers.data])
  const loading = customers.isPending || leads.isPending

  return (
    <SelectInput ref={ref} id="ct-record" disabled={loading} {...props}>
      <option value="">{loading ? 'Loading companies…' : 'Choose a customer or lead…'}</option>
      {custs.length > 0 && (
        <optgroup label="Customers">
          {custs.map((c) => (
            <option key={c.id} value={`Customer:${c.id}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
      {openLeads.length > 0 && (
        <optgroup label="Leads">
          {openLeads.map((l) => (
            <option key={l.id} value={`Lead:${l.id}`}>
              {l.company}
            </option>
          ))}
        </optgroup>
      )}
    </SelectInput>
  )
})
