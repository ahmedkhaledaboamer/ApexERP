import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Handshake } from 'lucide-react'
import type { ContactSalesInput } from '@/modules/signup/types'
import type { CountryCode } from '@/modules/tenancy/types'
import { useContactSales } from '@/modules/signup/api'
import { COUNTRY_CODES, COUNTRY_NAMES } from '@/modules/tenancy/regionDefaults'
import { PATHS } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { ErrorAlert, StepHeading } from '@/modules/signup/components/SignupParts'

type Values = Required<ContactSalesInput>
type Errors = Partial<Record<keyof Values, string>>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Enterprise: a request for sales to get in touch. No workspace is created. */
export function ContactSalesStep({ initial, onBack }: { initial: ContactSalesInput; onBack?: () => void }) {
  const [values, setValues] = useState<Values>({ message: '', ...initial } as Values)
  const [errors, setErrors] = useState<Errors>({})
  const send = useContactSales()

  function change<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found: Errors = {}
    if (values.companyName.trim().length < 2) found.companyName = 'Enter your company name.'
    if (values.name.trim().length < 2) found.name = 'Enter your name.'
    if (!EMAIL.test(values.email.trim())) found.email = 'Enter a valid work email.'
    setErrors(found)
    if (Object.keys(found).length) return
    send.mutate({
      companyName: values.companyName.trim(),
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      country: values.country,
      message: values.message.trim() || undefined,
    })
  }

  if (send.isSuccess) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
          <Handshake className="size-6" aria-hidden />
        </span>
        <StepHeading
          title="Thanks, we’ll be in touch"
          description={
            <>
              {send.data?.message || (
                <>
                  Our sales team will email <span className="font-medium text-ink">{values.email}</span> within one business day to plan
                  your Enterprise workspace.
                </>
              )}{' '}
              No workspace has been created yet.
            </>
          }
        />
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {onBack && (
            <Button variant="secondary" onClick={onBack}>
              See other plans
            </Button>
          )}
          <Link
            to={PATHS.login}
            className="inline-flex h-9 items-center rounded-lg px-3.5 text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  const text = (key: 'companyName' | 'name' | 'email', label: string, type = 'text', autoComplete?: string) => (
    <Field id={`cs-${key}`} label={label} error={errors[key]} required>
      <TextInput
        id={`cs-${key}`}
        type={type}
        autoComplete={autoComplete}
        value={values[key]}
        invalid={!!errors[key]}
        aria-describedby={errors[key] ? `cs-${key}-error` : undefined}
        onChange={(e) => change(key, e.target.value)}
        className="h-10"
      />
    </Field>
  )

  return (
    <div>
      <StepHeading
        title="Talk to sales"
        description="Enterprise includes every module, unlimited users and leads, and dedicated onboarding. Tell us about your team and we’ll set it up with you."
      />
      <form noValidate onSubmit={onSubmit} className="mt-8 space-y-4">
        {text('companyName', 'Company name', 'text', 'organization')}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text('name', 'Your name', 'text', 'name')}
          {text('email', 'Work email', 'email', 'email')}
        </div>
        <Field id="cs-country" label="Country">
          <SelectInput id="cs-country" value={values.country} onChange={(e) => change('country', e.target.value as CountryCode)} className="h-10">
            {COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {COUNTRY_NAMES[c].name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id="cs-message" label="What do you need?" hint="Optional: team size, modules, integrations, timeline.">
          <TextArea id="cs-message" value={values.message} onChange={(e) => change('message', e.target.value)} />
        </Field>
        {send.isError && <ErrorAlert>{send.error.message}</ErrorAlert>}
        <Button type="submit" size="lg" loading={send.isPending} className="w-full">
          {send.isPending ? 'Sending…' : 'Send to sales'}
        </Button>
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
            Choose another plan
          </button>
        )}
      </form>
    </div>
  )
}
