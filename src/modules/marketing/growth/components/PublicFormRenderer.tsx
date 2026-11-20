import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import type { CountryCode } from '@/modules/tenancy/types'
import type { PublicForm, SubmissionChannel } from '@/modules/marketing/growth/types'
import { submitPublicForm } from '@/modules/marketing/growth/api'
import { isMobile, mobileError, mobileExample, MOBILE_RULES } from '@/shared/lib/phone'
import { Button } from '@/shared/components/ui/Button'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A lead capture form as visitors see it (hosted page /f/:key, the embed, landing pages): the form's
 * fields in order, the consent checkbox, and a hidden honeypot field for bots. On success it shows the
 * success message, or sends the visitor to the redirect URL.
 */
export function PublicFormRenderer({ form, channel, landingPage, onHeightChange }: { form: PublicForm; channel: SubmissionChannel; landingPage?: string; onHeightChange?: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [touched, setTouched] = useState(false)
  const submit = useMutation({
    mutationFn: () => submitPublicForm(form.publicKey, { values, consent, website, channel, landingPage }),
    onSuccess: (r) => {
      if (r.redirectUrl) {
        try {
          ;(window.top ?? window).location.href = r.redirectUrl
        } catch {
          window.location.href = r.redirectUrl
        }
      }
      onHeightChange?.()
    },
    onError: () => onHeightChange?.(),
  })
  const country = (form.country in MOBILE_RULES ? form.country : 'AE') as CountryCode

  const errors: Record<string, string> = {}
  if (touched) {
    for (const f of form.fields) {
      const v = (values[f.key] ?? '').trim()
      if (f.required && !v) errors[f.key] = 'Required.'
      else if (v && f.type === 'email' && !EMAIL_RE.test(v)) errors[f.key] = 'Enter a valid email address.'
      else if (v && f.type === 'mobile' && !isMobile(v, country)) errors[f.key] = mobileError(country)
    }
    if (form.consentText && !consent) errors.__consent = 'Tick the box to continue.'
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    const bad = form.fields.some((f) => {
      const v = (values[f.key] ?? '').trim()
      return (f.required && !v) || (v && f.type === 'email' && !EMAIL_RE.test(v)) || (v && f.type === 'mobile' && !isMobile(v, country))
    })
    if (bad || (form.consentText && !consent)) {
      onHeightChange?.()
      return
    }
    submit.mutate()
  }

  if (submit.isSuccess && !submit.data.redirectUrl) {
    return (
      <div role="status" className="py-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success-600" aria-hidden />
        <p className="mt-3 text-base font-semibold text-ink">{submit.data.message}</p>
      </div>
    )
  }
  if (!form.accepting) {
    return (
      <p role="status" className="rounded-lg bg-sunken px-4 py-3 text-[0.875rem] text-ink-2">
        {form.closedReason ?? 'This form isn’t accepting responses right now.'}
      </p>
    )
  }

  const set = (key: string, v: string) => setValues((x) => ({ ...x, [key]: v }))
  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4" aria-label={form.name}>
      {form.fields.map((f) => {
        const id = `pf-${f.key}`
        const common = { id, value: values[f.key] ?? '', invalid: !!errors[f.key] }
        return (
          <Field key={f.key} id={id} label={f.label} required={f.required} error={errors[f.key]} hint={f.type === 'mobile' && !errors[f.key] ? mobileExample(country) : undefined}>
            {f.type === 'industry' ? (
              <SelectInput {...common} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">Select…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectInput>
            ) : f.type === 'message' || f.type === 'custom' ? (
              <TextArea {...common} rows={f.type === 'message' ? 4 : 2} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <TextInput
                {...common}
                type={f.type === 'email' ? 'email' : f.type === 'mobile' ? 'tel' : 'text'}
                autoComplete={f.type === 'email' ? 'email' : f.type === 'mobile' ? 'tel' : f.type === 'contact_name' ? 'name' : f.type === 'company_name' ? 'organization' : 'off'}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </Field>
        )
      })}
      {form.consentText && (
        <div>
          <label className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
            <Checkbox className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={!!errors.__consent || undefined} />
            <span>{form.consentText}</span>
          </label>
          {errors.__consent && <p className="mt-1 text-xs text-danger-600">{errors.__consent}</p>}
        </div>
      )}
      {/* Honeypot: hidden from people (and from assistive tech); bots fill it. */}
      <div aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="pf-website">Website</label>
        <input id="pf-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {submit.isError && (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
          {submit.error.message}
        </p>
      )}
      <Button type="submit" className="w-full" loading={submit.isPending}>
        Submit
      </Button>
      <p className="text-xs text-muted">Your details go to {form.organizerName} so they can follow up on your request.</p>
    </form>
  )
}
