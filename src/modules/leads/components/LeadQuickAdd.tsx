import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { leadPath, PATHS } from '@/app/paths'
import { scopeOf } from '@/shared/lib/permissions'
import { useAppDispatch, useCurrentUser } from '@/store/hooks'
import { lastSourceUsed } from '@/store/prefsSlice'
import { useLastSource } from '@/modules/leads/lastSource'
import { useLookups } from '@/shared/hooks/useLookups'
import type { QuickAddInput } from '@/modules/leads/types'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { quickAddSchema, type QuickAddValues } from '@/modules/leads/schemas'
import { useCreateLead, useDuplicateCheck } from '@/modules/leads/hooks/useLeads'
import { useRegion } from '@/modules/tenancy/hooks'
import { mobileExample, mobileSample } from '@/shared/lib/phone'

const DEFAULTS: QuickAddValues = {
  company: '',
  contactName: '',
  mobile: '',
  email: '',
  sourceType: '',
  industry: '',
}

export function LeadQuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const region = useRegion()
  const navigate = useNavigate()
  const create = useCreateLead()
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'sales') : 'hidden'
  const isManager = scope === 'full' || scope === 'team'
  const [override, setOverride] = useState(false)
  // Pickers and validation read the live lookups (active items only; no free typing).
  const lookups = useLookups()
  const lookupsRef = useRef(lookups)
  lookupsRef.current = lookups
  const resolver: Resolver<QuickAddValues> = (values, ctx, opts) => zodResolver(quickAddSchema(lookupsRef.current))(values, ctx, opts)
  const {
    register,
    handleSubmit,
    watch,
    reset,
    resetField,
    formState: { errors },
  } = useForm<QuickAddValues>({ resolver, defaultValues: DEFAULTS, mode: 'onTouched' })

  const duplicates = useDuplicateCheck(watch('company'), watch('email'))
  const matches = duplicates.data ?? []

  // Source stays required, but starts on the agent's last used source (if still active) for fast entry.
  const dispatch = useAppDispatch()
  const lastSource = useLastSource()
  const sourcePicked = useRef(false)
  useEffect(() => {
    if (open && !sourcePicked.current) resetField('sourceType', { defaultValue: lastSource })
  }, [open, lastSource, resetField])

  function close() {
    reset(DEFAULTS)
    sourcePicked.current = false
    setOverride(false)
    create.reset()
    onClose()
  }

  const onSubmit = handleSubmit((values) => {
    const input: QuickAddInput = {
      company: values.company ?? '',
      contactName: values.contactName ?? '',
      mobile: values.mobile ?? '',
      email: values.email ?? '',
      sourceType: values.sourceType,
      industry: values.industry ?? '',
      force: matches.length > 0 && isManager && override,
    }
    create.mutate(input, {
      onSuccess: (lead) => {
        if (user) dispatch(lastSourceUsed({ userId: user.id, source: values.sourceType }))
        close()
        navigate(leadPath(lead.id))
      },
    })
  })

  return (
    <Modal
      open={open}
      onClose={close}
      title="Quick add lead"
      description={`The lead starts as ${lookups.openStatuses[0]?.label ?? 'New'} and is assigned automatically. Add details on its page.`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="quick-add-form"
            loading={create.isPending}
            disabled={lookups.isLoading || (matches.length > 0 && !(isManager && override))}
          >
            {matches.length > 0 && override ? 'Add anyway' : 'Add lead'}
          </Button>
        </>
      }
    >
      <form id="quick-add-form" noValidate onSubmit={onSubmit} className="space-y-4">
        <div className="-mt-1 flex justify-end">
          <Link
            to={PATHS.leadNew}
            onClick={close}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            Open full form
            <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
        <Field id="qa-company" label="Company" required error={errors.company?.message}>
          <TextInput
            id="qa-company"
            autoComplete="organization"
            placeholder="e.g. Al Noor Medical Centre"
            invalid={!!errors.company}
            aria-describedby={errors.company ? 'qa-company-error' : undefined}
            {...register('company')}
          />
        </Field>

        {matches.length > 0 && (
          <div role="status" className="rounded-xl border border-warning-500/40 bg-warning-50 p-3.5 text-sm dark:bg-warning-700/15">
            <p className="flex items-center gap-2 font-medium text-warning-700 dark:text-warning-500">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              Possible duplicate
            </p>
            <ul className="mt-2 space-y-2">
              {matches.slice(0, 3).map((m) => (
                <li key={m.leadId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    to={leadPath(m.leadId)}
                    onClick={close}
                    className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                  >
                    {m.company}
                  </Link>
                  <StatusBadge status={m.status} />
                  <span className="text-muted">
                    {m.ownerName} · same {m.reason === 'company' ? 'company name' : m.reason === 'domain' ? 'domain' : 'email'}
                  </span>
                </li>
              ))}
            </ul>
            {isManager ? (
              <label className="mt-3 flex items-center gap-2 text-ink-2">
                <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} />
                I’ve checked — add it anyway <span className="text-muted">(managers only)</span>
              </label>
            ) : (
              <p className="mt-2 text-muted">Duplicates are blocked. Open the existing lead, or ask your manager.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="qa-contact" label="Contact name" error={errors.contactName?.message}>
            <TextInput id="qa-contact" autoComplete="name" invalid={!!errors.contactName} {...register('contactName')} />
          </Field>
          <Field id="qa-mobile" label="Mobile" error={errors.mobile?.message} hint={mobileExample(region.country)}>
            <TextInput
              id="qa-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={mobileSample(region.country)}
              invalid={!!errors.mobile}
              aria-describedby={errors.mobile ? 'qa-mobile-error' : 'qa-mobile-hint'}
              {...register('mobile')}
            />
          </Field>
        </div>

        <Field id="qa-email" label="Email" error={errors.email?.message}>
          <TextInput
            id="qa-email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            invalid={!!errors.email}
            aria-describedby={errors.email ? 'qa-email-error' : undefined}
            {...register('email')}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="qa-source" label="Source" required error={errors.sourceType?.message}>
            <SelectInput
              id="qa-source"
              invalid={!!errors.sourceType}
              aria-busy={lookups.isLoading || undefined}
              aria-describedby={errors.sourceType ? 'qa-source-error' : undefined}
              {...register('sourceType', { onChange: () => (sourcePicked.current = true) })}
            >
              <option value="">{lookups.isLoading ? 'Loading…' : 'Choose…'}</option>
              {lookups.sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="qa-industry" label="Industry" required error={errors.industry?.message}>
            <SelectInput
              id="qa-industry"
              invalid={!!errors.industry}
              aria-describedby={errors.industry ? 'qa-industry-error' : undefined}
              {...register('industry')}
            >
              <option value="">{lookups.isLoading ? 'Loading…' : 'Choose…'}</option>
              {lookups.industries.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        {create.isError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {create.error.message}
          </p>
        )}
      </form>
    </Modal>
  )
}
